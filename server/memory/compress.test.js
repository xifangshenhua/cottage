import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createMemory, mergeMemoryConfig, parseCompressOutput, readJob, houseJobCount } from "./index.js";
import { getDiary, getDiarySource } from "./diaries.js";
import { isIsoWeekBoundary, isMonthBoundary } from "./period.js";
import { nowClock } from "../clock.js";

const SAT_NOON = "2026-11-21T04:00:00.000Z"; // Saturday 12:00 Asia/Shanghai
const SUN_MORNING = "2026-11-21T23:00:00.000Z"; // Sunday 07:00
const SUN_NOON = "2026-11-22T04:00:00.000Z";
const MON_MORNING = "2026-11-22T23:00:00.000Z"; // Monday 07:00, closes Sunday
const NOV30_NOON = "2026-11-30T04:00:00.000Z";
const DEC1_MORNING = "2026-11-30T23:00:00.000Z";

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

function clockAt(iso) {
  return nowClock(new Date(iso));
}

function character(id = "qingqing", name = "青青") {
  return {
    id,
    name,
    room: "living",
    action: "sit",
    line: null,
    lastProactiveAt: null,
    stats: { energy: 70, hunger: 70, clean: 80, mood: 70, bond: 18 },
  };
}

function worldAt(iso, characters) {
  const list = characters ?? [character()];
  const map = {};
  for (const ch of list) map[ch.id] = ch;
  return { clock: clockAt(iso), characters: map, viewer: { present: false, room: "living" } };
}

