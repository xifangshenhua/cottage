import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createMemory, mergeMemoryConfig } from "./index.js";
import { appendMessage } from "./messages.js";
import { upsertFact } from "./facts.js";
import { rememberTopic } from "./topics.js";
import { appendEpisode } from "./episodes.js";
import { maybeCompressWithModel } from "./compress.js";
import { writeDayDiary } from "./diaries.js";
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

function clockAt(iso = NOON) {
  return nowClock(new Date(iso));
}

function character(id = "qingqing") {
  return {
    id,
    name: "青青",
    room: "living",
    action: "sit",
    line: null,
    lastProactiveAt: null,
    stats: { energy: 70, hunger: 70, clean: 80, mood: 70, bond: 18 },
  };
}

describe("memory retrieve and record", () => {
  it("keeps the idle pack under its char cap and omits raw message logs", () => {
    const memory = makeMemory();
    const { db, config } = memory;
    const rawMarker = "UNIQUE_RAW_MESSAGE_TOKEN_SHOULD_NOT_APPEAR";
    appendMessage(db, {
      characterId: "qingqing",
      kind: "chat",
      role: "viewer",
      text: rawMarker,
      createdAt: NOON,
    });
    for (let i = 0; i < 10; i += 1) {
      upsertFact(db, "qingqing", { text: `这是一条足够长的事实用来撑满检索包${i}号`, importance: 2 }, config, NOON);
    }
    rememberTopic(db, "qingqing", "喝茶聊天", config, NOON);
    appendEpisode(db, {
      characterId: "qingqing",
      dayKey: "2026-11-21",
      action: "sit",
      room: "living",
      speechLanded: false,
      summary: "sit @living",
      createdAt: NOON,
    });

    const pack = memory.loadForThink(
      { viewer: { present: false, room: "living" } },
      character(),
      clockAt(NOON),
      new Date(NOON),
    );
    assert.ok(pack.length <= config.idlePackChars, `idle pack ${pack.length} exceeded ${config.idlePackChars}`);
    assert.equal(pack.includes(rawMarker), false);
    assert.equal(pack.includes("工作记忆："), false);
    assert.equal(pack.includes("最近对话："), false);
  });

  it("lets the engaged pack include more but still stay under its cap", () => {
    const memory = makeMemory();
    const { db, config } = memory;
    for (let i = 0; i < 16; i += 1) {
      upsertFact(db, "qingqing", { text: `互动事实${i}：喜欢在客厅里慢慢喝茶聊天`, importance: 3 }, config, NOON);
    }
    const ch = character();
    ch.lastProactiveAt = NOON;
    ch.line = "你来了。";
    const world = { viewer: { present: true, room: "living" } };
    const pack = memory.loadForThink(world, ch, clockAt(NOON), new Date(NOON));
    assert.ok(pack.length <= config.engagedPackChars, `engaged pack ${pack.length} exceeded ${config.engagedPackChars}`);
    assert.ok(pack.includes("上次开口：") || pack.includes("事实："));
    assert.ok(pack.length > 0);
  });

  it("recordAfterThink writes an episode and trims working memory to the cap", () => {
    const memory = makeMemory({ workingMemoryChars: 80 });
    const ch = character();
    const clock = clockAt(NOON);
    const longLine = "这是一句很长的摘要用来把工作记忆撑过上限，需要被裁掉旧的部分。";
    for (let i = 0; i < 8; i += 1) {
      memory.recordAfterThink({
        world: { viewer: { present: false } },
        character: ch,
        intent: { action: "sit", room: "living" },
        clock,
        now: new Date(NOON),
        speechLanded: false,
      });
      // Stretch the compiled line by recording a fact-free long action summary via extra working appends is implicit.
      memory.db.prepare("UPDATE episodes SET summary = ? WHERE id = (SELECT MAX(id) FROM episodes)").run(`${longLine}${i}`);
    }
    // Rebuild working memory over the cap using the public record path with long speech.
    ch.line = longLine;
    for (let i = 0; i < 6; i += 1) {
      memory.recordAfterThink({
        world: { viewer: { present: true } },
        character: ch,
        intent: { action: "sit", room: "living", speech: { to: "viewer", line: longLine, reason: "测试" } },
        clock,
        now: new Date(NOON),
        speechLanded: true,
      });
    }
    const episodes = memory.db.prepare("SELECT COUNT(*) AS n FROM episodes WHERE character_id = ?").get("qingqing");
    assert.ok(episodes.n >= 1);
    const working = memory.db.prepare("SELECT text FROM working WHERE character_id = ?").get("qingqing");
    assert.ok(working?.text.length <= 80, `working memory ${working?.text.length} exceeded 80`);
  });

  it("evicts the lowest-importance oldest fact when the cap is exceeded", () => {
    const memory = makeMemory({ maxFacts: 3, factMaxChars: 80 });
    const { db, config } = memory;
    upsertFact(db, "qingqing", { text: "最旧最不重要", importance: 1 }, config, "2026-11-21T01:00:00.000Z");
    upsertFact(db, "qingqing", { text: "中等重要", importance: 2 }, config, "2026-11-21T02:00:00.000Z");
    upsertFact(db, "qingqing", { text: "很重要", importance: 5 }, config, "2026-11-21T03:00:00.000Z");
    upsertFact(db, "qingqing", { text: "新进来的事实", importance: 3 }, config, "2026-11-21T04:00:00.000Z");
    const rows = db.prepare("SELECT text FROM facts WHERE character_id = ? ORDER BY importance DESC").all("qingqing");
    const texts = rows.map((row) => row.text);
    assert.equal(texts.length, 3);
    assert.ok(texts.includes("新进来的事实"));
    assert.ok(texts.includes("很重要"));
    assert.equal(texts.includes("最旧最不重要"), false);
  });

  it("does not call a provider for compress or diary when diaryUseModel is false", async () => {
    const calls = [];
    const provider = {
      name: "spy",
      complete: async (input) => {
        calls.push(input);
        return "model should not be used";
      },
    };
    const memory = makeMemory({ diaryUseModel: false, writeDiaryIfNoInteraction: "short" });
    const clock = clockAt(NOON);
    memory.recordAfterThink({
      world: { viewer: { present: false } },
      character: character(),
      intent: { action: "sit", room: "living" },
      clock,
      now: new Date(NOON),
      speechLanded: false,
    });

    await maybeCompressWithModel("一段需要压缩的文本".repeat(20), {
      cap: 40,
      useModel: memory.config.diaryUseModel,
      provider,
    });
    await writeDayDiary(memory.db, "qingqing", "2026-11-21", memory.config, {
      nowIso: NOON,
      provider,
    });

    // Game-day rollover: 07:00 on 2026-11-22 is 2026-11-21T23:00:00.000Z
    const nextMorning = new Date("2026-11-21T23:00:00.000Z");
    const world = {
      clock: nowClock(nextMorning),
      characters: { qingqing: character() },
    };
    await memory.tickDiary(world, { now: nextMorning, provider });
    assert.equal(calls.length, 0);
  });

  it("records an overhear in working memory without fact or topic extraction", () => {
    const memory = makeMemory({ workingMemoryChars: 200 });
    const linxia = { id: "linxia", name: "林夏", room: "living", action: "sit" };
    const qingqing = character();
    memory.recordOverhear({
      character: linxia,
      userText: "中午吃饭了吗？",
      reply: "吃了一点。",
      target: qingqing,
      responder: qingqing,
      volume: { id: "normal", label: "普通" },
      viewerRoom: "living",
      now: new Date(NOON),
    });
    const rows = memory.db.prepare(
      "SELECT role, kind, text FROM messages WHERE character_id = ? ORDER BY id",
    ).all("linxia");
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((row) => row.kind === "overhear"));
    assert.ok(rows.some((row) => row.role === "user" && row.text.includes("中午吃饭了吗")));
    const working = memory.db.prepare("SELECT text FROM working WHERE character_id = ?").get("linxia");
    assert.equal(working.text.includes("你对青青说"), true);
    assert.equal(working.text.includes("我听见了"), true);
    assert.equal(working.text.includes("吃了一点"), true);
    const facts = memory.db.prepare("SELECT text FROM facts WHERE character_id = ?").all("linxia");
    const topics = memory.db.prepare("SELECT text FROM topics WHERE character_id = ?").all("linxia");
    assert.equal(facts.length, 0);
    assert.equal(topics.length, 0);
  });

  it("includes overhear turns in the chat retrieve pack by default", () => {
    const memory = makeMemory();
    const linxia = { id: "linxia", name: "林夏", room: "dining", action: "sit" };
    const qingqing = { ...character(), room: "living" };
    memory.recordOverhear({
      character: linxia,
      userText: "UNIQUE_OVERHEAR_TOKEN_SHOULD_APPEAR",
      reply: "这句跨房间回复不会被记成听见",
      target: qingqing,
      responder: qingqing,
      volume: { id: "loud", label: "大声" },
      viewerRoom: "living",
      now: new Date(NOON),
    });
    const pack = memory.loadForChat(
      { viewer: { present: true, room: "living" } },
      linxia,
      clockAt(NOON),
      new Date(NOON),
    );
    assert.equal(pack.includes("最近对话："), true);
    assert.equal(pack.includes("user：UNIQUE_OVERHEAR_TOKEN_SHOULD_APPEAR"), true);
    const working = memory.db.prepare("SELECT text FROM working WHERE character_id = ?").get("linxia");
    assert.equal(working.text.includes("UNIQUE_OVERHEAR_TOKEN_SHOULD_APPEAR"), true);
    assert.equal(working.text.includes("大声"), true);
    assert.equal(working.text.includes("这句跨房间回复不会被记成听见"), false);
  });

  it("can still omit overhear turns from the chat pack when the flag is off", () => {
    const memory = makeMemory({ includeOverhearInChatPack: false });
    const linxia = { id: "linxia", name: "林夏", room: "dining", action: "sit" };
    const qingqing = { ...character(), room: "living" };
    memory.recordOverhear({
      character: linxia,
      userText: "UNIQUE_OVERHEAR_TOKEN_SHOULD_NOT_APPEAR",
      reply: "这句回复不应该进检索包",
      target: qingqing,
      responder: qingqing,
      volume: { id: "loud", label: "大声" },
      viewerRoom: "living",
      now: new Date(NOON),
    });
    const pack = memory.loadForChat(
      { viewer: { present: true, room: "living" } },
      linxia,
      clockAt(NOON),
      new Date(NOON),
    );
    assert.equal(pack.includes("最近对话："), false);
    assert.equal(pack.includes("user：UNIQUE_OVERHEAR_TOKEN_SHOULD_NOT_APPEAR"), false);
    const working = memory.db.prepare("SELECT text FROM working WHERE character_id = ?").get("linxia");
    assert.equal(working.text.includes("UNIQUE_OVERHEAR_TOKEN_SHOULD_NOT_APPEAR"), true);
  });

  it("records npc talk for speaker and listener, and includes bystander overhear in recent chat turns", () => {
    const memory = makeMemory();
    const world = {
      characters: {
        qingqing: character("qingqing"),
        linxia: { id: "linxia", name: "林夏", room: "living", action: "sit" },
        xiaonan: { id: "xiaonan", name: "小南", room: "living", action: "sit" },
      },
    };
    const recorded = memory.recordNpcTalk({
      world,
      speaker: world.characters.qingqing,
      listener: world.characters.linxia,
      line: "一起坐一会儿吧。",
      now: new Date(NOON),
    });
    assert.deepEqual(recorded.bystanders, ["xiaonan"]);

    const qingqingWorking = memory.db.prepare("SELECT text FROM working WHERE character_id = ?").get("qingqing");
    const linxiaWorking = memory.db.prepare("SELECT text FROM working WHERE character_id = ?").get("linxia");
    const xiaonanWorking = memory.db.prepare("SELECT text FROM working WHERE character_id = ?").get("xiaonan");
    assert.equal(qingqingWorking.text.includes("对林夏说：一起坐一会儿吧。"), true);
    assert.equal(linxiaWorking.text.includes("青青对我说：一起坐一会儿吧。"), true);
    assert.equal(xiaonanWorking.text.includes("听见青青对林夏说：一起坐一会儿吧。"), true);

    const kinds = memory.db.prepare("SELECT character_id, kind FROM messages ORDER BY id").all();
    assert.ok(kinds.some((row) => row.character_id === "qingqing" && row.kind === "npc"));
    assert.ok(kinds.some((row) => row.character_id === "linxia" && row.kind === "npc"));
    assert.ok(kinds.some((row) => row.character_id === "xiaonan" && row.kind === "overhear"));

    const qingqingPack = memory.loadForChat(world, world.characters.qingqing, clockAt(NOON), new Date(NOON));
    assert.ok(qingqingPack.includes("对林夏说：一起坐一会儿吧。"));
    assert.ok(qingqingPack.includes("一起坐一会儿吧。"));

    const xiaonanPack = memory.loadForChat(world, world.characters.xiaonan, clockAt(NOON), new Date(NOON));
    assert.ok(xiaonanPack.includes("character：一起坐一会儿吧。"));
    assert.ok(xiaonanPack.includes("听见青青对林夏说：一起坐一会儿吧。"));
  });
});
