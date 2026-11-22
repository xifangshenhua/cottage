import { nowClock } from "../clock.js";
import { resolveLife } from "../settings/index.js";
import { config } from "./config.js";
import { progress } from "./needs.js";
import { advance } from "./actions.js";
import { propose } from "./rules.js";
import { pick } from "./decide.js";
import { intent } from "./apply.js";
import { clearLine } from "../think/speech/apply.js";

/**
 * Life-loop tick pipeline coordinator.
 *
 * Think is a peer layer in server/think/: it runs after this catch-up, against
 * real now, and must not be folded into decide.pick or each 30s stepWorld.
 * Later, memory/chat hooks after a think (or reuses parse + speech + apply).
 * Do not fold those into needs, actions, or apply.
 *
 * Persist once at the end of the HTTP tick; this function only mutates the
 * in-memory world snapshot and does not write the disk.
 */
export function tickWorld(world, opts = {}) {
  const capMs = opts.capMs ?? config.catchUpCapMs;
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now ?? Date.now());
  const nowMs = now.getTime();

  let fromMs = Date.parse(world.lastTickAt || world.savedAt || world.clock?.iso || "");
  if (!Number.isFinite(fromMs)) fromMs = nowMs;
  if (nowMs - fromMs > capMs) fromMs = nowMs - capMs;
  if (fromMs > nowMs) fromMs = nowMs;

  // Settings do not change mid-catch-up; resolve once per character.
  const lifeCache = new Map();
  const hooks = {
    ...opts,
    lifeCfgFor(id) {
      if (lifeCache.has(id)) return lifeCache.get(id);
      const cfg = lifeCfg(id, opts);
      lifeCache.set(id, cfg);
      return cfg;
    },
  };

  let cursor = fromMs;
  while (cursor < nowMs) {
    const dt = nextCatchUpDt(cursor, nowMs, opts);
    if (dt <= 0) break;
    const end = cursor + dt;
    stepWorld(world, dt, new Date(end), hooks);
    cursor = end;
  }

  world.lastTickAt = new Date(nowMs).toISOString();
  world.clock = nowClock(now);
  return world;
}

/**
 * Next simulation slice. Live / recent time uses stepMs (30s). A long stale
 * gap uses catchUpStepMs until the last catchUpStepMs window before now.
 */
export function nextCatchUpDt(cursor, nowMs, opts = {}) {
  const stepMs = opts.stepMs ?? config.stepMs;
  const catchUpStepMs = opts.catchUpStepMs ?? config.catchUpStepMs ?? stepMs;
  const fineMs = opts.catchUpFineMs ?? config.catchUpFineMs ?? catchUpStepMs;
  if (!(cursor < nowMs) || !Number.isFinite(cursor) || !Number.isFinite(nowMs)) return 0;
  const fineStart = nowMs - Math.max(0, Number(fineMs) || 0);
  const stride = cursor >= fineStart ? stepMs : catchUpStepMs;
  let dt = Math.min(stride, nowMs - cursor);
  if (cursor < fineStart && cursor + dt > fineStart) dt = fineStart - cursor;
  return dt > 0 ? dt : 0;
}

function stepWorld(world, dtMs, at, hooks = {}) {
  const clock = nowClock(at);
  const ids = Object.keys(world.characters ?? {}).sort();
  const justEnded = new Set();
  const cfgFor = (id) => (hooks.lifeCfgFor ? hooks.lifeCfgFor(id) : lifeCfg(id, hooks));

  for (const id of ids) {
    const character = world.characters[id];
    character.stats = progress(character, dtMs, cfgFor(id));
  }

  for (const id of ids) {
    const character = world.characters[id];
    const cfg = cfgFor(id);
    const result = advance(world, character, clock, at.getTime(), cfg);
    if (result.completed && character.action && character.action !== "sit") {
      justEnded.add(id);
      if (result.clearLine) clearLine(character);
      character.action = null;
    }
  }

  for (const id of ids) {
    const character = world.characters[id];
    if (!isFree(character, justEnded.has(id))) continue;
    const cfg = cfgFor(id);
    const options = propose(world, character, clock, cfg);
    const chosen = pick(options, { world, character, clock, cfg });
    if (!chosen) continue;
    intent(world, id, chosen, clock, cfg);
  }

  hooks.afterStep?.(world, dtMs, at);
}

/** Resolve per-character life numbers from house.life / character.life, else code defaults. */
export function lifeCfg(characterId, opts = {}) {
  if (opts.lifeConfig) return opts.lifeConfig;
  if (opts.settings) return resolveLife(characterId, opts.settings);
  return config;
}

function isFree(character, justEnded) {
  if (justEnded) return true;
  const action = character.action;
  return !action || action === "sit";
}

export { config } from "./config.js";
export { progress } from "./needs.js";
export { propose } from "./rules.js";
export { pick } from "./decide.js";
export { intent } from "./apply.js";
export { advance } from "./actions.js";
