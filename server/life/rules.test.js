import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tickWorld } from "./index.js";
import { propose } from "./rules.js";
import { pick } from "./decide.js";
import { advance } from "./actions.js";
import { resolveLife } from "../settings/index.js";
import { clockAt, makeWorld, MORNING, NIGHT, NOON } from "./test-helpers.js";

describe("night and morning schedule", () => {
  it("sends a free character to sleep in their own room at night, even if energy is not low", () => {
    const lastTickAt = "2026-11-21T14:29:30.000Z";
    const world = makeWorld({
      lastTickAt,
      nowIso: NIGHT,
      characters: {
        qingqing: { room: "living", action: "sit", stats: { energy: 90, hunger: 80, clean: 80 } },
        linxia: { room: "living", action: "sit", stats: { energy: 88, hunger: 80, clean: 80 } },
        xiaonan: { room: "living", action: "sit", stats: { energy: 85, hunger: 80, clean: 80 } },
      },
    });
    tickWorld(world, { now: new Date(NIGHT) });
    for (const character of Object.values(world.characters)) {
      assert.equal(character.action, "sleep", character.id);
      assert.equal(character.room, character.id, character.id);
    }
  });

  it("proposes sleep for a free character during night hours", () => {
    const world = makeWorld({
      nowIso: NIGHT,
      characters: {
        qingqing: { room: "living", action: "sit", stats: { energy: 90, hunger: 80, clean: 80 } },
      },
    });
    const options = propose(world, world.characters.qingqing, clockAt(NIGHT));
    const chosen = pick(options);
    assert.equal(chosen.action, "sleep");
    assert.equal(chosen.room, "qingqing");
  });

  it("wakes a sufficiently rested character in the morning", () => {
    const lastTickAt = "2026-11-21T23:29:30.000Z";
    const world = makeWorld({
      lastTickAt,
      nowIso: MORNING,
      characters: {
        qingqing: {
          room: "qingqing",
          action: "sleep",
          actionStartedAt: "2026-11-21T14:30:00.000Z",
          stats: { energy: 85, hunger: 70, clean: 80 },
        },
        linxia: { room: "living", action: "sit", stats: { energy: 80, hunger: 70, clean: 80 } },
        xiaonan: { room: "living", action: "sit", stats: { energy: 80, hunger: 70, clean: 80 } },
      },
    });
    const completed = advance(
      world,
      world.characters.qingqing,
      clockAt(MORNING),
      Date.parse(MORNING),
    );
    assert.equal(completed.completed, true);

    tickWorld(world, { now: new Date(MORNING) });
    assert.notEqual(world.characters.qingqing.action, "sleep");
    assert.notEqual(world.characters.qingqing.room, "qingqing");
  });

  it("keeps a critically tired character asleep in the morning until energy recovers", () => {
    const lastTickAt = "2026-11-21T23:29:30.000Z";
    const world = makeWorld({
      lastTickAt,
      nowIso: MORNING,
      characters: {
        qingqing: {
          room: "qingqing",
          action: "sleep",
          actionStartedAt: "2026-11-21T14:30:00.000Z",
          stats: { energy: 20, hunger: 70, clean: 80 },
        },
      },
    });
    tickWorld(world, { now: new Date(MORNING) });
    assert.equal(world.characters.qingqing.action, "sleep");
    assert.equal(world.characters.qingqing.room, "qingqing");
  });

  it("does not propose sleep at noon when energy is fine", () => {
    const world = makeWorld({
      nowIso: NOON,
      characters: {
        qingqing: { room: "living", action: "sit", stats: { energy: 80, hunger: 80, clean: 80 } },
      },
    });
    const options = propose(world, world.characters.qingqing, clockAt(NOON));
    assert.ok(!options.some((o) => o.action === "sleep"));
    assert.equal(pick(options).action, "sit");
  });
});

