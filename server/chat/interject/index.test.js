import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createMemory, mergeMemoryConfig } from "../../memory/index.js";
import { collectDayHighlights, ruleDayDiary } from "../../memory/diaries.js";
import { makeWorld, NOON } from "../../life/test-helpers.js";
import { nowClock } from "../../clock.js";
import { handleChat, resetChatLocks } from "../index.js";
import { formatLineLabel } from "./label.js";
import { getEdge, migrateRelations } from "../../relations/index.js";

const memories = [];

function memoryWith(overrides = {}) {
  const memory = createMemory({
    dbPath: ":memory:",
    config: mergeMemoryConfig({ workingMemoryChars: 200, ...overrides }),
  });
  memories.push(memory);
  return memory;
}

function worldReady(patch = {}) {
  const { characters, ...rest } = patch;
  const world = makeWorld({
    viewer: { present: true, room: "living", lastSeenAt: NOON },
    characters: {
      qingqing: { room: "living", action: "sit", stats: { mood: 50, energy: 70, hunger: 70, clean: 80 } },
      linxia: { room: "living", action: "sit", stats: { mood: 50, energy: 70, hunger: 70, clean: 80 } },
      xiaonan: { room: "xiaonan", action: "sit", stats: { mood: 50, energy: 70, hunger: 70, clean: 80 } },
      ...characters,
    },
    ...rest,
  });
  migrateRelations(world);
  return world;
}

