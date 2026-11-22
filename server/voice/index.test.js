import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { handleChat, resetChatLocks } from "../chat/index.js";
import { config as chatConfig } from "../chat/config.js";
import { makeWorld, NOON } from "../life/test-helpers.js";
import { createDummyProvider } from "./provider/dummy.js";
import { cacheKey } from "./cache.js";
import { createVoiceService, presentVoice } from "./index.js";
import { shouldSynthesize } from "./config.js";

const temps = [];
after(() => {
  resetChatLocks();
  for (const dir of temps) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "house-voice-"));
  temps.push(dir);
  return dir;
}

function livingWorld() {
  return makeWorld({
    viewer: { present: true, room: "living", lastSeenAt: NOON },
  });
}

function settingsWith(patch = {}) {
  return {
    house: { model: { provider: "dummy", model: null }, voice: { enabled: true }, ...(patch.house || {}) },
    characters: {
      qingqing: { identity: { id: "qingqing", name: "青青" }, voice: { ...(patch.qingqing || {}) } },
      linxia: { identity: { id: "linxia", name: "林夏" }, voice: { ...(patch.linxia || {}) } },
      xiaonan: { identity: { id: "xiaonan", name: "小南" }, voice: { ...(patch.xiaonan || {}) } },
    },
  };
}

