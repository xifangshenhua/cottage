import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeWorld, NOON } from "../../life/test-helpers.js";
import { nowClock } from "../../clock.js";
import { config } from "./config.js";
import {
  characterDayCount,
  houseOccasionCount,
  houseOccasionFull,
  isEligible,
  isWhisper,
  listCandidates,
  mentionsPresentName,
  shouldJudge,
} from "./gates.js";

function worldTwoInLiving(patch = {}) {
  const { characters, ...rest } = patch;
  return makeWorld({
    viewer: { present: true, room: "living", lastSeenAt: NOON },
    characters: {
      qingqing: { room: "living", action: "sit" },
      linxia: { room: "living", action: "sit" },
      xiaonan: { room: "xiaonan", action: "sit" },
      ...characters,
    },
    ...rest,
  });
}

function audienceFor(world, { volume = "normal", targetId = "qingqing", extraOverhearers } = {}) {
  const responder = world.characters.qingqing;
  const overhearers = extraOverhearers ?? Object.values(world.characters).filter((c) => {
    if (c.id === responder.id) return false;
    if (volume === "whisper") return false;
    if (volume === "normal") return c.room === world.viewer.room && c.action !== "sleep";
    return c.action !== "sleep";
  });
  const range = volume === "whisper" ? "target" : volume === "loud" ? "house" : "room";
  return {
    ok: true,
    volume: { id: volume, label: volume === "whisper" ? "悄悄" : volume === "loud" ? "大声" : "普通", range, requiresTarget: volume === "whisper" },
    targetId,
    responder,
    overhearers,
    hearers: [responder, ...overhearers],
  };
}

