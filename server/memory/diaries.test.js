import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createMemory, mergeMemoryConfig } from "./index.js";
import {
  collectDayHighlights,
  dayHadInteraction,
  noteworthyText,
  ruleDayDiary,
} from "./diaries.js";
import { appendMessage } from "./messages.js";

const NOON = "2026-11-21T04:00:00.000Z";

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

describe("rule day highlights include overhear", () => {
  it("collects overhear lines and writes a 听见了 section in the rule diary", () => {
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
    appendMessage(memory.db, {
      characterId: "linxia",
      kind: "overhear",
      role: "character",
      text: "一起坐一会儿吧。",
      createdAt: NOON,
    });

    const highlights = collectDayHighlights(memory.db, "linxia", "2026-11-21", memory.config);
    assert.deepEqual(highlights.overhear, ["中午吃饭了吗？", "吃了一点。", "一起坐一会儿吧。"]);
    assert.equal(dayHadInteraction(highlights), true);
    assert.match(noteworthyText(highlights), /中午吃饭了吗？/);
    assert.match(noteworthyText(highlights), /一起坐一会儿吧。/);

    const text = ruleDayDiary("2026-11-21", highlights.episodes, true, highlights);
    assert.match(text, /听见了「中午吃饭了吗？」「吃了一点。」「一起坐一会儿吧。」/);
    assert.equal(memory.db.prepare("SELECT COUNT(*) AS n FROM diaries").get().n, 0);
  });

  it("still describes a day with no messages as quiet", () => {
    const memory = makeMemory();
    const highlights = collectDayHighlights(memory.db, "xiaonan", "2026-11-21", memory.config);
    assert.deepEqual(highlights.overhear, []);
    assert.equal(dayHadInteraction(highlights), false);
    assert.equal(ruleDayDiary("2026-11-21", [], false, highlights), "2026-11-21：这一天很安静。");
  });
});