describe("daytime sleep completion", () => {
  function sleepingWorld(energy, nowIso = NOON) {
    return makeWorld({
      nowIso,
      characters: {
        qingqing: {
          room: "qingqing",
          action: "sleep",
          actionStartedAt: "2026-11-21T04:00:00.000Z",
          stats: { energy, hunger: 70, clean: 80 },
        },
      },
    });
  }

  it("keeps a day nap going while energy is below sleepWakeEnergy, including 40–79", () => {
    const life = resolveLife("qingqing");
    for (const energy of [40, 79]) {
      const world = sleepingWorld(energy);
      const result = advance(
        world,
        world.characters.qingqing,
        clockAt(NOON),
        Date.parse(NOON),
        life,
      );
      assert.equal(result.completed, false, `energy ${energy} should stay asleep`);
    }
  });

  it("wakes from a day nap once energy reaches sleepWakeEnergy", () => {
    const life = resolveLife("qingqing");
    const world = sleepingWorld(life.sleepWakeEnergy);
    const result = advance(
      world,
      world.characters.qingqing,
      clockAt(NOON),
      Date.parse(NOON),
      life,
    );
    assert.equal(result.completed, true);
  });

  it("never wakes at night, even with high energy", () => {
    const life = resolveLife("qingqing");
    const world = sleepingWorld(100, NIGHT);
    const result = advance(
      world,
      world.characters.qingqing,
      clockAt(NIGHT),
      Date.parse(NIGHT),
      life,
    );
    assert.equal(result.completed, false);
  });

  it("follows an injected sleepWakeEnergy from settings, not a second critical threshold", () => {
    const life = resolveLife("qingqing", { house: { life: { sleepWakeEnergy: 90 } } });
    const stillAsleep = advance(
      sleepingWorld(80),
      sleepingWorld(80).characters.qingqing,
      clockAt(NOON),
      Date.parse(NOON),
      life,
    );
    assert.equal(stillAsleep.completed, false);
    const world = sleepingWorld(90);
    const woke = advance(
      world,
      world.characters.qingqing,
      clockAt(NOON),
      Date.parse(NOON),
      life,
    );
    assert.equal(woke.completed, true);
  });
});

describe("daytime meals before naps", () => {
  it("picks eat over a daytime nap when hunger is at the eat threshold", () => {
    const world = makeWorld({
      nowIso: NOON,
      characters: {
        qingqing: { room: "living", action: "sit", stats: { energy: 25, hunger: 30, clean: 80 } },
      },
    });
    const chosen = pick(propose(world, world.characters.qingqing, clockAt(NOON)));
    assert.equal(chosen.action, "eat");
    assert.equal(chosen.room, "dining");
  });

  it("picks a daytime nap when energy is low but hunger is fine", () => {
    const world = makeWorld({
      nowIso: NOON,
      characters: {
        qingqing: { room: "living", action: "sit", stats: { energy: 25, hunger: 80, clean: 80 } },
      },
    });
    const chosen = pick(propose(world, world.characters.qingqing, clockAt(NOON)));
    assert.equal(chosen.action, "sleep");
    assert.equal(chosen.room, "qingqing");
  });

  it("picks bedtime over starting a new meal at night", () => {
    const world = makeWorld({
      nowIso: NIGHT,
      characters: {
        qingqing: { room: "living", action: "sit", stats: { energy: 50, hunger: 30, clean: 80 } },
      },
    });
    const chosen = pick(propose(world, world.characters.qingqing, clockAt(NIGHT)));
    assert.equal(chosen.action, "sleep");
    assert.equal(chosen.room, "qingqing");
  });

  it("continues an in-progress daytime meal even after energy hits sleepStartEnergy", () => {
    const world = makeWorld({
      nowIso: NOON,
      characters: {
        qingqing: {
          room: "dining",
          action: "eat",
          actionStartedAt: "2026-11-21T03:50:00.000Z",
          stats: { energy: 25, hunger: 40, clean: 80 },
        },
      },
    });
    const chosen = pick(propose(world, world.characters.qingqing, clockAt(NOON)));
    assert.equal(chosen.action, "eat");
    assert.equal(chosen.room, "dining");
  });

  it("lets a short in-progress meal finish after night starts", () => {
    const world = makeWorld({
      nowIso: NIGHT,
      characters: {
        qingqing: {
          room: "dining",
          action: "eat",
          actionStartedAt: "2026-11-21T14:20:00.000Z",
          stats: { energy: 50, hunger: 40, clean: 80 },
        },
      },
    });
    const chosen = pick(propose(world, world.characters.qingqing, clockAt(NIGHT)));
    assert.equal(chosen.action, "eat");
    assert.equal(chosen.room, "dining");
  });
});