describe("interject gates", () => {
  it("lists same-room overhearers who can reply", () => {
    const world = worldTwoInLiving();
    const clock = nowClock(new Date(NOON));
    const candidates = listCandidates(world, {
      audience: audienceFor(world),
      responder: world.characters.qingqing,
      now: new Date(NOON),
      clock,
    }, config);
    assert.deepEqual(candidates.map((c) => c.id), ["linxia"]);
  });

  it("skips whispers and the primary responder", () => {
    const world = worldTwoInLiving();
    const clock = nowClock(new Date(NOON));
    const whisper = audienceFor(world, { volume: "whisper" });
    assert.equal(isWhisper(whisper), true);
    const candidates = listCandidates(world, {
      audience: whisper,
      responder: world.characters.qingqing,
      now: new Date(NOON),
      clock,
    }, config);
    assert.deepEqual(candidates, []);
    assert.equal(isEligible(world.characters.qingqing, world, {
      audience: audienceFor(world),
      responder: world.characters.qingqing,
      now: new Date(NOON),
      clock,
    }, config), false);
  });

  it("does not offer a sleeper or a wash-busy character", () => {
    const world = worldTwoInLiving({
      characters: {
        linxia: { room: "living", action: "sleep" },
        xiaonan: { room: "living", action: "wash" },
      },
    });
    const clock = nowClock(new Date(NOON));
    const audience = audienceFor(world, {
      extraOverhearers: [world.characters.linxia, world.characters.xiaonan],
    });
    const candidates = listCandidates(world, {
      audience,
      responder: world.characters.qingqing,
      now: new Date(NOON),
      clock,
    }, config);
    assert.deepEqual(candidates, []);
  });

  it("allows eating without treating the eater as ineligible", () => {
    const world = worldTwoInLiving({
      characters: { linxia: { room: "living", action: "eat" } },
    });
    const clock = nowClock(new Date(NOON));
    const candidates = listCandidates(world, {
      audience: audienceFor(world),
      responder: world.characters.qingqing,
      now: new Date(NOON),
      clock,
    }, config);
    assert.deepEqual(candidates.map((c) => c.id), ["linxia"]);
  });

  it("excludes loud cross-room hearers when sameRoomOnly is on", () => {
    const world = worldTwoInLiving({
      characters: { linxia: { room: "linxia", action: "sit" } },
    });
    const clock = nowClock(new Date(NOON));
    const audience = audienceFor(world, { volume: "loud" });
    assert.equal(audience.overhearers.some((c) => c.id === "linxia"), true);
    const candidates = listCandidates(world, {
      audience,
      responder: world.characters.qingqing,
      now: new Date(NOON),
      clock,
    }, config);
    assert.deepEqual(candidates, []);
    const allowed = listCandidates(world, {
      audience,
      responder: world.characters.qingqing,
      now: new Date(NOON),
      clock,
    }, { ...config, sameRoomOnly: false });
    assert.deepEqual(allowed.map((c) => c.id), ["linxia", "xiaonan"]);
  });

  it("enforces the per-character day cap and min gap", () => {
    const world = worldTwoInLiving({
      characters: {
        linxia: {
          room: "living",
          action: "sit",
          interjectMeta: { dayKey: "2026-11-21", countToday: 2, lastInterjectAt: NOON },
        },
      },
    });
    const clock = nowClock(new Date(NOON));
    const ctx = {
      audience: audienceFor(world),
      responder: world.characters.qingqing,
      now: new Date(NOON),
      clock,
    };
    assert.equal(characterDayCount(world.characters.linxia, clock, config), 2);
    assert.deepEqual(listCandidates(world, ctx, config), []);

    world.characters.linxia.interjectMeta = {
      dayKey: "2026-11-21",
      countToday: 1,
      lastInterjectAt: NOON,
    };
    assert.deepEqual(listCandidates(world, ctx, config), []);
    const later = new Date(Date.parse(NOON) + 20 * 60_000);
    const afterGap = listCandidates(world, { ...ctx, now: later }, config);
    assert.deepEqual(afterGap.map((c) => c.id), ["linxia"]);
  });

  it("treats a missing interjectMeta as zero and rolls a new game day", () => {
    const world = worldTwoInLiving();
    const clock = nowClock(new Date(NOON));
    assert.equal(characterDayCount(world.characters.linxia, clock, config), 0);
    world.characters.linxia.interjectMeta = {
      dayKey: "2026-11-20",
      countToday: 2,
      lastInterjectAt: "2026-11-20T04:00:00.000Z",
    };
    assert.equal(characterDayCount(world.characters.linxia, clock, config), 0);
    const candidates = listCandidates(world, {
      audience: audienceFor(world),
      responder: world.characters.qingqing,
      now: new Date(NOON),
      clock,
    }, config);
    assert.deepEqual(candidates.map((c) => c.id), ["linxia"]);
  });

  it("reports a full house hourly occasion cap", () => {
    const world = worldTwoInLiving({
      interjectMeta: { hourKey: "2026-11-21-12", occasionCount: 3 },
    });
    const clock = nowClock(new Date(NOON));
    assert.equal(houseOccasionCount(world, clock), 3);
    assert.equal(houseOccasionFull(world, clock, config), true);
    world.interjectMeta = { hourKey: "2026-11-21-11", occasionCount: 3 };
    assert.equal(houseOccasionCount(world, clock), 0);
    assert.equal(houseOccasionFull(world, clock, config), false);
  });

  it("skips unaddressed speech when judgeUnaddressed is off unless a name appears", () => {
    const world = worldTwoInLiving();
    const closed = { ...config, judgeUnaddressed: false };
    const unaddressed = { volume: { id: "normal", range: "room" }, targetId: "" };
    assert.equal(shouldJudge({ text: "今天天气真好。", audience: unaddressed, world, cfg: closed }), false);
    assert.equal(shouldJudge({ text: "林夏也在吗？", audience: unaddressed, world, cfg: closed }), true);
    assert.equal(shouldJudge({
      text: "今天天气真好。",
      audience: { ...unaddressed, targetId: "qingqing" },
      world,
      cfg: closed,
    }), true);
    assert.equal(shouldJudge({ text: "今天天气真好。", audience: unaddressed, world, cfg: config }), true);
    assert.equal(mentionsPresentName("小南吃了吗？", Object.values(world.characters)), true);
  });

  it("returns no candidates when the feature is disabled", () => {
    const world = worldTwoInLiving();
    const clock = nowClock(new Date(NOON));
    const candidates = listCandidates(world, {
      audience: audienceFor(world),
      responder: world.characters.qingqing,
      now: new Date(NOON),
      clock,
    }, { ...config, enabled: false });
    assert.deepEqual(candidates, []);
  });
});
