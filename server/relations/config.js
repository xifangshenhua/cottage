/**
 * THE ONLY place for relations numbers and flags.
 * Override from settings/house.json under "relations".
 * Starting edges live in settings/relations.json (first create only).
 * Do not put API keys here.
 */

export const VIEWER_ID = "viewer";

export const config = {
  viewerId: VIEWER_ID,
  dayStartHhmm: "07:00",

  /**
   * Active numeric dimensions. Add a later dimension (e.g. trust) here
   * without changing the edge identity (from, to, stance, updatedAt).
   * Trust is reserved and not enabled in v1.
   */
  dimensions: {
    familiarity: {
      id: "familiarity",
      min: 0,
      max: 100,
      compositeWeight: 0.4,
      enabled: true,
    },
    closeness: {
      id: "closeness",
      min: 0,
      max: 100,
      compositeWeight: 0.6,
      enabled: true,
    },
  },

  statMin: 0,
  statMax: 100,

  /**
   * Missing character→viewer edges copy stats.bond into both dimensions
   * (scale 1 / 1) so the HUD composite stays the same:
   * 0.4 * bond + 0.6 * bond = bond.
   */
  migrateBond: {
    familiarityScale: 1,
    closenessScale: 1,
  },

  /** Fallback for a missing character–character edge with no seed. */
  defaultCharacterEdge: {
    familiarity: 14,
    closeness: 12,
    stance: "roommate",
  },

  playerChat: {
    minInputChars: 8,
    cooldownMs: 45_000,
    familiarityDelta: 0.8,
    closenessDelta: 1.2,
    diminishPower: 0.7,
    maxFamiliarityGainPerDay: 4,
    maxClosenessGainPerDay: 6,
    maxClosenessLossPerDay: 4,
    alsoUpdateViewerEdge: true,
  },

  sharedRoom: {
    minutesPerUnit: 10,
    familiarityDelta: 0.15,
    closenessDelta: 0,
    maxFamiliarityGainPerDay: 1.5,
    maxClosenessGainPerDay: 0.4,
    excludeRooms: ["bathroom"],
    excludeActions: ["sleep", "wash"],
  },

  mealTogether: {
    minutesPerUnit: 8,
    familiarityDelta: 0.2,
    closenessDelta: 0.35,
    maxFamiliarityGainPerDay: 0.8,
    maxClosenessGainPerDay: 1.2,
  },

  npcTalk: {
    minutesPerUnit: 6,
    familiarityDelta: 0.2,
    closenessDelta: 0.3,
    maxFamiliarityGainPerDay: 0.8,
    maxClosenessGainPerDay: 1.0,
  },

  overhear: {
    familiarityDelta: 0.2,
    closenessDelta: 0,
    minInputChars: 8,
    cooldownMs: 45_000,
    maxFamiliarityGainPerDay: 1.0,
    maxClosenessGainPerDay: 0,
    alsoUpdateViewerEdge: false,
  },

  /** Same numbers as overhear, without player-chat length/cooldown gates. */
  npcOverhear: {
    familiarityDelta: 0.2,
    closenessDelta: 0,
    maxFamiliarityGainPerDay: 1.0,
    maxClosenessGainPerDay: 0,
  },

  idleThink: {
    familiarityDelta: 0,
    closenessDelta: 0,
  },

  proactiveSpeech: {
    familiarityDelta: 0,
    closenessDelta: 0,
  },

  interject: {
    familiarityDelta: 0.3,
    closenessDelta: 0.4,
    maxFamiliarityGainPerDay: 0.6,
    maxClosenessGainPerDay: 0.8,
    alsoUpdateViewerEdge: false,
  },

  decay: {
    familiarityAbsenceDays: 10,
    familiarityPerDay: 0.15,
    closenessPlayerAbsenceDays: 3,
    closenessPlayerPerDay: 0.6,
    closenessNpcAbsenceDays: 6,
    closenessNpcPerDay: 0.25,
    maxDaysPerTick: 14,
  },

  packs: {
    idlePackChars: 60,
    chatPackChars: 160,
  },
};

export function mergeRelationsConfig(base = config, overlay = null) {
  const root = structuredClone(base);
  if (!isPlain(overlay)) return root;
  mergeKnown(root, overlay, base);
  return root;
}

function mergeKnown(target, overlay, schema) {
  for (const [key, value] of Object.entries(overlay)) {
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
