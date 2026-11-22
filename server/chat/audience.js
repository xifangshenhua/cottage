/**
 * Audience sub-module: normalize volume, list who can hear, pick the
 * single responder, and list overhearers. Does not call a model, write
 * memory, or change relation scores.
 */
import { getEdge } from "../relations/graph.js";
import { config as defaultConfig, getAddressing, normalizeVolume } from "./config.js";
import { canHear, canReply, isInRange } from "./policy.js";

const VIEWER_ID = "viewer";

/**
 * @returns {{
 *   ok: boolean,
 *   reason: string | null,
 *   situation?: string | null,
 *   volume: object,
 *   targetId: string,
 *   range: string,
 *   hearers: object[],
 *   responder: object | null,
 *   overhearers: object[],
 * }}
 */
export function resolveAudience(world, request = {}, cfg = defaultConfig) {
  const volume = normalizeVolume(request.volume, cfg);
  const targetId = typeof request.characterId === "string" ? request.characterId.trim() : "";
  const viewerRoom = world?.viewer?.room ?? null;
  const hearCtx = { volume: volume.id, viewerRoom, targetId };

  if (volume.requiresTarget && !targetId) {
    return fail("whisper-needs-target", volume, targetId);
  }

  if (targetId) {
    const target = world?.characters?.[targetId] ?? null;
    if (!target) return fail("unknown-character", volume, targetId);

    if (!isInRange(target, hearCtx, cfg)) {
      return fail("target-out-of-range", volume, targetId);
    }
    const heard = canHear(target, hearCtx, cfg);
    if (!heard.ok) return fail(heard.reason, volume, targetId);
    const reply = canReply(target, cfg);
    if (!reply.ok) return fail(reply.reason, volume, targetId);

    const hearers = listHearers(world, hearCtx, cfg);
    return succeed(volume, targetId, hearers, target);
  }

  const hearers = listHearers(world, hearCtx, cfg);
  if (!hearers.length) {
    return fail("no-hearers", volume, targetId, noHearersSituation(world, hearCtx, cfg));
  }

  const candidates = hearers.filter((character) => canReply(character, cfg).ok);
  if (!candidates.length) {
    return fail("no-hearers", volume, targetId, noReplySituation(hearers));
  }

  const responder = pickResponder(candidates, world, viewerRoom, cfg);
  return succeed(volume, targetId, hearers, responder);
}

export function listHearers(world, ctx, cfg = defaultConfig) {
  const characters = Object.values(world?.characters ?? {});
  return characters
    .filter((character) => canHear(character, ctx, cfg).ok)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

export function pickResponder(candidates, world, viewerRoom, cfg = defaultConfig) {
  const addressing = getAddressing(cfg);
  const pref = Array.isArray(addressing.actionPreference) ? addressing.actionPreference : ["talk", "sit", "eat"];
  const sameRoomFirst = addressing.sameRoomFirst !== false;
  const ranked = [...candidates].sort((a, b) => {
    if (sameRoomFirst) {
      const aSame = a.room === viewerRoom ? 0 : 1;
      const bSame = b.room === viewerRoom ? 0 : 1;
      if (aSame !== bSame) return aSame - bSame;
    }
    const aClose = closenessToViewer(world, a.id);
    const bClose = closenessToViewer(world, b.id);
    if (aClose !== bClose) return bClose - aClose;
    const aAct = actionRank(a.action, pref);
    const bAct = actionRank(b.action, pref);
    if (aAct !== bAct) return aAct - bAct;
    return String(a.id).localeCompare(String(b.id));
  });
  // maxResponders stays a hook; v1 returns a single responder.
  return ranked[0] ?? null;
}

function succeed(volume, targetId, hearers, responder) {
  const overhearers = volume.id === "whisper" || volume.range === "target"
    ? []
    : hearers.filter((character) => character.id !== responder?.id);
  return {
    ok: true,
    reason: null,
    situation: null,
    volume,
    targetId: targetId || "",
    range: volume.range,
    hearers,
    responder,
    overhearers,
  };
}

function fail(reason, volume, targetId, situation = null) {
  return {
    ok: false,
    reason,
    situation,
    volume,
    targetId: targetId || "",
    range: volume.range,
    hearers: [],
    responder: null,
    overhearers: [],
  };
}

function noHearersSituation(world, ctx, cfg) {
  const all = Object.values(world?.characters ?? {});
  const inRange = all.filter((character) => isInRange(character, ctx, cfg));
  if (!inRange.length) {
    return ctx.volume === "loud" || ctx.volume?.id === "loud" ? "empty-house" : "empty-room";
  }
  if (inRange.every((character) => character.action === "sleep")) return "sleeping";
  if (inRange.every((character) => character.action === "wash")) return "washing";
  return "empty-room";
}

function noReplySituation(hearers) {
  if (hearers.every((character) => character.action === "sleep")) return "sleeping";
  if (hearers.every((character) => character.action === "wash")) return "washing";
  return "busy";
}

function closenessToViewer(world, characterId) {
  const edge = getEdge(world, characterId, VIEWER_ID);
  const value = Number(edge?.closeness);
  return Number.isFinite(value) ? value : 0;
}

function actionRank(action, pref) {
  const index = pref.indexOf(action);
  return index === -1 ? pref.length : index;
}
