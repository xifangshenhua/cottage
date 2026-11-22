import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LAST_CHAT_EXPIRE_MIN,
  formatSpokenLine,
  selectVisibleDialog,
} from "./dialog.js";

const NOON = Date.parse("2026-11-21T04:00:00.000Z"); // 12:00 Asia/Shanghai
const AFTERNOON = Date.parse("2026-11-21T06:25:00.000Z"); // 14:25
const EVENING = Date.parse("2026-11-21T13:06:00.000Z"); // 21:06
const LATER = Date.parse("2026-11-21T13:10:00.000Z"); // 21:10

function qingqing(extra = {}) {
  return {
    id: "qingqing",
    name: "青青",
    room: "living",
    action: "sit",
    line: null,
    lineTo: null,
    lineKind: null,
    ...extra,
  };
}

function linxia(extra = {}) {
  return {
    id: "linxia",
    name: "林夏",
    room: "living",
    action: "sit",
    line: null,
    lineTo: null,
    lineKind: null,
    ...extra,
  };
}

describe("selectVisibleDialog", () => {
  it("does not let a stale lastChat cover a newer character line", () => {
    const person = qingqing({
      action: "talk",
      line: "这个点了，你吃晚饭了吗？",
      lineTo: "viewer",
      lineAt: "2026-11-21T13:06:00.000Z",
    });
    const lastChat = {
      responderId: "qingqing",
      name: "青青",
      line: "在的，我在客厅呢…",
      at: "2026-11-21T06:25:00.000Z",
      viewerRoom: "living",
    };
    const selected = selectVisibleDialog({
      people: [person],
      focused: person,
      lastChat,
      currentRoomId: "living",
      nowMs: EVENING,
    });
    assert.equal(selected.source, "speech");
    assert.equal(selected.text, "青青对你说：这个点了，你吃晚饭了吗？");
  });

  it("prefers an in-room line over lastChat when timestamps are missing", () => {
    const person = qingqing({
      action: "talk",
      line: "这个点了，你吃晚饭了吗？",
      lineTo: "viewer",
    });
    const selected = selectVisibleDialog({
      people: [person],
      focused: person,
      lastChat: {
        responderId: "qingqing",
        name: "青青",
        line: "在的，我在客厅呢…",
        at: "2026-11-21T06:25:00.000Z",
        viewerRoom: "living",
      },
      currentRoomId: "living",
      nowMs: EVENING,
    });
    assert.equal(selected.text, "青青对你说：这个点了，你吃晚饭了吗？");
  });

  it("shows an interjection with 插话说 formatting when it is the newest line", () => {
    const speaker = qingqing({
      action: "talk",
      line: "吃了一点。",
      lineTo: "viewer",
      lineAt: "2026-11-21T13:06:00.000Z",
    });
    const interjector = linxia({
      action: "talk",
      line: "我也刚吃过。",
      lineTo: "viewer",
      lineKind: "interject",
      lineAt: "2026-11-21T13:06:05.000Z",
    });
    const selected = selectVisibleDialog({
      people: [speaker, interjector],
      focused: speaker,
      lastChat: {
        responderId: "qingqing",
        name: "青青",
        line: "吃了一点。",
        at: "2026-11-21T13:06:00.000Z",
        viewerRoom: "living",
      },
      currentRoomId: "living",
      nowMs: LATER,
    });
    assert.equal(selected.source, "speech");
    assert.equal(selected.text, "林夏插话说：我也刚吃过。");
  });

  it("formats lastChat consistently when it is the latest or only speech", () => {
    const only = selectVisibleDialog({
      people: [],
      focused: null,
      lastChat: {
        responderId: "qingqing",
        name: "青青",
        line: "吃了一点。",
        at: "2026-11-21T13:06:00.000Z",
        viewerRoom: "living",
      },
      currentRoomId: "living",
      nowMs: EVENING,
    });
    assert.equal(only.source, "speech");
    assert.equal(only.text, "青青对你说：吃了一点。");

    const person = qingqing({
      action: "talk",
      line: "吃了一点。",
      lineTo: "viewer",
      lineAt: "2026-11-21T13:06:00.000Z",
    });
    const tied = selectVisibleDialog({
      people: [person],
      focused: person,
      lastChat: {
        responderId: "qingqing",
        name: "青青",
        line: "吃了一点。",
        at: "2026-11-21T13:06:00.000Z",
        viewerRoom: "living",
      },
      currentRoomId: "living",
      nowMs: EVENING,
    });
    assert.equal(tied.text, "青青对你说：吃了一点。");
  });

  it("hides an expired lastChat and falls back to action or empty-room copy", () => {
    const expired = {
      responderId: "qingqing",
      name: "青青",
      line: "在的，我在客厅呢…",
      at: "2026-11-21T06:25:00.000Z",
      viewerRoom: "living",
    };
    const nowMs = AFTERNOON + (LAST_CHAT_EXPIRE_MIN + 1) * 60_000;
    const empty = selectVisibleDialog({
      people: [],
      lastChat: expired,
      currentRoomId: "living",
      nowMs,
    });
    assert.equal(empty.source, "empty");
    assert.equal(empty.text, "这个房间现在没人。");

    const sleeper = qingqing({ room: "qingqing", action: "sleep" });
    const action = selectVisibleDialog({
      people: [sleeper],
      focused: sleeper,
      lastChat: expired,
      currentRoomId: "qingqing",
      nowMs,
    });
    assert.equal(action.source, "action");
    assert.equal(action.icon, "sleep");
    assert.equal(action.text, "青青在睡觉，没有主动说话。");
  });

  it("shows idle copy when someone is in the room but has not spoken", () => {
    const person = qingqing({ action: "talk" });
    const selected = selectVisibleDialog({
      people: [person],
      focused: person,
      lastChat: null,
      currentRoomId: "living",
      nowMs: NOON,
    });
    assert.equal(selected.source, "idle");
    assert.equal(selected.text, "青青在这里，暂时没有说话。");
  });

  it("formats a roommate line as 对某人说", () => {
    const person = qingqing({
      line: "一起坐一会儿吧。",
      lineTo: "linxia",
      lineToName: "林夏",
      lineAt: "2026-11-21T04:00:00.000Z",
    });
    assert.equal(formatSpokenLine(person), "青青对林夏说：一起坐一会儿吧。");
    const selected = selectVisibleDialog({
      people: [person],
      focused: person,
      currentRoomId: "living",
      nowMs: NOON,
    });
    assert.equal(selected.text, "青青对林夏说：一起坐一会儿吧。");
  });
});
