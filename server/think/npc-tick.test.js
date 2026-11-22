import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { makeWorld, NOON } from "../life/test-helpers.js";
import { createMemory } from "../memory/index.js";
import { getEdge, migrateRelations } from "../relations/index.js";
import { tickThink } from "./index.js";

const memories = [];

after(() => {
  for (const memory of memories) {
    try { memory.close(); } catch { /* already closed */ }
  }
});

function livingRoom(extra = {}) {
  const { characters, viewer, ...rest } = extra;
  return makeWorld({
    viewer: { present: false, room: "dining", lastSeenAt: null, ...viewer },
    characters: {
      qingqing: {
        room: "living",
        action: "sit",
        line: null,
        lineTo: null,
        lastThinkAt: "2026-11-21T03:50:00.000Z",
        lastProactiveAt: null,
        proactiveCountToday: 0,
        lastNpcTalkAt: null,
        npcTalkCountToday: 0,
        stats: { energy: 80, hunger: 80, clean: 80 },
        ...characters?.qingqing,
      },
      linxia: {
        room: "living",
        action: "sit",
        lastThinkAt: NOON,
        ...characters?.linxia,
      },
      xiaonan: {
        room: "living",
        action: "sit",
        lastThinkAt: NOON,
        ...characters?.xiaonan,
      },
    },
    ...rest,
  });
}

function providerSaying(speech, extra = {}) {
  const prompts = [];
  return {
    prompts,
    provider: {
      name: "spy",
      complete: async (input) => {
        prompts.push(input?.prompt ?? "");
        return {
          characterId: "qingqing",
          action: extra.action ?? "sit",
          room: extra.room ?? "living",
          speech,
          fact: extra.fact,
        };
      },
    },
  };
}

