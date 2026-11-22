/**
 * Only place for proactive-speech numbers and windows.
 * Game day is [dayStart, next dayStart). 00:00–dayStart belongs to the previous game day.
 * Quiet hours are [quietStart, quietEnd) in Asia/Shanghai and may wrap midnight.
 * NPC-to-NPC talk numbers live under `npcTalk` and may be overridden via
 * settings/house.json `speech.npcTalk`. Relation deltas stay in relations/config.
 */
export const config = {
  minGapMs: 45 * 60 * 1000,
  maxPerGameDay: 4,
  quietStartHhmm: "22:00",
  quietEndHhmm: "07:30",
  dayStartHhmm: "07:00",
  /** Minutes without a view heartbeat before present is cleared. */
  viewerAwayTimeoutMin: 5,
  /** "Just entered living" window. */
  justEnteredMin: 10,
  livingRoom: "living",
  npcTalk: {
    enabled: true,
    requiresViewer: false,
    forbiddenRooms: ["bathroom"],
    canTalkWhenSleeping: false,
    canTalkWhenWashing: false,
    canTalkWhenEating: true,
    canTalkInQuietHours: false,
    maxPerGameDay: 3,
    minGapMin: 30,
    houseMaxPerHour: 2,
    mouthCooldownMin: 3,
    lineVisibleOnlySameRoom: true,
    setActionToTalkWhenSitting: true,
  },
};
