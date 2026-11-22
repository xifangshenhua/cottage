import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeWorld, NOON } from "../life/test-helpers.js";
import { canChat, reasonText } from "./policy.js";
import { config } from "./config.js";

describe("chat policy", () => {
  it("allows a character who is present in the same room as the viewer", () => {
    const world = makeWorld({
      viewer: { present: true, room: "living", lastSeenAt: NOON },
    });
    const gate = canChat(world, world.characters.qingqing, config);
    assert.equal(gate.ok, true);
    assert.equal(gate.reason, null);
  });

  it("denies a character in a different room", () => {
    const world = makeWorld({
      viewer: { present: true, room: "living", lastSeenAt: NOON },
      characters: { linxia: { room: "linxia", action: "sit" } },
    });
    const gate = canChat(world, world.characters.linxia, config);
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, "different-room");
    assert.equal(reasonText("different-room").includes("房间"), true);
  });

  it("denies a sleeping character and does not auto-wake", () => {
    const world = makeWorld({
      viewer: { present: true, room: "xiaonan", lastSeenAt: NOON },
      characters: { xiaonan: { room: "xiaonan", action: "sleep" } },
    });
    const character = world.characters.xiaonan;
    const gate = canChat(world, character, config);
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, "sleeping");
    assert.equal(character.action, "sleep");
    assert.equal(reasonText("sleeping").includes("睡觉"), true);
  });

  it("denies washing by default and allows it when canTalkWhenWashing is true", () => {
    const world = makeWorld({
      viewer: { present: true, room: "bathroom", lastSeenAt: NOON },
      characters: { qingqing: { room: "bathroom", action: "wash" } },
    });
    const denied = canChat(world, world.characters.qingqing, config);
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, "washing");

    const allowed = canChat(world, world.characters.qingqing, {
      ...config,
      canTalkWhenWashing: true,
    });
    assert.equal(allowed.ok, true);
  });
});
