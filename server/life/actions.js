import { isWrappedWindow } from "../clock.js";
import { bedroomOf } from "../rooms.js";
import { config } from "./config.js";
import { ratesFor } from "./needs.js";

function lifeOf(ctx) {
  return ctx?.cfg ?? config;
}

export function isNight(clock, cfg = config) {
  return isWrappedWindow(clock?.hhmm, cfg.nightStartHhmm, cfg.dayStartHhmm);
}

export function isDaytime(clock, cfg = config) {
  return !isNight(clock, cfg);
}

function elapsedMinutes(character, nowMs) {
  const started = Date.parse(character?.actionStartedAt || "");
  if (!Number.isFinite(started) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, (nowMs - started) / 60_000);
}

export const actions = {
  sleep: {
    id: "sleep",
    requiredRoom: (character) => bedroomOf(character.id),
    occupancy: "bedroom",
    durationMin: null,
    rates: () => ratesFor("sleep"),
    canStart({ character, clock, cfg }) {
      const life = lifeOf({ cfg });
      if (character.action === "sleep") return true;
      return isNight(clock, life) || Number(character.stats?.energy) <= life.sleepStartEnergy;
    },
    shouldComplete({ character, clock, cfg }) {
      const life = lifeOf({ cfg });
      if (isNight(clock, life)) return false;
      const energy = Number(character.stats?.energy);
      return energy >= life.sleepWakeEnergy;
    },
  },
  eat: {
    id: "eat",
    requiredRoom: "dining",
    occupancy: "shared",
    durationMin: config.eatDurationMin,
    rates: () => ratesFor("eat"),
    canStart({ character, cfg }) {
      const life = lifeOf({ cfg });
      if (character.action === "eat") return true;
      return Number(character.stats?.hunger) <= life.eatStartHunger;
    },
    shouldComplete({ character, elapsedMin, cfg }) {
      const life = lifeOf({ cfg });
      if (Number(character.stats?.hunger) >= life.eatStopHunger) return true;
      return elapsedMin >= life.eatDurationMin;
    },
  },
  wash: {
    id: "wash",
    requiredRoom: "bathroom",
    occupancy: "exclusive",
    durationMin: config.washDurationMin,
    rates: () => ratesFor("wash"),
    canStart({ character, cfg }) {
      const life = lifeOf({ cfg });
      if (character.action === "wash") return true;
      return Number(character.stats?.clean) <= life.washStartClean;
    },
    shouldComplete({ character, elapsedMin, cfg }) {
      const life = lifeOf({ cfg });
      if (Number(character.stats?.clean) >= life.washStopClean) return true;
      return elapsedMin >= life.washDurationMin;
    },
  },
  sit: {
    id: "sit",
    requiredRoom: "living",
    occupancy: "shared",
    durationMin: null,
    rates: () => ratesFor("sit"),
    canStart() {
      return true;
    },
    shouldComplete() {
      return false;
    },
  },
  /** Reserved for later. Existing seed lines expire; the loop does not start new talk. */
  talk: {
    id: "talk",
    requiredRoom: null,
    occupancy: "shared",
    durationMin: config.talkExpireMin,
    rates: () => ratesFor("talk"),
    canStart() {
      return false;
    },
    shouldComplete({ elapsedMin, cfg }) {
      const life = lifeOf({ cfg });
      return elapsedMin >= life.talkExpireMin;
    },
  },
};

export function getAction(actionId) {
  return actions[actionId] ?? null;
}

export function resolveRoom(actionDef, character) {
  const required = actionDef?.requiredRoom;
  if (typeof required === "function") return required(character);
  return required ?? null;
}

/**
 * Complete an action whose duration or end condition has elapsed.
 * Sleep lasts until its wake condition. Does not pick the next action.
 * Pure with respect to other characters; may instruct the caller to clear a talk line.
 */
export function advance(world, character, clock, nowMs, cfg = config) {
  const def = getAction(character?.action);
  if (!def) return { completed: true };
  const elapsedMin = elapsedMinutes(character, nowMs);
  const completed = !!def.shouldComplete({ world, character, clock, elapsedMin, cfg });
  return {
    completed,
    clearLine: completed && def.id === "talk",
  };
}
