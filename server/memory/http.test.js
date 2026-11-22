import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nowClock } from "../clock.js";
import { createMemory, mergeMemoryConfig } from "./index.js";
import { getMeta, setMeta } from "./db.js";
import { upsertFact } from "./facts.js";
import { rememberTopic } from "./topics.js";
import { appendMessage } from "./messages.js";
import { getMemoryBrowseResponse, getMemoryExportResponse, parseExportFormat } from "./http.js";

const NOON = "2026-11-21T04:00:00.000Z";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const memories = [];

after(() => {
  for (const memory of memories) {
    try { memory.close(); } catch { /* already closed */ }
  }
});

function makeWorld() {
  const memory = createMemory({
    dbPath: ":memory:",
    config: mergeMemoryConfig(),
  });
  memories.push(memory);
  appendMessage(memory.db, {
    characterId: "qingqing",
    kind: "chat",
    role: "user",
    text: "今天一起喝茶好吗",
    createdAt: NOON,
  });
  upsertFact(memory.db, "qingqing", { text: "喜欢和你一起喝茶", importance: 2 }, memory.config, NOON);
  rememberTopic(memory.db, "qingqing", "喝茶聊天", memory.config, NOON);
  setMeta(memory.db, "lastDiaryGameDay", "2026-11-21");
  return {
    memory,
    settings: null,
    world: {
      clock: nowClock(new Date(NOON)),
      characters: {
        qingqing: { id: "qingqing", name: "青青" },
        linxia: { id: "linxia", name: "林夏" },
        xiaonan: { id: "xiaonan", name: "小南" },
      },
    },
  };
}

function diaryCount(db) {
  return Number(db.prepare("SELECT COUNT(*) AS n FROM diaries").get()?.n) || 0;
}

describe("memory browse and export HTTP", () => {
  it("returns the browse payload for a known character", () => {
    const world = makeWorld();
    const result = getMemoryBrowseResponse(world, "http://127.0.0.1:8787/api/memory/browse?character=qingqing", {
      now: NOON,
      clock: world.world.clock,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.character.name, "青青");
    assert.equal(result.body.today.source, "today");
    assert.match(result.body.today.text, /今天一起喝茶好吗/);
    assert.equal(result.body.facts[0].text, "喜欢和你一起喝茶");
    assert.equal(diaryCount(world.memory.db), 0);
    assert.equal(getMeta(world.memory.db, "lastDiaryGameDay"), "2026-11-21");
  });

  it("rejects a missing or unknown character and does not write the diaries table", () => {
    const world = makeWorld();
    const missing = getMemoryBrowseResponse(world, "http://127.0.0.1:8787/api/memory/browse", { now: NOON });
    assert.equal(missing.status, 400);
    assert.deepEqual(missing.body, { ok: false, error: "missing-character" });

    const empty = getMemoryBrowseResponse(world, "http://127.0.0.1:8787/api/memory/browse?character=", { now: NOON });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, "missing-character");

    const unknown = getMemoryBrowseResponse(
      world,
      "http://127.0.0.1:8787/api/memory/browse?character=nobody",
      { now: NOON },
    );
    assert.equal(unknown.status, 400);
    assert.deepEqual(unknown.body, { ok: false, error: "unknown-character" });

    const exportMissing = getMemoryExportResponse(world, "http://127.0.0.1:8787/api/memory/export?format=md", { now: NOON });
    assert.equal(exportMissing.status, 400);
    assert.equal(exportMissing.body.error, "missing-character");

    assert.equal(diaryCount(world.memory.db), 0);
    assert.equal(getMeta(world.memory.db, "lastDiaryGameDay"), "2026-11-21");
  });

  it("rejects an invalid format and does not write disk", () => {
    const world = makeWorld();
    const result = getMemoryExportResponse(
      world,
      "http://127.0.0.1:8787/api/memory/export?character=qingqing&format=csv",
      { now: NOON, clock: world.world.clock },
    );
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { ok: false, error: "invalid-format" });
    assert.equal(parseExportFormat("csv"), null);
    assert.equal(parseExportFormat(""), "md");
    assert.equal(parseExportFormat(null), "md");
    assert.equal(parseExportFormat("json"), "json");
    assert.equal(diaryCount(world.memory.db), 0);
  });

  it("sets markdown download headers and the Chinese filename", () => {
    const world = makeWorld();
    const result = getMemoryExportResponse(
      world,
      "http://127.0.0.1:8787/api/memory/export?character=qingqing",
      { now: NOON, clock: world.world.clock },
    );
    assert.equal(result.status, 200);
    assert.equal(result.filename, "青青日记-2026-11-21.md");
    assert.equal(result.headers["Content-Type"], "text/markdown; charset=utf-8");
    assert.match(result.headers["Content-Disposition"], /filename\*=UTF-8''%E9%9D%92%E9%9D%92%E6%97%A5%E8%AE%B0-2026-11-21\.md/);
    assert.match(result.body, /# 青青的日记/);
    assert.match(result.body, /喜欢和你一起喝茶/);
    assert.equal(diaryCount(world.memory.db), 0);
  });

  it("exports all characters as json with the house filename", () => {
    const world = makeWorld();
    const result = getMemoryExportResponse(
      world,
      "http://127.0.0.1:8787/api/memory/export?character=all&format=json",
      { now: NOON, clock: world.world.clock },
    );
    assert.equal(result.status, 200);
    assert.equal(result.filename, "房子日记-2026-11-21.json");
    assert.equal(result.headers["Content-Type"], "application/json; charset=utf-8");
    const parsed = JSON.parse(result.body);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.characters.map((item) => item.character.id), [
      "qingqing",
      "linxia",
      "xiaonan",
    ]);
    assert.equal(diaryCount(world.memory.db), 0);
  });

  it("does not default export character to all", () => {
    const world = makeWorld();
    const result = getMemoryExportResponse(
      world,
      "http://127.0.0.1:8787/api/memory/export?format=md",
      { now: NOON },
    );
    assert.equal(result.body.error, "missing-character");
    assert.equal(result.body.ok, false);
  });

  it("registers the two GET routes on the house server", () => {
    const source = readFileSync(path.join(ROOT, "server/index.js"), "utf8");
    assert.match(source, /\/api\/memory\/browse/);
    assert.match(source, /\/api\/memory\/export/);
    assert.match(source, /getMemoryBrowseResponse/);
    assert.match(source, /getMemoryExportResponse/);
    assert.match(source, /resolveListenHost/);
    assert.match(source, /const HOST = resolveListenHost/);
  });
});
