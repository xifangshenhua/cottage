import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeWorld, NOON } from "../life/test-helpers.js";
import { config } from "./config.js";
import { whoMayThink } from "./policy.js";

describe("think policy", () => {
  it("skips a sleeping character and returns at most one due character", () => {
    const world = makeWorld({
      characters: {
        qingqing: { action: "sleep", room: "qingqing", lastThinkAt: null },
        linxia: { action: "sit", room: "living", lastThinkAt: null },
        xiaonan: { action: "sit", room: "living", lastThinkAt: null },
      },
    });
    const due = whoMayThink(world, new Date(NOON));
    assert.equal(due.length, 1);
    assert.equal(due[0].id, "linxia");
    assert.ok(!due.some((c) => c.action === "sleep"));
  });

  it("does not select a character who thought more recently than the interval", () => {
    const world = makeWorld({
      characters: {
        qingqing: { action: "sit", lastThinkAt: "2026-11-21T03:55:00.000Z" },
        linxia: { action: "sit", lastThinkAt: "2026-11-21T03:55:00.000Z" },
        xiaonan: { action: "sit", lastThinkAt: "2026-11-21T03:55:00.000Z" },
      },
    });
    const due = whoMayThink(world, new Date(NOON), config);
    assert.deepEqual(due, []);
  });

  it("selects a character once the 10-minute interval has elapsed", () => {
    const world = makeWorld({
      characters: {
        qingqing: { action: "sit", lastThinkAt: "2026-11-21T03:50:00.000Z" },
        linxia: { action: "sit", lastThinkAt: "2026-11-21T03:51:00.000Z" },
        xiaonan: { action: "sit", lastThinkAt: "2026-11-21T03:52:00.000Z" },
      },
    });
    const due = whoMayThink(world, new Date(NOON), config);
    assert.equal(due.length, 1);
    assert.equal(due[0].id, "qingqing");
  });

  it("uses a per-character think interval when cfg.intervalMsFor is provided", () => {
    const world = makeWorld({
      characters: {
        qingqing: { action: "sit", lastThinkAt: "2026-11-21T03:50:00.000Z" },
        linxia: { action: "sleep", room: "linxia", lastThinkAt: "2026-11-21T03:50:00.000Z" },
        xiaonan: { action: "sit", lastThinkAt: "2026-11-21T03:50:00.000Z" },
      },
    });
    const cfg = {
      ...config,
      intervalMsFor(character) {
        return character.id === "xiaonan" ? 15 * 60 * 1000 : config.intervalMs;
      },
    };
    const due = whoMayThink(world, new Date(NOON), cfg);
    assert.equal(due.length, 1);
    assert.equal(due[0].id, "qingqing");

    const stillWaiting = whoMayThink(
      { ...world, characters: { xiaonan: world.characters.xiaonan } },
      new Date(NOON),
      cfg,
    );
    assert.deepEqual(stillWaiting, []);

    const later = whoMayThink(
      { ...world, characters: { xiaonan: world.characters.xiaonan } },
      new Date("2026-11-21T04:05:00.000Z"),
      cfg,
    );
    assert.equal(later.length, 1);
    assert.equal(later[0].id, "xiaonan");
  });
});
