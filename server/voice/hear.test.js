import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canHearVoice } from "./hear.js";

const living = { room: "living", present: true };
const kitchen = { room: "kitchen", present: true };
const away = { room: "living", present: false };

const whisper = { volume: "whisper", lineTo: "viewer", room: "living" };
const normal = { volume: "normal", lineTo: "viewer", room: "living" };
const loud = { volume: "loud", lineTo: "viewer", room: "living" };
const npc = { volume: "normal", lineTo: "linxia", room: "living" };

describe("canHearVoice", () => {
  it("plays a whisper only when the line is addressed to the viewer", () => {
    assert.equal(canHearVoice(whisper, { viewer: living }), true);
    assert.equal(canHearVoice({ ...whisper, lineTo: "linxia" }, { viewer: living }), false);
    assert.equal(canHearVoice(whisper, { viewer: kitchen }), true);
  });

  it("plays a normal line only in the clip's land-time room", () => {
    assert.equal(canHearVoice(normal, { viewer: living }), true);
    assert.equal(canHearVoice(normal, { viewer: kitchen }), false);
  });

  it("plays a loud line for any present viewer in the house", () => {
    assert.equal(canHearVoice(loud, { viewer: living }), true);
    assert.equal(canHearVoice(loud, { viewer: kitchen }), true);
    assert.equal(canHearVoice(loud, { viewer: away }), false);
  });

  it("treats same-room NPC talk as a normal line when lineVisibleOnlySameRoom is on", () => {
    assert.equal(canHearVoice(npc, { viewer: living, lineVisibleOnlySameRoom: true }), true);
    assert.equal(canHearVoice(npc, { viewer: kitchen, lineVisibleOnlySameRoom: true }), false);
  });

  it("stays silent when speech is off, the viewer is away, or the client is recording", () => {
    assert.equal(canHearVoice(normal, { viewer: living, enabled: false }), false);
    assert.equal(canHearVoice(normal, { viewer: living, characterEnabled: false }), false);
    assert.equal(canHearVoice(normal, { viewer: away }), false);
    assert.equal(canHearVoice(normal, { viewer: living, recording: true }), false);
    assert.equal(canHearVoice(normal, { viewer: living, muted: true }), false);
    assert.equal(canHearVoice(null, { viewer: living }), false);
  });
});
