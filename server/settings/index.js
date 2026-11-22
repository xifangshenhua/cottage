/**
 * Load, validate, merge, and resolve house + character settings.
 * Code defaults remain in think/speech/life/memory/chat/relations/mood/presentation/voice config modules.
 * This module never reads, stores, or logs API keys.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as thinkDefaults } from "../think/config.js";
import { config as speechDefaults } from "../think/speech/config.js";
import { config as lifeDefaults } from "../life/config.js";
import { config as memoryDefaults, mergeMemoryConfig } from "../memory/config.js";
import { config as chatDefaults, mergeChatAddressing } from "../chat/config.js";
import { config as interjectDefaults, mergeInterjectConfig } from "../chat/interject/config.js";
import { config as relationsDefaults, mergeRelationsConfig } from "../relations/config.js";
import { config as moodDefaults, mergeMoodConfig } from "../mood/config.js";
import { config as presentationDefaults, mergePresentation } from "../presentation/config.js";
import {
  config as voiceDefaults,
  characterVoiceDefaults,
  clampSpeed,
  clampVolume,
} from "../voice/config.js";
import { DEFAULT_SEED_EDGES, normalizeSeedList } from "../relations/schema.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STAT_KEYS = ["energy", "hunger", "clean", "mood", "bond"];
export const SECRET_KEY = /^(api[_-]?key|key|secret|token|authorization|password|passwd|access[_-]?token|client[_-]?secret)$/i;

const DEFAULT_MODELS = {
  minimax: "MiniMax-M3.1-Flash",
  deepseek: "deepseek-chat",
};

let cached = null;
let cachedRoot = null;

export function defaultSettingsRoot() {
  return PROJECT_ROOT;
}

export function resetSettingsCache() {
  cached = null;
  cachedRoot = null;
}

/**
 * Load settings from `<root>/settings/house.json` and
 * `<root>/settings/characters/*.json`.
 */
export function loadSettings(opts = {}) {
  const root = opts.root ?? PROJECT_ROOT;
  if (cached && cachedRoot === root && !opts.reload) return cached;
  const house = sanitize(readJson(path.join(root, "settings", "house.json"), {}));
  const characters = {};
  const dir = path.join(root, "settings", "characters");
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const idFromFile = name.replace(/\.json$/i, "");
      const raw = sanitize(readJson(path.join(dir, name), {}));
      const character = normalizeCharacter(raw, idFromFile);
      if (character) characters[character.identity.id] = character;
    }
  }
  const identityCardChars = positiveInt(
    house.identityCardChars,
    memoryDefaults.identityCardChars,
  );
  const relationSeeds = normalizeSeedList(
    sanitize(readJson(path.join(root, "settings", "relations.json"), { edges: DEFAULT_SEED_EDGES })),
  );
  const presentation = sanitize(readJson(path.join(root, "settings", "presentation.json"), {}));
  const settings = { root, house, characters, identityCardChars, relationSeeds, presentation };
  if (!opts.root || root === PROJECT_ROOT) {
    cached = settings;
    cachedRoot = root;
  }
  return settings;
}

export function getSettings() {
  return loadSettings();
}

/** Merge code defaults ← house overlay ← character overlay for think cadence. */
export function resolveThink(characterId, settings = null, base = thinkDefaults) {
  const house = settings?.house?.think ?? settings?.think ?? {};
  const character = settings?.characters?.[characterId]?.think ?? {};
  const merged = { ...base };
  applyThinkOverlay(merged, house);
  applyThinkOverlay(merged, character);
  return merged;
}

/** Merge speech defaults ← house ← character. */
export function resolveSpeech(characterId, settings = null, base = speechDefaults) {
  const house = settings?.house?.speech ?? settings?.speech ?? {};
  const character = settings?.characters?.[characterId]?.speech ?? {};
  const merged = {
    ...base,
    canSpeakProactively: true,
    npcTalk: cloneNpcTalk(base.npcTalk),
  };
  applySpeechOverlay(merged, house);
  applySpeechOverlay(merged, character);
  const lifeDay = settings?.house?.life?.dayStartHhmm ?? settings?.life?.dayStartHhmm;
  if (!house?.dayStartHhmm && !character?.dayStartHhmm && typeof lifeDay === "string" && lifeDay.trim()) {
    merged.dayStartHhmm = lifeDay.trim();
  }
  return merged;
}

