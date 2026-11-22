import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { intent } from "./apply.js";
import { propose } from "./rules.js";
import { clockAt, makeWorld, NIGHT } from "./test-helpers.js";

describe("apply.intent", () => {
  it("rejects illegal intents without mutating the world", () => {
    const world = makeWorld();
    const clock = world.clock;
    const cases = [
      { id: "qingqing", proposed: { action: "sleep", room: "dining" }, reason: "not-own-bedroom" },
      { id: "qingqing", proposed: { action: "sleep", room: "linxia" }, reason: "not-own-bedroom" },
      { id: "qingqing", proposed: { action: "eat", room: "living" }, reason: "wrong-room" },
      { id: "qingqing", proposed: { action: "wash", room: "dining" }, reason: "wrong-room" },
      { id: "qingqing", proposed: { action: "talk", room: "living" }, reason: "talk-reserved" },
      { id: "qingqing", proposed: { action: "dance", room: "living" }, reason: "unknown-action" },
    ];
    for (const { id, proposed, reason } of cases) {
      const before = structuredClone(world);
      const result = intent(world, id, proposed, clock);
      assert.equal(result.ok, false, `${proposed.action} ${proposed.room}`);
      assert.equal(result.reason, reason);
      assert.deepEqual(world, before);
    }
  });

  it("allows sleep only in the character's own bedroom and teleports there", () => {
    const world = makeWorld();
    const ok = intent(world, "qingqing", { action: "sleep", room: "qingqing" }, clockAt(NIGHT));
    assert.equal(ok.ok, true);
    assert.equal(world.characters.qingqing.room, "qingqing");
    assert.equal(world.characters.qingqing.action, "sleep");
    assert.equal(world.characters.qingqing.line, null);
  });

  it("allows eat only in dining", () => {
    const world = makeWorld({
      characters: { qingqing: { stats: { hunger: 20 } } },
    });
    const ok = intent(world, "qingqing", { action: "eat", room: "dining" }, world.clock);
    assert.equal(ok.ok, true);
    assert.equal(world.characters.qingqing.room, "dining");
    assert.equal(world.characters.qingqing.action, "eat");
  });

  it("rejects a second wash when the bathroom is already occupied, without mutating", () => {
    const world = makeWorld({
      characters: {
        linxia: { room: "bathroom", action: "wash", stats: { clean: 20 } },
        qingqing: { stats: { clean: 20 } },
      },
    });
    const before = structuredClone(world);
    const result = intent(world, "qingqing", { action: "wash", room: "bathroom" }, world.clock);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "occupied");
    assert.deepEqual(world, before);
    const occupants = Object.values(world.characters).filter((c) => c.room === "bathroom");
    assert.equal(occupants.length, 1);
    assert.equal(occupants[0].id, "linxia");
  });
});

describe("rules.propose occupancy", () => {
  it("does not propose wash when the bathroom already has someone else", () => {
    const world = makeWorld({
      characters: {
        linxia: { room: "bathroom", action: "wash", stats: { clean: 20 } },
        qingqing: { stats: { clean: 20, hunger: 80, energy: 80 } },
      },
    });
    const options = propose(world, world.characters.qingqing, world.clock);
    assert.ok(!options.some((o) => o.action === "wash"));
    assert.ok(options.some((o) => o.action === "sit"));
  });
});

describe("apply.intent line ownership", () => {
  it("clears a leftover line when starting sleep or leaving the room", () => {
    const world = makeWorld({
      characters: {
        qingqing: { room: "living", action: "sit", line: "还在客厅说的话。" },
      },
    });
    const ok = intent(world, "qingqing", { action: "sleep", room: "qingqing" }, clockAt(NIGHT));
    assert.equal(ok.ok, true);
    assert.equal(world.characters.qingqing.line, null);
    assert.equal(world.characters.qingqing.enteredRoomAt, world.characters.qingqing.actionStartedAt);
  });

  it("keeps a line when the character stays in the same room and is not going to sleep", () => {
    const world = makeWorld({
      characters: {
        qingqing: { room: "living", action: "sit", line: "还坐在这里。" },
      },
    });
    const ok = intent(world, "qingqing", { action: "sit", room: "living" }, world.clock);
    assert.equal(ok.ok, true);
    assert.equal(world.characters.qingqing.line, "还坐在这里。");
  });
});
