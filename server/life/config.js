/**
 * The only place for life-loop rates, thresholds, durations, and hours.
 * Tuning numbers here should not require edits to needs / actions / rules / apply.
 *
 * Units:
 * - *Hhmm: Asia/Shanghai clock, 24-hour "HH:MM"
 * - rates: stat change per real hour (positive = recover, negative = drain)
 * - *DurationMin / *ExpireMin: minutes
 * - stepMs / catchUpCapMs: milliseconds
 * - hunger is fullness (high = full)
 */

export const config = {
  /** Simulated live tick / fine catch-up step. */
  stepMs: 30_000,
  /** Ignore any gap longer than this; simulate the most recent 24 hours only. */
  catchUpCapMs: 24 * 60 * 60 * 1000,
  /**
   * When replaying a long downtime gap, walk the stale portion in this coarser
   * step, then revert to stepMs for the last catchUpStepMs so the landing
   * state stays accurate. Live ticks still use stepMs. Action durations are
   * many minutes, so 5-minute stale steps stay coherent across day/night.
   */
  catchUpStepMs: 5 * 60 * 1000,

  /** Game day is [dayStart, next dayStart). Night quiet / sleep preference is [nightStart, dayStart). */
  dayStartHhmm: "07:00",
  nightStartHhmm: "22:00",

  statMin: 0,
  statMax: 100,

  /**
   * Per-hour rates while an action is active.
   * Eat ~200/h reaches stop (>= 85) from a typical start (<= 35) in about 15 min,
   * and from near-empty in one 25 min sitting.
   * Wash ~450/h reaches stop (>= 90) from a typical start (<= 40) in well under 15 min.
   */
  rates: {
    awake: { energy: -4.5, hunger: -9, clean: -3.5, mood: -0.4 },
    sit: { energy: -4.5, hunger: -9, clean: -3.5, mood: 1.0 },
    talk: { energy: -4.5, hunger: -9, clean: -3.5, mood: 0.5 },
    sleep: { energy: 7, hunger: -4, clean: -1.5, mood: 0.5 },
    eat: { energy: -3, hunger: 200, clean: -2, mood: 1.0 },
    wash: { energy: -3, hunger: -6, clean: 450, mood: 1.0 },
  },

  /** Extra mood drain per hour when any of energy / hunger / clean is at or below this. */
  moodLowNeedThreshold: 25,
  moodLowNeedPenaltyPerHour: 2,

  eatStartHunger: 35,
  eatStopHunger: 85,
  washStartClean: 40,
  washStopClean: 90,
  /** Go to bed when energy is at or below this, even during the day. */
  sleepStartEnergy: 25,
  /** Kept as a setting. Daytime wake uses sleepWakeEnergy only; this is not a second wake threshold. */
  sleepCriticalEnergy: 40,
  /** Wake from a day rest once energy is at or above this. Night sleep does not complete. */
  sleepWakeEnergy: 80,

  eatDurationMin: 25,
  washDurationMin: 12,
  /** Leftover seed talk lines expire after this, then the character sits. */
  talkExpireMin: 3,
};