/**
 * Life overlays (hours / thresholds / durations).
 * House.life wins over a day-start copied from speech or relations when life omits it.
 * The life loop reads this via tickWorld({ settings }).
 */
export function resolveLife(characterId, settings = null, base = lifeDefaults) {
  const houseLife = settings?.house?.life ?? settings?.life ?? {};
  const speech = settings?.house?.speech ?? settings?.speech ?? {};
  const relations = settings?.house?.relations ?? settings?.relations ?? {};
  const character = settings?.characters?.[characterId]?.life ?? {};
  const inherited = {};
  if (typeof relations.dayStartHhmm === "string" && relations.dayStartHhmm.trim()) {
    inherited.dayStartHhmm = relations.dayStartHhmm.trim();
  }
  if (typeof speech.dayStartHhmm === "string" && speech.dayStartHhmm.trim()) {
    inherited.dayStartHhmm = speech.dayStartHhmm.trim();
  }
  const merged = coerceLife({
    ...base,
    ...inherited,
    ...pickKnown(houseLife, LIFE_KEYS),
    ...pickKnown(character, LIFE_KEYS),
  });
  merged.rates = mergeLifeRates(base.rates, houseLife.rates, character.rates);
  return merged;
}

/** Memory numbers: code defaults ← house.memory. Nested compress / model merge deeply. */
export function resolveMemory(settings = null, base = memoryDefaults) {
  const overlay = settings?.house?.memory ?? settings?.memory ?? {};
  const known = stripUnknownNumbers(overlay, { ...base, model: base.model ?? {} });
  if (overlay && typeof overlay.model === "object") known.model = overlay.model;
  if (base === memoryDefaults) return mergeMemoryConfig(known);
  return mergeMemoryConfig(known, base);
}

/** Relations numbers: code defaults ← house.relations. Seeds stay in settings/relations.json. */
export function resolveRelations(settings = null, base = relationsDefaults) {
  const overlay = settings?.house?.relations ?? settings?.relations ?? {};
  return mergeRelationsConfig(base, overlay);
}

/** Discrete mood-event numbers: code defaults ← house.mood. Inherits day start from life when omitted. */
export function resolveMood(settings = null, base = moodDefaults) {
  const overlay = settings?.house?.mood ?? settings?.mood ?? {};
  const merged = mergeMoodConfig(base, overlay);
  if (overlay && typeof overlay.dayStartHhmm === "string" && overlay.dayStartHhmm.trim()) {
    return merged;
  }
  const lifeDay = settings?.house?.life?.dayStartHhmm ?? settings?.life?.dayStartHhmm;
  const speechDay = settings?.house?.speech?.dayStartHhmm ?? settings?.speech?.dayStartHhmm;
  const relationsDay = settings?.house?.relations?.dayStartHhmm ?? settings?.relations?.dayStartHhmm;
  const inherited = [lifeDay, speechDay, relationsDay].find((value) => typeof value === "string" && value.trim());
  if (inherited) merged.dayStartHhmm = inherited.trim();
  return merged;
}

/**
 * Presentation: code defaults ← settings/presentation.json ← house.presentation.
 * Character appearance is not merged here; read it from the character file.
 */
export function resolvePresentation(settings = null, base = presentationDefaults) {
  const file = settings?.presentation && isPlain(settings.presentation) ? settings.presentation : {};
  const house = settings?.house?.presentation && isPlain(settings.house.presentation)
    ? settings.house.presentation
    : {};
  return mergePresentation(base, file, house);
}

/** Character appearance only; missing appearance is a valid empty object (use fallback art). */
export function resolveAppearance(characterId, settings = null) {
  const raw = settings?.characters?.[characterId]?.appearance;
  return isPlain(raw) ? { ...raw, preferredAnchors: isPlain(raw.preferredAnchors) ? { ...raw.preferredAnchors } : {} } : {};
}

