/**
 * Clamp, diminishing returns, daily caps, and player-chat spam/short filters.
 * This is the only place that writes relation scores after an event.
 */

import { nowClock } from "../clock.js";
import { gameDayKey } from "../think/speech/gates.js";
import { VIEWER_ID, config as defaultConfig } from "./config.js";
import { EVENT_TYPES, deltasFor, eventConfig } from "./events.js";
import { ensureEdge, getEdge } from "./graph.js";
import { clampScore, isViewerId } from "./schema.js";

export function applyEvent(world, event, cfg = defaultConfig, now = new Date(), clock = null) {
  if (!world || !event?.type || !event.from || !event.to) {
    return { applied: false, reason: "invalid-event" };
  }
  if (event.from === event.to) return { applied: false, reason: "same-node" };

  const at = now instanceof Date ? now : new Date(now ?? Date.now());
  const when = clock ?? world.clock ?? nowClock(at);
  const type = event.type;

  if (type === EVENT_TYPES.playerChat) {
    return applyPlayerChat(world, event, cfg, at, when);
  }
  if (type === EVENT_TYPES.overhear) {
    return applyOverhear(world, event, cfg, at, when);
  }
  if (type === EVENT_TYPES.idleThink || type === EVENT_TYPES.proactiveSpeech) {
    return applyPlainDelta(world, event, cfg, at, when, { markInteract: false, markChat: false });
  }
  if (type === EVENT_TYPES.sharedRoom || type === EVENT_TYPES.mealTogether || type === EVENT_TYPES.npcTalk || type === EVENT_TYPES.npcOverhear) {
    return applyPlainDelta(world, event, cfg, at, when, { markInteract: true, markChat: false });
  }
  if (type === EVENT_TYPES.interject) {
    return applyPlainDelta(world, event, cfg, at, when, { markInteract: true, markChat: true });
  }
  if (type === EVENT_TYPES.decay) {
    return applyPlainDelta(world, event, cfg, at, when, { markInteract: false, markChat: false, decay: true });
  }
  return { applied: false, reason: "unknown-event" };
}

export function applyEvents(world, events, cfg = defaultConfig, now = new Date(), clock = null) {
  const results = [];
  for (const event of events ?? []) {
    results.push(applyEvent(world, event, cfg, event.now ?? now, clock));
  }
  return results;
}

function applyPlayerChat(world, event, cfg, at, clock) {
  const edge = ensureEdge(world, event.from, event.to, {}, at.toISOString(), cfg);
  const gate = playerChatGate(event, edge, cfg, at);
  if (!gate.ok) {
    return { applied: false, reason: gate.reason, familiarity: 0, closeness: 0, edge };
  }

  const iso = at.toISOString();
  const proposed = deltasFor(event, cfg);
  const result = writeDelta(world, edge, proposed, cfg, at, clock, {
    markInteract: true,
    markChat: true,
    type: EVENT_TYPES.playerChat,
  });
  edge.lastScoredChatAt = iso;

  if (cfg.playerChat.alsoUpdateViewerEdge) {
    const viewerId = cfg.viewerId ?? VIEWER_ID;
    const otherFrom = event.to === viewerId ? viewerId : event.to;
    const otherTo = event.from === viewerId ? viewerId : event.from;
    if (otherFrom !== event.from || otherTo !== event.to) {
      const other = ensureEdge(world, otherFrom, otherTo, { stance: edge.stance }, iso, cfg);
      writeDelta(world, other, proposed, cfg, at, clock, {
        markInteract: true,
        markChat: true,
        type: EVENT_TYPES.playerChat,
      });
      other.lastScoredChatAt = iso;
    }
  }
  return result;
}

export function playerChatGate(event, edge, cfg, at) {
  const text = typeof event.text === "string" ? event.text.trim() : "";
  const minChars = Number(cfg.playerChat.minInputChars) || 0;
  if (text.length < minChars) return { ok: false, reason: "short" };
  const cooldown = Number(cfg.playerChat.cooldownMs) || 0;
  if (cooldown > 0 && edge?.lastScoredChatAt) {
    const last = Date.parse(edge.lastScoredChatAt);
    if (Number.isFinite(last) && at.getTime() - last < cooldown) {
      return { ok: false, reason: "cooldown" };
    }
  }
  return { ok: true };
}


function applyOverhear(world, event, cfg, at, clock) {
  const edge = ensureEdge(world, event.from, event.to, {}, at.toISOString(), cfg);
  const gate = overhearGate(event, edge, cfg, at);
  if (!gate.ok) {
    return { applied: false, reason: gate.reason, familiarity: 0, closeness: 0, edge };
  }

  const proposed = deltasFor(event, cfg);
  const result = writeDelta(world, edge, proposed, cfg, at, clock, {
    markInteract: true,
    markChat: false,
    type: EVENT_TYPES.overhear,
  });
  edge.lastScoredOverhearAt = at.toISOString();
  return result;
}

export function overhearGate(event, edge, cfg, at) {
  const text = typeof event.text === "string" ? event.text.trim() : "";
  const minChars = Number(cfg.overhear?.minInputChars) || 0;
  if (text.length < minChars) return { ok: false, reason: "short" };
  const cooldown = Number(cfg.overhear?.cooldownMs) || 0;
  if (cooldown > 0 && edge?.lastScoredOverhearAt) {
    const last = Date.parse(edge.lastScoredOverhearAt);
    if (Number.isFinite(last) && at.getTime() - last < cooldown) {
      return { ok: false, reason: "cooldown" };
    }
  }
  return { ok: true };
}

