/**
 * Edge shape, dimension registry helpers, and stance list.
 * Cultivation must not rewrite stance or persona files.
 */

import { VIEWER_ID, config as defaultConfig } from "./config.js";

export const STANCES = ["companion", "roommate", "friend", "acquaintance"];
export const DEFAULT_STANCE = "roommate";

export const STANCE_LABELS = {
  companion: "同伴",
  roommate: "室友",
  friend: "好友",
  acquaintance: "相识",
};

/** Built-in seeds used when settings/relations.json is missing. */
export const DEFAULT_SEED_EDGES = [
  { from: "qingqing", to: "viewer", familiarity: 18, closeness: 18, stance: "companion" },
  { from: "viewer", to: "qingqing", familiarity: 18, closeness: 18, stance: "companion" },
  { from: "linxia", to: "viewer", familiarity: 16, closeness: 16, stance: "roommate" },
  { from: "viewer", to: "linxia", familiarity: 16, closeness: 16, stance: "roommate" },
  { from: "xiaonan", to: "viewer", familiarity: 15, closeness: 15, stance: "friend" },
  { from: "viewer", to: "xiaonan", familiarity: 15, closeness: 15, stance: "friend" },
  { from: "qingqing", to: "linxia", familiarity: 22, closeness: 20, stance: "friend" },
  { from: "linxia", to: "qingqing", familiarity: 20, closeness: 16, stance: "roommate" },
  { from: "qingqing", to: "xiaonan", familiarity: 24, closeness: 22, stance: "friend" },
  { from: "xiaonan", to: "qingqing", familiarity: 24, closeness: 23, stance: "friend" },
  { from: "linxia", to: "xiaonan", familiarity: 16, closeness: 14, stance: "roommate" },
  { from: "xiaonan", to: "linxia", familiarity: 18, closeness: 16, stance: "roommate" },
];

export function stanceLabel(stance) {
  return STANCE_LABELS[stance] || STANCE_LABELS[DEFAULT_STANCE];
}

export function normalizeStance(value, fallback = DEFAULT_STANCE) {
  const stance = typeof value === "string" ? value.trim() : "";
  return STANCES.includes(stance) ? stance : fallback;
}

export function enabledDimensions(cfg = defaultConfig) {
  const dims = cfg?.dimensions ?? defaultConfig.dimensions;
  return Object.values(dims).filter((dim) => dim && dim.enabled !== false && dim.id);
}

export function edgeKey(from, to) {
  return `${from}->${to}`;
}

export function parseEdgeKey(key) {
  const at = String(key).indexOf("->");
  if (at <= 0) return null;
  return { from: key.slice(0, at), to: key.slice(at + 2) };
}

export function isViewerId(id, cfg = defaultConfig) {
  return id === (cfg.viewerId ?? VIEWER_ID);
}

export function involvesViewer(from, to, cfg = defaultConfig) {
  return isViewerId(from, cfg) || isViewerId(to, cfg);
}

/**
 * Normalize a runtime edge. Official persisted fields:
 * from, to, familiarity, closeness, stance, updatedAt.
 * Bookkeeping fields (lastInteractAt, lastChatAt, lastScoredChatAt,
 * lastScoredOverhearAt, daily ledgers) stay on the edge in world.json but are omitted from public state.
 */
export function normalizeEdge(raw = {}, cfg = defaultConfig, nowIso = null) {
  const from = String(raw.from ?? "").trim();
  const to = String(raw.to ?? "").trim();
  const at = typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : nowIso;
  const edge = {
    from,
    to,
    familiarity: clampScore(raw.familiarity, cfg),
    closeness: clampScore(raw.closeness, cfg),
    stance: normalizeStance(raw.stance),
    updatedAt: at,
    lastInteractAt: asIso(raw.lastInteractAt) ?? at,
    lastChatAt: asIso(raw.lastChatAt),
    lastScoredChatAt: asIso(raw.lastScoredChatAt),
    lastScoredOverhearAt: asIso(raw.lastScoredOverhearAt),
    ledgerDayKey: typeof raw.ledgerDayKey === "string" ? raw.ledgerDayKey : null,
    familiarityGainToday: numberOr(raw.familiarityGainToday, 0),
    closenessGainToday: numberOr(raw.closenessGainToday, 0),
    closenessLossToday: numberOr(raw.closenessLossToday, 0),
  };
  return edge;
}

export function publicEdge(edge) {
  if (!edge) return null;
  return {
    from: edge.from,
    to: edge.to,
    familiarity: roundScore(edge.familiarity),
    closeness: roundScore(edge.closeness),
    stance: edge.stance,
    updatedAt: edge.updatedAt ?? null,
  };
}

export function clampScore(value, cfg = defaultConfig) {
  const n = Number(value);
  const min = Number(cfg.statMin) || 0;
  const max = Number(cfg.statMax) || 100;
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return Math.round(n * 10000) / 10000;
}

export function roundScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

export function normalizeSeedList(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.edges) ? raw.edges : [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const from = String(item.from ?? "").trim();
    const to = String(item.to ?? "").trim();
    if (!from || !to || from === to) continue;
    out.push({
      from,
      to,
      familiarity: Number.isFinite(Number(item.familiarity)) ? Number(item.familiarity) : 14,
      closeness: Number.isFinite(Number(item.closeness)) ? Number(item.closeness) : 12,
      stance: normalizeStance(item.stance),
    });
  }
  return out;
}

function asIso(value) {
  if (typeof value === "string" && value && Number.isFinite(Date.parse(value))) return value;
  return null;
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export { VIEWER_ID };