/**
 * Voice (TTS/ASR) settings: code defaults ← house.voice ← character.voice.
 * Per-character timbre/speed/enabled start from characterVoiceDefaults.
 * Final `enabled` is house master AND the character switch (default true).
 * Mic / autoSend / masterVolume stay house-level.
 */
export function resolveVoice(characterId, settings = null, base = voiceDefaults) {
  const house = settings?.house?.voice ?? settings?.voice ?? {};
  const charId = typeof characterId === "string" && characterId.trim() ? characterId.trim() : null;
  const character = charId ? (settings?.characters?.[charId]?.voice ?? {}) : {};
  const charDefaults = charId ? characterVoiceDefaults(charId) : { enabled: true, voiceId: base.voiceId, speed: base.speed };

  const merged = {
    ...base,
    voiceId: charDefaults.voiceId ?? base.voiceId,
    speed: charDefaults.speed ?? base.speed,
  };
  applyVoiceOverlay(merged, house);
  const houseEnabled = typeof house.enabled === "boolean" ? house.enabled : base.enabled !== false;

  if (charId) {
    applyVoiceOverlay(merged, character);
    const custom = typeof character.customVoiceId === "string" ? character.customVoiceId.trim() : "";
    if (custom) merged.voiceId = custom;
    const characterEnabled = typeof character.enabled === "boolean"
      ? character.enabled
      : charDefaults.enabled !== false;
    merged.houseEnabled = houseEnabled;
    merged.characterEnabled = characterEnabled;
    merged.enabled = houseEnabled && characterEnabled;
  } else {
    merged.houseEnabled = houseEnabled;
    merged.characterEnabled = true;
    merged.enabled = houseEnabled;
  }

  merged.masterVolume = clampVolume(merged.masterVolume, base.masterVolume);
  merged.speed = clampSpeed(merged.speed, charDefaults.speed ?? 1);
  if (merged.vol == null || !Number.isFinite(Number(merged.vol))) merged.vol = 1;
  if (merged.pitch == null || !Number.isFinite(Number(merged.pitch))) merged.pitch = 0;
  return merged;
}


/** House-only interjection policy: code defaults ← house.chat.interject. Inherits day start. */
export function resolveInterject(settings = null, base = interjectDefaults) {
  const houseChat = settings?.house?.chat ?? settings?.chat ?? {};
  const overlay = isPlain(houseChat.interject) ? houseChat.interject : {};
  const merged = mergeInterjectConfig(base, overlay);
  if (overlay && typeof overlay.dayStartHhmm === "string" && overlay.dayStartHhmm.trim()) {
    return merged;
  }
  const lifeDay = settings?.house?.life?.dayStartHhmm ?? settings?.life?.dayStartHhmm;
  const speechDay = settings?.house?.speech?.dayStartHhmm ?? settings?.speech?.dayStartHhmm;
  const relationsDay = settings?.house?.relations?.dayStartHhmm ?? settings?.relations?.dayStartHhmm;
  const moodDay = settings?.house?.mood?.dayStartHhmm ?? settings?.mood?.dayStartHhmm;
  const inherited = [lifeDay, speechDay, relationsDay, moodDay].find((value) => typeof value === "string" && value.trim());
  if (inherited) merged.dayStartHhmm = inherited.trim();
  return merged;
}

/** Merge chat defaults ← house.chat ← character.chat. Addressing stays house-only. */
export function resolveChat(characterId, settings = null, base = chatDefaults) {
  const house = settings?.house?.chat ?? settings?.chat ?? {};
  const character = settings?.characters?.[characterId]?.chat ?? {};
  const merged = {
    ...base,
    allowedTones: [...(base.allowedTones ?? [])],
    allowedLengths: [...(base.allowedLengths ?? [])],
  };
  applyChatOverlay(merged, house);
  applyChatOverlay(merged, character);
  merged.addressing = resolveChatAddressing(settings, base);
  return merged;
}

/**
 * Volume range / hearing flags come from code defaults ← house.chat.addressing.
 * Character settings cannot change house acoustics (who can hear).
 */
export function resolveChatAddressing(settings = null, base = chatDefaults) {
  const house = settings?.house?.chat ?? settings?.chat ?? {};
  const overlay = isPlain(house.addressing) ? house.addressing : {};
  const defaults = base?.addressing ?? chatDefaults.addressing;
  return mergeChatAddressing(defaults, overlay);
}

