import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemory, mergeMemoryConfig } from "./memory/index.js";
import { getDiary, getDiarySource } from "./memory/diaries.js";
import { nowClock } from "./clock.js";
import { createSeed } from "./seed.js";
import { createWorld, resolveDiaryProvider } from "./world.js";
import { createVoiceService } from "./voice/index.js";
import { createDummyProvider } from "./voice/provider/dummy.js";

const SAT_NOON = "2026-11-21T04:00:00.000Z";
const SUN_MORNING = "2026-11-21T23:00:00.000Z";

const temps = [];
const memories = [];

after(() => {
  for (const memory of memories) {
    try { memory.close(); } catch { /* already closed */ }
  }
  for (const dir of temps) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "house-world-"));
  temps.push(dir);
  return dir;
}

function testMemory(overrides = {}) {
  const memory = createMemory({
    dbPath: ":memory:",
    config: mergeMemoryConfig(overrides),
  });
  memories.push(memory);
  return memory;
}

function dualProvider() {
  const calls = [];
  const provider = {
    name: "spy",
    async complete(input) {
      calls.push(input);
      if (input?.purpose === "memory-compress") {
        return JSON.stringify({ dayDiary: "今天把火锅和明天吃面的约定记下来了。" });
      }
      return { action: "sit", room: "living" };
    },
  };
  return { calls, provider };
}

function settingsStub() {
  return {
    house: { model: { provider: "dummy", model: null } },
    characters: {},
  };
}

describe("resolveDiaryProvider", () => {
  it("prefers an injected provider, then memory.model, and stays off when compress is disabled", () => {
    const injected = { name: "injected", complete: async () => "{}" };
    assert.equal(resolveDiaryProvider({ provider: injected }), injected);

    const memory = testMemory({ model: { provider: "dummy", model: "compress-test" } });
    const seen = [];
    const provider = resolveDiaryProvider({
      memory,
      settings: settingsStub(),
      getProvider: (opts) => {
        seen.push(opts);
        return { name: "from-get", complete: async () => "{}" };
      },
    });
    assert.equal(provider.name, "from-get");
    assert.equal(seen[0].name, "dummy");
    assert.equal(seen[0].model, "compress-test");
    assert.equal(JSON.stringify(seen[0]).includes("apiKey"), false);
    assert.equal(JSON.stringify(seen[0]).includes("KEY"), false);

    const off = testMemory({ compress: { enabled: false } });
    assert.equal(resolveDiaryProvider({ memory: off, settings: settingsStub() }), null);
  });
});

describe("world tickDiary wiring", () => {
  it("passes the tick provider into the daily compress job after a game-day rollover", async () => {
    const memory = testMemory();
    const { calls, provider } = dualProvider();
    const world = createWorld(tempDir(), {
      memory,
      provider,
      settings: settingsStub(),
      now: new Date(SAT_NOON),
    });
    await world.ready;
    const qingqing = world.world.characters.qingqing;
    assert.ok(qingqing);
    memory.recordChat({
      character: qingqing,
      userText: "今天晚上想吃火锅，还要再买点菜和调料，顺便把明天的午饭也定下来。",
      reply: "好啊，我来准备锅和芝麻酱，也帮你记一下明天吃面。",
      now: new Date(SAT_NOON),
    });
    const compressBefore = calls.filter((item) => item.purpose === "memory-compress").length;
    await world.tick(new Date(SUN_MORNING));
    const compressCalls = calls.filter((item) => item.purpose === "memory-compress");
    assert.equal(compressCalls.length, compressBefore + 1);
    const row = getDiary(memory.db, "qingqing", "day", "2026-11-21");
    assert.equal(row?.text, "今天把火锅和明天吃面的约定记下来了。");
    assert.equal(getDiarySource(memory.db, "qingqing", "day", "2026-11-21"), "model");
  });

  it("resolves a diary provider from memory.model when no provider is injected", async () => {
    const memory = testMemory({ model: { provider: "dummy", model: "memory-compress" } });
    const { calls, provider } = dualProvider();
    const seen = [];
    const world = createWorld(tempDir(), {
      memory,
      settings: settingsStub(),
      now: new Date(SAT_NOON),
      getProvider: (opts) => {
        seen.push(opts);
        return provider;
      },
    });
    await world.ready;
    memory.recordChat({
      character: world.world.characters.qingqing,
      userText: "今天晚上想吃火锅，还要再买点菜和调料，顺便把明天的午饭也定下来。",
      reply: "好啊，我来准备锅和芝麻酱，也帮你记一下明天吃面。",
      now: new Date(SAT_NOON),
    });
    await world.tick(new Date(SUN_MORNING));
    assert.ok(seen.some((opts) => opts.name === "dummy" && opts.model === "memory-compress"));
    assert.ok(calls.some((item) => item.purpose === "memory-compress"));
    assert.equal(getDiarySource(memory.db, "qingqing", "day", "2026-11-21"), "model");
  });
});



function seededWorldDir() {
  const dir = tempDir();
  const world = createSeed(nowClock(new Date(SAT_NOON)));
  writeFileSync(path.join(dir, "world.json"), `${JSON.stringify(world, null, 2)}\n`);
  return dir;
}

