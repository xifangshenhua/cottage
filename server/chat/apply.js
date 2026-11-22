import { gameDayKey } from "../think/speech/gates.js";
import { config as speechDefaults } from "../think/speech/config.js";
import { config as defaultConfig } from "./config.js";

/**
 * Write the reply line without proactive-speech gates.
 * Does not increment lastProactiveAt / proactiveCountToday unless
 * cfg.countAgainstProactiveCap is true.
 * May set action to "talk" in the current room when the character is free
 * (sit / talk / idle). Does not teleport or interrupt eat / wash / sleep.
 */
export function applyReply(world, character, intent, clock, now = new Date(), cfg = defaultConfig) {
  if (!character) return { ok: false, reason: "unknown-character" };
  const line = typeof intent?.line === "string" ? intent.line.trim() : "";
  if (!line) return { ok: false, reason: "missing-line" };

  const at = now instanceof Date ? now : new Date(now);
  character.line = line;
  character.lineTo = "viewer";
  character.lineKind = intent?.lineKind === "interject" ? "interject" : null;
  character.lineAt = at.toISOString();

  if (cfg.countAgainstProactiveCap === true) {
    const dayKey = gameDayKey(clock, { dayStartHhmm: cfg.dayStartHhmm || speechDefaults.dayStartHhmm });
    if (character.proactiveDayKey !== dayKey) {
      character.proactiveDayKey = dayKey;
      character.proactiveCountToday = 0;
    }
    character.lastProactiveAt = at.toISOString();
    character.proactiveCountToday = (Number(character.proactiveCountToday) || 0) + 1;
  }

  const current = character.action;
  if (!current || current === "sit" || current === "talk") {
    character.action = "talk";
    character.actionStartedAt = clock?.iso ?? at.toISOString();
  }

  return { ok: true, reason: null };
}
