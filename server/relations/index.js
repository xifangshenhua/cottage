/**
 * Relations facade: load/migrate the directed graph, apply events, query packs,
 * and keep stats.bond synced as a composite of familiarity + closeness.
 *
 * Other modules emit events or ask for a pack; they must not write scores.
 */

import { nowClock } from "../clock.js";
import { resolveRelations } from "../settings/index.js";
import {
  applyEvent as writeEvent,
  applyEvents as writeEvents,
  syncAllBonds,
} from "./apply.js";
import { config as defaultConfig, mergeRelationsConfig } from "./config.js";
import { tickDecay } from "./decay.js";
import { drainHouseholdEvents, EVENT_TYPES, observeLifeStep as watchLifeStep } from "./events.js";
import { allEdges, ensureEdge, ensureStore, getEdge, presentViewerRelations } from "./graph.js";
import { queryPack as buildPack } from "./query.js";
import { DEFAULT_SEED_EDGES, isViewerId, normalizeSeedList, VIEWER_ID } from "./schema.js";

export { config, mergeRelationsConfig, VIEWER_ID } from "./config.js";
export {
  applyEvent as applyEventDirect,
  applyEvents as applyEventsDirect,
  compositeBond,
  playerChatGate,
  syncAllBonds,
  syncBond,
} from "./apply.js";
export { tickDecay } from "./decay.js";
export { EVENT_TYPES, drainHouseholdEvents } from "./events.js";
export { allEdges, ensureEdge, getEdge, presentViewerRelations } from "./graph.js";
export { DEFAULT_SEED_EDGES, STANCES, publicEdge } from "./schema.js";

export function resolveConfig(opts = {}) {
  if (opts.cfg) return opts.cfg;
  return resolveRelations(opts.settings ?? null, defaultConfig);
}

/**
 * Ensure world.relations exists, create missing edges, and sync HUD bonds.
 * Existing edges are never overwritten. Rooms, actions, lastThinkAt and other
 * stats are not touched; stats.bond is rewritten as the rounded composite.
 *
 * Migration rule for a missing character→viewer edge: familiarity and
 * closeness both copy stats.bond so 0.4 * bond + 0.6 * bond stays the HUD value.
 */
export function migrateRelations(world, opts = {}) {
  if (!world || typeof world !== "object") return world;
  const cfg = resolveConfig(opts);
  const nowIso = world.clock?.iso || world.lastTickAt || new Date().toISOString();
  ensureStore(world);
  const seeds = indexSeeds(opts.seeds ?? opts.settings?.relationSeeds ?? DEFAULT_SEED_EDGES);
  const characterIds = Object.keys(world.characters ?? {});
  const viewerId = cfg.viewerId ?? VIEWER_ID;

  for (const id of characterIds) {
    const character = world.characters[id];
    const bond = Number(character?.stats?.bond);
    const hasBond = Number.isFinite(bond);
    if (!getEdge(world, id, viewerId)) {
      const seed = seeds.get(`${id}->${viewerId}`);
      const familiarity = hasBond ? bond * (cfg.migrateBond.familiarityScale ?? 1) : seed?.familiarity ?? 15;
      const closeness = hasBond ? bond * (cfg.migrateBond.closenessScale ?? 1) : seed?.closeness ?? familiarity;
      ensureEdge(world, id, viewerId, {
        familiarity,
        closeness,
        stance: seed?.stance || "companion",
      }, nowIso, cfg);
    }
    if (!getEdge(world, viewerId, id)) {
      const seed = seeds.get(`${viewerId}->${id}`) || seeds.get(`${id}->${viewerId}`);
      const familiarity = seed?.familiarity ?? (hasBond ? bond : 15);
      const closeness = seed?.closeness ?? (hasBond ? bond : familiarity);
      ensureEdge(world, viewerId, id, {
        familiarity,
        closeness,
        stance: seed?.stance || "companion",
      }, nowIso, cfg);
    }
  }

  for (const seed of seeds.values()) {
    if (isViewerId(seed.from, cfg) || isViewerId(seed.to, cfg)) continue;
    if (!world.characters?.[seed.from] || !world.characters?.[seed.to]) continue;
    if (!getEdge(world, seed.from, seed.to)) {
      ensureEdge(world, seed.from, seed.to, seed, nowIso, cfg);
    }
  }

  for (const a of characterIds) {
    for (const b of characterIds) {
      if (a === b) continue;
      if (!getEdge(world, a, b)) {
        ensureEdge(world, a, b, cfg.defaultCharacterEdge, nowIso, cfg);
      }
    }
  }

  syncAllBonds(world, cfg);
  return world;
}

export const ensureRelations = migrateRelations;

export function applyEvent(world, event, opts = {}) {
  const cfg = resolveConfig(opts);
  migrateRelations(world, { ...opts, cfg });
  const now = event?.now ?? opts.now ?? new Date();
  const clock = opts.clock ?? world?.clock ?? nowClock(now);
  return writeEvent(world, event, cfg, now, clock);
}

export function applyEvents(world, events, opts = {}) {
  const cfg = resolveConfig(opts);
  migrateRelations(world, { ...opts, cfg });
  const now = opts.now ?? new Date();
  const clock = opts.clock ?? world?.clock ?? nowClock(now);
  return writeEvents(world, events, cfg, now, clock);
}

export function observeLifeStep(world, dtMs, at, opts = {}) {
  const cfg = resolveConfig(opts);
  ensureStore(world);
  return watchLifeStep(world, dtMs, at, cfg);
}

export function tickRelations(world, opts = {}) {
  const cfg = resolveConfig(opts);
  migrateRelations(world, { ...opts, cfg });
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now ?? Date.now());
  const clock = opts.clock ?? world?.clock ?? nowClock(now);
  const household = drainHouseholdEvents(world, cfg, now);
  const applied = writeEvents(world, household, cfg, now, clock);
  const decay = tickDecay(world, { cfg, now, clock });
  return { household: applied, decay };
}

export function queryPack(world, characterId, kind = "idle", opts = {}) {
  const cfg = resolveConfig(opts);
  return buildPack(world, characterId, kind, cfg);
}

export function presentRelations(world, opts = {}) {
  const cfg = resolveConfig(opts);
  return presentViewerRelations(world, cfg);
}

export function snapshotEdges(world) {
  return allEdges(world).map((edge) => ({
    from: edge.from,
    to: edge.to,
    familiarity: edge.familiarity,
    closeness: edge.closeness,
    stance: edge.stance,
    updatedAt: edge.updatedAt,
  }));
}

function indexSeeds(raw) {
  const map = new Map();
  for (const seed of normalizeSeedList(raw)) {
    map.set(`${seed.from}->${seed.to}`, seed);
  }
  return map;
}

export { mergeRelationsConfig as mergeConfig };