describe("think coordinator npc talk", () => {
  it("lands a roommate line when the viewer is absent, writes memory, and settles relations both ways", async () => {
    const world = livingRoom();
    const memory = createMemory({ dbPath: ":memory:" });
    memories.push(memory);
    migrateRelations(world);
    const beforeQL = snapshot(world, "qingqing", "linxia");
    const beforeLQ = snapshot(world, "linxia", "qingqing");
    const beforeQX = snapshot(world, "qingqing", "xiaonan");
    const beforeQV = snapshot(world, "qingqing", "viewer");
    const { provider, prompts } = providerSaying({
      to: "linxia",
      line: "一起坐一会儿吧。",
      reason: "林夏刚在客厅坐下",
    });

    await tickThink(world, { now: new Date(NOON), provider, settings: null, memory });

    const qingqing = world.characters.qingqing;
    assert.equal(qingqing.action, "talk");
    assert.equal(qingqing.npcTalkCountToday, 1);
    assert.equal(qingqing.npcTalkDayKey, "2026-11-21");
    assert.equal(qingqing.lastNpcTalkAt, NOON);
    assert.equal(qingqing.proactiveCountToday, 0);
    assert.equal(qingqing.lastProactiveAt, null);
    // Viewer is in another room and not watching, so the bubble stays hidden.
    assert.equal(qingqing.line, null);
    assert.equal(qingqing.lineTo, null);

    const qingqingWorking = memory.db.prepare("SELECT text FROM working WHERE character_id = ?").get("qingqing");
    const linxiaWorking = memory.db.prepare("SELECT text FROM working WHERE character_id = ?").get("linxia");
    const xiaonanWorking = memory.db.prepare("SELECT text FROM working WHERE character_id = ?").get("xiaonan");
    assert.ok(qingqingWorking.text.includes("对林夏说：一起坐一会儿吧。"));
    assert.ok(linxiaWorking.text.includes("青青对我说：一起坐一会儿吧。"));
    assert.ok(xiaonanWorking.text.includes("听见青青对林夏说：一起坐一会儿吧。"));

    assert.ok(getEdge(world, "qingqing", "linxia").familiarity > beforeQL.familiarity);
    assert.ok(getEdge(world, "qingqing", "linxia").closeness > beforeQL.closeness);
    assert.ok(getEdge(world, "linxia", "qingqing").familiarity > beforeLQ.familiarity);
    assert.ok(getEdge(world, "linxia", "qingqing").closeness > beforeLQ.closeness);
    assert.ok(getEdge(world, "qingqing", "xiaonan").familiarity > beforeQX.familiarity);
    assert.equal(getEdge(world, "qingqing", "xiaonan").closeness, beforeQX.closeness);
    // Viewer edges must not move for the npc line (idleThink is a zero-delta).
    assert.equal(getEdge(world, "qingqing", "viewer").familiarity, beforeQV.familiarity);
    assert.equal(getEdge(world, "qingqing", "viewer").closeness, beforeQV.closeness);

    const prompt = prompts[0];
    assert.ok(prompt.includes("同屋："));
    assert.ok(prompt.includes("linxia"));
    assert.ok(prompt.includes("合法同伴对象："));
    assert.ok(prompt.includes("对同伴说话不需要观众在看"));
  });

  it("shows the bubble only when the viewer is watching in the same room", async () => {
    const world = livingRoom({
      viewer: { present: true, room: "living", lastSeenAt: NOON },
    });
    const { provider } = providerSaying({
      to: "linxia",
      line: "一起坐一会儿吧。",
      reason: "林夏刚在客厅坐下",
    });
    await tickThink(world, { now: new Date(NOON), provider, settings: null });
    assert.equal(world.characters.qingqing.line, "一起坐一会儿吧。");
    assert.equal(world.characters.qingqing.lineTo, "linxia");
    assert.equal(world.characters.qingqing.proactiveCountToday, 0);
  });

  it("does not treat a failed roommate line as proactive speech or consume the proactive cap", async () => {
    const world = livingRoom({
      characters: { linxia: { room: "linxia", action: "sleep" } },
    });
    const before = world.characters.qingqing.action;
    const { provider } = providerSaying({
      to: "linxia",
      line: "你还醒着吗？",
      reason: "想和林夏说话",
    });
    await tickThink(world, { now: new Date(NOON), provider, settings: null });
    assert.equal(world.characters.qingqing.action, before);
    assert.equal(world.characters.qingqing.line, null);
    assert.equal(Number(world.characters.qingqing.npcTalkCountToday) || 0, 0);
    assert.equal(world.characters.qingqing.proactiveCountToday, 0);
    assert.equal(world.characters.qingqing.lastProactiveAt, null);
  });

  it("keeps eating when a dining-table line lands", async () => {
    const world = livingRoom({
      characters: {
        qingqing: { room: "dining", action: "eat" },
        linxia: { room: "dining", action: "eat" },
        xiaonan: { room: "xiaonan", action: "sit" },
      },
    });
    const { provider } = providerSaying(
      { to: "linxia", line: "这菜还不错。", reason: "两人正在一起吃饭" },
      { action: "eat", room: "dining" },
    );
    await tickThink(world, { now: new Date(NOON), provider, settings: null });
    assert.equal(world.characters.qingqing.action, "eat");
    assert.equal(world.characters.qingqing.room, "dining");
    assert.equal(world.characters.qingqing.npcTalkCountToday, 1);
  });

  it("ignores a proposed talk action and still does not start talk from the life intent path", async () => {
    const world = livingRoom();
    const { provider } = providerSaying(null, { action: "talk", room: "living" });
    // Force an illegal talk action with no speech.
    provider.complete = async () => ({ characterId: "qingqing", action: "talk", room: "living" });
    await tickThink(world, { now: new Date(NOON), provider, settings: null });
    assert.equal(world.characters.qingqing.action, "sit");
    assert.equal(world.characters.qingqing.line, null);
  });

  it("cross-room characters do not overhear or gain npcOverhear familiarity", async () => {
    const world = livingRoom({
      characters: { xiaonan: { room: "xiaonan", action: "sit" } },
    });
    const memory = createMemory({ dbPath: ":memory:" });
    memories.push(memory);
    await tickThink(world, { now: new Date(NOON), memory, settings: null, provider: providerSaying({
      to: "linxia",
      line: "一起坐一会儿吧。",
      reason: "林夏刚在客厅坐下",
    }).provider });
    const xiaonanWorking = memory.db.prepare("SELECT text FROM working WHERE character_id = ?").get("xiaonan");
    assert.equal(xiaonanWorking == null || !xiaonanWorking.text.includes("听见青青对林夏说"), true);
    const overheard = memory.db.prepare(
      "SELECT kind FROM messages WHERE character_id = ? AND kind = 'overhear'",
    ).all("xiaonan");
    assert.equal(overheard.length, 0);
  });

  it("raises speaker and listener mood after a successful roommate line, not the overhearer", async () => {
    const world = livingRoom({
      characters: {
        qingqing: { stats: { mood: 50, energy: 80, hunger: 80, clean: 80 } },
        linxia: { stats: { mood: 50 } },
        xiaonan: { stats: { mood: 50 } },
      },
    });
    const energy = world.characters.qingqing.stats.energy;
    await tickThink(world, {
      now: new Date(NOON),
      settings: null,
      provider: providerSaying({
        to: "linxia",
        line: "一起坐一会儿吧。",
        reason: "林夏刚在客厅坐下",
      }).provider,
    });
    assert.equal(world.characters.qingqing.stats.mood, 50.8);
    assert.equal(world.characters.linxia.stats.mood, 50.6);
    assert.equal(world.characters.xiaonan.stats.mood, 50);
    assert.equal(world.characters.qingqing.moodMeta.npcTalkGain, 0.8);
    assert.equal(world.characters.linxia.moodMeta.npcTalkGain, 0.6);
    assert.equal(world.characters.xiaonan.moodMeta, undefined);
    assert.equal(world.characters.qingqing.stats.energy, energy);
  });
});

function snapshot(world, from, to) {
  // tickThink migrates relations; this helper is used before and after.
  const edge = getEdge(world, from, to);
  if (!edge) return { familiarity: 0, closeness: 0 };
  return { familiarity: edge.familiarity, closeness: edge.closeness };
}
