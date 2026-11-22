/**
 * MiniMax China TTS / ASR adapter.
 * Auth is Bearer API key from .env only. The key is never logged or returned.
 * Tests must inject `fetch`; the test runner will not hit the live API
 * unless fetch or allowLive is passed at the service layer.
 */
import { readFile } from "node:fs/promises";

const DEFAULT_BASE_URL = "https://api.minimax.cn/v1";

export function createMinimaxVoiceProvider(opts = {}) {
  const apiKey = typeof opts.apiKey === "string" ? opts.apiKey.trim() : String(opts.apiKey ?? process.env.MINIMAX_API_KEY ?? "").trim();
  const baseUrl = normalizeBaseUrl(opts.baseUrl ?? process.env.MINIMAX_BASE_URL ?? DEFAULT_BASE_URL);
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const available = !!apiKey;

  return {
    name: "minimax",
    available,
    async synthesize(input = {}) {
      if (!apiKey) return { ok: false, error: "unavailable" };
      if (typeof fetchFn !== "function") return { ok: false, error: "unavailable" };
      try {
        const res = await withTimeout(fetchFn(`${baseUrl}/t2a_v2`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: input.model || "speech-2.8-turbo",
            text: input.text ?? "",
            stream: false,
            voice_setting: {
              voice_id: input.voiceId,
              speed: input.speed,
              vol: input.vol,
              pitch: input.pitch,
            },
            audio_setting: {
              sample_rate: input.sampleRate || 32_000,
              bitrate: 128000,
              format: input.format || "mp3",
              channel: input.channel || 1,
            },
          }),
        }), input.timeoutMs);
        if (!res?.ok) return { ok: false, error: "synth-failed" };
        const data = await res.json();
        if (Number(data?.base_resp?.status_code) !== 0) return { ok: false, error: "synth-failed" };
        const audio = decodeAudio(data?.data?.audio);
        if (!audio) return { ok: false, error: "decode-failed" };
        const durationMs = Number(data?.extra_info?.audio_length);
        return {
          ok: true,
          audio,
          durationMs: Number.isFinite(durationMs) ? durationMs : null,
        };
      } catch (err) {
        if (err?.message === "timeout") return { ok: false, error: "timeout" };
        return { ok: false, error: "synth-failed" };
      }
    },
    async transcribe(input = {}) {
      if (!apiKey) return { ok: false, error: "unavailable" };
      if (typeof fetchFn !== "function") return { ok: false, error: "unavailable" };
      try {
        const form = new FormData();
        form.append("model", input.model || "asr-1.0");
        form.append("language", input.language || "zh");
        const mime = input.mime || "application/octet-stream";
        const bytes = input.buffer
          ? Buffer.from(input.buffer)
          : (input.filePath ? await readFile(input.filePath) : null);
        if (!bytes || !bytes.length) return { ok: false, error: "empty-audio" };
        form.append("file", new Blob([bytes], { type: mime }), input.filename || "audio.webm");
        const res = await withTimeout(fetchFn(`${baseUrl}/speech_to_text`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: form,
        }), input.timeoutMs);
        if (!res?.ok) return { ok: false, error: "asr-failed" };
        const data = await res.json();
        if (data?.base_resp && Number(data.base_resp.status_code) !== 0) {
          return { ok: false, error: "asr-failed" };
        }
        const text = firstText(data);
        if (!text) return { ok: false, error: "empty" };
        return { ok: true, text };
      } catch (err) {
        if (err?.message === "timeout") return { ok: false, error: "timeout" };
        return { ok: false, error: "asr-failed" };
      }
    },
  };
}

function firstText(data) {
  const candidates = [
    data?.text,
    data?.data?.text,
    data?.data?.result?.text,
    data?.result?.text,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function decodeAudio(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value.length ? value : null;
  if (typeof value !== "string") return null;
  const hex = value.trim().replace(/\s+/g, "");
  if (!hex || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) return null;
  try {
    const buf = Buffer.from(hex, "hex");
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).trim().replace(/\/$/, "");
}

function withTimeout(promise, ms) {
  const limit = Number(ms);
  if (!Number.isFinite(limit) || limit <= 0) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), limit);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export { decodeAudio, normalizeBaseUrl };
