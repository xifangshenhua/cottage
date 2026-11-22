import { config as chatDefaults } from "../config.js";
import { canReply } from "../policy.js";
import { gameDayKey, npcTalkHourKey, toMs } from "../../think/speech/gates.js";
import { config as defaultConfig } from "./config.js";

/**
 * Eligible overhearers who may be offered to the content judge.
 * Does not call a model. House hourly cap is checked separately so a full
 * hour skips the judge entirely.
 */
export function listCandidates(world, ctx = {}, cfg = defaultConfig) {
  if (cfg.enabled === false) return [];
  if (isWhisper(ctx.audience)) return [];
  const overhearers = Array.isArray(ctx.audience?.overhearers) ? ctx.audience.overhearers : [];
  return overhearers
    .filter((character) => isEligible(character, world, ctx, cfg))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function isEligible(character, world, ctx = {}, cfg = defaultConfig) {
  if (!character?.id) return false;
  if (character.id === ctx.responder?.id) return false;
  if (isWhisper(ctx.audience)) return false;

  const overhearers = Array.isArray(ctx.audience?.overhearers) ? ctx.audience.overhearers : [];
  if (!overhearers.some((item) => item.id === character.id)) return false;

  const chatCfg = ctx.chatCfg ?? chatDefaults;
  if (!canReply(character, chatCfg).ok) return false;

  if (cfg.sameRoomOnly !== false) {
    const viewerRoom = world?.viewer?.room ?? null;
    if (!viewerRoom || character.room !== viewerRoom) return false;
  }

  if (characterDayCount(character, ctx.clock, cfg) >= (Number(cfg.maxPerCharacterDay) || 0)) {
    return false;
  }
  if (!gapElapsed(character, ctx.now, cfg)) return false;
  return true;
}

export function isWhisper(audience) {
  const volume = audience?.volume;
  if (!volume) return false;
  return volume.id === "whisper" || volume.range === "target" || !(audience.overhearers || []).length;
}

export function houseOccasionFull(world, clock, cfg = defaultConfig) {
  const cap = Number(cfg.maxOccasionsPerHouseHour);
  if (!Number.isFinite(cap) || cap <= 0) return true;
  return houseOccasionCount(world, clock) >= cap;
}

export function houseOccasionCount(world, clock) {
  const hourKey = interjectHourKey(clock);
  if (!hourKey || world?.interjectMeta?.hourKey !== hourKey) return 0;
  return Number(world.interjectMeta.occasionCount) || 0;
}

export function interjectHourKey(clock) {
  return npcTalkHourKey(clock);
}

export function characterDayCount(character, clock, cfg = defaultConfig) {
  const key = gameDayKey(clock, { dayStartHhmm: cfg.dayStartHhmm });
  const meta = character?.interjectMeta;
  if (!key || !meta || meta.dayKey !== key) return 0;
  return Number(meta.countToday) || 0;
}

export function gapElapsed(character, now, cfg = defaultConfig) {
  const last = Date.parse(character?.interjectMeta?.lastInterjectAt || "");
  if (!Number.isFinite(last)) return true;
  const nowMs = toMs(now);
  if (!Number.isFinite(nowMs)) return false;
  const gapMs = (Number(cfg.minGapMin) || 0) * 60_000;
  return nowMs - last >= gapMs;
}

/**
 * When judgeUnaddressed is false, skip the model unless the player addressed
 * someone or the utterance mentions a present character's name.
 */
export function shouldJudge({ text, audience, world, cfg = defaultConfig } = {}) {
  if (cfg.judgeUnaddressed !== false) return true;
  if (audience?.targetId) return true;
  const people = Object.values(world?.characters ?? {});
  return mentionsPresentName(text, people);
}

export function mentionsPresentName(text, characters) {
  const raw = String(text ?? "");
  if (!raw) return false;
  for (const character of characters ?? []) {
    const name = typeof character?.name === "string" ? character.name.trim() : "";
    if (name && raw.includes(name)) return true;
  }
  return false;
}
