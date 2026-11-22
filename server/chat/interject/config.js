/**
 * THE ONLY place for player-chat interjection numbers and flags.
 * Override from settings/house.json under "chat.interject", via resolveInterject.
 * Counters are separate from proactive speech and NPC-talk caps.
 * Do not put API keys here.
 */

export const config = {
  enabled: true,
  /** Each character's interjections per game day (game day starts at dayStartHhmm). */
  maxPerCharacterDay: 2,
  /** Minimum minutes since this character's last interjection. */
  minGapMin: 20,
  /** House-wide interjection occasions per clock hour. Two lines in one judge count as 1. */
  maxOccasionsPerHouseHour: 3,
  /** Max people who may interject after one player message. */
  maxPerMessage: 2,
  /** Loud cross-room hearers do not shout back when this is true. */
  sameRoomOnly: true,
  /**
   * When true, also judge unaddressed room speech.
   * When false, only judge if the player named a target or the text mentions
   * another present person's name.
   */
  judgeUnaddressed: true,
  maxReplyChars: 60,
  timeoutMs: 15_000,
  maxPromptChars: 2_000,
  reasonMaxChars: 80,
  dayStartHhmm: "07:00",
};

export function mergeInterjectConfig(base = config, overlay = null) {
  const root = { ...base };
  if (!isPlain(overlay)) return root;
  if (typeof overlay.enabled === "boolean") root.enabled = overlay.enabled;
  if (typeof overlay.sameRoomOnly === "boolean") root.sameRoomOnly = overlay.sameRoomOnly;
  if (typeof overlay.judgeUnaddressed === "boolean") root.judgeUnaddressed = overlay.judgeUnaddressed;
  for (const key of [
    "maxPerCharacterDay",
    "minGapMin",
    "maxOccasionsPerHouseHour",
    "maxPerMessage",
    "maxReplyChars",
    "timeoutMs",
    "maxPromptChars",
    "reasonMaxChars",
  ]) {
    if (overlay[key] != null && Number.isFinite(Number(overlay[key]))) {
      root[key] = Number(overlay[key]);
    }
  }
  if (typeof overlay.dayStartHhmm === "string" && overlay.dayStartHhmm.trim()) {
    root.dayStartHhmm = overlay.dayStartHhmm.trim();
  }
  return root;
}

function isPlain(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