/**
 * Resolve the provider + model name for a character.
 * character.model → house.model → env THINK_PROVIDER / MINIMAX_MODEL → dummy.
 * Never returns or reads an API key.
 */
export function resolveModel(characterId, settings = null, env = process.env) {
  const charModel = sanitizeModel(settings?.characters?.[characterId]?.model);
  if (charModel) return charModel;
  const houseModel = sanitizeModel(settings?.house?.model ?? settings?.model);
  if (houseModel) return houseModel;
  return modelFromEnv(env);
}

/** Short persona blurb for the think prompt. Truncated to identityCardChars (or an explicit cap). */
export function identityCard(characterId, settings = null, cap = null) {
  const source = settings ?? loadSettings();
  const character = source?.characters?.[characterId];
  const limit = positiveInt(cap, source?.identityCardChars ?? memoryDefaults.identityCardChars);
  if (!character) return "";
  const identity = character.identity ?? {};
  const persona = character.persona ?? {};
  const parts = [];
  if (identity.name) parts.push(`${identity.name}。`);
  if (identity.addressPlayerAs) parts.push(`称呼你为「${identity.addressPlayerAs}」。`);
  const traits = asList(persona.traits);
  if (traits) parts.push(`性格：${traits}。`);
  if (persona.speechStyle) parts.push(`说话：${persona.speechStyle}。`);
  if (persona.background) parts.push(`背景：${persona.background}。`);
  const likes = asList(persona.likes);
  if (likes) parts.push(`喜欢：${likes}。`);
  const dislikes = asList(persona.dislikes);
  if (dislikes) parts.push(`不喜欢：${dislikes}。`);
  return truncateChars(parts.join(""), limit);
}

/**
 * Copy display name (and bedroom) from settings into the live world.
 * Does not touch stats, positions, actions, or lines.
 * Characters present only in settings are seeded; existing ones are not reset.
 */
export function syncWorldFromSettings(world, settings = null) {
  const source = settings ?? loadSettings();
  if (!world || !source?.characters) return world;
  if (!world.characters || typeof world.characters !== "object") world.characters = {};
  const clockIso = world.clock?.iso || world.lastTickAt || new Date().toISOString();

  for (const [id, spec] of Object.entries(source.characters)) {
    const identity = spec.identity ?? {};
    const existing = world.characters[id];
    if (!existing) {
      world.characters[id] = seedCharacter(id, spec, clockIso);
      continue;
    }
    if (identity.name) existing.name = identity.name;
    if (identity.bedroom) existing.bedroom = identity.bedroom;
  }
  return world;
}

export function startingStatsFor(spec, fallback = null) {
  const stats = { energy: 50, hunger: 50, clean: 50, mood: 50, bond: 15, ...(fallback ?? {}) };
  const raw = spec?.startingStats ?? {};
  for (const key of STAT_KEYS) {
    const n = Number(raw[key]);
    if (Number.isFinite(n)) stats[key] = n;
  }
  return stats;
}

function seedCharacter(id, spec, clockIso) {
  const identity = spec?.identity ?? {};
  const bedroom = identity.bedroom || id;
  return {
    id,
    name: identity.name || id,
    bedroom,
    room: "living",
    action: "sit",
    line: null,
    stats: startingStatsFor(spec),
    actionStartedAt: clockIso,
    enteredRoomAt: clockIso,
    lastRoomChangeAt: null,
    lastThinkAt: null,
    lastProactiveAt: null,
    proactiveCountToday: 0,
    proactiveDayKey: null,
    lineTo: null,
    lastNpcTalkAt: null,
    npcTalkCountToday: 0,
    npcTalkDayKey: null,
  };
}

