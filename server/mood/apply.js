/**
 * Min chars, cooldown, daily caps, high-mood diminish, and 0–100 clamp.
 * This is the only place that writes character.stats.mood after a discrete event.
 * It never writes energy, hunger, clean, bond, or relation edges.
 */

import { nowClock } from "../clock.js";
import { gameDayKey } from "../think/speech/gates.js";
import { config as defaultConfig } from "./config.js";
import { EVENT_TYPES, deltasFor, eventConfig, gainKey } from "./events.js";

export function applyEvent(world, event, cfg = defaultConfig, now = new Date(), clock = null) {
  if (!world || !event?.type) {
    return { applied: false, reason: "invalid-event", delta: 0 };
  }
  if (!EVENT_TYPES[event.type]) {
    return { applied: false, reason: "unknown-event", delta: 0 };
  }
  const characterId = event.characterId || event.from;
  const character = world.characters?.[characterId];
  if (!character) return { applied: false, reason: "unknown-character", delta: 0 };

  const at = now instanceof Date ? now : new Date(now ?? Date.now());
  const when = clock ?? nowClock(at);

  if (event.type === EVENT_TYPES.playerChat) {
    const gate = playerChatGate(event, character, cfg, at);
    if (!gate.ok) return { applied: false, reason: gate.reason, delta: 0 };
  }

  const proposed = deltasFor(event, cfg);
  return writeDelta(character, event, proposed, cfg, at, when);
}

export function playerChatGate(event, character, cfg, at) {
  const text = typeof event.text === "string" ? event.text.trim() : "";
  const minChars = Number(cfg.playerChat?.minInputChars) || 0;
  if (text.length < minChars) return { ok: false, reason: "short" };
  const cooldown = Number(cfg.playerChat?.cooldownMs) || 0;
  const lastAt = character?.moodMeta?.lastPlayerChatAt;
  if (cooldown > 0 && lastAt) {
    const last = Date.parse(lastAt);
    if (Number.isFinite(last) && at.getTime() - last < cooldown) {
      return { ok: false, reason: "cooldown" };
    }
  }
  return { ok: true };
}

function writeDelta(character, event, proposed, cfg, at, clock) {
  const meta = ensureMoodMeta(character);
  const dayKey = gameDayKey(clock, { dayStartHhmm: cfg.dayStartHhmm });
  rollLedger(meta, dayKey);

  const current = currentMood(character);
  let delta = Number(proposed) || 0;
  if (delta > 0) delta = diminish(delta, current, cfg);

  const typeCfg = eventConfig(event.type, cfg) ?? {};
  const key = gainKey(event.type);
  const cap = finiteNumber(typeCfg.maxGainPerDay);
  if (delta > 0 && cap != null && key) {
    const used = Number(meta[key]) || 0;
    const remain = Math.max(0, cap - used);
    delta = Math.min(delta, remain);
  }

  const next = roundMood(clampMood(current + delta, cfg));
  const actual = roundMood(next - current);
  if (almostZero(actual) || almostZero(delta)) {
    return { applied: false, reason: delta > 0 && almostZero(actual) ? "clamped" : "capped", delta: 0 };
  }

  if (!character.stats || typeof character.stats !== "object") character.stats = {};
  character.stats.mood = next;
  if (key && actual > 0) meta[key] = roundMood((Number(meta[key]) || 0) + actual);
  if (event.type === EVENT_TYPES.playerChat) {
    meta.lastPlayerChatAt = at.toISOString();
  }
  return { applied: true, reason: null, delta: actual };
}

export function diminish(delta, current, cfg = defaultConfig) {
  if (!(delta > 0)) return delta;
  const mood = Number(current) || 0;
  const veryStart = Number(cfg.veryHighMoodStart);
  const highStart = Number(cfg.highMoodStart);
  if (Number.isFinite(veryStart) && mood >= veryStart) {
    const factor = Number(cfg.veryHighMoodFactor);
    return Number.isFinite(factor) ? delta * factor : delta;
  }
  if (Number.isFinite(highStart) && mood >= highStart) {
    const factor = Number(cfg.highMoodFactor);
    return Number.isFinite(factor) ? delta * factor : delta;
  }
  return delta;
}

export function ensureMoodMeta(character) {
  if (!character.moodMeta || typeof character.moodMeta !== "object") {
    character.moodMeta = {
      dayKey: null,
      playerChatGain: 0,
      npcTalkGain: 0,
      proactiveGain: 0,
      interjectGain: 0,
      lastPlayerChatAt: null,
    };
  } else {
    const meta = character.moodMeta;
    if (!("dayKey" in meta)) meta.dayKey = null;
    if (!Number.isFinite(Number(meta.playerChatGain))) meta.playerChatGain = 0;
    if (!Number.isFinite(Number(meta.npcTalkGain))) meta.npcTalkGain = 0;
    if (!Number.isFinite(Number(meta.proactiveGain))) meta.proactiveGain = 0;
    if (!Number.isFinite(Number(meta.interjectGain))) meta.interjectGain = 0;
    if (!("lastPlayerChatAt" in meta)) meta.lastPlayerChatAt = null;
  }
  return character.moodMeta;
}

function rollLedger(meta, dayKey) {
  if (!dayKey || meta.dayKey === dayKey) return;
  meta.dayKey = dayKey;
  meta.playerChatGain = 0;
  meta.npcTalkGain = 0;
  meta.proactiveGain = 0;
  meta.interjectGain = 0;
}

function currentMood(character) {
  const n = Number(character?.stats?.mood);
  return Number.isFinite(n) ? n : 0;
}

function clampMood(value, cfg = defaultConfig) {
  const min = Number(cfg.statMin);
  const max = Number(cfg.statMax);
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) ? max : 100;
  return Math.max(lo, Math.min(hi, value));
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function almostZero(n) {
  return Math.abs(n) < 1e-9;
}

function roundMood(n) {
  return Number(Number(n).toFixed(4));
}
