import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nowClock } from "../clock.js";
import { createMemory, mergeMemoryConfig } from "./index.js";
import { getMeta, setMeta } from "./db.js";
import { setDiarySource, writeDiary } from "./diaries.js";
import { appendEpisode } from "./episodes.js";
import { appendMessage } from "./messages.js";
import { upsertFact } from "./facts.js";
import { rememberTopic } from "./topics.js";
import { setWorking } from "./working.js";
import { browseCharacter } from "./browse.js";
import { exportAll, exportCharacter, exportJson, exportMarkdown } from "./export.js";

const NOON = "2026-11-21T04:00:00.000Z"; // 12:00 Asia/Shanghai, game day 2026-11-21
const BEFORE_ROLLOVER = "2026-11-21T22:30:00.000Z"; // 06:30 Nov 22 Shanghai, still game day 2026-11-21
const SECRET = "MINIMAX_API_KEY=sk-test-secret-should-never-leak";
const RAW_TRANSCRIPT = "UNIQUE_RAW_TRANSCRIPT_TOKEN_SHOULD_NOT_APPEAR";
const WORKING_DUMP = "UNIQUE_WORKING_MEMORY_DUMP_TOKEN";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const memories = [];

after(() => {
  for (const memory of memories) {
    try { memory.close(); } catch { /* already closed */ }
  }
});

function makeMemory(overrides = {}) {
  const memory = createMemory({
    dbPath: ":memory:",
    config: mergeMemoryConfig(overrides),
  });
  memories.push(memory);
  return memory;
}

function clockAt(iso = NOON) {
  return nowClock(new Date(iso));
}

function diaryCount(db) {
  return Number(db.prepare("SELECT COUNT(*) AS n FROM diaries").get()?.n) || 0;
}

function seedQingqing(memory, { fact = true, topic = true, chat = true } = {}) {
  const { db, config } = memory;
  if (chat) {
    appendMessage(db, {
      characterId: "qingqing",
      kind: "chat",
      role: "user",
      text: "今天一起喝茶好吗",
      createdAt: NOON,
    });
    appendMessage(db, {
      characterId: "qingqing",
      kind: "chat",
      role: "character",
      text: "好，我去泡一壶。",
      createdAt: NOON,
    });
  }
  appendEpisode(db, {
    characterId: "qingqing",
    dayKey: "2026-11-21",
    action: "sit",
    room: "living",
    speechLanded: false,
    summary: "sit @living",
    createdAt: NOON,
  });
  appendMessage(db, {
    characterId: "qingqing",
    kind: "think",
    role: "system",
    text: RAW_TRANSCRIPT,
    createdAt: NOON,
  });
  setWorking(db, "qingqing", `${WORKING_DUMP}\n${SECRET}`, NOON, 2000);
  if (fact) {
    upsertFact(db, "qingqing", { text: "喜欢和你一起喝茶", importance: 2 }, config, NOON);
  }
  if (topic) {
    rememberTopic(db, "qingqing", "喝茶聊天", config, NOON);
  }
}

function seedLinxia(memory) {
  const { db, config } = memory;
  upsertFact(db, "linxia", { text: "林夏在看书", importance: 1 }, config, NOON);
  rememberTopic(db, "linxia", "阅读", config, NOON);
  appendMessage(db, {
    characterId: "linxia",
    kind: "chat",
    role: "user",
    text: "这本好看吗",
    createdAt: NOON,
  });
  appendMessage(db, {
    characterId: "linxia",
    kind: "chat",
    role: "character",
    text: "还行，安静。",
    createdAt: NOON,
  });
}