function normalizeCharacter(raw, idFromFile) {
  if (!raw || typeof raw !== "object") return null;
  const identityIn = raw.identity && typeof raw.identity === "object" ? raw.identity : {};
  const id = String(identityIn.id || idFromFile || "").trim();
  if (!id) return null;
  return {
    identity: {
      id,
      name: typeof identityIn.name === "string" && identityIn.name.trim() ? identityIn.name.trim() : id,
      bedroom: typeof identityIn.bedroom === "string" && identityIn.bedroom.trim() ? identityIn.bedroom.trim() : id,
      addressPlayerAs:
        typeof identityIn.addressPlayerAs === "string" && identityIn.addressPlayerAs.trim()
          ? identityIn.addressPlayerAs.trim()
          : "你",
    },
    persona: normalizePersona(raw.persona),
    think: isPlain(raw.think) ? raw.think : {},
    speech: isPlain(raw.speech) ? raw.speech : {},
    life: isPlain(raw.life) ? raw.life : {},
    chat: isPlain(raw.chat) ? raw.chat : {},
    voice: isPlain(raw.voice) ? raw.voice : {},
    startingStats: isPlain(raw.startingStats) ? raw.startingStats : {},
    appearance: isPlain(raw.appearance) ? raw.appearance : {},
    model: sanitizeModel(raw.model),
  };
}

function normalizePersona(raw) {
  const src = isPlain(raw) ? raw : {};
  return {
    traits: asArray(src.traits),
    speechStyle: asString(src.speechStyle),
    background: asString(src.background),
    likes: asArray(src.likes),
    dislikes: asArray(src.dislikes),
  };
}

function applyVoiceOverlay(target, overlay) {
  if (!isPlain(overlay)) return;
  for (const key of ["enabled", "micEnabled", "autoSend"]) {
    if (typeof overlay[key] === "boolean") target[key] = overlay[key];
  }
  if (overlay.masterVolume != null && Number.isFinite(Number(overlay.masterVolume))) {
    target.masterVolume = Number(overlay.masterVolume);
  }
  for (const key of ["model", "asrModel", "language", "format", "voiceId"]) {
    if (typeof overlay[key] === "string" && overlay[key].trim()) target[key] = overlay[key].trim();
  }
  for (const key of [
    "timeoutMs", "asrTimeoutMs", "retry", "synthConcurrency", "maxRecordSec",
    "maxTextChars", "cacheMaxFiles", "cacheMaxBytes", "sampleRate", "channel",
    "vol", "pitch", "speed",
  ]) {
    if (overlay[key] != null && Number.isFinite(Number(overlay[key]))) {
      target[key] = Number(overlay[key]);
    }
  }
  if (overlay.cacheMaxMb != null && Number.isFinite(Number(overlay.cacheMaxMb))) {
    target.cacheMaxBytes = Math.max(0, Number(overlay.cacheMaxMb) * 1024 * 1024);
  }
  const custom = typeof overlay.customVoiceId === "string" ? overlay.customVoiceId.trim() : "";
  if (custom) target.voiceId = custom;
}

function applyThinkOverlay(target, overlay) {
  if (!isPlain(overlay)) return;
  if (overlay.intervalMs != null && Number.isFinite(Number(overlay.intervalMs))) {
    target.intervalMs = Number(overlay.intervalMs);
  } else if (overlay.intervalMin != null && Number.isFinite(Number(overlay.intervalMin))) {
    target.intervalMs = Number(overlay.intervalMin) * 60_000;
  }
  for (const key of ["timeoutMs", "staggerMs", "maxLineChars", "maxReasonChars", "maxPromptChars"]) {
    if (overlay[key] != null && Number.isFinite(Number(overlay[key]))) {
      target[key] = Number(overlay[key]);
    }
  }
}

