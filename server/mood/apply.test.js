import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeWorld, NOON, MORNING } from "../life/test-helpers.js";
import { applyEvent as applyRelationEvent, getEdge, migrateRelations } from "../relations/index.js";
import { applyEvent, mergeMoodConfig, config } from "./index.js";

function later(iso, ms) {
  return new Date(Date.parse(iso) + ms);
}

function moodOf(world, id) {
  return world.characters[id].stats.mood;
}

function snapshotStats(character) {
  return {
    energy: character.stats.energy,
    hunger: character.stats.hunger,
    clean: character.stats.clean,
    bond: character.stats.bond,
    mood: character.stats.mood,
  };
}

function snapshotEdges(world) {
  return structuredClone(world.relations ?? []);
}

function worldReady(patch = {}) {
  const world = makeWorld(patch);
  migrateRelations(world);
  return world;
}

describe("mood apply", () => {
  it("adds +2 mood on a successful player chat", () => {
    const world = worldReady();
    const before = moodOf(world, "qingqing");
    const result = applyEvent(world, {
      type: "playerChat",
      characterId: "qingqing",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
    });
    assert.equal(result.applied, true);
    assert.equal(result.delta, 2);
    assert.equal(moodOf(world, "qingqing"), before + 2);
    assert.equal(world.characters.qingqing.moodMeta.playerChatGain, 2);
    assert.equal(world.characters.qingqing.moodMeta.lastPlayerChatAt, new Date(NOON).toISOString());
  });

  it("adds nothing for too-short or cooldown player chat", () => {
    const world = worldReady();
    const start = moodOf(world, "qingqing");
    const short = applyEvent(world, {
      type: "playerChat",
      characterId: "qingqing",
      text: "你好。",
      now: new Date(NOON),
    });
    assert.equal(short.applied, false);
    assert.equal(short.reason, "short");
    assert.equal(moodOf(world, "qingqing"), start);
    assert.equal(world.characters.qingqing.moodMeta, undefined);

    const first = applyEvent(world, {
      type: "playerChat",
      characterId: "qingqing",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
    });
    assert.equal(first.applied, true);
    const afterFirst = moodOf(world, "qingqing");
    const spam = applyEvent(world, {
      type: "playerChat",
      characterId: "qingqing",
      text: "再跟你说一件刚才想到的小事。",
      now: later(NOON, 1_000),
    });
    assert.equal(spam.applied, false);
    assert.equal(spam.reason, "cooldown");
    assert.equal(moodOf(world, "qingqing"), afterFirst);

    const afterCool = applyEvent(world, {
      type: "playerChat",
      characterId: "qingqing",
      text: "再跟你说一件刚才想到的小事。",
      now: later(NOON, 45_000),
    });
    assert.equal(afterCool.applied, true);
    assert.equal(moodOf(world, "qingqing"), afterFirst + 2);
  });

  it("truncates at the daily player-chat cap", () => {
    const cfg = mergeMoodConfig(config, {
      playerChat: { cooldownMs: 0, delta: 4, maxGainPerDay: 10 },
    });
    const world = worldReady({
      characters: { qingqing: { stats: { mood: 50 } } },
    });
    const now = new Date(NOON);
    const first = applyEvent(world, {
      type: "playerChat",
      characterId: "qingqing",
      text: "今天过得怎么样，有没有休息好？",
      now,
    }, { cfg });
    const second = applyEvent(world, {
      type: "playerChat",
      characterId: "qingqing",
      text: "还想再跟你多说几句刚才的事。",
      now: later(NOON, 1_000),
    }, { cfg });
    const third = applyEvent(world, {
      type: "playerChat",
      characterId: "qingqing",
      text: "最后再问你一句今天还好吗。",
      now: later(NOON, 2_000),
    }, { cfg });
    assert.equal(first.delta, 4);
    assert.equal(second.delta, 4);
    assert.equal(third.applied, true);
    assert.equal(third.delta, 2);
    assert.equal(moodOf(world, "qingqing"), 60);
    const fourth = applyEvent(world, {
      type: "playerChat",
      characterId: "qingqing",
      text: "已经聊了不少了，再试一句。",
      now: later(NOON, 3_000),
    }, { cfg });
    assert.equal(fourth.applied, false);
    assert.equal(fourth.reason, "capped");
    assert.equal(moodOf(world, "qingqing"), 60);
  });

  it("halves gains at 80 mood and quarters them at 90, then applies the daily cap", () => {
    const worldHigh = worldReady({
      characters: { qingqing: { stats: { mood: 82 } } },
    });
    const high = applyEvent(worldHigh, {
      type: "playerChat",
      characterId: "qingqing",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
    });
    assert.equal(high.applied, true);
    assert.equal(high.delta, 1);
    assert.equal(moodOf(worldHigh, "qingqing"), 83);

    const worldVery = worldReady({
      characters: { qingqing: { stats: { mood: 90 } } },
    });
    const very = applyEvent(worldVery, {
      type: "playerChat",
      characterId: "qingqing",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
    });
    assert.equal(very.applied, true);
    assert.equal(very.delta, 0.5);
    assert.equal(moodOf(worldVery, "qingqing"), 90.5);

    const cfg = mergeMoodConfig(config, {
      playerChat: { cooldownMs: 0, delta: 8, maxGainPerDay: 5 },
    });
    const worldCap = worldReady({
      characters: { qingqing: { stats: { mood: 82 } } },
    });
    // diminish 8 → 4, then cap remaining 5 → 4
    const first = applyEvent(worldCap, {
      type: "playerChat",
      characterId: "qingqing",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
    }, { cfg });
    assert.equal(first.delta, 4);
    const second = applyEvent(worldCap, {
      type: "playerChat",
      characterId: "qingqing",
      text: "再跟你说一件刚才想到的小事。",
      now: later(NOON, 1_000),
    }, { cfg });
    // diminish 8 → 4, remain 1 → 1
    assert.equal(second.delta, 1);
    assert.equal(moodOf(worldCap, "qingqing"), 87);
  });

  it("resets daily gains when the game day rolls over", () => {
    const cfg = mergeMoodConfig(config, {
      playerChat: { cooldownMs: 0, delta: 6, maxGainPerDay: 6 },
    });
    const world = worldReady({
      characters: { qingqing: { stats: { mood: 40 } } },
    });
    const first = applyEvent(world, {
      type: "playerChat",
      characterId: "qingqing",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
    }, { cfg });
    assert.equal(first.delta, 6);
    const sameDay = applyEvent(world, {
      type: "playerChat",
      characterId: "qingqing",
      text: "再跟你说一件刚才想到的小事。",
      now: later(NOON, 1_000),
    }, { cfg });
    assert.equal(sameDay.applied, false);
    assert.equal(world.characters.qingqing.moodMeta.dayKey, "2026-11-21");

    const nextDay = applyEvent(world, {
      type: "playerChat",
      characterId: "qingqing",
      text: "新的一天，再跟你打个招呼吧。",
      now: new Date(MORNING),
    }, { cfg });
    assert.equal(nextDay.applied, true);
    assert.equal(nextDay.delta, 6);
    assert.equal(world.characters.qingqing.moodMeta.dayKey, "2026-11-22");
    assert.equal(world.characters.qingqing.moodMeta.playerChatGain, 6);
    assert.equal(moodOf(world, "qingqing"), 52);
  });

  it("adds npc talk mood to the speaker and the listener, each on their own cap", () => {
    const world = worldReady({
      characters: {
        qingqing: { stats: { mood: 50 } },
        linxia: { stats: { mood: 50 } },
        xiaonan: { stats: { mood: 50 } },
      },
    });
    const speaker = applyEvent(world, {
      type: "npcTalk",
      characterId: "qingqing",
      role: "speaker",
      now: new Date(NOON),
    });
    const listener = applyEvent(world, {
      type: "npcTalk",
      characterId: "linxia",
      role: "listener",
      now: new Date(NOON),
    });
    assert.equal(speaker.applied, true);
    assert.equal(speaker.delta, 0.8);
    assert.equal(listener.applied, true);
    assert.equal(listener.delta, 0.6);
    assert.equal(moodOf(world, "qingqing"), 50.8);
    assert.equal(moodOf(world, "linxia"), 50.6);
    assert.equal(moodOf(world, "xiaonan"), 50);
    assert.equal(world.characters.qingqing.moodMeta.npcTalkGain, 0.8);
    assert.equal(world.characters.linxia.moodMeta.npcTalkGain, 0.6);
    assert.equal(world.characters.xiaonan.moodMeta, undefined);
  });

  it("adds proactive speech mood only to the speaker", () => {
    const world = worldReady({
      characters: {
        qingqing: { stats: { mood: 50 } },
        linxia: { stats: { mood: 50 } },
      },
    });
    const result = applyEvent(world, {
      type: "proactiveSpeech",
      characterId: "qingqing",
      now: new Date(NOON),
    });
    assert.equal(result.applied, true);
    assert.equal(result.delta, 1);
    assert.equal(moodOf(world, "qingqing"), 51);
    assert.equal(moodOf(world, "linxia"), 50);
    assert.equal(world.characters.qingqing.moodMeta.proactiveGain, 1);
  });

  it("does not change relations or other stats, and does not reset an existing mood value", () => {
    const world = worldReady({
      characters: {
        qingqing: { stats: { mood: 61, energy: 77, hunger: 66, clean: 55, bond: 18 } },
      },
    });
    const statsBefore = snapshotStats(world.characters.qingqing);
    const edgesBefore = snapshotEdges(world);
    const startedAt = world.startedAt;
    applyEvent(world, {
      type: "playerChat",
      characterId: "qingqing",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
    });
    const statsAfter = world.characters.qingqing.stats;
    assert.equal(statsAfter.mood, 63);
    assert.equal(statsAfter.energy, statsBefore.energy);
    assert.equal(statsAfter.hunger, statsBefore.hunger);
    assert.equal(statsAfter.clean, statsBefore.clean);
    assert.equal(statsAfter.bond, statsBefore.bond);
    assert.deepEqual(world.relations, edgesBefore);
    assert.equal(world.startedAt, startedAt);
  });

  it("does not roll back a prior relations write if mood settlement is skipped", () => {
    const world = worldReady();
    const beforeEdge = getEdge(world, "qingqing", "viewer");
    const fam = beforeEdge.familiarity;
    applyRelationEvent(world, {
      type: "playerChat",
      from: "qingqing",
      to: "viewer",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
    });
    const afterRelation = getEdge(world, "qingqing", "viewer").familiarity;
    assert.ok(afterRelation > fam);
    const mood = applyEvent(world, {
      type: "playerChat",
      characterId: "qingqing",
      text: "你好。",
      now: new Date(NOON),
    });
    assert.equal(mood.applied, false);
    assert.equal(getEdge(world, "qingqing", "viewer").familiarity, afterRelation);
  });

  it("treats missing moodMeta as zeros and does not write data files", () => {
    const world = worldReady({
      startedAt: "2026-11-21T02:17:31.039Z",
      characters: { qingqing: { stats: { mood: 40 } } },
    });
    delete world.characters.qingqing.moodMeta;
    const result = applyEvent(world, {
      type: "playerChat",
      characterId: "qingqing",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
    });
    assert.equal(result.applied, true);
    assert.equal(world.characters.qingqing.moodMeta.playerChatGain, 2);
    assert.equal(world.characters.qingqing.moodMeta.npcTalkGain, 0);
    assert.equal(world.characters.qingqing.moodMeta.proactiveGain, 0);
    assert.equal(world.characters.qingqing.moodMeta.interjectGain, 0);
    assert.equal(world.startedAt, "2026-11-21T02:17:31.039Z");
    assert.equal(world.characters.qingqing.room, "living");
  });

  it("reads overlay numbers from settings at event time", () => {
    const world = worldReady({
      characters: { qingqing: { stats: { mood: 50 } } },
    });
    const result = applyEvent(world, {
      type: "playerChat",
      characterId: "qingqing",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
    }, { settings: { house: { mood: { playerChat: { delta: 5, cooldownMs: 0 } } } } });
    assert.equal(result.applied, true);
    assert.equal(result.delta, 5);
    assert.equal(moodOf(world, "qingqing"), 55);
  });

  it("adds a smaller interject mood gain with its own daily cap and diminish", () => {
    const world = worldReady({
      characters: { linxia: { stats: { mood: 50 } } },
    });
    const short = applyEvent(world, {
      type: "interject",
      characterId: "linxia",
      text: "饿了吗？",
      now: new Date(NOON),
    });
    assert.equal(short.applied, true);
    assert.equal(short.delta, 0.8);
    assert.equal(moodOf(world, "linxia"), 50.8);
    assert.equal(world.characters.linxia.moodMeta.interjectGain, 0.8);
    assert.equal(world.characters.linxia.moodMeta.playerChatGain, 0);

    const second = applyEvent(world, {
      type: "interject",
      characterId: "linxia",
      text: "还有吗？",
      now: later(NOON, 1_000),
    });
    assert.equal(second.applied, true);
    assert.equal(moodOf(world, "linxia"), 51.6);

    const capped = applyEvent(world, {
      type: "interject",
      characterId: "linxia",
      text: "再来一句。",
      now: later(NOON, 2_000),
    });
    assert.equal(capped.applied, false);
    assert.equal(capped.reason, "capped");
    assert.equal(moodOf(world, "linxia"), 51.6);

    const high = worldReady({
      characters: { linxia: { stats: { mood: 90 } } },
    });
    const dim = applyEvent(high, {
      type: "interject",
      characterId: "linxia",
      text: "有人饿了吗？",
      now: new Date(NOON),
    });
    assert.equal(dim.applied, true);
    assert.equal(dim.delta, 0.2);
    assert.equal(moodOf(high, "linxia"), 90.2);
  });

  it("reads interject overlay numbers from settings at event time", () => {
    const world = worldReady({
      characters: { linxia: { stats: { mood: 50 } } },
    });
    const result = applyEvent(world, {
      type: "interject",
      characterId: "linxia",
      text: "有人饿了吗？",
      now: new Date(NOON),
    }, { settings: { house: { mood: { interject: { delta: 1.5 } } } } });
    assert.equal(result.applied, true);
    assert.equal(result.delta, 1.5);
    assert.equal(moodOf(world, "linxia"), 51.5);
  });
});
