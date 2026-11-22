import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createMemory, mergeMemoryConfig, assemblePack } from "./index.js";
import { writeDiary } from "./diaries.js";
import { upsertFact } from "./facts.js";
import { nowClock } from "../clock.js";

const NOON = "2026-11-21T04:00:00.000Z";
const memories = [];

function makeMemory(overrides = {}) {
  const memory = createMemory({
    dbPath: ":memory:",
    config: mergeMemoryConfig(overrides),
  });
  memories.push(memory);
  return memory;
}

after(() => {
  for (const memory of memories) {
    try { memory.close(); } catch { /* already closed */ }
  }
});

function character() {
  return {
    id: "qingqing",
    name: "青青",
    room: "living",
    action: "sit",
    line: "你来了。",
    lastProactiveAt: NOON,
    stats: { energy: 70, hunger: 70, clean: 80, mood: 70, bond: 18 },
  };
}

function putDiaries(db, cfg) {
  writeDiary(db, {
    characterId: "qingqing",
    kind: "day",
    periodKey: "2026-11-19",
    text: "UNIQUE_DAY_19_DIARY",
    createdAt: NOON,
    cap: cfg.diaryDayChars,
    source: "rule",
  });
  writeDiary(db, {
    characterId: "qingqing",
    kind: "day",
    periodKey: "2026-11-20",
    text: "UNIQUE_DAY_20_DIARY",
    createdAt: NOON,
    cap: cfg.diaryDayChars,
    source: "rule",
  });
  writeDiary(db, {
    characterId: "qingqing",
    kind: "day",
    periodKey: "2026-11-21",
    text: "UNIQUE_DAY_21_DIARY",
    createdAt: NOON,
    cap: cfg.diaryDayChars,
    source: "rule",
  });
  writeDiary(db, {
    characterId: "qingqing",
    kind: "week",
    periodKey: "2026-W47",
    text: "UNIQUE_WEEK_DIARY",
    createdAt: NOON,
    cap: cfg.diaryWeekChars,
    source: "rule",
  });
  writeDiary(db, {
    characterId: "qingqing",
    kind: "month",
    periodKey: "2026-11",
    text: "UNIQUE_MONTH_DIARY",
    createdAt: NOON,
    cap: cfg.diaryMonthChars,
    source: "rule",
  });
}

describe("memory retrieve diary budgets", () => {
  it("omits day diaries from the idle pack by default", () => {
    const memory = makeMemory();
    putDiaries(memory.db, memory.config);
    upsertFact(memory.db, "qingqing", { text: "UNIQUE_FACT_TOKEN", importance: 5 }, memory.config, NOON);
    const pack = memory.loadForThink(
      { viewer: { present: false, room: "living" } },
      { ...character(), line: null, lastProactiveAt: null },
      nowClock(new Date(NOON)),
      new Date(NOON),
    );
    assert.ok(pack.length <= memory.config.idlePackChars);
    assert.equal(pack.includes("UNIQUE_DAY_21_DIARY"), false);
    assert.equal(pack.includes("UNIQUE_WEEK_DIARY"), false);
    assert.equal(pack.includes("UNIQUE_FACT_TOKEN"), true);
  });

  it("includes the latest engaged day diary and stays under the cap", () => {
    const memory = makeMemory();
    putDiaries(memory.db, memory.config);
    const pack = memory.loadForThink(
      { viewer: { present: true, room: "living" } },
      character(),
      nowClock(new Date(NOON)),
      new Date(NOON),
    );
    assert.ok(pack.length <= memory.config.engagedPackChars);
    assert.equal(pack.includes("UNIQUE_DAY_21_DIARY"), true);
    assert.equal(pack.includes("UNIQUE_DAY_20_DIARY"), false);
    assert.equal(pack.includes("UNIQUE_WEEK_DIARY"), false);
  });

  it("includes recent day / week / month diaries in the chat pack, dropping older diaries first", () => {
    const memory = makeMemory({
      chatPackChars: 140,
      chatFactCount: 1,
      chatRecentTurns: 0,
    });
    upsertFact(memory.db, "qingqing", { text: "UNIQUE_FACT_TOKEN", importance: 5 }, memory.config, NOON);
    putDiaries(memory.db, memory.config);
    const pack = memory.loadForChat(
      { viewer: { present: true, room: "living" } },
      { ...character(), line: null, lastProactiveAt: null },
      nowClock(new Date(NOON)),
      new Date(NOON),
    );
    assert.ok(pack.length <= 140, `chat pack ${pack.length} exceeded 140`);
    assert.equal(pack.includes("UNIQUE_FACT_TOKEN"), true);
    assert.equal(pack.includes("UNIQUE_DAY_19_DIARY"), false, "oldest day diary should be dropped first");
    // A generous cap keeps all diaries plus facts.
    const roomy = makeMemory();
    upsertFact(roomy.db, "qingqing", { text: "UNIQUE_FACT_TOKEN", importance: 5 }, roomy.config, NOON);
    putDiaries(roomy.db, roomy.config);
    const full = roomy.loadForChat(
      { viewer: { present: true } },
      { ...character(), line: null },
      nowClock(new Date(NOON)),
      new Date(NOON),
    );
    assert.ok(full.length <= roomy.config.chatPackChars);
    assert.equal(full.includes("UNIQUE_FACT_TOKEN"), true);
    assert.equal(full.includes("UNIQUE_DAY_19_DIARY"), true);
    assert.equal(full.includes("UNIQUE_DAY_20_DIARY"), true);
    assert.equal(full.includes("UNIQUE_DAY_21_DIARY"), true);
    assert.equal(full.includes("UNIQUE_WEEK_DIARY"), true);
    assert.equal(full.includes("UNIQUE_MONTH_DIARY"), true);
  });

  it("assemblePack drops older diary sections before preferred facts", () => {
    const packed = assemblePack(
      ["事实：KEEP_FACT"],
      [
        { key: "2026-11-19", text: "日记：OLD_DIARY" },
        { key: "2026-11-21", text: "日记：NEW_DIARY" },
      ],
      "事实：KEEP_FACT".length + 1 + "日记：NEW_DIARY".length,
    );
    assert.equal(packed.includes("KEEP_FACT"), true);
    assert.equal(packed.includes("OLD_DIARY"), false);
    assert.equal(packed.includes("NEW_DIARY"), true);
  });
});