function applyPlainDelta(world, event, cfg, at, clock, flags) {
  const proposed = deltasFor(event, cfg);
  if (!flags.decay && proposed.familiarity === 0 && proposed.closeness === 0) {
    return { applied: false, reason: "zero-delta", familiarity: 0, closeness: 0 };
  }
  const edge = ensureEdge(world, event.from, event.to, {}, at.toISOString(), cfg);
  return writeDelta(world, edge, proposed, cfg, at, clock, { ...flags, type: event.type });
}

function writeDelta(world, edge, proposed, cfg, at, clock, flags) {
  const dayKey = gameDayKey(clock, { dayStartHhmm: cfg.dayStartHhmm });
  rollLedger(edge, dayKey);

  let fam = Number(proposed.familiarity) || 0;
  let close = Number(proposed.closeness) || 0;
  if (fam > 0) fam = diminish(fam, edge.familiarity, cfg);
  if (close > 0) close = diminish(close, edge.closeness, cfg);

  const caps = eventConfig(flags.type, cfg) ?? {};
  fam = capDimension(edge, "familiarity", fam, caps.maxFamiliarityGainPerDay, caps.maxFamiliarityLossPerDay);
  close = capDimension(edge, "closeness", close, caps.maxClosenessGainPerDay, closenessLossCap(flags.type, caps, cfg));

  const iso = at.toISOString();
  if (flags.markInteract) edge.lastInteractAt = iso;
  if (flags.markChat) edge.lastChatAt = iso;

  if (almostZero(fam) && almostZero(close)) {
    return { applied: false, reason: flags.decay ? "zero-delta" : "capped", familiarity: 0, closeness: 0, edge };
  }

  edge.familiarity = clampScore(edge.familiarity + fam, cfg);
  edge.closeness = clampScore(edge.closeness + close, cfg);
  edge.updatedAt = iso;
  if (fam > 0) edge.familiarityGainToday += fam;
  if (close > 0) edge.closenessGainToday += close;
  if (close < 0) edge.closenessLossToday += -close;

  syncBondIfNeeded(world, edge, cfg);
  return { applied: true, reason: null, familiarity: fam, closeness: close, edge };
}

export function diminish(delta, current, cfg = defaultConfig) {
  if (!(delta > 0)) return delta;
  const power = Number(cfg.playerChat?.diminishPower);
  if (!Number.isFinite(power) || power <= 0) return delta;
  const max = Number(cfg.statMax) || 100;
  const ratio = Math.max(0, Math.min(1, 1 - current / max));
  return delta * ratio ** power;
}

function closenessLossCap(type, caps, cfg) {
  if (finiteNumber(caps.maxClosenessLossPerDay) != null) return caps.maxClosenessLossPerDay;
  if (type === "playerChat") return cfg.playerChat?.maxClosenessLossPerDay;
  return null;
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function capDimension(edge, dim, delta, maxGain, maxLoss) {
  const gainCap = finiteNumber(maxGain);
  const lossCap = finiteNumber(maxLoss);
  if (delta > 0 && gainCap != null) {
    const used = dim === "familiarity" ? edge.familiarityGainToday : edge.closenessGainToday;
    const remain = Math.max(0, gainCap - (Number(used) || 0));
    return Math.min(delta, remain);
  }
  if (delta < 0 && lossCap != null) {
    const used = dim === "familiarity" ? (edge.familiarityLossToday || 0) : (edge.closenessLossToday || 0);
    const remain = Math.max(0, lossCap - used);
    return -Math.min(-delta, remain);
  }
  return delta;
}

function rollLedger(edge, dayKey) {
  if (!dayKey || edge.ledgerDayKey === dayKey) return;
  edge.ledgerDayKey = dayKey;
  edge.familiarityGainToday = 0;
  edge.closenessGainToday = 0;
  edge.closenessLossToday = 0;
}

export function compositeBond(edge, cfg = defaultConfig) {
  if (!edge) return 0;
  const famW = Number(cfg.dimensions?.familiarity?.compositeWeight) || 0;
  const closeW = Number(cfg.dimensions?.closeness?.compositeWeight) || 0;
  return famW * Number(edge.familiarity || 0) + closeW * Number(edge.closeness || 0);
}

export function syncBond(character, edge, cfg = defaultConfig) {
  if (!character) return null;
  if (!character.stats || typeof character.stats !== "object") character.stats = {};
  character.stats.bond = Math.round(compositeBond(edge, cfg));
  return character.stats.bond;
}

export function syncBondIfNeeded(world, edge, cfg = defaultConfig) {
  const viewerId = cfg.viewerId ?? VIEWER_ID;
  if (!edge || edge.to !== viewerId || isViewerId(edge.from, cfg)) return null;
  const character = world?.characters?.[edge.from];
  if (!character) return null;
  return syncBond(character, edge, cfg);
}

export function syncAllBonds(world, cfg = defaultConfig) {
  const viewerId = cfg.viewerId ?? VIEWER_ID;
  for (const id of Object.keys(world?.characters ?? {})) {
    const edge = getEdge(world, id, viewerId);
    if (edge) syncBond(world.characters[id], edge, cfg);
  }
}

function almostZero(n) {
  return Math.abs(n) < 1e-9;
}