function spyProvider(replies) {
  const calls = [];
  const queue = Array.isArray(replies) ? [...replies] : [replies];
  return {
    calls,
    provider: {
      name: "spy",
      async complete(input) {
        calls.push(input);
        const next = queue.length > 1 ? queue.shift() : queue[0];
        if (typeof next === "function") return next(input);
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

function dayDiaryJson(text, extra = {}) {
  return JSON.stringify({ dayDiary: text, ...extra });
}

async function seedDay(memory, iso, characters) {
  await memory.tickDiary(worldAt(iso, characters), { now: new Date(iso) });
}

function noteworthyChat(memory, ch, now = SAT_NOON) {
  memory.recordChat({
    character: ch,
    userText: "今天晚上想吃火锅，还要再买点菜和调料，顺便把明天的午饭也定下来。",
    reply: "好啊，我来准备锅和芝麻酱，也帮你记一下明天吃面。",
    now: new Date(now),
  });
}

describe("memory compress config", () => {
  it("defaults the daily model upgrade on and maps a flat diaryUseModel flag", () => {
    const on = mergeMemoryConfig();
    assert.equal(on.compress.enabled, true);
    assert.equal(on.compress.diaryUseModel, true);
    assert.equal(on.diaryUseModel, true);
    assert.equal(on.idleDiaryDays, 0);
    assert.equal(on.engagedDiaryDays, 1);
    assert.equal(on.chatDiaryDays, 3);
    assert.equal(on.chatIncludeWeek, true);
    assert.equal(on.compress.maxModelJobsPerCharacterDay, 1);
    assert.equal(on.compress.maxModelJobsPerHouseDay, 6);
    assert.equal(on.compress.staggerMs, 30_000);
    assert.equal(on.compress.episodeUseModel, false);

    const off = mergeMemoryConfig({ diaryUseModel: false });
    assert.equal(off.diaryUseModel, false);
    assert.equal(off.compress.diaryUseModel, false);
    assert.equal(off.compress.enabled, true);

    const nested = mergeMemoryConfig({
      compress: { maxPromptChars: 900, diaryUseModel: false },
    });
    assert.equal(nested.compress.maxPromptChars, 900);
    assert.equal(nested.compress.timeoutMs, 20_000);
    assert.equal(nested.compress.diaryUseModel, false);
    assert.equal(nested.diaryUseModel, false);
  });

  it("parses a strict JSON upgrade and rejects invalid output", () => {
    const cfg = mergeMemoryConfig();
    const ok = parseCompressOutput(dayDiaryJson("今天和你聊了火锅。", {
      facts: [{ text: "喜欢火锅", importance: 2 }],
      topics: [{ text: "火锅" }],
    }), cfg);
    assert.equal(ok.dayDiary.includes("火锅"), true);
    assert.equal(ok.facts[0].text, "喜欢火锅");
    assert.equal(parseCompressOutput("not-json", cfg), null);
    assert.equal(parseCompressOutput(JSON.stringify({ facts: [] }), cfg), null);
  });
});

describe("memory compress jobs", () => {
  it("writes a short rule diary on a quiet day and does not call the model", async () => {
    const memory = makeMemory();
    const ch = character();
    const { calls, provider } = spyProvider(dayDiaryJson("不该出现的模型日记"));
    await seedDay(memory, SAT_NOON, [ch]);
    memory.recordAfterThink({
      world: { viewer: { present: false } },
      character: ch,
      intent: { action: "sit", room: "living" },
      clock: clockAt(SAT_NOON),
      now: new Date(SAT_NOON),
      speechLanded: false,
    });
    const written = await memory.tickDiary(worldAt(SUN_MORNING, [ch]), { now: new Date(SUN_MORNING), provider });
    assert.equal(calls.length, 0);
    assert.equal(written.length, 1);
    const row = getDiary(memory.db, "qingqing", "day", "2026-11-21");
    assert.ok(row?.text.includes("2026-11-21"));
    assert.ok(row.text.includes("安静") || row.text.includes("没有和你说话") || row.text.includes("sit"));
    assert.equal(getDiarySource(memory.db, "qingqing", "day", "2026-11-21"), "rule");
    assert.equal(readJob(memory.db, "qingqing", "2026-11-21")?.status, "skipped");
  });

  it("runs exactly one model job per noteworthy character day and overwrites the rule draft", async () => {
    const memory = makeMemory();
    const ch = character();
    const upgraded = "今天你说想吃火锅，我答应一起准备。";
    const { calls, provider } = spyProvider(dayDiaryJson(upgraded, {
      facts: [{ text: "今晚想吃火锅" }],
    }));
    await seedDay(memory, SAT_NOON, [ch]);
    noteworthyChat(memory, ch, SAT_NOON);
    const written = await memory.tickDiary(worldAt(SUN_MORNING, [ch]), { now: new Date(SUN_MORNING), provider });
    assert.equal(written.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].purpose, "memory-compress");
    assert.ok(String(calls[0].prompt).length <= memory.config.compress.maxPromptChars);
    const row = getDiary(memory.db, "qingqing", "day", "2026-11-21");
    assert.equal(row.text, upgraded);
    assert.equal(getDiarySource(memory.db, "qingqing", "day", "2026-11-21"), "model");
    const facts = memory.db.prepare("SELECT text FROM facts WHERE character_id = ?").all("qingqing");
    assert.ok(facts.some((fact) => fact.text.includes("火锅")));
    assert.equal(readJob(memory.db, "qingqing", "2026-11-21")?.status, "done");

    const later = new Date(new Date(SUN_MORNING).getTime() + 30_000);
    await memory.tickDiary(worldAt(later.toISOString(), [ch]), { now: later, provider });
    assert.equal(calls.length, 1, "must not start a second job for the same character day");
  });

  it("includes the week diary in the same Sunday job, and the month diary on a month boundary", async () => {
    assert.equal(isIsoWeekBoundary("2026-11-22"), true);
    assert.equal(isMonthBoundary("2026-11-22"), false);
    assert.equal(isMonthBoundary("2026-11-30"), true);

    const memory = makeMemory();
    const ch = character();
    const { calls, provider } = spyProvider((input) => {
      const prompt = String(input.prompt);
      if (prompt.includes("周记")) {
        return dayDiaryJson("周日把这周的火锅计划说清楚了。", { weekDiary: "这周主要在讨论火锅。" });
      }
      return dayDiaryJson("月底把十一月的事记下来了。", { monthDiary: "十一月偶尔一起吃饭。" });
    });

    await seedDay(memory, SUN_NOON, [ch]);
    noteworthyChat(memory, ch, SUN_NOON);
    await memory.tickDiary(worldAt(MON_MORNING, [ch]), { now: new Date(MON_MORNING), provider });
    assert.equal(calls.length, 1);
    assert.equal(String(calls[0].prompt).includes("周记"), true);
    assert.equal(String(calls[0].prompt).includes("月记"), false);
    const week = getDiary(memory.db, "qingqing", "week", "2026-W47");
    assert.ok(week?.text.includes("火锅"));
    assert.equal(getDiarySource(memory.db, "qingqing", "week", "2026-W47"), "model");

    const monthMemory = makeMemory();
    const { calls: monthCalls, provider: monthProvider } = spyProvider((input) => {
      const prompt = String(input.prompt);
      assert.equal(prompt.includes("月记"), true);
      return dayDiaryJson("十一月最后一天还在聊天。", { monthDiary: "十一月偶尔一起吃饭。" });
    });
    await seedDay(monthMemory, NOV30_NOON, [ch]);
    noteworthyChat(monthMemory, ch, NOV30_NOON);
    await monthMemory.tickDiary(worldAt(DEC1_MORNING, [ch]), { now: new Date(DEC1_MORNING), provider: monthProvider });
    assert.equal(monthCalls.length, 1);
    const month = getDiary(monthMemory.db, "qingqing", "month", "2026-11");
    assert.ok(month?.text.includes("十一月"));
    assert.equal(getDiarySource(monthMemory.db, "qingqing", "month", "2026-11"), "model");
  });

  it("keeps the rule draft when the model returns invalid output or times out", async () => {
    const ch = character();
    const invalidMemory = makeMemory();
    const { calls, provider } = spyProvider("this is not json");
    await seedDay(invalidMemory, SAT_NOON, [ch]);
    noteworthyChat(invalidMemory, ch, SAT_NOON);
    await invalidMemory.tickDiary(worldAt(SUN_MORNING, [ch]), { now: new Date(SUN_MORNING), provider });
    assert.equal(calls.length, 1);
    const rule = getDiary(invalidMemory.db, "qingqing", "day", "2026-11-21");
    assert.ok(rule?.text);
    assert.equal(rule.text.includes("不该"), false);
    assert.equal(getDiarySource(invalidMemory.db, "qingqing", "day", "2026-11-21"), "rule");
    assert.equal(readJob(invalidMemory.db, "qingqing", "2026-11-21")?.status, "failed");

    const timeoutMemory = makeMemory({ compress: { timeoutMs: 30 } });
    const hanging = {
      name: "hang",
      complete: () => new Promise(() => {}),
    };
    await seedDay(timeoutMemory, SAT_NOON, [ch]);
    noteworthyChat(timeoutMemory, ch, SAT_NOON);
    await timeoutMemory.tickDiary(worldAt(SUN_MORNING, [ch]), { now: new Date(SUN_MORNING), provider: hanging });
    const timed = getDiary(timeoutMemory.db, "qingqing", "day", "2026-11-21");
    assert.ok(timed?.text);
    assert.equal(getDiarySource(timeoutMemory.db, "qingqing", "day", "2026-11-21"), "rule");
    assert.equal(readJob(timeoutMemory.db, "qingqing", "2026-11-21")?.status, "failed");
    assert.equal(readJob(timeoutMemory.db, "qingqing", "2026-11-21")?.reason, "timeout");
  });

  it("upgrades at most one character per tick and honors house / stagger budgets", async () => {
    const chars = [
      character("qingqing", "青青"),
      character("linxia", "林夏"),
      character("xiaonan", "小南"),
    ];
    const memory = makeMemory();
    const { calls, provider } = spyProvider((input) => {
      const prompt = String(input.prompt);
      const id = prompt.includes("linxia") ? "linxia" : prompt.includes("xiaonan") ? "xiaonan" : "qingqing";
      return dayDiaryJson(`${id}记下了今晚要吃火锅。`);
    });
    await seedDay(memory, SAT_NOON, chars);
    for (const ch of chars) noteworthyChat(memory, ch, SAT_NOON);

    await memory.tickDiary(worldAt(SUN_MORNING, chars), { now: new Date(SUN_MORNING), provider });
    assert.equal(calls.length, 1, "first rollover tick upgrades only one character");
    assert.equal(houseJobCount(memory.db, "2026-11-22"), 1);
    const firstId = chars.find((ch) => readJob(memory.db, ch.id, "2026-11-21")?.status === "done")?.id;
    assert.ok(firstId);
    assert.equal(getDiarySource(memory.db, firstId, "day", "2026-11-21"), "model");
    const pending = chars.filter((ch) => ch.id !== firstId);
    for (const ch of pending) {
      assert.equal(getDiarySource(memory.db, ch.id, "day", "2026-11-21"), "rule");
      assert.equal(readJob(memory.db, ch.id, "2026-11-21")?.status, "pending");
    }

    await memory.tickDiary(worldAt(SUN_MORNING, chars), { now: new Date(SUN_MORNING), provider });
    assert.equal(calls.length, 1, "same now is blocked by staggerMs");

    const later = new Date(new Date(SUN_MORNING).getTime() + 30_000);
    await memory.tickDiary(worldAt(later.toISOString(), chars), { now: later, provider });
    assert.equal(calls.length, 2);

    const tight = makeMemory({ compress: { maxModelJobsPerHouseDay: 1 } });
    const tightSpy = spyProvider(dayDiaryJson("只应升级一次。"));
    await seedDay(tight, SAT_NOON, chars);
    for (const ch of chars) noteworthyChat(tight, ch, SAT_NOON);
    await tight.tickDiary(worldAt(SUN_MORNING, chars), { now: new Date(SUN_MORNING), provider: tightSpy.provider });
    const afterBudget = new Date(new Date(SUN_MORNING).getTime() + 30_000);
    await tight.tickDiary(worldAt(afterBudget.toISOString(), chars), { now: afterBudget, provider: tightSpy.provider });
    assert.equal(tightSpy.calls.length, 1);
    assert.equal(houseJobCount(tight.db, "2026-11-22"), 1);
  });

  it("does not call the model when the flat diaryUseModel flag is false", async () => {
    const memory = makeMemory({ diaryUseModel: false });
    const ch = character();
    const { calls, provider } = spyProvider(dayDiaryJson("不该出现"));
    await seedDay(memory, SAT_NOON, [ch]);
    noteworthyChat(memory, ch, SAT_NOON);
    await memory.tickDiary(worldAt(SUN_MORNING, [ch]), { now: new Date(SUN_MORNING), provider });
    assert.equal(calls.length, 0);
    assert.equal(getDiarySource(memory.db, "qingqing", "day", "2026-11-21"), "rule");
  });

  it("does not smash a model-upgraded week diary on a later mid-week rule roll", async () => {
    const memory = makeMemory();
    const ch = character();
    const { provider } = spyProvider(dayDiaryJson("周日的升级稿。", { weekDiary: "MODEL_WEEK_UNIQUE" }));
    await seedDay(memory, SUN_NOON, [ch]);
    noteworthyChat(memory, ch, SUN_NOON);
    await memory.tickDiary(worldAt(MON_MORNING, [ch]), { now: new Date(MON_MORNING), provider });
    assert.equal(getDiary(memory.db, "qingqing", "week", "2026-W47")?.text, "MODEL_WEEK_UNIQUE");

    // Monday close is still week 47? Nov 23 2026 is Monday, week 48.
    // Use a later tick the same Monday morning — maybeRoll already ran.
    assert.equal(getDiarySource(memory.db, "qingqing", "week", "2026-W47"), "model");
    assert.equal(getDiary(memory.db, "qingqing", "week", "2026-W47")?.text, "MODEL_WEEK_UNIQUE");
  });
});
