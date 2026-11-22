import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { occupants } from "../rooms.js";
import { config } from "./config.js";
import { nextCatchUpDt, tickWorld } from "./index.js";
import { makeWorld, NOON } from "./test-helpers.js";

function hoursLater(iso, hours) {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}

function assertLegal(world) {
  for (const character of Object.values(world.characters)) {
    for (const [key, value] of Object.entries(character.stats)) {
      assert.ok(value >= 0 && value <= 100, `${character.id}.${key}=${value}`);
    }
    if (character.action === "sleep") {
      assert.equal(character.room, character.id, `${character.id} must sleep in own room`);
    }
    if (character.action === "eat") {
      assert.equal(character.room, "dining", `${character.id} must eat in dining`);
    }
    if (character.action === "wash") {
      assert.equal(character.room, "bathroom", `${character.id} must wash in bathroom`);
    }
    if (character.action === "sit") {
      assert.equal(character.room, "living", `${character.id} must sit in living`);
    }
  }
  assert.ok(occupants(world, "bathroom").length <= 1, "bathroom is single-occupant");
}

describe("catch-up", () => {
  it("over several hours produces a coherent state: someone eats or sleeps rather than freezing", () => {
    const start = NOON;
    const end = hoursLater(start, 8);
    const world = makeWorld({
      lastTickAt: start,
      nowIso: start,
      characters: {
        qingqing: { room: "living", action: "sit", stats: { energy: 60, hunger: 20, clean: 70 } },
        linxia: { room: "living", action: "sit", stats: { energy: 55, hunger: 22, clean: 30 } },
        xiaonan: { room: "living", action: "sit", stats: { energy: 50, hunger: 18, clean: 75 } },
      },
    });
    const before = structuredClone(world.characters);

    tickWorld(world, { now: new Date(end) });

    assertLegal(world);
    assert.equal(world.lastTickAt, end);
    assert.equal(world.clock.hhmm, "20:00");

    const changed = Object.values(world.characters).some((c) => {
      const prev = before[c.id];
      return c.action !== prev.action || c.room !== prev.room || c.stats.hunger > prev.stats.hunger;
    });
    assert.ok(changed, "characters should act over an 8 hour gap instead of staying frozen");

    const recoveredOrEating = Object.values(world.characters).some((c) => {
      return c.action === "eat" || c.action === "sleep" || c.stats.hunger > 35;
    });
    assert.ok(recoveredOrEating, "someone should have eaten (or already be in a later cycle) rather than starving idle");
  });

  it("caps catch-up at 24 hours and still keeps stats in range", () => {
    const start = "2026-11-18T04:00:00.000Z";
    const end = "2026-11-21T04:00:00.000Z";
    const world = makeWorld({
      lastTickAt: start,
      nowIso: start,
      characters: {
        qingqing: { room: "living", action: "sit", stats: { energy: 40, hunger: 40, clean: 40 } },
      },
    });
    tickWorld(world, { now: new Date(end), capMs: config.catchUpCapMs });
    assert.equal(world.lastTickAt, end);
    assertLegal(world);
  });

  it("expires leftover talk after a short time and does not invent a new line", () => {
    const start = NOON;
    const end = hoursLater(start, 1);
    const world = makeWorld({
      lastTickAt: start,
      characters: {
        qingqing: {
          room: "living",
          action: "talk",
          line: "你来了。我刚在和林夏聊刚才那本书。",
          stats: { energy: 80, hunger: 80, clean: 80 },
        },
      },
    });
    tickWorld(world, { now: new Date(end) });
    assert.notEqual(world.characters.qingqing.action, "talk");
    assert.equal(world.characters.qingqing.line, null);
  });

  it("uses coarser stale steps so a 24h catch-up runs far fewer than 2880 afterStep calls", () => {
    const start = "2026-11-20T04:00:00.000Z";
    const end = "2026-11-21T04:00:00.000Z";
    const world = makeWorld({
      lastTickAt: start,
      nowIso: start,
      characters: {
        qingqing: { room: "living", action: "sit", stats: { energy: 40, hunger: 40, clean: 40 } },
        linxia: { room: "living", action: "sit", stats: { energy: 45, hunger: 35, clean: 50 } },
        xiaonan: { room: "living", action: "sit", stats: { energy: 50, hunger: 30, clean: 45 } },
      },
    });
    let steps = 0;
    tickWorld(world, {
      now: new Date(end),
      capMs: config.catchUpCapMs,
      afterStep: () => {
        steps += 1;
      },
    });
    assert.equal(world.lastTickAt, end);
    assertLegal(world);
    assert.ok(steps < 500, `expected far fewer than 2880 steps, got ${steps}`);
    assert.ok(steps > 50, `catch-up should still walk the day, got ${steps} steps`);
  });

  it("keeps a live 30s gap on the fine step", () => {
    const start = NOON;
    const end = new Date(Date.parse(start) + config.stepMs).toISOString();
    const world = makeWorld({
      lastTickAt: start,
      nowIso: start,
      characters: {
        qingqing: { room: "living", action: "sit", stats: { energy: 80, hunger: 80, clean: 80 } },
      },
    });
    let steps = 0;
    let dt = 0;
    tickWorld(world, {
      now: new Date(end),
      afterStep: (_world, dtMs) => {
        steps += 1;
        dt = dtMs;
      },
    });
    assert.equal(steps, 1);
    assert.equal(dt, config.stepMs);
  });
});

describe("nextCatchUpDt", () => {
  it("uses catchUpStepMs until the last fine window, then stepMs", () => {
    const stepMs = 30_000;
    const catchUpStepMs = 5 * 60_000;
    const nowMs = 10 * 60 * 60 * 1000;
    const fromMs = nowMs - 60 * 60 * 1000;
    const first = nextCatchUpDt(fromMs, nowMs, { stepMs, catchUpStepMs });
    assert.equal(first, catchUpStepMs);
    const fineStart = nowMs - catchUpStepMs;
    const intoFine = nextCatchUpDt(fineStart - 60_000, nowMs, { stepMs, catchUpStepMs });
    assert.equal(intoFine, 60_000);
    const inFine = nextCatchUpDt(fineStart, nowMs, { stepMs, catchUpStepMs });
    assert.equal(inFine, stepMs);
  });
});
