export { config } from "./config.js";
export {
  canSpeak,
  canSpeakToNpc,
  gameDayKey,
  isQuietHours,
  justEnteredLiving,
  dayCount,
  npcDayCount,
  npcTalkHourKey,
  houseHourCount,
  npcTalkOf,
  isNpcSpeechTarget,
  legalNpcSpeechTargets,
} from "./gates.js";
export { applySpeech, applyNpcSpeech, clearLineIfNeeded, clearLine, shouldShowNpcLine } from "./apply.js";
