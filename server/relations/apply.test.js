import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeWorld, NOON } from "../life/test-helpers.js";
import { applyEvent, migrateRelations, getEdge } from "./index.js";
import { mergeRelationsConfig, config } from "./config.js";

function worldWithRelations(patch = {}) {
  const world = makeWorld(patch);
  migrateRelations(world);
  return world;
}

function later(iso, ms) {
  return new Date(Date.parse(iso) + ms);
}

describe("relations apply", () => {
  it("playerChat raises familiarity and closeness on the character→viewer edge", () => {
    const world = worldWithRelations();
    const before = getEdge(world, "qingqing", "viewer");
    const fam = before.familiarity;
    const close = before.closeness;
    const result = applyEvent(world, {
      type: "playerChat",
      from: "qingqing",
      to: "viewer",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
    });
    assert.equal(result.applied, true);
    const edge = getEdge(world, "qingqing", "viewer");
    assert.ok(edge.familiarity > fam);
    assert.ok(edge.closeness > close);
    const back = getEdge(world, "viewer", "qingqing");
    assert.ok(back.familiarity > fam);
  });

  it("short or cooldown-spam player chat does not change scores", () => {
    const world = worldWithRelations();
    const start = structuredClone(getEdge(world, "qingqing", "viewer"));
    const short = applyEvent(world, {
      type: "playerChat",
      from: "qingqing",
      to: "viewer",
      text: "你好。",
      now: new Date(NOON),
    });
    assert.equal(short.applied, false);
    assert.equal(short.reason, "short");
    assert.equal(getEdge(world, "qingqing", "viewer").familiarity, start.familiarity);
    assert.equal(getEdge(world, "qingqing", "viewer").closeness, start.closeness);

    const first = applyEvent(world, {
      type: "playerChat",
      from: "qingqing",
      to: "viewer",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
    });
    assert.equal(first.applied, true);
    const afterFirst = structuredClone(getEdge(world, "qingqing", "viewer"));
    const spam = applyEvent(world, {
      type: "playerChat",
      from: "qingqing",
      to: "viewer",
      text: "再跟你说一件刚才想到的小事。",
      now: later(NOON, 1_000),
    });
    assert.equal(spam.applied, false);
    assert.equal(spam.reason, "cooldown");
    assert.equal(getEdge(world, "qingqing", "viewer").familiarity, afterFirst.familiarity);
    assert.equal(getEdge(world, "qingqing", "viewer").closeness, afterFirst.closeness);
  });

  it("enforces the daily familiarity gain cap", () => {
    const cfg = mergeRelationsConfig(config, {
      playerChat: {
        cooldownMs: 0,
        familiarityDelta: 2,
        closenessDelta: 0,
        diminishPower: 0,
        maxFamiliarityGainPerDay: 3,
        maxClosenessGainPerDay: 10,
      },
    });
    const world = worldWithRelations();
    const start = getEdge(world, "qingqing", "viewer").familiarity;
    for (let i = 0; i < 5; i += 1) {
      applyEvent(world, {
        type: "playerChat",
        from: "qingqing",
        to: "viewer",
        text: "今天过得怎么样，有没有休息好？",
        now: later(NOON, i * 60_000),
      }, { cfg });
    }
    const gained = getEdge(world, "qingqing", "viewer").familiarity - start;
    assert.ok(gained <= 3 + 1e-6, `gained ${gained} over daily cap 3`);
    assert.ok(gained >= 3 - 1e-6, `should reach the cap, gained ${gained}`);
  });

  it("syncs stats.bond to the rounded composite after a scoring chat", () => {
    const world = worldWithRelations();
    assert.equal(world.characters.qingqing.stats.bond, 18);
    applyEvent(world, {
      type: "playerChat",
      from: "qingqing",
      to: "viewer",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
    });
    const edge = getEdge(world, "qingqing", "viewer");
    const expected = Math.round(0.4 * edge.familiarity + 0.6 * edge.closeness);
    assert.equal(world.characters.qingqing.stats.bond, expected);
    assert.equal(world.characters.linxia.stats.bond, 16);
  });

  it("idle think and proactive speech default deltas do not change scores", () => {
    const world = worldWithRelations();
    const snap = structuredClone(world.relations);
    applyEvent(world, { type: "idleThink", from: "qingqing", to: "viewer", now: new Date(NOON) });
    applyEvent(world, { type: "proactiveSpeech", from: "qingqing", to: "viewer", now: new Date(NOON) });
    assert.deepEqual(
      world.relations.map((e) => [e.from, e.to, e.familiarity, e.closeness]),
      snap.map((e) => [e.from, e.to, e.familiarity, e.closeness]),
    );
    assert.equal(world.characters.qingqing.stats.bond, 18);
  });

  it("directed edges stay independent when only one side is updated", () => {
    const world = worldWithRelations();
    const fwd = getEdge(world, "qingqing", "linxia");
    const back = getEdge(world, "linxia", "qingqing");
    const fwdFam = fwd.familiarity;
    const fwdClose = fwd.closeness;
    const backFam = back.familiarity;
    const backClose = back.closeness;
    const result = applyEvent(world, {
      type: "npcTalk",
      from: "qingqing",
      to: "linxia",
      now: new Date(NOON),
    });
    assert.equal(result.applied, true);
    assert.ok(getEdge(world, "qingqing", "linxia").familiarity > fwdFam);
    assert.ok(getEdge(world, "qingqing", "linxia").closeness > fwdClose);
    assert.equal(getEdge(world, "linxia", "qingqing").familiarity, backFam);
    assert.equal(getEdge(world, "linxia", "qingqing").closeness, backClose);
  });

  it("overhear raises familiarity a little and does not change closeness or the viewer edge", () => {
    const world = worldWithRelations();
    const before = structuredClone(getEdge(world, "linxia", "viewer"));
    const backBefore = structuredClone(getEdge(world, "viewer", "linxia"));
    const result = applyEvent(world, {
      type: "overhear",
      from: "linxia",
      to: "viewer",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
    });
    assert.equal(result.applied, true);
    const edge = getEdge(world, "linxia", "viewer");
    assert.ok(edge.familiarity > before.familiarity);
    assert.ok(edge.familiarity - before.familiarity <= 0.2 + 1e-9);
    assert.equal(edge.closeness, before.closeness);
    const back = getEdge(world, "viewer", "linxia");
    assert.equal(back.familiarity, backBefore.familiarity);
    assert.equal(back.closeness, backBefore.closeness);
  });

  it("short or cooldown-spam overhear does not change scores", () => {
    const world = worldWithRelations();
    const start = structuredClone(getEdge(world, "linxia", "viewer"));
    const short = applyEvent(world, {
      type: "overhear",
      from: "linxia",
      to: "viewer",
      text: "你好。",
      now: new Date(NOON),
    });
    assert.equal(short.applied, false);
    assert.equal(short.reason, "short");
    assert.equal(getEdge(world, "linxia", "viewer").familiarity, start.familiarity);

    const first = applyEvent(world, {
      type: "overhear",
      from: "linxia",
      to: "viewer",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
    });
    assert.equal(first.applied, true);
    const afterFirst = structuredClone(getEdge(world, "linxia", "viewer"));
    const spam = applyEvent(world, {
      type: "overhear",
      from: "linxia",
      to: "viewer",
      text: "再跟你说一件刚才想到的小事。",
      now: later(NOON, 1_000),
    });
    assert.equal(spam.applied, false);
    assert.equal(spam.reason, "cooldown");
    assert.equal(getEdge(world, "linxia", "viewer").familiarity, afterFirst.familiarity);
  });

  it("enforces the daily familiarity cap on overhear", () => {
    const cfg = mergeRelationsConfig(config, {
      overhear: {
        cooldownMs: 0,
        familiarityDelta: 0.8,
        closenessDelta: 0,
        maxFamiliarityGainPerDay: 1.0,
      },
    });
    const world = worldWithRelations();
    const start = getEdge(world, "linxia", "viewer").familiarity;
    const times = [
      new Date(NOON),
      later(NOON, 60_000),
      later(NOON, 120_000),
    ];
    for (const now of times) {
      applyEvent(world, {
        type: "overhear",
        from: "linxia",
        to: "viewer",
        text: "今天过得怎么样，有没有休息好？",
        now,
      }, { cfg, now });
    }
    const gained = getEdge(world, "linxia", "viewer").familiarity - start;
    assert.ok(gained <= 1.0 + 1e-6, `gained ${gained} over the daily cap`);
  });

  it("npcOverhear raises familiarity a little without closeness or player-chat gates", () => {
    const world = worldWithRelations();
    const before = structuredClone(getEdge(world, "qingqing", "xiaonan"));
    const viewerBefore = structuredClone(getEdge(world, "qingqing", "viewer"));
    const result = applyEvent(world, {
      type: "npcOverhear",
      from: "qingqing",
      to: "xiaonan",
      now: new Date(NOON),
    });
    assert.equal(result.applied, true);
    const edge = getEdge(world, "qingqing", "xiaonan");
    assert.ok(edge.familiarity > before.familiarity);
    assert.equal(edge.closeness, before.closeness);
    assert.equal(getEdge(world, "qingqing", "viewer").familiarity, viewerBefore.familiarity);
    assert.equal(getEdge(world, "qingqing", "viewer").closeness, viewerBefore.closeness);
  });

  it("interject raises familiarity and closeness a little without player-chat gates", () => {
    const world = worldWithRelations();
    const before = structuredClone(getEdge(world, "linxia", "viewer"));
    const viewerBefore = structuredClone(getEdge(world, "viewer", "linxia"));
    const result = applyEvent(world, {
      type: "interject",
      from: "linxia",
      to: "viewer",
      text: "饿了吗？",
      now: new Date(NOON),
    });
    assert.equal(result.applied, true);
    const edge = getEdge(world, "linxia", "viewer");
    assert.ok(edge.familiarity > before.familiarity);
    assert.ok(edge.closeness > before.closeness);
    assert.ok(result.familiarity > 0);
    assert.ok(result.closeness > 0);
    assert.ok(result.familiarity < 0.8);
    assert.ok(result.closeness < 1.2);
    assert.equal(getEdge(world, "viewer", "linxia").familiarity, viewerBefore.familiarity);
    assert.equal(getEdge(world, "viewer", "linxia").closeness, viewerBefore.closeness);
  });

  it("enforces the daily interject familiarity cap and reads settings overlays", () => {
    const world = worldWithRelations();
    const overlay = { familiarityDelta: 0.5, closenessDelta: 0, maxFamiliarityGainPerDay: 0.01 };
    const first = applyEvent(world, {
      type: "interject",
      from: "linxia",
      to: "viewer",
      now: new Date(NOON),
    }, { settings: { house: { relations: { interject: overlay } } } });
    assert.equal(first.applied, true);
    assert.ok(first.familiarity <= 0.01 + 1e-9);
    const second = applyEvent(world, {
      type: "interject",
      from: "linxia",
      to: "viewer",
      now: new Date(NOON),
    }, { settings: { house: { relations: { interject: overlay } } } });
    assert.equal(second.applied, false);
    assert.equal(second.reason, "capped");
  });
});
