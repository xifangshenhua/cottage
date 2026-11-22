import { config as defaultConfig } from "./config.js";

/**
 * Parse and validate provider output into a ThinkIntent.
 * Actions not in the proposed legal options are rejected.
 * Omitting action means keep the current action. Invalid speech is dropped
 * without rejecting the action. A short `fact` is kept for the memory layer
 * when present and valid; it never rewrites persona settings.
 */
export function parse(raw, { character, options = [], cfg = defaultConfig } = {}) {
  const data = asObject(raw);
  if (!data) return { ok: false, reason: "invalid-json" };

  const characterId = typeof data.characterId === "string" && data.characterId
    ? data.characterId
    : character?.id;
  if (!characterId) return { ok: false, reason: "missing-character" };
  if (character?.id && characterId !== character.id) {
    return { ok: false, reason: "wrong-character" };
  }

  const hasAction = data.action != null && String(data.action).trim() !== "";
  let action;
  let room;
  if (!hasAction) {
    action = character?.action ?? undefined;
    room = data.room ?? character?.room;
  } else {
    action = String(data.action).trim();
    const match = findOption(options, action, data.room);
    if (!match) return { ok: false, reason: "illegal-action" };
    action = match.action;
    room = match.room;
  }

  const intent = { characterId };
  if (action != null) intent.action = action;
  if (room != null) intent.room = room;

  const speech = parseSpeech(data.speech, characterId, cfg);
  if (speech) intent.speech = speech;

  const fact = parseFact(data.fact, cfg);
  if (fact) intent.fact = fact;

  return { ok: true, intent };
}

function asObject(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = fenced ? fenced[1].trim() : trimmed;
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    return null;
  } catch {
    return null;
  }
}

function findOption(options, action, room) {
  const matches = options.filter((o) => o.action === action);
  if (!matches.length) return null;
  if (room == null || room === "") return matches[0];
  return matches.find((o) => o.room === room) ?? null;
}

function parseSpeech(speech, characterId, cfg) {
  if (speech == null) return null;
  if (typeof speech !== "object" || Array.isArray(speech)) return null;
  const line = typeof speech.line === "string" ? speech.line.trim() : "";
  const reason = typeof speech.reason === "string" ? speech.reason.trim() : "";
  if (!line || !reason) return null;
  const to = typeof speech.to === "string" && speech.to.trim() ? speech.to.trim() : "viewer";
  return {
    to,
    line: line.slice(0, cfg.maxLineChars),
    reason: reason.slice(0, cfg.maxReasonChars),
  };
}

const DEFAULT_FACT_MAX = 80;

function parseFact(raw, cfg) {
  if (raw == null) return null;
  let text = "";
  let importance = null;
  if (typeof raw === "string") {
    text = raw.trim();
  } else if (typeof raw === "object") {
    text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (Number.isFinite(Number(raw.importance))) importance = Number(raw.importance);
  } else {
    return null;
  }
  if (!text) return null;
  const cap = Number(cfg?.factMaxChars);
  const limit = Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_FACT_MAX;
  const fact = { text: text.slice(0, limit) };
  if (importance != null) fact.importance = importance;
  return fact;
}
