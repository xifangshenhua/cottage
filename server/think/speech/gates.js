import { hhmmToMinutes, isWrappedWindow } from "../../clock.js";
import { config as defaultConfig } from "./config.js";

/**
 * Whether this character may speak proactively right now.
 * Returns `{ ok, reason }` — reason is a denial code when not ok.
 */
export function canSpeak(world, character, speech, clock, now = new Date(), cfg = defaultConfig) {
  if (cfg.canSpeakProactively === false) return deny("speech-disabled");
  if (!world?.viewer?.present) return deny("viewer-absent");
  if (character?.room !== cfg.livingRoom && !justEnteredLiving(character, clock, now, cfg)) {
    return deny("not-in-living");
  }
  if (isQuietHours(clock, cfg)) return deny("quiet-hours");
  if (!hasConcreteReason(speech)) return deny("missing-reason");
  if (!gapElapsed(character, now, cfg)) return deny("gap");
  if (dayCount(character, clock, cfg) >= cfg.maxPerGameDay) return deny("day-cap");
  return { ok: true, reason: null };
}

/**
 * Whether this character may speak a one-way line to a roommate right now.
 * Viewer-proactive caps and `canSpeak` are not used here.
 */
export function canSpeakToNpc(world, speaker, target, speech, clock, now = new Date(), cfg = defaultConfig) {
  const npcCfg = npcTalkOf(cfg);
  if (npcCfg.enabled === false) return deny("npc-talk-disabled");
  if (!target?.id || target.id === speaker?.id) return deny("unknown-target");
  if (!world?.characters?.[target.id]) return deny("unknown-target");
  if (npcCfg.requiresViewer && !world?.viewer?.present) return deny("viewer-absent");
  if (!speaker?.room || speaker.room !== target.room) return deny("not-same-room");
  if (isForbiddenRoom(speaker.room, npcCfg) || isForbiddenRoom(target.room, npcCfg)) {
    return deny("forbidden-room");
  }
  const speakerBusy = busyReason(speaker, npcCfg, "speaker");
  if (speakerBusy) return deny(speakerBusy);
  const targetBusy = busyReason(target, npcCfg, "target");
  if (targetBusy) return deny(targetBusy);
  if (!npcCfg.canTalkInQuietHours && isQuietHours(clock, cfg)) return deny("quiet-hours");
  if (!hasConcreteReason(speech)) return deny("missing-reason");
  if (!mouthCooldownElapsed(world, speaker, now, npcCfg)) return deny("mouth-cooldown");
  if (!npcGapElapsed(speaker, now, npcCfg)) return deny("gap");
  if (npcDayCount(speaker, clock, cfg) >= npcCfg.maxPerGameDay) return deny("day-cap");
  if (houseHourCount(world, clock) >= npcCfg.houseMaxPerHour) return deny("house-hour-cap");
  return { ok: true, reason: null };
}

/** Same-room hearers this speaker could address right now (excludes the viewer). */
export function legalNpcSpeechTargets(world, speaker, clock, now = new Date(), cfg = defaultConfig) {
  const speech = { reason: "probe" };
  const targets = [];
  for (const other of Object.values(world?.characters ?? {})) {
    if (!other?.id || other.id === speaker?.id) continue;
    const gate = canSpeakToNpc(world, speaker, other, speech, clock, now, cfg);
    if (gate.ok) targets.push(other);
  }
  return targets;
}

export function isQuietHours(clock, cfg = defaultConfig) {
  return isWrappedWindow(clock?.hhmm, cfg.quietStartHhmm, cfg.quietEndHhmm);
}

/**
 * Game day key: [07:00, next 07:00). Midnight–07:00 belongs to the previous
 * game day. Do not use clock.dayKey blindly.
 */
export function gameDayKey(clock, cfg = defaultConfig) {
  const dayKey = clock?.dayKey;
  if (!dayKey) return null;
  if (hhmmToMinutes(clock.hhmm) < hhmmToMinutes(cfg.dayStartHhmm)) {
    return previousDayKey(dayKey);
  }
  return dayKey;
}

export function justEnteredLiving(character, clock, now, cfg = defaultConfig) {
  if (character?.room !== cfg.livingRoom) return false;
  const entered = Date.parse(character.enteredRoomAt || character.lastRoomChangeAt || "");
  if (!Number.isFinite(entered)) return false;
  const nowMs = toMs(now) ?? Date.parse(clock?.iso || "");
  if (!Number.isFinite(nowMs)) return false;
  return nowMs - entered <= cfg.justEnteredMin * 60_000 && nowMs - entered >= 0;
}

