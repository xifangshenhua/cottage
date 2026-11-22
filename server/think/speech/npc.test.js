import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clockAt, makeWorld, NOON } from "../../life/test-helpers.js";
import { applyNpcSpeech, applySpeech, clearLine } from "./apply.js";
import { canSpeak, canSpeakToNpc, gameDayKey, isQuietHours } from "./gates.js";

/** 21:59 Asia/Shanghai. */
const BEFORE_QUIET = "2026-11-21T13:59:00.000Z";
/** 22:00 Asia/Shanghai. */
const QUIET_START = "2026-11-21T14:00:00.000Z";
/** 00:30 Asia/Shanghai on Nov 22 (still previous game day). */
const AFTER_MIDNIGHT = "2026-11-21T16:30:00.000Z";
/** 07:30 Asia/Shanghai on Nov 22. */
const QUIET_END = "2026-11-21T23:30:00.000Z";

const NPC_SPEECH = { to: "linxia", line: "一起坐一会儿吧。", reason: "林夏刚坐下" };
const VIEWER_SPEECH = { to: "viewer", line: "你来了。", reason: "看见你进了客厅" };

function together(extra = {}) {
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
        lastNpcTalkAt: null,
        npcTalkCountToday: 0,
        npcTalkDayKey: null,
        line: null,
        lineTo: null,
        ...characters?.qingqing,
      },
      linxia: {
        room: "living",
        action: "sit",
        lastNpcTalkAt: null,
        npcTalkCountToday: 0,
        ...characters?.linxia,
      },
      xiaonan: {
        room: "xiaonan",
        action: "sit",
        ...characters?.xiaonan,
      },
      ...characters,
    },
    ...rest,
  });
}

function check(world, speech = NPC_SPEECH, nowIso) {
  const iso = nowIso ?? world.clock.iso;
  return canSpeakToNpc(
    world,
    world.characters.qingqing,
    world.characters[speech.to] ?? world.characters.linxia,
    speech,
    clockAt(iso),
    new Date(iso),
  );
}

function deliver(world, speech = NPC_SPEECH, nowIso) {
  const iso = nowIso ?? world.clock.iso;
  return applyNpcSpeech(
    world,
    world.characters.qingqing,
    speech,
    clockAt(iso),
    new Date(iso),
  );
}

