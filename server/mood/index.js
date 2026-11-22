/**
 * Mood facade: apply discrete conversation events to character.stats.mood.
 * Life-loop hourly rates stay in server/life/needs.js and are not called here.
 */

import { nowClock } from "../clock.js";
import { resolveMood } from "../settings/index.js";
import { applyEvent as writeEvent } from "./apply.js";
import { config as defaultConfig, mergeMoodConfig } from "./config.js";
import { EVENT_TYPES } from "./events.js";

export { config, mergeMoodConfig } from "./config.js";
export { EVENT_TYPES, deltasFor } from "./events.js";
export { applyEvent as applyEventDirect, diminish, ensureMoodMeta, playerChatGate } from "./apply.js";

export function resolveConfig(opts = {}) {
  if (opts.cfg) return opts.cfg;
  return resolveMood(opts.settings ?? null, defaultConfig);
}

export function applyEvent(world, event, opts = {}) {
  try {
    const cfg = resolveConfig(opts);
    const now = event?.now ?? opts.now ?? new Date();
    const clock = opts.clock ?? nowClock(now);
    return writeEvent(world, event, cfg, now, clock);
  } catch {
    return { applied: false, reason: "error", delta: 0 };
  }
}

export { mergeMoodConfig as mergeConfig };
