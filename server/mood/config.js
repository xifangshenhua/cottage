/**
 * THE ONLY place for discrete mood-event numbers and flags.
 * Override from settings/house.json under "mood".
 * Continuous hourly mood rates stay in server/life/config.js.
 * Do not put API keys here.
 */

export const config = {
  dayStartHhmm: "07:00",

  statMin: 0,
  statMax: 100,

  /** When current mood is at or above this, further gains are halved. */
  highMoodStart: 80,
  highMoodFactor: 0.5,
  /** When current mood is at or above this, further gains are quartered. */
  veryHighMoodStart: 90,
  veryHighMoodFactor: 0.25,

  playerChat: {
    delta: 2,
    maxGainPerDay: 10,
    minInputChars: 8,
    cooldownMs: 45_000,
  },

  npcTalk: {
    speakerDelta: 0.8,
    listenerDelta: 0.6,
    maxGainPerDay: 3,
  },

  proactiveSpeech: {
    delta: 1,
    maxGainPerDay: 3,
  },

  interject: {
    delta: 0.8,
    maxGainPerDay: 1.6,
  },
};

export function mergeMoodConfig(base = config, overlay = null) {
  const root = structuredClone(base);
  if (!isPlain(overlay)) return root;
  mergeKnown(root, overlay, base);
  const sec = Number(overlay.playerChat?.cooldownSec);
  if (Number.isFinite(sec)) {
    if (!isPlain(root.playerChat)) root.playerChat = { ...base.playerChat };
    root.playerChat.cooldownMs = sec * 1000;
  }
  return root;
}

function mergeKnown(target, overlay, schema) {
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "cooldownSec") continue;
    const template = Object.prototype.hasOwnProperty.call(schema, key) ? schema[key] : undefined;
    if (isPlain(value) && (isPlain(template) || template === undefined)) {
      if (!isPlain(target[key])) target[key] = isPlain(template) ? structuredClone(template) : {};
      const childSchema = isPlain(template) ? template : target[key];
      mergeKnown(target[key], value, childSchema);
    } else if (Array.isArray(template) || Array.isArray(value)) {
      if (Array.isArray(value)) target[key] = [...value];
    } else if (typeof template === "number" || (template === undefined && typeof value === "number")) {
      const n = Number(value);
      if (Number.isFinite(n)) target[key] = n;
    } else if (typeof template === "boolean") {
      if (typeof value === "boolean") target[key] = value;
    } else if (typeof template === "string") {
      if (typeof value === "string" && value.trim()) target[key] = value.trim();
    }
  }
  return target;
}

function isPlain(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
