/**
 * Only place for think cadence, stagger, timeouts, and prompt/line limits.
 * Speech cadence numbers live in speech/config.js.
 */
export const config = {
  /** How often a character may think. */
  intervalMs: 10 * 60 * 1000,
  /**
   * Minimum spacing used when several characters are due at once.
   * Combined with "at most one think per world tick" so three model
   * calls never share the same tick.
   */
  staggerMs: 30_000,
  /** Provider timeout; on timeout, fall back to life/decide.pick. */
  timeoutMs: 20_000,
  /** Hard cap on a proactive spoken line. */
  maxLineChars: 80,
  /** Hard cap on the model's reason string. */
  maxReasonChars: 200,
  /** Prompt text cap (context stays compact). */
  maxPromptChars: 4_000,
};
