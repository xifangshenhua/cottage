/**
 * Event types → proposed mood deltas.
 * Scoring filters, caps, and diminish live in apply.js.
 * v1 does not emit overhear or idleThink events.
 */

import { config as defaultConfig } from "./config.js";

export const EVENT_TYPES = {
  playerChat: "playerChat",
  npcTalk: "npcTalk",
  proactiveSpeech: "proactiveSpeech",
  interject: "interject",
};

export function deltasFor(event, cfg = defaultConfig) {
  const type = event?.type;
  if (type === EVENT_TYPES.playerChat) {
    return Number(cfg.playerChat.delta) || 0;
  }
  if (type === EVENT_TYPES.npcTalk) {
    if (event.role === "listener") return Number(cfg.npcTalk.listenerDelta) || 0;
    return Number(cfg.npcTalk.speakerDelta) || 0;
  }
  if (type === EVENT_TYPES.proactiveSpeech) {
    return Number(cfg.proactiveSpeech.delta) || 0;
  }
  if (type === EVENT_TYPES.interject) {
    return Number(cfg.interject.delta) || 0;
  }
  return 0;
}

export function eventConfig(type, cfg = defaultConfig) {
  if (type === EVENT_TYPES.playerChat) return cfg.playerChat;
  if (type === EVENT_TYPES.npcTalk) return cfg.npcTalk;
  if (type === EVENT_TYPES.proactiveSpeech) return cfg.proactiveSpeech;
  if (type === EVENT_TYPES.interject) return cfg.interject;
  return null;
}

export function gainKey(type) {
  if (type === EVENT_TYPES.playerChat) return "playerChatGain";
  if (type === EVENT_TYPES.npcTalk) return "npcTalkGain";
  if (type === EVENT_TYPES.proactiveSpeech) return "proactiveGain";
  if (type === EVENT_TYPES.interject) return "interjectGain";
  return null;
}
