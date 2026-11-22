/**
 * Directed relationship graph stored on world.relations (an array of edges).
 * Other modules must not write scores directly; go through applyEvent.
 */

import { VIEWER_ID, config as defaultConfig } from "./config.js";
import { clampScore, edgeKey, normalizeEdge, publicEdge } from "./schema.js";

export function ensureStore(world) {
  if (!world || typeof world !== "object") return world;
  if (!Array.isArray(world.relations)) world.relations = [];
  if (!isPlain(world.relationsMeta)) {
    world.relationsMeta = { lastDecayDayKey: null, accum: {} };
  }
  if (!isPlain(world.relationsMeta.accum)) world.relationsMeta.accum = {};
  if (world.relationsMeta.lastDecayDayKey === undefined) {
    world.relationsMeta.lastDecayDayKey = null;
  }
  return world;
}

export function allEdges(world) {
  return Array.isArray(world?.relations) ? world.relations : [];
}

export function getEdge(world, from, to) {
  return allEdges(world).find((edge) => edge.from === from && edge.to === to) ?? null;
}

export function hasEdge(world, from, to) {
  return !!getEdge(world, from, to);
}

/**
 * Create a missing edge from a seed. Never overwrites an existing edge,
 * including stance and scores.
 */
export function ensureEdge(world, from, to, seed = {}, nowIso = null, cfg = defaultConfig) {
  ensureStore(world);
  const existing = getEdge(world, from, to);
  if (existing) {
    normalizeInPlace(existing, cfg);
    return existing;
  }
  const edge = normalizeEdge({ ...seed, from, to }, cfg, nowIso);
  world.relations.push(edge);
  return edge;
}

export function setScores(world, from, to, patch, cfg = defaultConfig, nowIso = null) {
  const edge = ensureEdge(world, from, to, {}, nowIso, cfg);
  if (patch.familiarity != null) edge.familiarity = clampScore(patch.familiarity, cfg);
  if (patch.closeness != null) edge.closeness = clampScore(patch.closeness, cfg);
  if (nowIso) edge.updatedAt = nowIso;
  return edge;
}

export function iterateEdges(world, fn) {
  for (const edge of allEdges(world)) fn(edge);
}

export function edgesFrom(world, from) {
  return allEdges(world).filter((edge) => edge.from === from);
}

export function publicEdges(world) {
  return allEdges(world).map(publicEdge);
}

export function presentViewerRelations(world, cfg = defaultConfig) {
  const viewerId = cfg.viewerId ?? VIEWER_ID;
  const out = {};
  for (const id of Object.keys(world?.characters ?? {})) {
    const edge = getEdge(world, id, viewerId);
    if (!edge) continue;
    out[id] = {
      familiarity: publicEdge(edge).familiarity,
      closeness: publicEdge(edge).closeness,
      stance: edge.stance,
    };
  }
  return out;
}

export { edgeKey };

function normalizeInPlace(edge, cfg) {
  const normalized = normalizeEdge(edge, cfg, edge.updatedAt);
  Object.assign(edge, normalized);
  return edge;
}

function isPlain(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
