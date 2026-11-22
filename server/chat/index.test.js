import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createMemory, mergeMemoryConfig } from "../memory/index.js";
import { makeWorld, NOON } from "../life/test-helpers.js";
import { applyReply } from "./apply.js";
import { config } from "./config.js";
import { handleChat, resetChatLocks } from "./index.js";
import { nowClock } from "../clock.js";

const memories = [];

function memoryWith(overrides = {}) {
  const memory = createMemory({
    dbPath: ":memory:",
    config: mergeMemoryConfig({ workingMemoryChars: 80, ...overrides }),
  });
  memories.push(memory);
  return memory;
}

function livingWorld(patch = {}) {
  return makeWorld({
    viewer: { present: true, room: "living", lastSeenAt: NOON },
    ...patch,
  });
}

function replyProvider(payload, calls) {
  return {
    name: "spy",
    async complete(input) {
      calls.push(input);
      return payload;
    },
  };
}

afterEach(() => {
  resetChatLocks();
  while (memories.length) {
    const memory = memories.pop();
    try { memory.close(); } catch { /* already closed */ }
  }
});

describe("player chat", () => {
  it("does not increment proactive counters when countAgainstProactiveCap is false", async () => {
    const world = livingWorld();
    const character = world.characters.qingqing;
    character.proactiveCountToday = 1;
    character.lastProactiveAt = "2026-11-21T02:00:00.000Z";
    const calls = [];
    const result = await handleChat(world, {
      characterId: "qingqing",
      text: "你好。",
      now: new Date(NOON),
      settings: null,
      provider: replyProvider({ characterId: "qingqing", line: "嗯，我在。" }, calls),
      cfg: { ...config, countAgainstProactiveCap: false },
    });
    assert.equal(result.ok, true);
    assert.equal(character.line, "嗯，我在。");
    assert.equal(character.action, "talk");
    assert.equal(character.room, "living");
    assert.equal(character.proactiveCountToday, 1);
    assert.equal(character.lastProactiveAt, "2026-11-21T02:00:00.000Z");
  });

  it("increments proactive counters only when the cap flag is on", () => {
    const world = livingWorld();
    const character = world.characters.qingqing;
    character.proactiveCountToday = 0;
    character.lastProactiveAt = null;
    const clock = nowClock(new Date(NOON));
    applyReply(
      world,
      character,
      { line: "你来了。" },
      clock,
      new Date(NOON),
      { ...config, countAgainstProactiveCap: true },
    );
    assert.equal(character.line, "你来了。");
    assert.equal(character.lastProactiveAt, NOON);
    assert.equal(character.proactiveCountToday, 1);
    assert.equal(character.proactiveDayKey, "2026-11-21");
  });

  it("rejects overlong input without calling the provider", async () => {
    const world = livingWorld();
    const calls = [];
    const result = await handleChat(world, {
      characterId: "qingqing",
      text: "啊".repeat(config.maxInputChars + 1),
      now: new Date(NOON),
      settings: null,
      provider: replyProvider({ characterId: "qingqing", line: "不该出现" }, calls),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, "input-too-long");
    assert.equal(calls.length, 0);
    assert.equal(world.characters.qingqing.line, null);
  });

  it("returns a safe error when the provider fails and does not throw", async () => {
    const world = livingWorld();
    const result = await handleChat(world, {
      characterId: "qingqing",
      text: "在吗？",
      now: new Date(NOON),
      settings: null,
      provider: {
        name: "spy",
        async complete() {
          throw new Error("network should not escape");
        },
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, "provider-failed");
    assert.equal(typeof result.reason, "string");
    assert.equal(result.reason.includes("稍后再试"), true);
    assert.equal(world.characters.qingqing.line, null);
  });

  it("records the player and character messages and keeps working memory under the cap", async () => {
    const memory = memoryWith({ workingMemoryChars: 80 });
    const world = livingWorld();
    const long = "这是一句很长的话用来把工作记忆撑过上限需要裁掉前面的部分。";
    for (let i = 0; i < 6; i += 1) {
      const result = await handleChat(world, {
        characterId: "qingqing",
        text: `${long}${i}`,
        now: new Date(NOON),
        settings: null,
        memory,
        provider: replyProvider({
          characterId: "qingqing",
          line: `${long}回${i}`,
          fact: "你喜欢喝茶",
          topic: "喝茶",
        }, []),
      });
      assert.equal(result.ok, true);
    }
    const rows = memory.db.prepare(
      "SELECT role, kind, text FROM messages WHERE character_id = ? AND kind = 'chat' ORDER BY id",
    ).all("qingqing");
    assert.ok(rows.length >= 2);
    assert.equal(rows[0].role, "user");
    assert.equal(rows[1].role, "character");
    assert.ok(rows.some((row) => row.role === "user" && row.text.includes("这是一句很长的话")));
    assert.ok(rows.some((row) => row.role === "character" && row.text.includes("回")));
    const working = memory.db.prepare("SELECT text FROM working WHERE character_id = ?").get("qingqing");
    assert.ok(working?.text.length <= 80, `working memory ${working?.text.length} exceeded 80`);
    const facts = memory.db.prepare("SELECT text FROM facts WHERE character_id = ?").all("qingqing");
    assert.ok(facts.some((row) => row.text.includes("喝茶")));
    const topics = memory.db.prepare("SELECT text FROM topics WHERE character_id = ?").all("qingqing");
    assert.ok(topics.some((row) => row.text === "喝茶"));
  });

  it("does not hit the network when a test provider is used", async () => {
    const world = livingWorld();
    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      fetchCalls.push(args[0]);
      throw new Error("network should not be used");
    };
    try {
      const result = await handleChat(world, {
        characterId: "qingqing",
        text: "你好。",
        now: new Date(NOON),
        settings: null,
        provider: replyProvider({ characterId: "qingqing", line: "你好。" }, []),
      });
      assert.equal(result.ok, true);
      assert.equal(fetchCalls.length, 0);
    } finally {
      if (originalFetch) globalThis.fetch = originalFetch;
      else delete globalThis.fetch;
    }
  });

  it("picks one responder for an unaddressed line and calls the provider once", async () => {
    const memory = memoryWith({ workingMemoryChars: 200 });
    const world = livingWorld({
      characters: {
        qingqing: { room: "living", action: "sit" },
        linxia: { room: "living", action: "sit" },
        xiaonan: { room: "xiaonan", action: "sit" },
      },
      relations: [
        { from: "qingqing", to: "viewer", familiarity: 20, closeness: 80, stance: "companion" },
        { from: "linxia", to: "viewer", familiarity: 20, closeness: 10, stance: "roommate" },
      ],
    });
    const calls = [];
    const result = await handleChat(world, {
      text: "中午吃饭了吗？",
      volume: "normal",
      now: new Date(NOON),
      settings: null,
      memory,
      provider: replyProvider({ characterId: "qingqing", line: "吃了一点。" }, calls),
    });
    assert.equal(result.ok, true);
    assert.equal(result.responderId, "qingqing");
    assert.equal(result.targetId, null);
    assert.equal(result.volume, "normal");
    assert.deepEqual([...result.hearerIds].sort(), ["linxia", "qingqing"]);
    assert.equal(calls.length, 1);
    assert.equal(world.characters.qingqing.line, "吃了一点。");
    assert.equal(world.characters.linxia.line, null);
    assert.equal(world.lastChat.responderId, "qingqing");
    assert.equal(world.lastChat.line, "吃了一点。");
    assert.equal(calls[0].prompt.includes("音量：普通"), true);
    assert.equal(calls[0].prompt.includes("没有点名"), true);
    assert.equal(calls[0].prompt.includes("林夏"), true);
    const overheard = memory.db.prepare(
      "SELECT kind FROM messages WHERE character_id = ? AND kind = 'overhear'",
    ).all("linxia");
    assert.ok(overheard.length >= 1);
    const direct = memory.db.prepare(
      "SELECT kind FROM messages WHERE character_id = ? AND kind = 'overhear'",
    ).all("qingqing");
    assert.equal(direct.length, 0);
  });

  it("keeps the specified target as responder and records an overhear for the other hearer", async () => {
    const memory = memoryWith({ workingMemoryChars: 200 });
    const world = livingWorld({
      characters: {
        qingqing: { room: "living", action: "sit" },
        linxia: { room: "living", action: "sit" },
      },
    });
    const calls = [];
    const result = await handleChat(world, {
      characterId: "qingqing",
      volume: "normal",
      text: "中午吃饭了吗？",
      now: new Date(NOON),
      settings: null,
      memory,
      provider: replyProvider({ characterId: "qingqing", line: "刚吃过。" }, calls),
    });
    assert.equal(result.ok, true);
    assert.equal(result.responderId, "qingqing");
    assert.equal(result.targetId, "qingqing");
    assert.equal(calls.length, 1);
    const overheard = memory.db.prepare(
      "SELECT text FROM messages WHERE character_id = ? AND kind = 'overhear'",
    ).all("linxia");
    assert.ok(overheard.some((row) => row.text.includes("中午吃饭了吗")));
  });

  it("records no overhearers on a whisper", async () => {
    const memory = memoryWith();
    const world = livingWorld({
      characters: {
        qingqing: { room: "living", action: "sit" },
        linxia: { room: "living", action: "sit" },
      },
    });
    const result = await handleChat(world, {
      characterId: "qingqing",
      volume: "whisper",
      text: "中午吃饭了吗？",
      now: new Date(NOON),
      settings: null,
      memory,
      provider: replyProvider({ characterId: "qingqing", line: "嗯，我在。" }, []),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.hearerIds, ["qingqing"]);
    const overheard = memory.db.prepare(
      "SELECT kind FROM messages WHERE character_id = ? AND kind = 'overhear'",
    ).all("linxia");
    assert.equal(overheard.length, 0);
  });

  it("rejects a second in-flight chat while the house lock is held", async () => {
    const world = livingWorld();
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    let started;
    const entered = new Promise((resolve) => { started = resolve; });
    const first = handleChat(world, {
      characterId: "qingqing",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
      settings: null,
      provider: {
        name: "spy",
        async complete() {
          started();
          await blocked;
          return { characterId: "qingqing", line: "还不错。" };
        },
      },
    });
    await entered;
    const second = await handleChat(world, {
      characterId: "linxia",
      text: "再跟你说一件刚才想到的小事。",
      now: new Date(NOON),
      settings: null,
      provider: replyProvider({ characterId: "linxia", line: "不该出现" }, []),
    });
    assert.equal(second.ok, false);
    assert.equal(second.reasonCode, "busy");
    release();
    const done = await first;
    assert.equal(done.ok, true);
    assert.equal(world.characters.qingqing.line, "还不错。");
    assert.equal(world.characters.linxia.line, null);
  });

  it("raises only the responder's mood after a successful reply", async () => {
    const world = livingWorld({
      characters: {
        qingqing: { room: "living", action: "sit", stats: { mood: 50, energy: 70, hunger: 70, clean: 80 } },
        linxia: { room: "living", action: "sit", stats: { mood: 50 } },
      },
    });
    const energy = world.characters.qingqing.stats.energy;
    const result = await handleChat(world, {
      characterId: "qingqing",
      volume: "normal",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
      settings: null,
      provider: replyProvider({ characterId: "qingqing", line: "挺好的。" }, []),
    });
    assert.equal(result.ok, true);
    assert.equal(world.characters.qingqing.stats.mood, 52);
    assert.equal(world.characters.qingqing.moodMeta.playerChatGain, 2);
    assert.equal(world.characters.linxia.stats.mood, 50);
    assert.equal(world.characters.linxia.moodMeta, undefined);
    assert.equal(world.characters.qingqing.stats.energy, energy);
  });

  it("does not change mood on a failed or too-short chat", async () => {
    const world = livingWorld({
      characters: { qingqing: { stats: { mood: 50 } } },
    });
    const failed = await handleChat(world, {
      characterId: "qingqing",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
      settings: null,
      cfg: { ...config, timeoutMs: 20 },
      provider: {
        name: "slow",
        complete: () => new Promise(() => {}),
      },
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.reasonCode, "timeout");
    assert.equal(world.characters.qingqing.stats.mood, 50);
    assert.equal(world.characters.qingqing.moodMeta, undefined);

    const short = await handleChat(world, {
      characterId: "qingqing",
      text: "你好。",
      now: new Date(NOON),
      settings: null,
      provider: replyProvider({ characterId: "qingqing", line: "嗯。" }, []),
    });
    assert.equal(short.ok, true);
    assert.equal(world.characters.qingqing.stats.mood, 50);
    assert.equal(world.characters.qingqing.line, "嗯。");
  });
});