function replyProvider(payload, calls) {
  return {
    name: "spy",
    async complete(input) {
      calls.push(input);
      return typeof payload === "function" ? payload(input) : payload;
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

async function chat(world, opts) {
  return handleChat(world, {
    now: new Date(NOON),
    settings: null,
    ...opts,
  });
}

describe("handleChat interjection", () => {
  it("does not call the judge on a whisper, a lone sleeper, another room, caps, or when disabled", async () => {
    const cases = [
      {
        name: "whisper",
        world: worldReady(),
        opts: { characterId: "qingqing", volume: "whisper", text: "有人饿了吗？" },
      },
      {
        name: "sleep",
        world: worldReady({ characters: { linxia: { room: "living", action: "sleep" } } }),
        opts: { characterId: "qingqing", volume: "normal", text: "有人饿了吗？" },
      },
      {
        name: "other-room",
        world: worldReady({ characters: { linxia: { room: "linxia", action: "sit" } } }),
        opts: { characterId: "qingqing", volume: "loud", text: "有人饿了吗？" },
      },
      {
        name: "day-cap",
        world: worldReady({
          characters: {
            linxia: {
              room: "living",
              action: "sit",
              interjectMeta: { dayKey: "2026-11-21", countToday: 2, lastInterjectAt: "2026-11-21T02:00:00.000Z" },
            },
          },
        }),
        opts: { characterId: "qingqing", volume: "normal", text: "有人饿了吗？" },
      },
      {
        name: "house-hour-cap",
        world: worldReady({ interjectMeta: { hourKey: "2026-11-21-12", occasionCount: 3 } }),
        opts: { characterId: "qingqing", volume: "normal", text: "有人饿了吗？" },
      },
      {
        name: "disabled",
        world: worldReady(),
        opts: {
          characterId: "qingqing",
          volume: "normal",
          text: "有人饿了吗？",
          settings: { house: { chat: { interject: { enabled: false } } } },
        },
      },
    ];

    for (const item of cases) {
      const judgeCalls = [];
      const result = await chat(item.world, {
        ...item.opts,
        provider: replyProvider({ characterId: "qingqing", line: "我刚吃过。" }, []),
        interjectProvider: replyProvider({ interjections: [{ characterId: "linxia", line: "不该出现" }] }, judgeCalls),
      });
      assert.equal(result.ok, true, item.name);
      assert.equal(judgeCalls.length, 0, item.name);
      assert.equal(item.world.characters.linxia.line, null, item.name);
      assert.deepEqual(result.interjectorIds, [], item.name);
      assert.equal(item.world.characters.qingqing.line, "我刚吃过。", item.name);
    }
  });

  it("keeps only the primary reply when analysis returns an empty list", async () => {
    const world = worldReady();
    const memory = memoryWith();
    const judgeCalls = [];
    const moodBefore = world.characters.linxia.stats.mood;
    const result = await chat(world, {
      characterId: "qingqing",
      volume: "normal",
      text: "青青，你午饭吃了吗？",
      memory,
      provider: replyProvider({ characterId: "qingqing", line: "吃了一点。" }, []),
      interjectProvider: replyProvider({ interjections: [] }, judgeCalls),
    });
    assert.equal(result.ok, true);
    assert.equal(judgeCalls.length, 1);
    assert.equal(world.characters.qingqing.line, "吃了一点。");
    assert.equal(world.characters.qingqing.lineKind, null);
    assert.equal(world.characters.linxia.line, null);
    assert.deepEqual(result.interjectorIds, []);
    assert.equal(world.characters.linxia.stats.mood, moodBefore);
    assert.equal(world.characters.linxia.interjectMeta, undefined);
    const interjectRows = memory.db.prepare("SELECT kind FROM messages WHERE kind = 'interject'").all();
    assert.equal(interjectRows.length, 0);
  });

  it("applies two interjections, one house occasion, and two personal counts", async () => {
    const world = worldReady({
      characters: {
        xiaonan: { room: "living", action: "sit", stats: { mood: 50, energy: 70, hunger: 70, clean: 80 } },
      },
    });
    const memory = memoryWith();
    const linxiaMood = world.characters.linxia.stats.mood;
    const xiaonanMood = world.characters.xiaonan.stats.mood;
    const linxiaFam = getEdge(world, "linxia", "viewer").familiarity;
    const result = await chat(world, {
      text: "有人饿了吗？",
      volume: "normal",
      memory,
      provider: replyProvider({ characterId: "qingqing", line: "我还可以。" }, []),
      interjectProvider: replyProvider({
        interjections: [
          { characterId: "linxia", reason: "被问到在场的人", line: "我有点饿了。" },
          { characterId: "xiaonan", reason: "同样在场", line: "我也还没吃。" },
        ],
      }, []),
    });
    assert.equal(result.ok, true);
    assert.equal(result.responderId, "qingqing");
    assert.deepEqual([...result.interjectorIds].sort(), ["linxia", "xiaonan"]);
    assert.equal(world.characters.qingqing.line, "我还可以。");
    assert.equal(world.characters.qingqing.lineKind, null);
    assert.equal(world.characters.linxia.line, "我有点饿了。");
    assert.equal(world.characters.linxia.lineTo, "viewer");
    assert.equal(world.characters.linxia.lineKind, "interject");
    assert.equal(world.characters.xiaonan.line, "我也还没吃。");
    assert.equal(world.characters.xiaonan.lineKind, "interject");
    assert.equal(world.interjectMeta.occasionCount, 1);
    assert.equal(world.interjectMeta.hourKey, "2026-11-21-12");
    assert.equal(world.characters.linxia.interjectMeta.countToday, 1);
    assert.equal(world.characters.xiaonan.interjectMeta.countToday, 1);
    assert.equal(world.characters.linxia.interjectMeta.dayKey, "2026-11-21");
    assert.equal(world.characters.qingqing.proactiveCountToday, 0);
    assert.equal(world.characters.linxia.proactiveCountToday, 0);
    assert.equal(formatLineLabel({
      name: world.characters.qingqing.name,
      line: world.characters.qingqing.line,
      lineTo: world.characters.qingqing.lineTo,
      lineKind: world.characters.qingqing.lineKind,
    }), "青青对你说：我还可以。");
    assert.equal(formatLineLabel({
      name: world.characters.linxia.name,
      line: world.characters.linxia.line,
      lineTo: world.characters.linxia.lineTo,
      lineToName: "你",
      lineKind: world.characters.linxia.lineKind,
    }), "林夏插话说：我有点饿了。");

    const own = memory.db.prepare(
      "SELECT kind, role, text FROM messages WHERE character_id = ? AND kind = 'interject'",
    ).all("linxia");
    assert.equal(own.length, 1);
    assert.equal(own[0].role, "character");
    assert.equal(own[0].text, "我有点饿了。");
    const overheard = memory.db.prepare(
      "SELECT text FROM messages WHERE character_id = ? AND kind = 'overhear' AND role = 'character'",
    ).all("qingqing");
    assert.ok(overheard.some((row) => row.text === "我有点饿了。"));
    assert.ok(overheard.some((row) => row.text === "我也还没吃。"));

    const highlights = collectDayHighlights(memory.db, "linxia", "2026-11-21", { diaryAtHhmm: "07:00" });
    assert.ok(highlights.interject.includes("我有点饿了。"));
    const diary = ruleDayDiary("2026-11-21", [], true, highlights);
    assert.equal(diary.includes("我有点饿了。"), true);

    assert.ok(world.characters.linxia.stats.mood > linxiaMood);
    assert.ok(world.characters.xiaonan.stats.mood > xiaonanMood);
    assert.ok(getEdge(world, "linxia", "viewer").familiarity > linxiaFam);
    assert.equal(world.characters.linxia.moodMeta.interjectGain > 0, true);
  });

  it("drops invalid ids and empty lines, keeping a valid one", async () => {
    const world = worldReady();
    const memory = memoryWith();
    const result = await chat(world, {
      characterId: "qingqing",
      volume: "normal",
      text: "有人饿了吗？",
      memory,
      provider: replyProvider({ characterId: "qingqing", line: "我还可以。" }, []),
      interjectProvider: replyProvider({
        interjections: [
          { characterId: "nobody", reason: "invented", line: "假的" },
          { characterId: "linxia", reason: "empty", line: "  " },
          { characterId: "linxia", reason: "ok", line: "我还没吃。" },
        ],
      }, []),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.interjectorIds, ["linxia"]);
    assert.equal(world.characters.linxia.line, "我还没吃。");
    assert.equal(world.interjectMeta.occasionCount, 1);
  });

  it("leaves the primary reply intact when the judge times out or throws", async () => {
    const memory = memoryWith();
    const world = worldReady();
    const mood = world.characters.linxia.stats.mood;
    const fam = getEdge(world, "linxia", "viewer").familiarity;
    const timed = await chat(world, {
      characterId: "qingqing",
      volume: "normal",
      text: "有人饿了吗？",
      memory,
      settings: { house: { chat: { interject: { timeoutMs: 20 } } } },
      provider: replyProvider({ characterId: "qingqing", line: "我还可以。" }, []),
      interjectProvider: {
        name: "slow",
        complete: () => new Promise(() => {}),
      },
    });
    assert.equal(timed.ok, true);
    assert.equal(world.characters.qingqing.line, "我还可以。");
    assert.equal(world.characters.linxia.line, null);
    assert.deepEqual(timed.interjectorIds, []);
    assert.equal(world.characters.linxia.stats.mood, mood);
    assert.equal(getEdge(world, "linxia", "viewer").familiarity, fam);
    assert.equal(world.characters.linxia.interjectMeta, undefined);
    assert.equal(world.interjectMeta, undefined);
    const rows = memory.db.prepare("SELECT kind FROM messages WHERE kind = 'interject'").all();
    assert.equal(rows.length, 0);

    const world2 = worldReady();
    const thrown = await chat(world2, {
      characterId: "qingqing",
      volume: "normal",
      text: "有人饿了吗？",
      provider: replyProvider({ characterId: "qingqing", line: "我还可以。" }, []),
      interjectProvider: {
        name: "boom",
        async complete() { throw new Error("network should not escape"); },
      },
    });
    assert.equal(thrown.ok, true);
    assert.equal(world2.characters.qingqing.line, "我还可以。");
    assert.equal(world2.characters.linxia.line, null);
  });

  it("does not interrupt a character who is eating", async () => {
    const world = worldReady({
      characters: { linxia: { room: "living", action: "eat", actionStartedAt: NOON } },
    });
    const started = world.characters.linxia.actionStartedAt;
    const result = await chat(world, {
      characterId: "qingqing",
      volume: "normal",
      text: "有人饿了吗？",
      provider: replyProvider({ characterId: "qingqing", line: "我还可以。" }, []),
      interjectProvider: replyProvider({
        interjections: [{ characterId: "linxia", reason: "正在吃饭", line: "我正在吃。" }],
      }, []),
    });
    assert.equal(result.ok, true);
    assert.equal(world.characters.linxia.line, "我正在吃。");
    assert.equal(world.characters.linxia.action, "eat");
    assert.equal(world.characters.linxia.actionStartedAt, started);
    assert.equal(world.characters.linxia.lineKind, "interject");
  });
});
