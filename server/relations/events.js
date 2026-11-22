/**
 * Event types → proposed deltas, plus life-step occupancy accumulation.
 * Scoring filters and caps live in apply.js.
 */

import { VIEWER_ID, config as defaultConfig } from "./config.js";

export const EVENT_TYPES = {
  playerChat: "playerChat",
  sharedRoom: "sharedRoom",
  mealTogether: "mealTogether",
  npcTalk: "npcTalk",
  overhear: "overhear",
  npcOverhear: "npcOverhear",
  idleThink: "idleThink",
  proactiveSpeech: "proactiveSpeech",
  interject: "interject",
  decay: "decay",
};

export function deltasFor(event, cfg = defaultConfig) {
  const type = event?.type;
  if (type === EVENT_TYPES.playerChat) {
    return {
      familiarity: cfg.playerChat.familiarityDelta,
      closeness: cfg.playerChat.closenessDelta,
    };
  }
  if (type === EVENT_TYPES.sharedRoom) {
    return {
      familiarity: cfg.sharedRoom.familiarityDelta,
      closeness: cfg.sharedRoom.closenessDelta,
    };
  }
  if (type === EVENT_TYPES.mealTogether) {
    return {
      familiarity: cfg.mealTogether.familiarityDelta,
      closeness: cfg.mealTogether.closenessDelta,
    };
  }
  if (type === EVENT_TYPES.npcTalk) {
    return {
      familiarity: cfg.npcTalk.familiarityDelta,
      closeness: cfg.npcTalk.closenessDelta,
    };
  }
  if (type === EVENT_TYPES.overhear) {
    return {
      familiarity: cfg.overhear.familiarityDelta,
      closeness: cfg.overhear.closenessDelta,
    };
  }
  if (type === EVENT_TYPES.npcOverhear) {
    return {
      familiarity: cfg.npcOverhear.familiarityDelta,
      closeness: cfg.npcOverhear.closenessDelta,
    };
  }
  if (type === EVENT_TYPES.idleThink) {
    return {
      familiarity: cfg.idleThink.familiarityDelta,
      closeness: cfg.idleThink.closenessDelta,
    };
  }
  if (type === EVENT_TYPES.proactiveSpeech) {
    return {
      familiarity: cfg.proactiveSpeech.familiarityDelta,
      closeness: cfg.proactiveSpeech.closenessDelta,
    };
  }
  if (type === EVENT_TYPES.interject) {
    return {
      familiarity: cfg.interject.familiarityDelta,
      closeness: cfg.interject.closenessDelta,
    };
  }
  if (type === EVENT_TYPES.decay) {
    return {
      familiarity: Number(event.familiarity) || 0,
      closeness: Number(event.closeness) || 0,
    };
  }
  return { familiarity: 0, closeness: 0 };
}

export function eventConfig(type, cfg = defaultConfig) {
  if (type === EVENT_TYPES.playerChat) return cfg.playerChat;
  if (type === EVENT_TYPES.overhear) return cfg.overhear;
  if (type === EVENT_TYPES.npcOverhear) return cfg.npcOverhear;
  if (type === EVENT_TYPES.sharedRoom) return cfg.sharedRoom;
  if (type === EVENT_TYPES.mealTogether) return cfg.mealTogether;
  if (type === EVENT_TYPES.npcTalk) return cfg.npcTalk;
  if (type === EVENT_TYPES.idleThink) return cfg.idleThink;
  if (type === EVENT_TYPES.proactiveSpeech) return cfg.proactiveSpeech;
  if (type === EVENT_TYPES.interject) return cfg.interject;
  if (type === EVENT_TYPES.decay) return cfg.decay;
  return null;
}

/**
 * Accumulate co-presence during a life step. Bathroom conflicts are ignored
 * (bathroom is excluded). Sleep / wash do not count as shared-room time.
 */
export function observeLifeStep(world, dtMs, _at, cfg = defaultConfig) {
  if (!world || !Number.isFinite(dtMs) || dtMs <= 0) return world;
  const ids = Object.keys(world.characters ?? {}).sort();
  if (!world.relationsMeta || typeof world.relationsMeta !== "object") {
    world.relationsMeta = { lastDecayDayKey: null, accum: {} };
  }
  if (!world.relationsMeta.accum || typeof world.relationsMeta.accum !== "object") {
    world.relationsMeta.accum = {};
  }
  const accum = world.relationsMeta.accum;
  const excludeRooms = new Set(cfg.sharedRoom?.excludeRooms ?? ["bathroom"]);
  const excludeActions = new Set(cfg.sharedRoom?.excludeActions ?? ["sleep", "wash"]);

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = world.characters[ids[i]];
      const b = world.characters[ids[j]];
      if (!a || !b || a.room !== b.room) continue;
      if (excludeRooms.has(a.room)) continue;

      const aBusy = excludeActions.has(a.action);
      const bBusy = excludeActions.has(b.action);
      if (!aBusy && !bBusy) {
        addAccum(accum, pairKey(a.id, b.id, EVENT_TYPES.sharedRoom), dtMs);
      }
      if (a.action === "eat" && b.action === "eat") {
        addAccum(accum, pairKey(a.id, b.id, EVENT_TYPES.mealTogether), dtMs);
      }
      if (isNpcTalk(a, b)) {
        addAccum(accum, pairKey(a.id, b.id, EVENT_TYPES.npcTalk), dtMs);
      }
    }
  }
  return world;
}

export function drainHouseholdEvents(world, cfg = defaultConfig, now = new Date()) {
  const accum = world?.relationsMeta?.accum;
  if (!accum || typeof accum !== "object") return [];
  const events = [];
  for (const [key, ms] of Object.entries(accum)) {
    const parsed = parsePairKey(key);
    if (!parsed) continue;
    const unitMin = minutesPerUnit(parsed.type, cfg);
    const unitMs = unitMin * 60_000;
    const held = Number(ms) || 0;
    if (!Number.isFinite(unitMs) || unitMs <= 0) {
      accum[key] = 0;
      continue;
    }
    const units = Math.floor(held / unitMs);
    accum[key] = held - units * unitMs;
    for (let i = 0; i < units; i += 1) {
      events.push({ type: parsed.type, from: parsed.a, to: parsed.b, now });
      events.push({ type: parsed.type, from: parsed.b, to: parsed.a, now });
    }
  }
  return events;
}

export function pairKey(a, b, type) {
  return a < b ? `${a}|${b}|${type}` : `${b}|${a}|${type}`;
}

function parsePairKey(key) {
  const parts = String(key).split("|");
  if (parts.length !== 3) return null;
  return { a: parts[0], b: parts[1], type: parts[2] };
}

function minutesPerUnit(type, cfg) {
  if (type === EVENT_TYPES.sharedRoom) return Number(cfg.sharedRoom.minutesPerUnit) || 10;
  if (type === EVENT_TYPES.mealTogether) return Number(cfg.mealTogether.minutesPerUnit) || 8;
  if (type === EVENT_TYPES.npcTalk) return Number(cfg.npcTalk.minutesPerUnit) || 6;
  return 0;
}

function addAccum(accum, key, dtMs) {
  accum[key] = (Number(accum[key]) || 0) + dtMs;
}

function isNpcTalk(a, b) {
  const talking = (c) => c.action === "talk";
  const receptive = (c) => c.action === "talk" || c.action === "sit";
  return (talking(a) && receptive(b)) || (talking(b) && receptive(a));
}

export { VIEWER_ID };
