import { config as defaultConfig } from "./config.js";

/**
 * Parse provider output into a ChatIntent.
 * A present `line` makes the parse succeed; bad fact/topic/action/room are
 * dropped instead of failing the reply.
 */
export function parse(raw, { character, cfg = defaultConfig } = {}) {
  const data = asObject(raw);
  if (!data) return { ok: false, reason: "invalid-json" };

  const characterId = typeof data.characterId === "string" && data.characterId
    ? data.characterId
    : character?.id;
  if (!characterId) return { ok: false, reason: "missing-character" };
  if (character?.id && characterId !== character.id) {
    return { ok: false, reason: "wrong-character" };
  }

  const line = typeof data.line === "string" ? data.line.trim() : "";
  if (!line) return { ok: false, reason: "missing-line" };

  const intent = {
    characterId,
    line: line.slice(0, Number(cfg.maxReplyChars) || defaultConfig.maxReplyChars),
  };

  const fact = parseFact(data.fact, cfg);
  if (fact) intent.fact = fact;
  const topic = parseTopic(data.topic, cfg);
  if (topic) intent.topic = topic;

  // v1: keep a same-room "talk" hint; ignore any other action or room change.
  if (typeof data.action === "string" && data.action.trim() === "talk") {
    intent.action = "talk";
    if (character?.room) intent.room = character.room;
  }

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

const DEFAULT_FACT_MAX = 80;
const DEFAULT_TOPIC_MAX = 20;

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

function parseTopic(raw, cfg) {
  if (raw == null) return null;
  const text = typeof raw === "string"
    ? raw.trim()
    : typeof raw === "object" && typeof raw.text === "string"
      ? raw.text.trim()
      : "";
  if (!text) return null;
  const cap = Number(cfg?.topicMaxChars);
  const limit = Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_TOPIC_MAX;
  return text.slice(0, limit);
}
