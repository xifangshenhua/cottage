import { config as defaultConfig, getAddressing, normalizeVolume } from "./config.js";

/**
 * Can the player talk to this character right now?
 * Returns { ok, reason } where reason is a stable code (never a secret).
 * Chinese copy for the UI lives in reasonText().
 *
 * This legacy gate still honors mustShareRoom so existing same-room tests
 * keep passing. New chat flow uses canHear / canReply and resolveAudience;
 * volume.range decides visibility there, not mustShareRoom.
 */
export function canChat(world, character, cfg = defaultConfig) {
  if (!character?.id) return deny("unknown-character");

  if (cfg.mustShareRoom !== false) {
    const viewerRoom = world?.viewer?.room ?? null;
    if (!viewerRoom || character.room !== viewerRoom) {
      return deny("different-room");
    }
  }

  const reply = canReply(character, cfg);
  if (!reply.ok) return reply;

  return { ok: true, reason: null };
}

/** Can this character answer a player line (sleep / wash flags). Range is not checked here. */
export function canReply(character, cfg = defaultConfig) {
  if (!character?.id) return deny("unknown-character");

  if (character.action === "sleep" && cfg.canTalkWhenSleeping !== true) {
    return deny("sleeping");
  }

  if (character.action === "wash" && cfg.canTalkWhenWashing !== true) {
    return deny("washing");
  }

  return { ok: true, reason: null };
}

/**
 * Is the character inside the volume's geographic range?
 * isolatedRooms is a reserved hook: a house-wide shout does not enter or
 * leave an isolated room.
 */
export function isInRange(character, ctx = {}, cfg = defaultConfig) {
  if (!character?.id) return false;
  const volume = normalizeVolume(ctx.volume, cfg);
  const viewerRoom = ctx.viewerRoom ?? null;
  const targetId = ctx.targetId ?? null;
  const room = character.room ?? null;
  if (!room) return false;

  if (volume.range === "target") {
    return !!targetId && character.id === targetId && !!viewerRoom && room === viewerRoom;
  }
  if (volume.range === "room") {
    return !!viewerRoom && room === viewerRoom;
  }

  const isolated = new Set(getAddressing(cfg).isolatedRooms ?? []);
  if (isolated.size) {
    if (isolated.has(room) && room !== viewerRoom) return false;
    if (viewerRoom && isolated.has(viewerRoom) && room !== viewerRoom) return false;
  }
  return true;
}

/** Can this character hear the player's line at this volume / range / state? */
export function canHear(character, ctx = {}, cfg = defaultConfig) {
  if (!character?.id) return deny("unknown-character");
  if (!isInRange(character, ctx, cfg)) return deny("target-out-of-range");

  const addressing = getAddressing(cfg);
  if (character.action === "sleep" && addressing.canHearWhenSleeping !== true) {
    return deny("sleeping");
  }
  if (character.action === "wash" && addressing.canHearWhenWashing !== true) {
    return deny("washing");
  }
  return { ok: true, reason: null };
}

export function reasonText(code, cfg = defaultConfig, ctx = {}) {
  const volumeId = typeof ctx?.volume === "string" ? ctx.volume : ctx?.volume?.id;
  const situation = ctx?.situation;
  switch (code) {
    case "unknown-character":
      return "找不到要对话的人。";
    case "empty-input":
      return "请先说点什么。";
    case "input-too-long":
      return `这句话有点长，缩短到${Number(cfg.maxInputChars) || 200}字以内再发给她。`;
    case "different-room":
      return "她现在不在这个房间。";
    case "whisper-needs-target":
      return "悄悄话要先指定一个人。";
    case "target-out-of-range":
      if (volumeId === "whisper") return "悄悄话要在同一个房间。";
      if (volumeId === "loud") return "她听不到。";
      return "她现在不在这个房间。大声说的话她也许能听到。";
    case "no-hearers":
      if (situation === "sleeping") return "大家都在睡觉，现在不方便说话。";
      if (situation === "washing" || situation === "busy") return "大家现在都不方便接话。";
      if (situation === "empty-house") return "这栋房子里现在没人能听见。";
      return "这里现在没人，说了也没人听见。大声说的话别处也许听得到。";
    case "sleeping":
      return "她在睡觉，现在不方便说话。";
    case "washing":
      return "她正在洗漱，过一会儿再聊吧。";
    case "busy":
      return "正在回复，请稍等。";
    case "provider-failed":
    case "timeout":
    case "invalid-reply":
      return "暂时没能接上话，稍后再试试。";
    default:
      return "现在不方便说话。";
  }
}

function deny(reason) {
  return { ok: false, reason };
}
