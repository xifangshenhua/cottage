import { nowClock } from "../clock.js";

/** Noon Asia/Shanghai on 2026-11-21 (UTC 04:00). */
export const NOON = "2026-11-21T04:00:00.000Z";
/** 22:30 Asia/Shanghai on 2026-11-21 (UTC 14:30). */
export const NIGHT = "2026-11-21T14:30:00.000Z";
/** 07:30 Asia/Shanghai on 2026-11-22 (UTC 23:30 previous day). */
export const MORNING = "2026-11-21T23:30:00.000Z";

export function clockAt(iso) {
  return nowClock(new Date(iso));
}

export function makeCharacter(id, name, extra = {}) {
  const { stats, bond, ...rest } = extra;
  return {
    id,
    name,
    room: "living",
    action: "sit",
    line: null,
    stats: { energy: 70, hunger: 70, clean: 80, mood: 70, bond: 15, ...(Number.isFinite(Number(bond)) ? { bond: Number(bond) } : {}), ...stats },
    actionStartedAt: NOON,
    enteredRoomAt: NOON,
    lastRoomChangeAt: null,
    lastThinkAt: null,
    lastProactiveAt: null,
    proactiveCountToday: 0,
    proactiveDayKey: null,
    ...rest,
  };
}

export function makeWorld({ characters, lastTickAt = NOON, nowIso = NOON, ...rest } = {}) {
  const clock = clockAt(nowIso);
  const base = {
    qingqing: makeCharacter("qingqing", "青青", { bond: 18, actionStartedAt: lastTickAt }),
    linxia: makeCharacter("linxia", "林夏", { bond: 16, actionStartedAt: lastTickAt }),
    xiaonan: makeCharacter("xiaonan", "小南", { bond: 15, actionStartedAt: lastTickAt }),
  };
  if (characters) {
    for (const [id, patch] of Object.entries(characters)) {
      base[id] = { ...base[id], ...patch, stats: { ...base[id].stats, ...patch.stats } };
    }
  }
  return {
    version: 2,
    startedAt: lastTickAt,
    savedAt: lastTickAt,
    lastTickAt,
    clock,
    viewer: { present: false, room: "living", lastSeenAt: null },
    characters: base,
    ...rest,
    lastTickAt,
    clock: rest.clock ?? clock,
  };
}