function applySpeechOverlay(target, overlay) {
  if (!isPlain(overlay)) return;
  if (typeof overlay.canSpeakProactively === "boolean") {
    target.canSpeakProactively = overlay.canSpeakProactively;
  }
  if (overlay.maxPerGameDay != null && Number.isFinite(Number(overlay.maxPerGameDay))) {
    target.maxPerGameDay = Number(overlay.maxPerGameDay);
  }
  if (overlay.minGapMs != null && Number.isFinite(Number(overlay.minGapMs))) {
    target.minGapMs = Number(overlay.minGapMs);
  } else if (overlay.minGapMin != null && Number.isFinite(Number(overlay.minGapMin))) {
    target.minGapMs = Number(overlay.minGapMin) * 60_000;
  }
  for (const key of ["quietStartHhmm", "quietEndHhmm", "dayStartHhmm", "livingRoom"]) {
    if (typeof overlay[key] === "string" && overlay[key].trim()) target[key] = overlay[key].trim();
  }
  if (overlay.justEnteredMin != null && Number.isFinite(Number(overlay.justEnteredMin))) {
    target.justEnteredMin = Number(overlay.justEnteredMin);
  }
  if (overlay.viewerAwayTimeoutMin != null && Number.isFinite(Number(overlay.viewerAwayTimeoutMin))) {
    target.viewerAwayTimeoutMin = Number(overlay.viewerAwayTimeoutMin);
  }
  if (isPlain(overlay.npcTalk)) {
    target.npcTalk = mergeNpcTalk(target.npcTalk, overlay.npcTalk);
  }
}

function cloneNpcTalk(raw) {
  const src = isPlain(raw) ? raw : {};
  return {
    ...src,
    forbiddenRooms: Array.isArray(src.forbiddenRooms) ? [...src.forbiddenRooms] : [],
  };
}

function mergeNpcTalk(base, overlay) {
  const target = cloneNpcTalk(base);
  if (!isPlain(overlay)) return target;
  for (const key of [
    "enabled",
    "requiresViewer",
    "canTalkWhenSleeping",
    "canTalkWhenWashing",
    "canTalkWhenEating",
    "canTalkInQuietHours",
    "lineVisibleOnlySameRoom",
    "setActionToTalkWhenSitting",
  ]) {
    if (typeof overlay[key] === "boolean") target[key] = overlay[key];
  }
  for (const key of ["maxPerGameDay", "minGapMin", "houseMaxPerHour", "mouthCooldownMin"]) {
    if (overlay[key] != null && Number.isFinite(Number(overlay[key]))) {
      target[key] = Number(overlay[key]);
    }
  }
  if (Array.isArray(overlay.forbiddenRooms)) {
    target.forbiddenRooms = overlay.forbiddenRooms.map((v) => String(v).trim()).filter(Boolean);
  }
  return target;
}

function applyChatOverlay(target, overlay) {
  if (!isPlain(overlay)) return;
  for (const key of [
    "maxInputChars",
    "maxReplyChars",
    "timeoutMs",
    "maxPromptChars",
    "styleInstructionsChars",
    "identityCardChars",
    "factMaxChars",
    "topicMaxChars",
  ]) {
    if (overlay[key] != null && Number.isFinite(Number(overlay[key]))) {
      target[key] = Number(overlay[key]);
    }
  }
  for (const key of ["mustShareRoom", "canTalkWhenSleeping", "canTalkWhenWashing", "countAgainstProactiveCap"]) {
    if (typeof overlay[key] === "boolean") target[key] = overlay[key];
  }
  if (typeof overlay.defaultTone === "string" && overlay.defaultTone.trim()) {
    target.defaultTone = overlay.defaultTone.trim();
  }
  if (typeof overlay.defaultLength === "string" && overlay.defaultLength.trim()) {
    target.defaultLength = overlay.defaultLength.trim();
  }
  if (Array.isArray(overlay.allowedTones)) {
    const list = overlay.allowedTones.map((v) => String(v).trim()).filter(Boolean);
    if (list.length) target.allowedTones = list;
  }
  if (Array.isArray(overlay.allowedLengths)) {
    const list = overlay.allowedLengths.map((v) => String(v).trim()).filter(Boolean);
    if (list.length) target.allowedLengths = list;
  }
  if (typeof overlay.dayStartHhmm === "string" && overlay.dayStartHhmm.trim()) {
    target.dayStartHhmm = overlay.dayStartHhmm.trim();
  }
}

const LIFE_KEYS = [
  "dayStartHhmm",
  "nightStartHhmm",
  "eatStartHunger",
  "eatStopHunger",
  "washStartClean",
  "washStopClean",
  "sleepStartEnergy",
  "sleepCriticalEnergy",
  "sleepWakeEnergy",
  "eatDurationMin",
  "washDurationMin",
  "talkExpireMin",
  "moodLowNeedThreshold",
  "moodLowNeedPenaltyPerHour",
];

