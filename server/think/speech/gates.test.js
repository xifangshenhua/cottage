import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clockAt, makeWorld, NOON } from "../../life/test-helpers.js";
import { canSpeak, dayCount, gameDayKey, isQuietHours } from "./gates.js";

/** 21:59 Asia/Shanghai. */
const BEFORE_QUIET = "2026-11-21T13:59:00.000Z";
/** 22:00 Asia/Shanghai. */
const QUIET_START = "2026-11-21T14:00:00.000Z";
/** 00:30 Asia/Shanghai on Nov 22 (still previous game day). */
const AFTER_MIDNIGHT = "2026-11-21T16:30:00.000Z";
/** 06:59 Asia/Shanghai on Nov 22. */
const BEFORE_DAY = "2026-11-21T22:59:00.000Z";
/** 07:00 Asia/Shanghai on Nov 22. */
const DAY_START = "2026-11-21T23:00:00.000Z";
/** 07:29 Asia/Shanghai on Nov 22. */
const BEFORE_QUIET_END = "2026-11-21T23:29:00.000Z";
/** 07:30 Asia/Shanghai on Nov 22. */
const QUIET_END = "2026-11-21T23:30:00.000Z";

const SPEECH = { to: "viewer", line: "你来了。", reason: "看见你进了客厅" };

function speakable(extra = {}) {
  const { characters, viewer, nowIso = NOON, ...rest } = extra;
  return makeWorld({
    nowIso,
    lastTickAt: nowIso,
    viewer: { present: true, room: "living", lastSeenAt: nowIso, ...viewer },
    characters: {
      qingqing: {
        room: "living",
        action: "sit",
        lastProactiveAt: null,
        proactiveCountToday: 0,
        proactiveDayKey: null,
        ...characters?.qingqing,
      },
      ...characters,
    },
    ...rest,
  });
}

function check(world, speech = SPEECH, nowIso) {
  const iso = nowIso ?? world.clock.iso;
  return canSpeak(world, world.characters.qingqing, speech, clockAt(iso), new Date(iso));
}

describe("speech gates", () => {
  it("allows a line when the viewer is present, the character is in the living room, and other limits are clear", () => {
    const world = speakable();
    const result = check(world);
    assert.equal(result.ok, true);
  });

  it("denies when the viewer is absent", () => {
    const world = speakable({ viewer: { present: false } });
    const result = check(world);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "viewer-absent");
  });

  it("denies when the character is not in the living room", () => {
    const world = speakable({ characters: { qingqing: { room: "dining", action: "eat" } } });
    const result = check(world);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not-in-living");
  });

  it("denies during night quiet hours 22:00–07:30", () => {
    for (const iso of [QUIET_START, AFTER_MIDNIGHT, BEFORE_DAY, DAY_START, BEFORE_QUIET_END]) {
      const world = speakable({ nowIso: iso });
      assert.equal(isQuietHours(world.clock), true, iso);
      const result = check(world, SPEECH, iso);
      assert.equal(result.ok, false, iso);
      assert.equal(result.reason, "quiet-hours", iso);
    }
    const before = speakable({ nowIso: BEFORE_QUIET });
    assert.equal(isQuietHours(before.clock), false);
    assert.equal(check(before, SPEECH, BEFORE_QUIET).ok, true);

    const after = speakable({ nowIso: QUIET_END });
    assert.equal(isQuietHours(after.clock), false);
    assert.equal(check(after, SPEECH, QUIET_END).ok, true);
  });

  it("denies if fewer than 45 minutes have passed since lastProactiveAt", () => {
    const now = NOON;
    const world = speakable({
      characters: { qingqing: { lastProactiveAt: "2026-11-21T03:16:00.000Z" } },
    });
    const short = check(world, SPEECH, now);
    assert.equal(short.ok, false);
    assert.equal(short.reason, "gap");

    const ready = speakable({
      characters: { qingqing: { lastProactiveAt: "2026-11-21T03:15:00.000Z" } },
    });
    assert.equal(check(ready, SPEECH, now).ok, true);
  });

  it("denies a fifth line in the same game day", () => {
    const world = speakable({
      characters: {
        qingqing: { proactiveCountToday: 4, proactiveDayKey: "2026-11-21" },
      },
    });
    const result = check(world);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "day-cap");
  });

  it("denies when the reason is missing or only whitespace", () => {
    const world = speakable();
    for (const speech of [
      { to: "viewer", line: "你来了。" },
      { to: "viewer", line: "你来了。", reason: "" },
      { to: "viewer", line: "你来了。", reason: "   " },
      { to: "viewer", line: "你来了。", reason: null },
    ]) {
      const result = check(world, speech);
      assert.equal(result.ok, false, JSON.stringify(speech));
      assert.equal(result.reason, "missing-reason");
    }
  });

  it("resets the game-day cap at 07:00 (00:00–07:00 belongs to the previous game day)", () => {
    assert.equal(gameDayKey(clockAt(NOON)), "2026-11-21");
    assert.equal(gameDayKey(clockAt(AFTER_MIDNIGHT)), "2026-11-21");
    assert.equal(gameDayKey(clockAt(BEFORE_DAY)), "2026-11-21");
    assert.equal(gameDayKey(clockAt(DAY_START)), "2026-11-22");
    assert.equal(gameDayKey(clockAt(QUIET_END)), "2026-11-22");

    const stamped = { proactiveCountToday: 4, proactiveDayKey: "2026-11-21" };
    const stillYesterday = speakable({ nowIso: BEFORE_DAY, characters: { qingqing: stamped } });
    assert.equal(dayCount(stillYesterday.characters.qingqing, stillYesterday.clock), 4);

    const atReset = speakable({ nowIso: DAY_START, characters: { qingqing: stamped } });
    assert.equal(gameDayKey(atReset.clock), "2026-11-22");
    assert.equal(dayCount(atReset.characters.qingqing, atReset.clock), 0);
    // 07:00 is a new game day, but quiet hours last until 07:30.
    assert.equal(check(atReset, SPEECH, DAY_START).reason, "quiet-hours");

    const morning = speakable({ nowIso: QUIET_END, characters: { qingqing: stamped } });
    assert.equal(dayCount(morning.characters.qingqing, morning.clock), 0);
    assert.equal(check(morning, SPEECH, QUIET_END).ok, true);

    const alreadyToday = speakable({
      nowIso: QUIET_END,
      characters: { qingqing: { proactiveCountToday: 4, proactiveDayKey: "2026-11-22" } },
    });
    assert.equal(check(alreadyToday, SPEECH, QUIET_END).reason, "day-cap");
  });
});
