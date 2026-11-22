import { config as defaultConfig } from "./config.js";

/**
 * Who may think on this real-now pass.
 * Skip sleep. A character is due if lastThinkAt + interval has elapsed
 * (or, on a first think, world.startedAt + id stagger has elapsed).
 * At most one character is returned so three model calls never share a tick;
 * ties break by oldest lastThinkAt, then id.
 */
export function whoMayThink(world, now = new Date(), cfg = defaultConfig) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) return [];

  const due = [];
  for (const character of Object.values(world?.characters ?? {})) {
    if (!character?.id) continue;
    if (character.action === "sleep") continue;
    if (!isDue(character, nowMs, cfg, world)) continue;
    due.push(character);
  }

  due.sort((a, b) => {
    const aLast = thinkTime(a);
    const bLast = thinkTime(b);
    if (aLast !== bLast) return aLast - bLast;
    return String(a.id).localeCompare(String(b.id));
  });

  return due.slice(0, 1);
}

export function isDue(character, nowMs, cfg = defaultConfig, world = null) {
  const last = thinkTime(character);
  const intervalMs = cfg.intervalMsFor?.(character) ?? cfg.intervalMs;
  if (Number.isFinite(last)) return nowMs - last >= intervalMs;
  if (world) {
    const start = Date.parse(world.startedAt || world.lastTickAt || "");
    if (Number.isFinite(start)) {
      return nowMs >= start + staggerOffsetMs(character.id, world, cfg);
    }
  }
  return true;
}

export function staggerOffsetMs(characterId, world, cfg = defaultConfig) {
  const ids = Object.keys(world?.characters ?? {}).sort();
  const index = Math.max(0, ids.indexOf(characterId));
  return index * cfg.staggerMs;
}

function thinkTime(character) {
  const parsed = Date.parse(character?.lastThinkAt || "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