const LIFE_NUMBER_KEYS = new Set([
  "eatStartHunger",
  "eatStopHunger",
  "washStartClean",
  "washStopClean",
  "sleepStartEnergy",
  "sleepCriticalEnergy",
  "sleepWakeEnergy",
  "eatDurationMin",
  "washDurationMin",
  "talkExpireMin",
  "moodLowNeedThreshold",
  "moodLowNeedPenaltyPerHour",
]);

function coerceLife(cfg) {
  const out = { ...cfg, rates: cfg.rates ? { ...cfg.rates } : cfg.rates };
  for (const key of LIFE_NUMBER_KEYS) {
    if (out[key] == null) continue;
    const n = Number(out[key]);
    if (Number.isFinite(n)) out[key] = n;
  }
  for (const key of ["dayStartHhmm", "nightStartHhmm"]) {
    if (typeof out[key] === "string") out[key] = out[key].trim();
  }
  return out;
}

function mergeLifeRates(base, ...overlays) {
  const out = {};
  for (const [action, rates] of Object.entries(base ?? {})) {
    out[action] = { ...rates };
  }
  for (const overlay of overlays) {
    if (!isPlain(overlay)) continue;
    for (const [action, rates] of Object.entries(overlay)) {
      if (!isPlain(rates) || !isPlain(out[action])) continue;
      for (const [stat, value] of Object.entries(rates)) {
        if (!(stat in out[action])) continue;
        const n = Number(value);
        if (Number.isFinite(n)) out[action][stat] = n;
      }
    }
  }
  return out;
}

function pickKnown(src, keys) {
  const out = {};
  if (!isPlain(src)) return out;
  for (const key of keys) {
    if (src[key] != null) out[key] = src[key];
  }
  return out;
}

function stripUnknownNumbers(overlay, base) {
  if (!isPlain(overlay)) return {};
  const out = {};
  for (const [key, value] of Object.entries(overlay)) {
    if (!(key in base)) continue;
    if (typeof base[key] === "number") {
      const n = Number(value);
      if (Number.isFinite(n)) out[key] = n;
    } else if (typeof base[key] === "boolean" && typeof value === "boolean") {
      out[key] = value;
    } else if (typeof base[key] === "string" && typeof value === "string") {
      out[key] = value;
    } else if (isPlain(base[key]) && isPlain(value)) {
      out[key] = { ...base[key], ...value };
    }
  }
  return out;
}

function sanitizeModel(raw) {
  if (!isPlain(raw)) return null;
  const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
  if (!provider) return null;
  const modelName = typeof raw.model === "string" ? raw.model.trim() : "";
  return { provider, model: modelName || DEFAULT_MODELS[provider] || null };
}

function modelFromEnv(env = process.env) {
  const provider = typeof env.THINK_PROVIDER === "string" ? env.THINK_PROVIDER.trim() : "";
  if (!provider || provider === "dummy") return { provider: "dummy", model: null };
  if (provider === "minimax") {
    const model = typeof env.MINIMAX_MODEL === "string" && env.MINIMAX_MODEL.trim()
      ? env.MINIMAX_MODEL.trim()
      : DEFAULT_MODELS.minimax;
    return { provider: "minimax", model };
  }
  if (provider === "deepseek") {
    const model = typeof env.DEEPSEEK_MODEL === "string" && env.DEEPSEEK_MODEL.trim()
      ? env.DEEPSEEK_MODEL.trim()
      : DEFAULT_MODELS.deepseek;
    return { provider: "deepseek", model };
  }
  return { provider, model: null };
}

/**
 * Drop secret-looking keys anywhere in a settings object.
 * Values are discarded, never logged.
 */
export function sanitize(value) {
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (!isPlain(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = sanitize(child);
  }
  return out;
}

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return isPlain(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function asList(value) {
  const list = asArray(value);
  return list.length ? list.join("、") : "";
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function truncateChars(text, cap) {
  if (!text) return "";
  if (!Number.isFinite(cap) || cap <= 0) return text;
  return text.length <= cap ? text : text.slice(0, cap);
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function isPlain(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export { PROJECT_ROOT, DEFAULT_MODELS, STAT_KEYS };
