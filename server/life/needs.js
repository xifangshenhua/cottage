import { config } from "./config.js";

const RATE_STATS = ["energy", "hunger", "clean", "mood"];

export function clampStat(value, cfg = config) {
  const n = Number(value);
  if (!Number.isFinite(n)) return cfg.statMin;
  return Math.min(cfg.statMax, Math.max(cfg.statMin, n));
}

export function ratesFor(actionId, cfg = config) {
  const table = cfg.rates ?? config.rates;
  return table[actionId] ?? table.awake;
}

/**
 * Apply decay / recovery for dt milliseconds based on the current action.
 * Pure: returns a new stats object. bond is never changed. Values are clamped 0–100.
 */
export function progress(character, dtMs, cfg = config) {
  const hours = Math.max(0, Number(dtMs) || 0) / 3_600_000;
  const current = character?.stats ?? {};
  const rates = ratesFor(character?.action, cfg);
  const next = { ...current };

  for (const key of RATE_STATS) {
    const rate = Number(rates[key]) || 0;
    const base = Number(current[key]);
    next[key] = clampStat((Number.isFinite(base) ? base : 0) + rate * hours, cfg);
  }

  if (hasLowNeed(current, cfg)) {
    next.mood = clampStat(next.mood - cfg.moodLowNeedPenaltyPerHour * hours, cfg);
  }

  if (current.bond != null) next.bond = current.bond;
  return next;
}

function hasLowNeed(stats, cfg = config) {
  const threshold = cfg.moodLowNeedThreshold;
  return ["energy", "hunger", "clean"].some((key) => Number(stats?.[key]) <= threshold);
}
