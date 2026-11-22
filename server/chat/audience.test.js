import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeWorld, NOON } from "../life/test-helpers.js";
import { config } from "./config.js";
import { resolveAudience } from "./audience.js";
import { canHear, canReply, reasonText } from "./policy.js";

function livingWorld(patch = {}) {
  return makeWorld({
    viewer: { present: true, room: "living", lastSeenAt: NOON },
    ...patch,
  });
}

function ids(list) {
  return (list || []).map((c) => c.id).sort();
}

describe("chat audience", () => {
  it("lets everyone who can hear in the viewer's room hear a normal line", () => {
    const world = livingWorld({
      characters: {
        qingqing: { room: "living", action: "sit" },
        linxia: { room: "living", action: "sit" },
        xiaonan: { room: "xiaonan", action: "sit" },
      },
    });
    const result = resolveAudience(world, { volume: "normal" }, config);
    assert.equal(result.ok, true);
    assert.equal(result.volume.id, "normal");
    assert.equal(result.range, "room");
    assert.deepEqual(ids(result.hearers), ["linxia", "qingqing"]);
    assert.ok(["linxia", "qingqing"].includes(result.responder.id));
    assert.equal(result.overhearers.length, 1);
    assert.equal(result.overhearers[0].id !== result.responder.id, true);
  });

  it("lets a loud line reach the whole house except sleepers who cannot hear", () => {
    const world = livingWorld({
      viewer: { present: true, room: "bathroom", lastSeenAt: NOON },
      characters: {
        qingqing: { room: "living", action: "sit" },
        linxia: { room: "dining", action: "eat" },
        xiaonan: { room: "xiaonan", action: "sleep" },
      },
    });
    const result = resolveAudience(world, { volume: "loud" }, config);
    assert.equal(result.ok, true);
    assert.equal(result.range, "house");
    assert.deepEqual(ids(result.hearers), ["linxia", "qingqing"]);
    assert.ok(["linxia", "qingqing"].includes(result.responder.id));
    assert.equal(canHear(world.characters.xiaonan, {
      volume: "loud",
      viewerRoom: "bathroom",
    }, config).ok, false);
  });

  it("requires a target for a whisper", () => {
    const world = livingWorld();
    const result = resolveAudience(world, { volume: "whisper" }, config);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "whisper-needs-target");
    assert.equal(result.responder, null);
    assert.equal(reasonText("whisper-needs-target").includes("指定"), true);
  });

  it("does not retarget when the specified person is out of range", () => {
    const world = livingWorld({
      characters: {
        qingqing: { room: "living", action: "sit" },
        linxia: { room: "linxia", action: "sit" },
      },
    });
    const normal = resolveAudience(world, { characterId: "linxia", volume: "normal" }, config);
    assert.equal(normal.ok, false);
    assert.equal(normal.reason, "target-out-of-range");
    assert.equal(normal.responder, null);
    assert.equal(reasonText("target-out-of-range", config, { volume: "normal" }).includes("大声"), true);

    const whisper = resolveAudience(world, { characterId: "linxia", volume: "whisper" }, config);
    assert.equal(whisper.ok, false);
    assert.equal(whisper.reason, "target-out-of-range");
    assert.equal(whisper.responder, null);
    assert.equal(reasonText("target-out-of-range", config, { volume: "whisper" }).includes("同一个房间"), true);
  });

  it("does not retarget a specified sleeper even when someone else could answer", () => {
    const world = livingWorld({
      viewer: { present: true, room: "xiaonan", lastSeenAt: NOON },
      characters: {
        xiaonan: { room: "xiaonan", action: "sleep" },
        qingqing: { room: "xiaonan", action: "sit" },
      },
    });
    const result = resolveAudience(world, { characterId: "xiaonan", volume: "normal" }, config);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "sleeping");
    assert.equal(result.responder, null);
    assert.equal(world.characters.xiaonan.action, "sleep");
    assert.equal(reasonText("sleeping").includes("睡觉"), true);
  });

  it("reports that an empty room has no hearers on a normal line", () => {
    const world = livingWorld({
      viewer: { present: true, room: "bathroom", lastSeenAt: NOON },
      characters: {
        qingqing: { room: "living", action: "sit" },
        linxia: { room: "living", action: "sit" },
        xiaonan: { room: "living", action: "sit" },
      },
    });
    const result = resolveAudience(world, { volume: "normal" }, config);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "no-hearers");
    assert.equal(result.situation, "empty-room");
    assert.equal(result.responder, null);
    const text = reasonText("no-hearers", config, { situation: "empty-room" });
    assert.equal(text.includes("没人听见"), true);
    assert.equal(text.includes("大声"), true);
  });

  it("picks the closer character when the line is unaddressed", () => {
    const world = livingWorld({
      characters: {
        qingqing: { room: "living", action: "sit" },
        linxia: { room: "living", action: "sit" },
        xiaonan: { room: "xiaonan", action: "sit" },
      },
      relations: [
        { from: "qingqing", to: "viewer", familiarity: 20, closeness: 10, stance: "companion" },
        { from: "linxia", to: "viewer", familiarity: 20, closeness: 80, stance: "companion" },
      ],
    });
    const result = resolveAudience(world, { volume: "normal" }, config);
    assert.equal(result.ok, true);
    assert.equal(result.responder.id, "linxia");
    assert.deepEqual(ids(result.overhearers), ["qingqing"]);
  });

  it("lets a washing character hear an unaddressed line but picks someone who can reply", () => {
    const world = livingWorld({
      viewer: { present: true, room: "bathroom", lastSeenAt: NOON },
      characters: {
        qingqing: { room: "bathroom", action: "wash" },
        linxia: { room: "bathroom", action: "sit" },
        xiaonan: { room: "xiaonan", action: "sit" },
      },
    });
    const heard = canHear(world.characters.qingqing, {
      volume: "normal",
      viewerRoom: "bathroom",
    }, config);
    assert.equal(heard.ok, true);
    assert.equal(canReply(world.characters.qingqing, config).ok, false);
    assert.equal(canReply(world.characters.qingqing, config).reason, "washing");

    const result = resolveAudience(world, { volume: "normal" }, config);
    assert.equal(result.ok, true);
    assert.equal(result.responder.id, "linxia");
    assert.deepEqual(ids(result.hearers), ["linxia", "qingqing"]);
    assert.deepEqual(ids(result.overhearers), ["qingqing"]);
  });

  it("produces no overhearers for a whisper", () => {
    const world = livingWorld({
      characters: {
        qingqing: { room: "living", action: "sit" },
        linxia: { room: "living", action: "sit" },
      },
    });
    const result = resolveAudience(world, { characterId: "qingqing", volume: "whisper" }, config);
    assert.equal(result.ok, true);
    assert.equal(result.responder.id, "qingqing");
    assert.deepEqual(ids(result.hearers), ["qingqing"]);
    assert.deepEqual(result.overhearers, []);
  });

  it("explains when a loud line has only sleeping listeners", () => {
    const world = livingWorld({
      characters: {
        qingqing: { room: "qingqing", action: "sleep" },
        linxia: { room: "linxia", action: "sleep" },
        xiaonan: { room: "xiaonan", action: "sleep" },
      },
    });
    const result = resolveAudience(world, { volume: "loud" }, config);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "no-hearers");
    assert.equal(result.situation, "sleeping");
    assert.equal(reasonText("no-hearers", config, { situation: "sleeping" }).includes("睡觉"), true);
  });

  it("explains when everyone in range can hear but nobody can reply", () => {
    const world = livingWorld({
      viewer: { present: true, room: "bathroom", lastSeenAt: NOON },
      characters: {
        qingqing: { room: "bathroom", action: "wash" },
        linxia: { room: "living", action: "sit" },
        xiaonan: { room: "xiaonan", action: "sit" },
      },
    });
    const result = resolveAudience(world, { volume: "normal" }, config);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "no-hearers");
    assert.equal(result.situation, "washing");
    assert.equal(reasonText("no-hearers", config, { situation: "washing" }).includes("不方便接话"), true);
  });
});