export function dayCount(character, clock, cfg = defaultConfig) {
  const key = gameDayKey(clock, cfg);
  if (!key || character?.proactiveDayKey !== key) return 0;
  return Number(character.proactiveCountToday) || 0;
}

export function npcDayCount(character, clock, cfg = defaultConfig) {
  const key = gameDayKey(clock, cfg);
  if (!key || character?.npcTalkDayKey !== key) return 0;
  return Number(character.npcTalkCountToday) || 0;
}

export function npcTalkHourKey(clock) {
  const dayKey = clock?.dayKey;
  const hhmm = typeof clock?.hhmm === "string" ? clock.hhmm : "";
  const hour = hhmm.slice(0, 2);
  if (!dayKey || !/^\d{2}$/.test(hour)) return null;
  return `${dayKey}-${hour}`;
}

export function houseHourCount(world, clock) {
  const hourKey = npcTalkHourKey(clock);
  if (!hourKey || world?.npcTalkMeta?.hourKey !== hourKey) return 0;
  return Number(world.npcTalkMeta.count) || 0;
}

export function npcTalkOf(cfg = defaultConfig) {
  const base = defaultConfig.npcTalk ?? {};
  const overlay = cfg?.npcTalk && typeof cfg.npcTalk === "object" ? cfg.npcTalk : {};
  return {
    ...base,
    ...overlay,
    forbiddenRooms: Array.isArray(overlay.forbiddenRooms)
      ? [...overlay.forbiddenRooms]
      : [...(base.forbiddenRooms ?? [])],
  };
}

export function isNpcSpeechTarget(to, world) {
  if (typeof to !== "string") return false;
  const id = to.trim();
  if (!id || id === "viewer") return false;
  return !!world?.characters?.[id];
}

function busyReason(character, npcCfg, who) {
  const action = character?.action;
  if (action === "sleep" && !npcCfg.canTalkWhenSleeping) return `${who}-sleeping`;
  if (action === "wash" && !npcCfg.canTalkWhenWashing) return `${who}-washing`;
  if (action === "eat" && !npcCfg.canTalkWhenEating) return `${who}-eating`;
  return null;
}

function isForbiddenRoom(room, npcCfg) {
  return (npcCfg.forbiddenRooms ?? []).includes(room);
}

function gapElapsed(character, now, cfg) {
  const last = Date.parse(character?.lastProactiveAt || "");
  if (!Number.isFinite(last)) return true;
  const nowMs = toMs(now);
  if (!Number.isFinite(nowMs)) return false;
  return nowMs - last >= cfg.minGapMs;
}

function npcGapElapsed(character, now, npcCfg) {
  const last = Date.parse(character?.lastNpcTalkAt || "");
  if (!Number.isFinite(last)) return true;
  const nowMs = toMs(now);
  if (!Number.isFinite(nowMs)) return false;
  const gapMs = (Number(npcCfg.minGapMin) || 0) * 60_000;
  return nowMs - last >= gapMs;
}

function mouthCooldownElapsed(world, character, now, npcCfg) {
  const cooldownMs = (Number(npcCfg.mouthCooldownMin) || 0) * 60_000;
  if (cooldownMs <= 0) return true;
  const nowMs = toMs(now);
  if (!Number.isFinite(nowMs)) return false;
  const stamps = [
    Date.parse(character?.lastProactiveAt || ""),
    Date.parse(character?.lastNpcTalkAt || ""),
  ];
  if (world?.lastChat?.responderId === character?.id) {
    stamps.push(Date.parse(world.lastChat.at || ""));
  }
  const last = Math.max(0, ...stamps.filter((ms) => Number.isFinite(ms)));
  if (!last) return true;
  return nowMs - last >= cooldownMs;
}

function hasConcreteReason(speech) {
  return typeof speech?.reason === "string" && speech.reason.trim().length > 0;
}

function previousDayKey(dayKey) {
  const [y, m, d] = String(dayKey).split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dayKey;
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const yyyy = prev.getUTCFullYear();
  const mm = String(prev.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(prev.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function toMs(now) {
  if (now instanceof Date) return now.getTime();
  const parsed = Date.parse(now);
  return Number.isFinite(parsed) ? parsed : null;
}

function deny(reason) {
  return { ok: false, reason };
}
