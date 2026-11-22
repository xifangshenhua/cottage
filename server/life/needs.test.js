import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { config } from "./config.js";
import { progress, clampStat } from "./needs.js";

const HOUR = 3_600_000;

function character(action, stats) {
  return {
    id: "qingqing",
    name: "青青",
    action,
    stats: { energy: 50, hunger: 50, clean: 50, mood: 50, bond: 18, ...stats },
  };
}

describe("needs.progress", () => {
  it("drains awake energy, hunger (fullness), and clean at the configured hourly rates", () => {
    const next = progress(character("sit", { energy: 50, hunger: 50, clean: 50, mood: 50 }), HOUR);
    assert.equal(next.energy, clampStat(50 + config.rates.sit.energy));
    assert.equal(next.hunger, clampStat(50 + config.rates.sit.hunger));
    assert.equal(next.clean, clampStat(50 + config.rates.sit.clean));
  });

  it("recovers energy while sleeping and still drains hunger and clean more slowly", () => {
    const next = progress(character("sleep", { energy: 40, hunger: 50, clean: 50 }), HOUR);
    assert.equal(next.energy, clampStat(40 + config.rates.sleep.energy));
    assert.equal(next.hunger, clampStat(50 + config.rates.sleep.hunger));
    assert.equal(next.clean, clampStat(50 + config.rates.sleep.clean));
    assert.ok(next.energy > 40);
    assert.ok(Math.abs(config.rates.sleep.hunger) < Math.abs(config.rates.sit.hunger));
  });

  it("recovers hunger quickly while eating and clean quickly while washing", () => {
    const ate = progress(character("eat", { hunger: 30 }), HOUR / 2);
    const washed = progress(character("wash", { clean: 40 }), HOUR / 4);
    assert.ok(ate.hunger > 30);
    assert.ok(washed.clean > 40);
    assert.equal(ate.hunger, clampStat(30 + config.rates.eat.hunger * 0.5));
    assert.equal(washed.clean, clampStat(40 + config.rates.wash.clean * 0.25));
  });

  it("clamps every stat to 0–100", () => {
    const drained = progress(character("sit", { energy: 1, hunger: 1, clean: 1, mood: 1 }), HOUR * 5);
    const filled = progress(character("sleep", { energy: 99, mood: 99 }), HOUR * 5);
    for (const key of ["energy", "hunger", "clean", "mood"]) {
      assert.ok(drained[key] >= 0 && drained[key] <= 100, key);
    }
    assert.equal(drained.energy, 0);
    assert.equal(filled.energy, 100);
  });

  it("does not change bond", () => {
    const next = progress(character("sit", { bond: 18 }), HOUR * 8);
    assert.equal(next.bond, 18);
  });

  it("worsens mood when needs are already low, and recovers a little while sitting", () => {
    const resting = progress(character("sit", { energy: 80, hunger: 80, clean: 80, mood: 50 }), HOUR);
    const low = progress(character("sit", { energy: 10, hunger: 10, clean: 10, mood: 50 }), HOUR);
    assert.ok(resting.mood > 50);
    assert.ok(low.mood < resting.mood);
  });

  it("is pure: the input character is not mutated", () => {
    const input = character("sit", { energy: 50 });
    const copy = structuredClone(input);
    progress(input, HOUR);
    assert.deepEqual(input, copy);
  });
});
