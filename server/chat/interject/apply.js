import { gameDayKey } from "../../think/speech/gates.js";
import { applyReply } from "../apply.js";
import { config as chatDefaults } from "../config.js";
import { config as defaultConfig } from "./config.js";
import { interjectHourKey } from "./gates.js";

/**
 * Write one interjection line, pose (without interrupting eat), and counters.
 * Does not spend proactive or NPC-talk quota. lineTo is the viewer.
 */
export function applyInterjection(world, character, item, clock, now = new Date(), cfg = defaultConfig) {
  if (!character) return { ok: false, reason: "unknown-character" };
  const line = typeof item?.line === "string" ? item.line.trim() : "";
  if (!line) return { ok: false, reason: "missing-line" };

  const at = now instanceof Date ? now : new Date(now);
  const result = applyReply(world, character, { line, lineKind: "interject" }, clock, at, {
    ...chatDefaults,
    maxReplyChars: Number(cfg.maxReplyChars) || chatDefaults.maxReplyChars,
    countAgainstProactiveCap: false,
  });
  if (!result.ok) return result;

  bumpCharacterDay(character, clock, at, cfg);
  return { ok: true, reason: null, line: character.line, characterId: character.id };
}

/** One house hourly occasion, regardless of how many people spoke in this judge. */
export function bumpHouseOccasion(world, clock) {
  if (!world.interjectMeta || typeof world.interjectMeta !== "object") {
    world.interjectMeta = { hourKey: null, occasionCount: 0 };
  }
  const hourKey = interjectHourKey(clock);
  if (world.interjectMeta.hourKey !== hourKey) {
    world.interjectMeta.hourKey = hourKey;
    world.interjectMeta.occasionCount = 0;
  }
  world.interjectMeta.occasionCount = (Number(world.interjectMeta.occasionCount) || 0) + 1;
  return world.interjectMeta;
}

function bumpCharacterDay(character, clock, at, cfg) {
  const dayKey = gameDayKey(clock, { dayStartHhmm: cfg.dayStartHhmm });
  if (!character.interjectMeta || typeof character.interjectMeta !== "object") {
    character.interjectMeta = { dayKey: null, countToday: 0, lastInterjectAt: null };
  }
  const meta = character.interjectMeta;
  if (meta.dayKey !== dayKey) {
    meta.dayKey = dayKey;
    meta.countToday = 0;
  }
  meta.lastInterjectAt = at.toISOString();
  meta.countToday = (Number(meta.countToday) || 0) + 1;
  return meta;
}