describe("npc speech gates and delivery", () => {
  it("allows a same-room line when other limits are clear", () => {
    const world = together();
    assert.equal(check(world).ok, true);
  });

  it("allows a line when the viewer is absent", () => {
    const world = together({ viewer: { present: false, room: null } });
    assert.equal(check(world).ok, true);
  });

  it("denies when the target is not in the same room", () => {
    const world = together({ characters: { linxia: { room: "dining", action: "eat" } } });
    const result = check(world);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not-same-room");
  });

  it("denies when the speaker or target is sleeping", () => {
    const speakerAsleep = together({ characters: { qingqing: { room: "qingqing", action: "sleep" }, linxia: { room: "qingqing", action: "sit" } } });
    assert.equal(check(speakerAsleep).reason, "speaker-sleeping");
    const targetAsleep = together({ characters: { linxia: { action: "sleep" } } });
    assert.equal(check(targetAsleep).reason, "target-sleeping");
  });

  it("denies bathroom talk even when both are present", () => {
    const world = together({
      characters: {
        qingqing: { room: "bathroom", action: "sit" },
        linxia: { room: "bathroom", action: "sit" },
      },
    });
    const result = check(world);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "forbidden-room");
  });

  it("denies during night quiet hours 22:00–07:30", () => {
    for (const iso of [QUIET_START, AFTER_MIDNIGHT]) {
      const world = together({ nowIso: iso });
      assert.equal(isQuietHours(world.clock), true, iso);
      const result = check(world, NPC_SPEECH, iso);
      assert.equal(result.ok, false, iso);
      assert.equal(result.reason, "quiet-hours", iso);
    }
    const before = together({ nowIso: BEFORE_QUIET });
    assert.equal(check(before, NPC_SPEECH, BEFORE_QUIET).ok, true);
    const after = together({ nowIso: QUIET_END });
    assert.equal(check(after, NPC_SPEECH, QUIET_END).ok, true);
  });

  it("denies when the reason is missing", () => {
    const world = together();
    const result = check(world, { to: "linxia", line: "你好。", reason: "  " });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "missing-reason");
  });

  it("does not increment the viewer-proactive day cap when an npc line lands", () => {
    const world = together();
    const result = deliver(world);
    assert.equal(result.ok, true);
    const qingqing = world.characters.qingqing;
    assert.equal(qingqing.npcTalkCountToday, 1);
    assert.equal(qingqing.npcTalkDayKey, "2026-11-21");
    assert.equal(qingqing.lastNpcTalkAt, NOON);
    assert.equal(qingqing.proactiveCountToday, 0);
    assert.equal(qingqing.lastProactiveAt, null);
    assert.equal(qingqing.proactiveDayKey, null);
    assert.equal(canSpeak(world, qingqing, VIEWER_SPEECH, world.clock, new Date(NOON)).ok, true);
  });

  it("keeps eating when a line lands, and only sitting becomes talk", () => {
    const eating = together({
      characters: {
        qingqing: { room: "dining", action: "eat" },
        linxia: { room: "dining", action: "eat" },
      },
    });
    const eatResult = deliver(eating);
    assert.equal(eatResult.ok, true);
    assert.equal(eating.characters.qingqing.action, "eat");
    assert.equal(eatResult.line, NPC_SPEECH.line);

    const sitting = together();
    const sitResult = deliver(sitting);
    assert.equal(sitResult.ok, true);
    assert.equal(sitting.characters.qingqing.action, "talk");
    assert.equal(sitting.characters.qingqing.actionStartedAt, NOON);
  });

  it("hides the bubble when the viewer is absent or in another room, but still returns the line", () => {
    const absent = together({ viewer: { present: false, room: "living" } });
    const hidden = deliver(absent);
    assert.equal(hidden.ok, true);
    assert.equal(hidden.visible, false);
    assert.equal(hidden.line, NPC_SPEECH.line);
    assert.equal(absent.characters.qingqing.line, null);
    assert.equal(absent.characters.qingqing.lineTo, null);

    const otherRoom = together({
      viewer: { present: true, room: "dining" },
      characters: { qingqing: { line: "旧台词", lineTo: "viewer" } },
    });
    const relocated = deliver(otherRoom);
    assert.equal(relocated.ok, true);
    assert.equal(relocated.visible, false);
    assert.equal(otherRoom.characters.qingqing.line, null);
    assert.equal(otherRoom.characters.qingqing.lineTo, null);

    const watching = together({ viewer: { present: true, room: "living" } });
    const shown = deliver(watching);
    assert.equal(shown.visible, true);
    assert.equal(watching.characters.qingqing.line, NPC_SPEECH.line);
    assert.equal(watching.characters.qingqing.lineTo, "linxia");
  });

  it("enforces mouth cooldown after viewer, npc, or player-reply speech", () => {
    const afterProactive = together({
      characters: { qingqing: { lastProactiveAt: "2026-11-21T03:58:00.000Z" } },
    });
    assert.equal(check(afterProactive).reason, "mouth-cooldown");

    const afterNpc = together({
      characters: { qingqing: { lastNpcTalkAt: "2026-11-21T03:58:00.000Z" } },
    });
    assert.equal(check(afterNpc).reason, "mouth-cooldown");

    const afterReply = together({
      lastChat: { responderId: "qingqing", at: "2026-11-21T03:58:00.000Z", line: "嗯。" },
    });
    assert.equal(check(afterReply).reason, "mouth-cooldown");

    const cooled = together({
      characters: { qingqing: { lastProactiveAt: "2026-11-21T03:57:00.000Z", lastNpcTalkAt: "2026-11-20T04:00:00.000Z" } },
    });
    assert.equal(check(cooled).ok, true);
  });

  it("enforces the per-speaker day cap and house hourly cap without touching proactive counters", () => {
    const dayFull = together({
      characters: { qingqing: { npcTalkCountToday: 3, npcTalkDayKey: "2026-11-21" } },
    });
    assert.equal(check(dayFull).reason, "day-cap");
    assert.equal(dayFull.characters.qingqing.proactiveCountToday, 0);

    const first = together();
    assert.equal(deliver(first).ok, true);
    first.characters.qingqing.lastNpcTalkAt = "2026-11-21T03:00:00.000Z";
    assert.equal(deliver(first, { ...NPC_SPEECH, line: "再聊一句。" }).ok, true);
    first.characters.qingqing.lastNpcTalkAt = "2026-11-21T03:00:00.000Z";
    const blocked = deliver(first, { ...NPC_SPEECH, line: "第三句不该落下。" });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "house-hour-cap");
    assert.equal(first.characters.qingqing.npcTalkCountToday, 2);
    assert.equal(first.characters.qingqing.proactiveCountToday, 0);
    assert.equal(first.npcTalkMeta.count, 2);
    assert.equal(first.npcTalkMeta.hourKey, `${gameDayKey(first.clock)}-12`);
  });

  it("enforces the 30-minute gap between npc lines for the same speaker", () => {
    const world = together({
      characters: { qingqing: { lastNpcTalkAt: "2026-11-21T03:31:00.000Z" } },
    });
    assert.equal(check(world).reason, "gap");
    const ready = together({
      characters: { qingqing: { lastNpcTalkAt: "2026-11-21T03:30:00.000Z" } },
    });
    assert.equal(check(ready).ok, true);
  });

  it("drops a failed line without reverting an already-applied action", () => {
    const world = together({ characters: { qingqing: { action: "eat", room: "dining" }, linxia: { room: "living" } } });
    world.characters.qingqing.action = "eat";
    world.characters.qingqing.room = "dining";
    const result = deliver(world);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not-same-room");
    assert.equal(world.characters.qingqing.action, "eat");
    assert.equal(world.characters.qingqing.room, "dining");
    assert.equal(Number(world.characters.qingqing.npcTalkCountToday) || 0, 0);
  });

  it("clears lineTo together with the spoken line", () => {
    const character = { line: "一起坐一会儿吧。", lineTo: "linxia" };
    clearLine(character);
    assert.equal(character.line, null);
    assert.equal(character.lineTo, null);
  });

  it("keeps existing viewer-proactive applySpeech behavior, including writing lineTo as viewer", () => {
    const world = together();
    const result = applySpeech(world, world.characters.qingqing, VIEWER_SPEECH, world.clock, new Date(NOON));
    assert.equal(result.ok, true);
    assert.equal(world.characters.qingqing.line, "你来了。");
    assert.equal(world.characters.qingqing.lineTo, "viewer");
    assert.equal(world.characters.qingqing.proactiveCountToday, 1);
    assert.equal(world.characters.qingqing.npcTalkCountToday, 0);
  });
});
