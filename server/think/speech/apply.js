import { config as defaultConfig } from "./config.js";
import {
  canSpeak,
  canSpeakToNpc,
  gameDayKey,
  isNpcSpeechTarget,
  npcTalkHourKey,
  npcTalkOf,
} from "./gates.js";

/**
 * If gates pass, write the spoken line and daily counters.
 * If gates fail, drop the line only — do not revert an already-applied action.
 */
export function applySpeech(world, character, speech, clock, now = new Date(), cfg = defaultConfig) {
  if (!character) return { ok: false, reason: "unknown-character" };
  const gate = canSpeak(world, character, speech, clock, now, cfg);
  if (!gate.ok) return gate;

  const line = typeof speech?.line === "string" ? speech.line.trim() : "";
  if (!line) return { ok: false, reason: "missing-line" };

  const at = now instanceof Date ? now : new Date(now);
  const dayKey = gameDayKey(clock, cfg);
  if (character.proactiveDayKey !== dayKey) {
    character.proactiveDayKey = dayKey;
    character.proactiveCountToday = 0;
  }
  character.line = line;
  character.lineTo = "viewer";
  character.lineKind = null;
  character.lineAt = at.toISOString();
  character.lastProactiveAt = at.toISOString();
  character.proactiveCountToday = (Number(character.proactiveCountToday) || 0) + 1;
  return { ok: true, reason: null, line, to: "viewer", visible: true };
}

/**
 * Deliver a one-way roommate line. On gate fail, drop the line only.
 * Always returns the landed `line` so memory can record it even when the
 * bubble is hidden from the viewer.
 */
export function applyNpcSpeech(world, character, speech, clock, now = new Date(), cfg = defaultConfig) {
  if (!character) return { ok: false, reason: "unknown-character" };
  const targetId = typeof speech?.to === "string" ? speech.to.trim() : "";
  if (!isNpcSpeechTarget(targetId, world)) return { ok: false, reason: "unknown-target" };
  const target = world.characters[targetId];
  const gate = canSpeakToNpc(world, character, target, speech, clock, now, cfg);
  if (!gate.ok) return gate;

  const line = typeof speech?.line === "string" ? speech.line.trim() : "";
  if (!line) return { ok: false, reason: "missing-line" };

  const at = now instanceof Date ? now : new Date(now);
  const npcCfg = npcTalkOf(cfg);
  const dayKey = gameDayKey(clock, cfg);
  if (character.npcTalkDayKey !== dayKey) {
    character.npcTalkDayKey = dayKey;
    character.npcTalkCountToday = 0;
  }
  character.npcTalkDayKey = dayKey;
  character.lastNpcTalkAt = at.toISOString();
  character.npcTalkCountToday = (Number(character.npcTalkCountToday) || 0) + 1;
  bumpHouseHour(world, clock);

  const visible = shouldShowNpcLine(world, character, npcCfg);
  if (visible) {
    character.line = line;
    character.lineTo = target.id;
    character.lineKind = null;
    character.lineAt = at.toISOString();
  } else {
    clearLine(character);
  }

  if (npcCfg.setActionToTalkWhenSitting && (character.action === "sit" || character.action === "talk")) {
    character.action = "talk";
    character.actionStartedAt = clock?.iso ?? at.toISOString();
  }

  return {
    ok: true,
    reason: null,
    line,
    to: target.id,
    toName: target.name || target.id,
    visible,
    target,
  };
}

/**
 * Speech owns writing `line`. Life may call this after a body change:
 * going to sleep or leaving the room drops any leftover line.
 */
export function clearLineIfNeeded(character, { previousRoom, action } = {}) {
  if (!character) return;
  if (action === "sleep" || (previousRoom != null && character.room !== previousRoom)) {
    clearLine(character);
  }
}

export function clearLine(character) {
  if (!character) return;
  character.line = null;
  character.lineTo = null;
  character.lineKind = null;
  character.lineAt = null;
}

export function shouldShowNpcLine(world, character, npcCfg = npcTalkOf()) {
  if (!npcCfg.lineVisibleOnlySameRoom) return true;
  const viewer = world?.viewer;
  if (!viewer?.present) return false;
  return !!character?.room && viewer.room === character.room;
}

function bumpHouseHour(world, clock) {
  if (!world.npcTalkMeta || typeof world.npcTalkMeta !== "object") {
    world.npcTalkMeta = { hourKey: null, count: 0 };
  }
  const hourKey = npcTalkHourKey(clock);
  if (world.npcTalkMeta.hourKey !== hourKey) {
    world.npcTalkMeta.hourKey = hourKey;
    world.npcTalkMeta.count = 0;
  }
  world.npcTalkMeta.count = (Number(world.npcTalkMeta.count) || 0) + 1;
}
