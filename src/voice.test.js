import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canHearVoice,
  captureHoldPointer,
  characterVoiceEnabled,
  decideTranscriptAction,
  enqueueClip,
  hearContext,
  isMicBlocked,
  recordLimitMs,
} from "./voice.js";

describe("frontend voice", () => {
  it("mirrors hearing rules for whisper, room mismatch, and loud lines", () => {
    const living = { viewer: { present: true, room: "living" } };
    const kitchen = { viewer: { present: true, room: "kitchen" } };
    assert.equal(canHearVoice({ volume: "whisper", lineTo: "viewer", room: "living" }, living), true);
    assert.equal(canHearVoice({ volume: "whisper", lineTo: "linxia", room: "living" }, living), false);
    assert.equal(canHearVoice({ volume: "normal", lineTo: "viewer", room: "living" }, kitchen), false);
    assert.equal(canHearVoice({ volume: "loud", lineTo: "viewer", room: "living" }, kitchen), true);
    assert.equal(canHearVoice({ volume: "normal", lineTo: "viewer", room: "living" }, { ...living, muted: true }), false);
    assert.equal(canHearVoice({ volume: "normal", lineTo: "viewer", room: "living" }, { ...living, recording: true }), false);
  });

  it("does not send a chat when recognition fails or returns empty text", () => {
    assert.deepEqual(decideTranscriptAction({ ok: false, error: "语音识别暂时不可用。" }), {
      send: false,
      fill: "",
      error: "语音识别暂时不可用。",
    });
    assert.deepEqual(decideTranscriptAction({ ok: true, text: "   ", autoSend: true }), {
      send: false,
      fill: "",
      error: "没能识别出内容。",
    });
    assert.deepEqual(decideTranscriptAction({ ok: true, text: "吃饭了吗？", autoSend: true }), {
      send: true,
      fill: "吃饭了吗？",
      error: null,
    });
    assert.deepEqual(decideTranscriptAction({ ok: true, text: "吃饭了吗？", autoSend: false }), {
      send: false,
      fill: "吃饭了吗？",
      error: null,
    });
  });

  it("drops unplayed older clips for a character when a newer line arrives", () => {
    const first = { id: "a", characterId: "qingqing", lineAt: "2026-11-21T02:00:00.000Z", text: "旧的" };
    const other = { id: "b", characterId: "linxia", lineAt: "2026-11-21T02:00:01.000Z", text: "旁人" };
    const next = { id: "c", characterId: "qingqing", lineAt: "2026-11-21T02:00:05.000Z", text: "新的" };
    const queued = enqueueClip(enqueueClip([first], other), next);
    assert.deepEqual(queued.map((c) => c.id), ["b", "c"]);
  });

  it("treats a missing present flag as in-house when building hear context", () => {
    const ctx = hearContext({ voice: { enabled: true }, viewer: { room: "living" } }, { room: "living" });
    assert.equal(ctx.viewer.present, true);
    assert.equal(ctx.viewer.room, "living");
  });

  it("skips playback when that character's 朗读 flag is off", () => {
    const living = { viewer: { present: true, room: "living" }, characterEnabled: false };
    assert.equal(canHearVoice({ volume: "normal", lineTo: "viewer", room: "living" }, living), false);
    assert.equal(characterVoiceEnabled({ characters: { qingqing: { enabled: false } } }, "qingqing"), false);
    assert.equal(characterVoiceEnabled({ characters: { qingqing: { enabled: true } } }, "qingqing"), true);
    assert.equal(characterVoiceEnabled({}, "qingqing"), true);
    const ctx = hearContext(
      { voice: { enabled: true, characters: { qingqing: { enabled: false } } }, viewer: { room: "living" } },
      { room: "living", characterId: "qingqing" },
    );
    assert.equal(ctx.characterEnabled, false);
  });

  it("uses the public maxRecordSec for the hold timer and blocks the mic while compose is busy", () => {
    assert.equal(recordLimitMs({ maxRecordSec: 20 }), 20_000);
    assert.equal(recordLimitMs({}), 15_000);
    assert.equal(isMicBlocked({ micEnabled: true, available: true, recognizing: false, composeBusy: true }), true);
    assert.equal(isMicBlocked({ micEnabled: true, available: true, recognizing: false, composeBusy: false }), false);
  });

  it("captures the pointer on hold-to-talk so a drag off the button can still end recording", () => {
    const ids = [];
    const event = {
      pointerId: 7,
      currentTarget: { setPointerCapture: (id) => ids.push(id) },
    };
    captureHoldPointer(event);
    assert.deepEqual(ids, [7]);
  });
});