function voiceWorldSettings(patch = {}) {
  return {
    house: {
      model: { provider: "dummy", model: null },
      think: { intervalMs: 0 },
      voice: { enabled: true, micEnabled: true, maxRecordSec: 12 },
      ...(patch.house || {}),
    },
    characters: {
      qingqing: { identity: { id: "qingqing", name: "青青" }, voice: { enabled: true } },
      linxia: { identity: { id: "linxia", name: "林夏" }, voice: { enabled: true } },
      xiaonan: { identity: { id: "xiaonan", name: "小南" }, voice: { enabled: true } },
      ...(patch.characters || {}),
    },
  };
}

function facadeProvider() {
  const calls = [];
  const provider = {
    name: "spy",
    async complete(input) {
      calls.push(input);
      if (input?.purpose === "memory-compress") {
        return JSON.stringify({ dayDiary: "今天没什么特别的。" });
      }
      if (input?.options) {
        return {
          characterId: input.character?.id,
          speech: { to: "viewer", line: "你来了，我刚坐下。", reason: "看见你进了客厅" },
        };
      }
      return { characterId: input.character?.id || "qingqing", line: "嗯，我在。" };
    },
  };
  return { calls, provider };
}

describe("createWorld voice wiring", () => {
  it("enqueues TTS for a landed chat line and a proactive think line through the facade", async () => {
    const settings = voiceWorldSettings();
    const memory = testMemory({ compress: { enabled: false } });
    const synthCalls = [];
    const voice = createVoiceService({
      dataDir: tempDir(),
      getSettings: () => settings,
      provider: createDummyProvider({ calls: synthCalls }),
    });
    const { provider } = facadeProvider();
    const world = createWorld(seededWorldDir(), {
      memory,
      voice,
      provider,
      settings,
      now: new Date(SAT_NOON),
    });
    await world.ready;

    world.setViewer({ room: "living", present: true });
    const chat = await world.chat({
      characterId: "qingqing",
      text: "你好。",
      now: new Date(SAT_NOON),
      sseClientCount: 1,
    });
    await voice.idle();
    assert.equal(chat.ok, true);
    assert.equal(world.world.characters.qingqing.line, "嗯，我在。");
    const afterChat = synthCalls.filter((item) => item.kind === "synthesize").length;
    assert.equal(afterChat, 1);

    for (const character of Object.values(world.world.characters)) {
      character.lastThinkAt = null;
      character.lastProactiveAt = null;
      character.proactiveCountToday = 0;
    }
    const beforeThink = synthCalls.filter((item) => item.kind === "synthesize").length;
    await world.tick(new Date(SAT_NOON), { sseClientCount: 1 });
    await voice.idle();
    const afterThink = synthCalls.filter((item) => item.kind === "synthesize").length;
    assert.ok(afterThink > beforeThink, "think/proactive line should enqueue TTS through createWorld");
    const spoken = Object.values(world.world.characters).some((c) => c.line === "你来了，我刚坐下。");
    assert.equal(spoken, true);
  });

  it("does not call the voice provider when there are no SSE clients or the viewer is away", async () => {
    const settings = voiceWorldSettings();
    const memory = testMemory({ compress: { enabled: false } });
    const synthCalls = [];
    const voice = createVoiceService({
      dataDir: tempDir(),
      getSettings: () => settings,
      provider: createDummyProvider({ calls: synthCalls }),
    });
    const { provider } = facadeProvider();
    const world = createWorld(tempDir(), {
      memory,
      voice,
      provider,
      settings,
      now: new Date(SAT_NOON),
    });
    await world.ready;

    world.setViewer({ room: "living", present: true });
    const silent = await world.chat({
      characterId: "qingqing",
      text: "你好。",
      now: new Date(SAT_NOON),
      sseClientCount: 0,
    });
    await voice.idle();
    assert.equal(silent.ok, true);
    assert.equal(world.world.characters.qingqing.line, "嗯，我在。");
    assert.equal(synthCalls.filter((item) => item.kind === "synthesize").length, 0);

    world.setViewer({ room: "living", present: false });
    const away = await world.chat({
      characterId: "qingqing",
      text: "还在吗？",
      now: new Date(SAT_NOON),
      sseClientCount: 1,
    });
    await voice.idle();
    assert.equal(away.ok, true);
    assert.equal(synthCalls.filter((item) => item.kind === "synthesize").length, 0);
  });

  it("still runs life and save when tick has no SSE clients, but does not return a full public state", async () => {
    const memory = testMemory({ compress: { enabled: false } });
    const world = createWorld(tempDir(), {
      memory,
      provider: { name: "spy", async complete() { return { action: "sit", room: "living" }; } },
      settings: voiceWorldSettings(),
      now: new Date(SAT_NOON),
    });
    await world.ready;
    const savedBefore = world.savedAt;
    const state = await world.tick(new Date("2026-11-21T04:00:30.000Z"), { sseClientCount: 0 });
    assert.equal(state, null);
    assert.ok(world.savedAt);
    assert.notEqual(world.savedAt, savedBefore);
    assert.equal(world.world.lastTickAt, "2026-11-21T04:00:30.000Z");
    const listed = await world.tick(new Date("2026-11-21T04:01:00.000Z"), { sseClientCount: 1 });
    assert.ok(listed?.characters?.qingqing);
    assert.ok(listed.voice.maxRecordSec);
    assert.equal(listed.voice.characters.qingqing.enabled, true);
    assert.equal(JSON.stringify(listed.voice).includes("apiKey"), false);
    assert.equal(JSON.stringify(listed.voice).includes("MINIMAX"), false);
  });
});
