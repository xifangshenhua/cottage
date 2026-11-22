import { config as defaultConfig } from "./config.js";

/**
 * Parse the combined judge+lines payload.
 * Unknown / ineligible / duplicate ids and empty lines are dropped.
 * After filtering, keep at most maxPerMessage items in model order.
 * A missing or empty list is a successful empty result, not a thrown error.
 */
export function parse(raw, { eligibleIds, cfg = defaultConfig } = {}) {
  const data = asObject(raw);
  if (!data) return { ok: false, reason: "invalid-json", interjections: [] };

  const list = Array.isArray(data.interjections) ? data.interjections : null;
  if (!list) return { ok: true, reason: "empty", interjections: [] };

  const allowed = new Set((eligibleIds ?? []).map((id) => String(id)));
  const seen = new Set();
  const out = [];
  const maxChars = Number(cfg.maxReplyChars) || defaultConfig.maxReplyChars;
  const reasonCap = Number(cfg.reasonMaxChars) || defaultConfig.reasonMaxChars;
  const cap = Number(cfg.maxPerMessage);
  const limit = Number.isFinite(cap) && cap > 0 ? cap : defaultConfig.maxPerMessage;

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const characterId = typeof item.characterId === "string" ? item.characterId.trim() : "";
    if (!characterId || !allowed.has(characterId) || seen.has(characterId)) continue;
    const line = typeof item.line === "string" ? item.line.trim() : "";
    if (!line) continue;
    const reason = typeof item.reason === "string" ? item.reason.trim().slice(0, reasonCap) : "";
    seen.add(characterId);
    out.push({ characterId, reason, line: line.slice(0, maxChars) });
    if (out.length >= limit) break;
  }

  return { ok: true, reason: out.length ? null : "empty", interjections: out };
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
