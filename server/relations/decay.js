/**
 * Daily decay. Familiarity only after a long absence; closeness sooner,
 * and slower between housemates than toward a neglected player.
 */

import { nowClock } from "../clock.js";
import { gameDayKey } from "../think/speech/gates.js";
import { VIEWER_ID, config as defaultConfig } from "./config.js";
import { applyEvent } from "./apply.js";
import { EVENT_TYPES } from "./events.js";
import { allEdges, ensureStore } from "./graph.js";
import { involvesViewer } from "./schema.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Apply at most one decay step per game day (catch-up if several days passed).
 * First run after migrate only records the day key so we do not punish an upgrade.
 */
export function tickDecay(world, opts = {}) {
  const cfg = opts.cfg ?? defaultConfig;
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now ?? Date.now());
  const clock = opts.clock ?? world?.clock ?? nowClock(now);
  const dayKey = gameDayKey(clock, { dayStartHhmm: cfg.dayStartHhmm }) || clock.dayKey;
  if (!dayKey || !world) return { days: 0, results: [] };

  ensureStore(world);
  const meta = world.relationsMeta;
  const last = meta.lastDecayDayKey;
  if (!last) {
    meta.lastDecayDayKey = dayKey;
    return { days: 0, results: [] };
  }
  if (last === dayKey) return { days: 0, results: [] };

  const days = Math.min(
    dayGap(last, dayKey),
    Number(cfg.decay.maxDaysPerTick) || 14,
  );
  const results = [];
  for (let i = 1; i <= days; i += 1) {
    const simulated = new Date(now.getTime() - (days - i) * DAY_MS);
    for (const edge of allEdges(world)) {
      const planned = decayForEdge(edge, simulated, cfg);
      if (!planned.familiarity && !planned.closeness) continue;
      results.push(applyEvent(world, {
        type: EVENT_TYPES.decay,
        from: edge.from,
        to: edge.to,
        familiarity: planned.familiarity,
        closeness: planned.closeness,
        now: simulated,
      }, cfg, simulated, clock));
    }
  }
  meta.lastDecayDayKey = dayKey;
  return { days, results };
}

export function decayForEdge(edge, now, cfg = defaultConfig) {
  const at = now instanceof Date ? now : new Date(now ?? Date.now());
  const nowMs = at.getTime();
  const sinceInteract = daysSince(edge.lastInteractAt || edge.updatedAt, nowMs);
  const sinceChat = daysSince(edge.lastChatAt || edge.lastInteractAt || edge.updatedAt, nowMs);
  const withViewer = involvesViewer(edge.from, edge.to, cfg);

  let familiarity = 0;
  let closeness = 0;
  const famAfter = Number(cfg.decay.familiarityAbsenceDays) || 10;
  if (sinceInteract > famAfter) {
    familiarity = -(Number(cfg.decay.familiarityPerDay) || 0);
  }
  if (withViewer) {
    const after = Number(cfg.decay.closenessPlayerAbsenceDays) || 3;
    if (sinceChat > after) closeness = -(Number(cfg.decay.closenessPlayerPerDay) || 0);
  } else {
    const after = Number(cfg.decay.closenessNpcAbsenceDays) || 6;
    if (sinceInteract > after) closeness = -(Number(cfg.decay.closenessNpcPerDay) || 0);
  }
  return { familiarity, closeness };
}

function daysSince(iso, nowMs) {
  const then = Date.parse(iso || "");
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, (nowMs - then) / DAY_MS);
}

function dayGap(fromKey, toKey) {
  const from = parseDay(fromKey);
  const to = parseDay(toKey);
  if (!from || !to) return 1;
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

function parseDay(dayKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export { VIEWER_ID };