describe("voice service", () => {
  it("does not synthesize punctuation-only or over-long lines", () => {
    assert.equal(shouldSynthesize(""), false);
    assert.equal(shouldSynthesize("  ……！！  "), false);
    assert.equal(shouldSynthesize("你好。"), true);
    assert.equal(shouldSynthesize("啊".repeat(501)), false);
  });

  it("keeps a landed chat line when synthesis fails", async () => {
    const world = livingWorld();
    const calls = [];
    const ready = [];
    const failed = [];
    const voice = createVoiceService({
      dataDir: tempDir(),
      settings: settingsWith(),
      provider: createDummyProvider({ calls, failSynthesize: true }),
      onReady: (p) => ready.push(p),
      onFailed: (p) => failed.push(p),
    });
    const result = await handleChat(world, {
      characterId: "qingqing",
      text: "你好。",
      now: new Date(NOON),
      settings: settingsWith(),
      provider: {
        name: "spy",
        async complete() { return { characterId: "qingqing", line: "嗯，我在。" }; },
      },
      cfg: chatConfig,
      scheduleVoice: (clip) => voice.scheduleVoice(clip),
    });
    assert.equal(result.ok, true);
    assert.equal(world.characters.qingqing.line, "嗯，我在。");
    await voice.idle();
    assert.equal(world.characters.qingqing.line, "嗯，我在。");
    assert.equal(ready.length, 0);
    assert.equal(failed.length, 1);
    assert.ok(calls.some((c) => c.kind === "synthesize"));
  });

  it("does not call the provider again when the cache key hits", async () => {
    const calls = [];
    const voice = createVoiceService({
      dataDir: tempDir(),
      settings: settingsWith(),
      provider: createDummyProvider({ calls }),
    });
    const clip = {
      characterId: "qingqing",
      text: "早上好。",
      lineAt: "2026-11-21T02:00:00.000Z",
      lineTo: "viewer",
      volume: "normal",
      room: "living",
    };
    assert.ok(voice.scheduleVoice(clip));
    await voice.idle();
    assert.ok(voice.scheduleVoice({ ...clip, lineAt: "2026-11-21T02:01:00.000Z" }));
    await voice.idle();
    const synths = calls.filter((c) => c.kind === "synthesize");
    assert.equal(synths.length, 1);
  });

  it("synthesizes the primary reply before an interjection", async () => {
    const order = [];
    const voice = createVoiceService({
      dataDir: tempDir(),
      settings: settingsWith(),
      provider: createDummyProvider({
        async synthesize(input) {
          order.push(input.text);
          return { ok: true, audio: Buffer.from("x"), durationMs: 200 };
        },
      }),
    });
    voice.scheduleVoice({
      characterId: "qingqing",
      text: "主回复",
      lineTo: "viewer",
      volume: "normal",
      room: "living",
    });
    voice.scheduleVoice({
      characterId: "xiaonan",
      text: "插话",
      lineTo: "viewer",
      lineKind: "interject",
      volume: "normal",
      room: "living",
    });
    await voice.idle();
    assert.deepEqual(order, ["主回复", "插话"]);
  });

  it("skips synthesis for a character whose 朗读 switch is off, and still synthesizes others", async () => {
    const calls = [];
    const settings = settingsWith({ qingqing: { enabled: false } });
    const voice = createVoiceService({
      dataDir: tempDir(),
      getSettings: () => settings,
      provider: createDummyProvider({ calls }),
    });
    const skipped = voice.scheduleVoice({
      characterId: "qingqing",
      text: "这句不应合成。",
      lineTo: "viewer",
      volume: "normal",
      room: "living",
    });
    const kept = voice.scheduleVoice({
      characterId: "linxia",
      text: "这句要合成。",
      lineTo: "viewer",
      volume: "normal",
      room: "living",
    });
    assert.equal(skipped, null);
    assert.ok(kept);
    await voice.idle();
    const texts = calls.filter((c) => c.kind === "synthesize").map((c) => c.input.text);
    assert.deepEqual(texts, ["这句要合成。"]);
  });

  it("lets text chat succeed when the voice provider has no key, and fails transcription closed", async () => {
    const world = livingWorld();
    const fetchCalls = [];
    const voice = createVoiceService({
      dataDir: tempDir(),
      settings: settingsWith(),
      provider: {
        name: "minimax",
        available: false,
        async synthesize() { return { ok: false, error: "unavailable" }; },
        async transcribe() { return { ok: false, error: "unavailable" }; },
      },
    });
    const result = await handleChat(world, {
      characterId: "qingqing",
      text: "在吗？",
      now: new Date(NOON),
      settings: settingsWith(),
      provider: {
        name: "spy",
        async complete() { return { characterId: "qingqing", line: "在的。" }; },
      },
      cfg: chatConfig,
      scheduleVoice: (clip) => voice.scheduleVoice(clip),
    });
    assert.equal(result.ok, true);
    assert.equal(world.characters.qingqing.line, "在的。");
    await voice.idle();
    const asr = await voice.transcribe({ buffer: Buffer.from("abc"), mime: "audio/webm" });
    assert.equal(asr.ok, false);
    assert.equal(asr.error.includes("密钥"), false);
    assert.equal(asr.error.includes("api"), false);
    assert.equal(JSON.stringify(asr).includes("MINIMAX"), false);
    assert.equal(fetchCalls.length, 0);
  });

  it("exposes maxRecordSec and per-character 朗读 flags on the slim public voice object, without secrets", () => {
    const settings = settingsWith({
      house: { voice: { enabled: true, maxRecordSec: 20 } },
      qingqing: { enabled: false },
    });
    const voice = createVoiceService({
      dataDir: tempDir(),
      settings,
      provider: createDummyProvider(),
    });
    const pub = voice.publicConfig();
    const presented = presentVoice(settings, { available: true });
    for (const body of [pub, presented]) {
      assert.equal(body.maxRecordSec, 20);
      assert.equal(body.characters.qingqing.enabled, false);
      assert.equal(body.characters.linxia.enabled, true);
      assert.equal(body.characters.xiaonan.enabled, true);
      assert.equal(Object.keys(body.characters.qingqing).join(","), "enabled");
      assert.equal(JSON.stringify(body).includes("apiKey"), false);
      assert.equal(JSON.stringify(body).includes("MINIMAX"), false);
      assert.equal(JSON.stringify(body).toLowerCase().includes("voiceid"), false);
    }
  });

  it("does not call the provider when there are no SSE clients or the viewer is away, and still synthesizes for a present viewer with a client", async () => {
    const settings = settingsWith();
    const clip = {
      characterId: "qingqing",
      text: "这句要不要合成。",
      lineTo: "viewer",
      volume: "normal",
      room: "living",
    };

    const none = [];
    const empty = createVoiceService({
      dataDir: tempDir(),
      settings,
      provider: createDummyProvider({ calls: none }),
      getSseClientCount: () => 0,
      getViewer: () => ({ present: true, room: "living" }),
    });
    assert.equal(empty.scheduleVoice(clip), null);
    await empty.idle();
    assert.equal(none.length, 0);

    const awayCalls = [];
    const away = createVoiceService({
      dataDir: tempDir(),
      settings,
      provider: createDummyProvider({ calls: awayCalls }),
      getSseClientCount: () => 1,
      getViewer: () => ({ present: false, room: "living" }),
    });
    assert.equal(away.scheduleVoice(clip), null);
    await away.idle();
    assert.equal(awayCalls.length, 0);

    const okCalls = [];
    const ok = createVoiceService({
      dataDir: tempDir(),
      settings,
      provider: createDummyProvider({ calls: okCalls }),
      getSseClientCount: () => 1,
      getViewer: () => ({ present: true, room: "kitchen" }),
    });
    assert.ok(ok.scheduleVoice(clip));
    await ok.idle();
    assert.equal(okCalls.filter((c) => c.kind === "synthesize").length, 1);
  });

  it("reuses a cache-key clip URL on a second schedule and evicts in-memory buffers past the cap", async () => {
    const settings = settingsWith();
    const calls = [];
    const voice = createVoiceService({
      dataDir: tempDir(),
      settings,
      provider: createDummyProvider({ calls, audio: Buffer.from("ID3same") }),
      memoryMaxClips: 3,
      memoryMaxBuffers: 1,
      bufferTtlMs: 60_000,
    });
    const first = voice.scheduleVoice({
      characterId: "qingqing",
      text: "同一句。",
      lineAt: "2026-11-21T04:00:00.000Z",
      lineTo: "viewer",
      volume: "normal",
      room: "living",
    });
    await voice.idle();
    const resolved = {
      model: "speech-2.8-turbo",
      voiceId: "Chinese (Mandarin)_Soft_Girl",
      speed: 0.92,
      vol: 1,
      pitch: 0,
      format: "mp3",
      text: "同一句。",
    };
    const key = cacheKey(resolved);
    assert.equal(first.id, key);
    assert.equal(first.url, `/api/voice/clips/${key}`);

    const again = voice.scheduleVoice({
      characterId: "qingqing",
      text: "同一句。",
      lineAt: "2026-11-21T04:01:00.000Z",
      lineTo: "viewer",
      volume: "normal",
      room: "living",
    });
    await voice.idle();
    assert.equal(again.id, first.id);
    assert.equal(again.url, first.url);
    assert.equal(calls.filter((c) => c.kind === "synthesize").length, 1);

    const served = voice.getClip(first.id);
    assert.ok(served.buffer);
    assert.equal(Buffer.from(served.buffer).toString(), "ID3same");

    for (const text of ["甲。", "乙。", "丙。"]) {
      voice.scheduleVoice({
        characterId: "linxia",
        text,
        lineTo: "viewer",
        volume: "normal",
        room: "living",
      });
    }
    await voice.idle();
    assert.ok(voice.clips.size <= 3);
    const buffered = [...voice.clips.values()].filter((clip) => clip.buffer).length;
    assert.ok(buffered <= 1);
    const reloaded = voice.getClip(first.id);
    assert.ok(reloaded?.buffer);
    assert.equal(Buffer.from(reloaded.buffer).toString(), "ID3same");
  });
});
