/**
 * Voice service: schedule TTS after a line has landed, serve clips, transcribe.
 * Text is the source of truth. Failures never roll back world or memory.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveChat, resolveSpeech, resolveVoice } from "../settings/index.js";
import { resolveVoiceCredentials } from "../secrets/resolve.js";
import { cacheKey, createVoiceCache } from "./cache.js";
import { CHARACTER_VOICE_DEFAULTS, config as voiceDefaults, shouldSynthesize, truncateAsrText } from "./config.js";
import { canHearVoice } from "./hear.js";
import { createDummyProvider } from "./provider/dummy.js";
import { createMinimaxVoiceProvider } from "./provider/minimax.js";
import { createQueue } from "./queue.js";

export function createVoiceService(opts = {}) {
  const dataDir = opts.dataDir;
  const getSettings = typeof opts.getSettings === "function" ? opts.getSettings : () => opts.settings ?? null;
  const cacheDir = opts.cacheDir ?? (dataDir ? path.join(dataDir, "voice-cache") : null);
  const clips = new Map();
  const cacheByLimit = new Map();
  const queue = createQueue({ concurrency: voiceDefaults.synthConcurrency });

  function settings() {
    return getSettings() ?? null;
  }

  function houseVoice() {
    return resolveVoice(null, settings());
  }

  function provider(characterId = null) {
    if (opts.provider) return opts.provider;
    if (inTestContext() && !opts.fetch && !opts.allowLive) {
      return createDummyProvider({ available: false });
    }
    const creds = resolveVoiceCredentials(characterId, {
      settings: settings(),
      root: settings()?.root,
    });
    return createMinimaxVoiceProvider({
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      fetch: opts.fetch,
      allowLive: opts.allowLive,
    });
  }

  function cacheFor(cfg) {
    const dir = cacheDir;
    const maxFiles = cfg.cacheMaxFiles;
    const maxBytes = cfg.cacheMaxBytes;
    const stamp = `${dir}|${maxFiles}|${maxBytes}`;
    let cache = cacheByLimit.get(stamp);
    if (!cache) {
      cache = createVoiceCache({ dir, maxFiles, maxBytes });
      cacheByLimit.set(stamp, cache);
    }
    return cache;
  }

  function nowMs() {
    return typeof opts.nowMs === "function" ? opts.nowMs() : Date.now();
  }

  function memoryLimits() {
    const cfg = houseVoice();
    return {
      maxClips: positiveInt(opts.memoryMaxClips ?? cfg.memoryMaxClips, voiceDefaults.memoryMaxClips),
      maxBuffers: positiveInt(opts.memoryMaxBuffers ?? cfg.memoryMaxBuffers, voiceDefaults.memoryMaxBuffers),
      bufferTtlMs: nonNegativeInt(opts.bufferTtlMs ?? cfg.bufferTtlMs, voiceDefaults.bufferTtlMs),
    };
  }

  function canDeliverAudio() {
    const count = typeof opts.getSseClientCount === "function"
      ? Number(opts.getSseClientCount())
      : undefined;
    if (Number.isFinite(count) && count <= 0) return false;
    const viewer = typeof opts.getViewer === "function" ? opts.getViewer() : undefined;
    if (viewer && viewer.present === false) return false;
    return true;
  }

  function publicConfig() {
    const cfg = houseVoice();
    const ready = provider(null);
    const creds = resolveVoiceCredentials(null, { settings: settings(), root: settings()?.root });
    const available = opts.provider ? !!ready?.available : creds.available && !!ready?.available;
    return slimVoice(cfg, settings(), { available });
  }

  function scheduleVoice(input = {}) {
    const cfgHouse = houseVoice();
    if (!cfgHouse.enabled) return null;
    if (!canDeliverAudio()) return null;
    const characterId = typeof input.characterId === "string" ? input.characterId.trim() : "";
    if (!characterId) return null;
    const resolved = resolveVoice(characterId, settings());
    if (!resolved.enabled) return null;
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!shouldSynthesize(text, resolved.maxTextChars)) return null;

    const key = cacheKey({
      model: resolved.model,
      voiceId: resolved.voiceId,
      speed: resolved.speed,
      vol: resolved.vol,
      pitch: resolved.pitch,
      format: resolved.format,
      text,
    });
    const meta = {
      characterId,
      text,
      lineAt: typeof input.lineAt === "string" && input.lineAt.trim() ? input.lineAt.trim() : null,
      lineTo: typeof input.lineTo === "string" && input.lineTo.trim() ? input.lineTo.trim() : null,
      lineKind: input.lineKind === "interject" ? "interject" : null,
      volume: normalizeVolume(input.volume),
      room: typeof input.room === "string" && input.room.trim() ? input.room.trim() : null,
    };

    const existing = clips.get(key);
    if (existing?.status === "ready") {
      Object.assign(existing, meta);
      existing.url = `/api/voice/clips/${key}`;
      existing.lastAccess = nowMs();
      if (typeof opts.onReady === "function") opts.onReady(readyPayload(existing));
      return existing;
    }
    if (existing?.status === "queued") {
      Object.assign(existing, meta);
      return existing;
    }

    const clip = {
      id: key,
      ...meta,
      status: "queued",
      url: `/api/voice/clips/${key}`,
      durationMs: null,
      file: null,
      lastAccess: nowMs(),
    };
    clips.set(clip.id, clip);
    pruneClipMemory();
    const job = queue.enqueue(() => synthesizeClip(clip));
    job.catch(() => {
      if (clip.status === "queued") markFailed(clip);
    });
    return clip;
  }

  async function synthesizeClip(clip) {
    if (!canDeliverAudio()) {
      clip.status = "skipped";
      return clip;
    }
    const resolved = resolveVoice(clip.characterId, settings());
    if (!resolved.enabled) {
      clip.status = "skipped";
      return clip;
    }
    const key = cacheKey({
      model: resolved.model,
      voiceId: resolved.voiceId,
      speed: resolved.speed,
      vol: resolved.vol,
      pitch: resolved.pitch,
      format: resolved.format,
      text: clip.text,
    });
    const cache = cacheFor(resolved);
    const hit = cache.get(key);
    if (hit) {
      return markReady(clip, hit.file, hit.buffer, null);
    }

    const ready = provider(clip.characterId);
    const input = {
      text: clip.text,
      model: resolved.model,
      voiceId: resolved.voiceId,
      speed: resolved.speed,
      vol: resolved.vol,
      pitch: resolved.pitch,
      format: resolved.format,
      sampleRate: resolved.sampleRate,
      channel: resolved.channel,
      timeoutMs: resolved.timeoutMs,
    };
    let result = await safeSynth(ready, input);
    let attempts = 0;
    const retry = Number(resolved.retry) || 0;
    while (!result.ok && attempts < retry) {
      attempts += 1;
      result = await safeSynth(ready, input);
    }
    if (!result.ok) {
      return markFailed(clip);
    }
    const stored = cache.put(key, result.audio);
    return markReady(clip, stored?.file, result.audio, result.durationMs);
  }

  function markReady(clip, file, buffer, durationMs) {
    clip.status = "ready";
    clip.file = file || null;
    clip.buffer = buffer;
    clip.durationMs = Number.isFinite(Number(durationMs)) ? Number(durationMs) : null;
    clip.url = `/api/voice/clips/${clip.id}`;
    clip.readyAt = nowMs();
    clip.lastAccess = clip.readyAt;
    pruneClipMemory();
    const payload = readyPayload(clip);
    if (typeof opts.onReady === "function") opts.onReady(payload);
    return clip;
  }

  function markFailed(clip) {
    clip.status = "failed";
    if (typeof opts.onFailed === "function") {
      opts.onFailed({ id: clip.id, characterId: clip.characterId, lineAt: clip.lineAt });
    }
    return clip;
  }

  function fillBufferFromDisk(clip, key) {
    if (clip?.file && existsSync(clip.file)) {
      clip.buffer = readFileSync(clip.file);
      return clip.buffer;
    }
    const file = clip?.file && cacheDir
      ? path.join(cacheDir, path.basename(clip.file))
      : (cacheDir && key ? path.join(cacheDir, `${key}.mp3`) : null);
    if (file && existsSync(file)) {
      clip.file = file;
      clip.buffer = readFileSync(file);
      return clip.buffer;
    }
    const hit = cacheFor(houseVoice()).get(key);
    if (hit?.buffer) {
      clip.file = hit.file;
      clip.buffer = hit.buffer;
      return clip.buffer;
    }
    return null;
  }

  function getClip(id) {
    pruneClipMemory();
    const key = typeof id === "string" ? id.trim() : "";
    if (!key) return null;
    let clip = clips.get(key);
    if (clip?.status === "ready") {
      const buffer = clip.buffer || fillBufferFromDisk(clip, key);
      if (buffer) {
        clip.lastAccess = nowMs();
        pruneClipMemory();
        return { ...clip, buffer };
      }
    }
    const hit = cacheFor(houseVoice()).get(key);
    if (!hit?.buffer) return null;
    clip = {
      id: key,
      status: "ready",
      url: `/api/voice/clips/${key}`,
      file: hit.file,
      buffer: hit.buffer,
      lastAccess: nowMs(),
    };
    clips.set(key, clip);
    pruneClipMemory();
    return { ...clip, buffer: hit.buffer };
  }

  function pruneClipMemory() {
    const { maxClips, maxBuffers, bufferTtlMs } = memoryLimits();
    const now = nowMs();
    const withBuffer = [];
    for (const clip of clips.values()) {
      if (!clip.buffer) continue;
      const touched = clip.lastAccess ?? clip.readyAt ?? 0;
      if (now - touched >= bufferTtlMs) {
        clip.buffer = undefined;
        continue;
      }
      withBuffer.push(clip);
    }
    withBuffer.sort((a, b) => (a.lastAccess ?? 0) - (b.lastAccess ?? 0));
    while (withBuffer.length > maxBuffers) {
      const victim = withBuffer.shift();
      victim.buffer = undefined;
    }
    const evictable = [];
    for (const [id, clip] of clips) {
      if (clip.status === "queued") continue;
      evictable.push([id, clip]);
    }
    evictable.sort((a, b) => (a.lastAccess ?? 0) - (b.lastAccess ?? 0));
    while (clips.size > maxClips && evictable.length) {
      const [id, clip] = evictable.shift();
      if (clip.status === "queued") continue;
      clip.buffer = undefined;
      clips.delete(id);
    }
  }

  async function transcribe({ buffer, mime, filename } = {}) {
    const cfg = houseVoice();
    if (!cfg.micEnabled) return { ok: false, error: "麦克风已关闭。" };
    const ready = provider(null);
    if (!ready?.available) return { ok: false, error: "语音识别暂时不可用。" };
    const bytes = buffer ? Buffer.from(buffer) : null;
    if (!bytes || !bytes.length) return { ok: false, error: "没能识别出内容。" };

    const tmp = mkdtempSync(path.join(tmpdir(), "house-voice-asr-"));
    const filePath = path.join(tmp, filename || "audio.webm");
    try {
      writeFileSync(filePath, bytes);
      const result = await ready.transcribe({
        buffer: bytes,
        filePath,
        mime: mime || "application/octet-stream",
        filename: filename || "audio.webm",
        model: cfg.asrModel,
        language: cfg.language,
        timeoutMs: cfg.asrTimeoutMs,
      });
      if (!result?.ok) return { ok: false, error: asrErrorText(result?.error) };
      const chat = resolveChat(null, settings());
      const text = truncateAsrText(result.text, chat.maxInputChars);
      if (!text) return { ok: false, error: "没能识别出内容。" };
      return { ok: true, text };
    } catch {
      return { ok: false, error: "语音识别暂时不可用。" };
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  return {
    scheduleVoice,
    getClip,
    transcribe,
    publicConfig,
    canHearVoice,
    idle: () => queue.idle(),
    pruneClipMemory,
    clips,
    queue,
  };
}

export function presentVoice(settings, extra = {}) {
  return slimVoice(resolveVoice(null, settings), settings, extra);
}

export function characterVoiceFlags(settings) {
  const ids = new Set(Object.keys(CHARACTER_VOICE_DEFAULTS));
  for (const id of Object.keys(settings?.characters ?? {})) {
    if (typeof id === "string" && id.trim()) ids.add(id.trim());
  }
  const out = {};
  for (const id of [...ids].sort()) {
    const resolved = resolveVoice(id, settings);
    out[id] = { enabled: resolved.characterEnabled !== false };
  }
  return out;
}

function slimVoice(cfg, settings, extra = {}) {
  const out = {
    enabled: !!cfg.enabled,
    micEnabled: !!cfg.micEnabled,
    autoSend: !!cfg.autoSend,
    masterVolume: cfg.masterVolume,
    maxRecordSec: positiveInt(cfg.maxRecordSec, voiceDefaults.maxRecordSec),
    characters: characterVoiceFlags(settings),
  };
  if (typeof extra.available === "boolean") out.available = extra.available;
  return out;
}

function positiveInt(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  return fallback;
}

function nonNegativeInt(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.round(n);
  return fallback;
}

export function npcLineVisibleOnlySameRoom(settings) {
  const speech = resolveSpeech(null, settings);
  return speech?.npcTalk?.lineVisibleOnlySameRoom !== false;
}

function readyPayload(clip) {
  return {
    id: clip.id,
    characterId: clip.characterId,
    lineAt: clip.lineAt,
    url: clip.url,
    durationMs: clip.durationMs,
    room: clip.room,
    volume: clip.volume,
    lineTo: clip.lineTo,
    lineKind: clip.lineKind,
  };
}

function normalizeVolume(value) {
  if (value === "whisper" || value === "loud" || value === "normal") return value;
  return "normal";
}

async function safeSynth(provider, input) {
  try {
    if (!provider?.synthesize) return { ok: false, error: "unavailable" };
    const result = await provider.synthesize(input);
    if (result?.ok && result.audio) return result;
    return { ok: false, error: result?.error || "synth-failed" };
  } catch {
    return { ok: false, error: "synth-failed" };
  }
}

function asrErrorText(code) {
  if (code === "empty") return "没能识别出内容。";
  return "语音识别暂时不可用。";
}

function inTestContext() {
  return process.env.NODE_TEST_CONTEXT != null;
}

export { canHearVoice, shouldSynthesize, truncateAsrText };
