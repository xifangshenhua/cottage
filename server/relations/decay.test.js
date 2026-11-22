import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nowClock } from "../clock.js";
import { makeWorld, NOON } from "../life/test-helpers.js";
import { migrateRelations, getEdge, tickDecay } from "./index.js";
import { mergeRelationsConfig, config } from "./config.js";

function daysLater(iso, days) {
  return new Date(Date.parse(iso) + days * 24 * 60 * 60 * 1000);
}

describe("relations decay", () => {
  it("does not decay on the first tick after migrate", () => {
    const world = makeWorld();
    migrateRelations(world);
    const fam = getEdge(world, "qingqing", "viewer").familiarity;
    const result = tickDecay(world, { now: new Date(NOON), clock: world.clock, cfg: config });
    assert.equal(result.days, 0);
    assert.equal(getEdge(world, "qingqing", "viewer").familiarity, fam);
  });

  it("drops closeness toward the player after configured days without chat, and familiarity only after a long absence", () => {
    const cfg = mergeRelationsConfig(config, {
      decay: {
        familiarityAbsenceDays: 10,
        familiarityPerDay: 0.2,
        closenessPlayerAbsenceDays: 3,
        closenessPlayerPerDay: 0.5,
        closenessNpcAbsenceDays: 6,
        closenessNpcPerDay: 0.2,
        maxDaysPerTick: 14,
      },
    });
    const world = makeWorld();
    migrateRelations(world, { cfg });
    const edge = getEdge(world, "qingqing", "viewer");
    const startFam = edge.familiarity;
    const startClose = edge.closeness;
    const startNpcClose = getEdge(world, "qingqing", "linxia").closeness;
    const aged = daysLater(NOON, 5);
    edge.lastChatAt = NOON;
    edge.lastInteractAt = NOON;
    getEdge(world, "qingqing", "linxia").lastInteractAt = NOON;
    world.relationsMeta.lastDecayDayKey = "2026-11-21";
    world.clock = nowClock(aged);

    const five = tickDecay(world, { now: aged, clock: world.clock, cfg });
    assert.equal(five.days, 5);
    const afterFive = { ...getEdge(world, "qingqing", "viewer") };
    // 5 days later: closeness decays on days 4–5 only (2 * 0.5); familiarity still inside the 10-day window.
    assert.equal(afterFive.familiarity, startFam);
    assert.ok(Math.abs(afterFive.closeness - (startClose - 1.0)) < 1e-6, `closeness ${afterFive.closeness} start ${startClose}`);
    assert.equal(getEdge(world, "qingqing", "linxia").closeness, startNpcClose);

    const later = daysLater(NOON, 12);
    world.clock = nowClock(later);
    const twelve = tickDecay(world, { now: later, clock: world.clock, cfg });
    assert.equal(twelve.days, 7);
    const afterTwelve = getEdge(world, "qingqing", "viewer");
    assert.ok(afterTwelve.familiarity < startFam, "familiarity should start decaying after 10 days");
    assert.ok(afterTwelve.closeness < afterFive.closeness);
  });

  it("decays housemate closeness slower than player neglect", () => {
    const cfg = mergeRelationsConfig(config, {
      decay: {
        familiarityAbsenceDays: 20,
        familiarityPerDay: 0,
        closenessPlayerAbsenceDays: 3,
        closenessPlayerPerDay: 1,
        closenessNpcAbsenceDays: 6,
        closenessNpcPerDay: 0.25,
        maxDaysPerTick: 14,
      },
    });
    const world = makeWorld();
    migrateRelations(world, { cfg });
    const player = getEdge(world, "qingqing", "viewer");
    const npc = getEdge(world, "qingqing", "linxia");
    const playerClose = player.closeness;
    const npcClose = npc.closeness;
    player.lastChatAt = NOON;
    player.lastInteractAt = NOON;
    npc.lastInteractAt = NOON;
    world.relationsMeta.lastDecayDayKey = "2026-11-21";
    const aged = daysLater(NOON, 8);
    world.clock = nowClock(aged);
    tickDecay(world, { now: aged, clock: world.clock, cfg });
    const playerLoss = playerClose - getEdge(world, "qingqing", "viewer").closeness;
    const npcLoss = npcClose - getEdge(world, "qingqing", "linxia").closeness;
    assert.ok(playerLoss > npcLoss, `player loss ${playerLoss} should exceed npc loss ${npcLoss}`);
    assert.ok(Math.abs(npcLoss - 0.25 * 2) < 1e-6, `npc loss ${npcLoss}`);
  });
});