describe("memory browse and export assembly", () => {
  it("returns a today draft that matches the rule diary and does not write diaries", () => {
    const memory = makeMemory();
    seedQingqing(memory);
    setMeta(memory.db, "lastDiaryGameDay", "2026-11-21");
    const before = diaryCount(memory.db);

    const payload = memory.browseCharacter("qingqing", {
      clock: clockAt(NOON),
      now: NOON,
      name: "青青",
    });
    const exported = memory.exportCharacter("qingqing", {
      clock: clockAt(NOON),
      now: NOON,
      name: "青青",
      format: "md",
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.character.id, "qingqing");
    assert.equal(payload.character.name, "青青");
    assert.equal(payload.dayStartHhmm, "07:00");
    assert.equal(payload.dayKey, "2026-11-21");
    assert.equal(payload.today?.source, "today");
    assert.equal(payload.today?.persisted, false);
    assert.equal(payload.today?.dayKey, "2026-11-21");
    assert.equal(payload.today?.kind, "day");
    assert.match(payload.today.text, /2026-11-21：/);
    assert.match(payload.today.text, /你说了「今天一起喝茶好吗」/);
    assert.match(payload.today.text, /对你说了「好，我去泡一壶。」/);
    assert.equal(payload.facts.some((row) => row.text === "喜欢和你一起喝茶"), true);
    assert.equal(payload.topics.some((row) => row.text === "喝茶聊天"), true);
    assert.equal(payload.diaries.length, 0);

    assert.equal(diaryCount(memory.db), before);
    assert.equal(diaryCount(memory.db), 0);
    assert.equal(getMeta(memory.db, "lastDiaryGameDay"), "2026-11-21");
    assert.equal(memory.db.prepare("SELECT COUNT(*) AS n FROM diaries").get().n, 0);
    assert.match(exported.body, /今日草稿（尚未日结）/);
    assert.match(exported.body, /喜欢和你一起喝茶/);
    assert.match(exported.body, /喝茶聊天/);
  });

  it("omits the today draft when a persisted same-day diary already exists", () => {
    const memory = makeMemory();
    seedQingqing(memory);
    writeDiary(memory.db, {
      characterId: "qingqing",
      kind: "day",
      periodKey: "2026-11-21",
      text: "2026-11-21：已经定稿的日记。",
      createdAt: NOON,
      cap: 400,
      source: "model",
    });

    const payload = browseCharacter(memory.db, "qingqing", {
      config: memory.config,
      clock: clockAt(NOON),
      now: NOON,
      name: "青青",
    });
    assert.equal(payload.today, null);
    assert.equal(payload.diaries.length, 1);
    assert.equal(payload.diaries[0].periodKey, "2026-11-21");
    assert.equal(payload.diaries[0].source, "model");
    assert.equal(payload.diaries[0].persisted, true);
    assert.equal(payload.diaries[0].text.includes("已经定稿的日记"), true);
    assert.equal(diaryCount(memory.db), 1);
  });

  it("isolates facts, topics, and diaries per character", () => {
    const memory = makeMemory();
    seedQingqing(memory);
    seedLinxia(memory);
    writeDiary(memory.db, {
      characterId: "qingqing",
      kind: "day",
      periodKey: "2026-11-20",
      text: "青青昨天的日记",
      createdAt: "2026-11-20T12:00:00.000Z",
      cap: 400,
      source: "rule",
    });
    writeDiary(memory.db, {
      characterId: "linxia",
      kind: "day",
      periodKey: "2026-11-20",
      text: "林夏昨天的日记",
      createdAt: "2026-11-20T12:00:00.000Z",
      cap: 400,
      source: "rule",
    });

    const qingqing = memory.browseCharacter("qingqing", { clock: clockAt(NOON), now: NOON, name: "青青" });
    const linxia = memory.browseCharacter("linxia", { clock: clockAt(NOON), now: NOON, name: "林夏" });

    assert.equal(qingqing.facts.some((row) => row.text.includes("林夏")), false);
    assert.equal(linxia.facts.some((row) => row.text.includes("喝茶")), false);
    assert.equal(qingqing.topics.some((row) => row.text === "阅读"), false);
    assert.equal(linxia.topics.some((row) => row.text === "喝茶聊天"), false);
    assert.equal(qingqing.diaries.some((row) => row.text.includes("林夏")), false);
    assert.equal(linxia.diaries.some((row) => row.text.includes("青青")), false);
    assert.match(qingqing.today.text, /今天一起喝茶好吗/);
    assert.equal(qingqing.today.text.includes("这本好看吗"), false);
    assert.match(linxia.today.text, /这本好看吗/);
  });

  it("labels persisted sources as rule or model and sorts day diaries descending", () => {
    const memory = makeMemory();
    writeDiary(memory.db, {
      characterId: "qingqing",
      kind: "day",
      periodKey: "2026-11-19",
      text: "规则写的一天",
      createdAt: "2026-11-19T12:00:00.000Z",
      cap: 400,
      source: "rule",
    });
    writeDiary(memory.db, {
      characterId: "qingqing",
      kind: "day",
      periodKey: "2026-11-20",
      text: "模型整理的一天",
      createdAt: "2026-11-20T12:00:00.000Z",
      cap: 400,
      source: "model",
    });
    writeDiary(memory.db, {
      characterId: "qingqing",
      kind: "week",
      periodKey: "2026-W47",
      text: "一周规则底稿",
      createdAt: NOON,
      cap: 600,
      source: "rule",
    });
    setDiarySource(memory.db, "qingqing", "week", "2026-W47", "rule");

    const payload = memory.browseCharacter("qingqing", { clock: clockAt(NOON), now: NOON, name: "青青" });
    assert.deepEqual(payload.diaries.map((row) => row.periodKey), ["2026-11-20", "2026-11-19"]);
    assert.equal(payload.diaries[0].source, "model");
    assert.equal(payload.diaries[1].source, "rule");
    assert.equal(payload.weeks[0].source, "rule");
    assert.equal(payload.weeks[0].periodKey, "2026-W47");
  });

  it("still returns the short quiet-day draft when writeDiaryIfNoInteraction is short", () => {
    const memory = makeMemory();
    const payload = memory.browseCharacter("xiaonan", { clock: clockAt(NOON), now: NOON, name: "小南" });
    assert.equal(payload.today?.text, "2026-11-21：这一天很安静。");
    assert.equal(payload.today?.source, "today");
    assert.equal(diaryCount(memory.db), 0);
  });

  it("includes overheard lines in today's draft and does not persist a diary", () => {
    const memory = makeMemory();
    appendMessage(memory.db, {
      characterId: "linxia",
      kind: "overhear",
      role: "user",
      text: "中午吃饭了吗？",
      createdAt: NOON,
    });
    appendMessage(memory.db, {
      characterId: "linxia",
      kind: "overhear",
      role: "character",
      text: "吃了一点。",
      createdAt: NOON,
    });
    const before = diaryCount(memory.db);
    const payload = memory.browseCharacter("linxia", { clock: clockAt(NOON), now: NOON, name: "林夏" });
    assert.equal(payload.today?.source, "today");
    assert.equal(payload.today?.persisted, false);
    assert.match(payload.today.text, /听见了「中午吃饭了吗？」「吃了一点。」/);
    assert.equal(diaryCount(memory.db), before);
    assert.equal(diaryCount(memory.db), 0);
    const exported = memory.exportCharacter("linxia", {
      clock: clockAt(NOON),
      now: NOON,
      name: "林夏",
      format: "md",
    });
    assert.match(exported.body, /## 今日草稿（尚未日结）/);
    assert.match(exported.body, /听见了「中午吃饭了吗？」「吃了一点。」/);
    assert.equal(diaryCount(memory.db), 0);
  });

  it("uses the game day, not the calendar date, before 07:00", () => {
    const memory = makeMemory();
    seedQingqing(memory);
    const payload = memory.browseCharacter("qingqing", {
      clock: clockAt(BEFORE_ROLLOVER),
      now: BEFORE_ROLLOVER,
      name: "青青",
    });
    assert.equal(payload.dayKey, "2026-11-21");
    assert.equal(payload.today.dayKey, "2026-11-21");
    const packed = memory.exportCharacter("qingqing", {
      clock: clockAt(BEFORE_ROLLOVER),
      now: BEFORE_ROLLOVER,
      name: "青青",
      format: "md",
    });
    assert.equal(packed.filename, "青青日记-2026-11-21.md");
  });

  it("exports markdown and json with draft, facts, and topics, but not secrets or transcripts", () => {
    const memory = makeMemory();
    seedQingqing(memory);
    writeDiary(memory.db, {
      characterId: "qingqing",
      kind: "day",
      periodKey: "2026-11-20",
      text: "昨天的模型整理稿",
      createdAt: "2026-11-20T12:00:00.000Z",
      cap: 400,
      source: "model",
    });
    const packed = exportCharacter(memory.db, "qingqing", {
      config: memory.config,
      clock: clockAt(NOON),
      now: "2026-11-21T13:14:00.000Z",
      name: "青青",
      format: "md",
    });
    const md = packed.body;
    assert.equal(packed.filename, "青青日记-2026-11-21.md");
    assert.match(md, /^# 青青的日记/m);
    assert.match(md, /导出时间：2026-11-21 21:14（Asia\/Shanghai）/);
    assert.match(md, /## 今日草稿（尚未日结）/);
    assert.match(md, /今天一起喝茶好吗/);
    assert.match(md, /### 2026-11-20（模型整理）/);
    assert.match(md, /昨天的模型整理稿/);
    assert.match(md, /## 记得的事/);
    assert.match(md, /- 喜欢和你一起喝茶/);
    assert.match(md, /## 话题/);
    assert.match(md, /- 喝茶聊天/);
    assert.equal(md.includes(SECRET), false);
    assert.equal(md.includes(RAW_TRANSCRIPT), false);
    assert.equal(md.includes(WORKING_DUMP), false);
    assert.equal(md.includes("工作记忆"), false);
    assert.equal(md.includes(".env"), false);

    const jsonPacked = exportCharacter(memory.db, "qingqing", {
      config: memory.config,
      clock: clockAt(NOON),
      now: NOON,
      name: "青青",
      format: "json",
    });
    assert.equal(jsonPacked.filename, "青青日记-2026-11-21.json");
    const parsed = JSON.parse(jsonPacked.body);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.character.name, "青青");
    assert.ok(parsed.today.text.includes("今天一起喝茶好吗"));
    assert.equal(parsed.facts[0].text, "喜欢和你一起喝茶");
    assert.equal(parsed.topics[0].text, "喝茶聊天");
    assert.equal(jsonPacked.body.includes(SECRET), false);
    assert.equal(jsonPacked.body.includes(RAW_TRANSCRIPT), false);
    assert.equal(jsonPacked.body.includes(WORKING_DUMP), false);
    assert.equal(diaryCount(memory.db), 1);
  });

  it("exports all three characters in fixed order", () => {
    const memory = makeMemory();
    seedQingqing(memory);
    seedLinxia(memory);
    const packed = exportAll(memory.db, {
      config: memory.config,
      clock: clockAt(NOON),
      now: NOON,
      names: { qingqing: "青青", linxia: "林夏", xiaonan: "小南" },
      format: "md",
    });
    assert.equal(packed.filename, "房子日记-2026-11-21.md");
    const qingqingAt = packed.body.indexOf("# 青青的日记");
    const linxiaAt = packed.body.indexOf("# 林夏的日记");
    const xiaonanAt = packed.body.indexOf("# 小南的日记");
    assert.ok(qingqingAt >= 0 && linxiaAt > qingqingAt && xiaonanAt > linxiaAt);
    assert.match(packed.body, /# 房子日记/);
    assert.match(packed.body, /喜欢和你一起喝茶/);
    assert.match(packed.body, /林夏在看书/);
    assert.match(packed.body, /这一天很安静/);

    const jsonPacked = memory.exportAll({
      clock: clockAt(NOON),
      now: NOON,
      names: { qingqing: "青青", linxia: "林夏", xiaonan: "小南" },
      format: "json",
    });
    assert.equal(jsonPacked.filename, "房子日记-2026-11-21.json");
    const parsed = JSON.parse(jsonPacked.body);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.exportedAt);
    assert.deepEqual(parsed.characters.map((item) => item.character.id), [
      "qingqing",
      "linxia",
      "xiaonan",
    ]);
    assert.equal(diaryCount(memory.db), 0);
  });

  it("keeps exportMarkdown and exportJson helpers aligned with the browse shape", () => {
    const memory = makeMemory();
    seedQingqing(memory);
    const payload = memory.browseCharacter("qingqing", { clock: clockAt(NOON), now: NOON, name: "青青" });
    const md = exportMarkdown(payload, { now: NOON });
    const json = JSON.parse(exportJson(payload, { now: NOON }));
    assert.match(md, /# 青青的日记/);
    assert.equal(json.character.id, "qingqing");
    assert.equal(json.today.source, "today");
    assert.ok(json.exportedAt);
  });
});

describe("frontend diary entry", () => {
  it("adds a house-page diary entry and hash routes", () => {
    const html = readFileSync(path.join(ROOT, "index.html"), "utf8");
    const main = readFileSync(path.join(ROOT, "src/main.js"), "utf8");
    const diary = readFileSync(path.join(ROOT, "src/diary.js"), "utf8");
    assert.match(html, /id="diary-btn"/);
    assert.match(html, />日记</);
    assert.match(html, /id="diary-panel"/);
    assert.match(main, /mountDiary/);
    assert.match(diary, /#diary/);
    assert.match(diary, /#diary\/\$\{characterId\}/);
    assert.match(diary, /\/api\/memory\/export\?character=/);
    assert.match(diary, /导出这位/);
    assert.match(diary, /导出全部/);
    assert.match(diary, /次日/);
    assert.match(diary, /才会定稿/);
  });
});
