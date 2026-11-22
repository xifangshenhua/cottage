import { legalNpcSpeechTargets } from "./speech/gates.js";

/**
 * Compact snapshot for a single character's think pass.
 * Memory supplies a short budgeted pack here when the coordinator asks.
 * Do not include full transcripts.
 */
export function assemble(world, character, options, clock, extras = {}) {
  const viewer = world?.viewer ?? { present: false, room: null };
  const roommates = listRoommates(world, character);
  const now = extras.now instanceof Date ? extras.now : new Date(extras.now ?? clock?.iso ?? Date.now());
  const legalTargets = extras.skipLegalTargets
    ? []
    : legalNpcSpeechTargets(world, character, clock, now, extras.speechCfg).map((other) => ({
      id: other.id,
      name: other.name,
    }));
  const recentRoommateLine = roommates.find((other) => typeof other.line === "string" && other.line.trim());
  const context = {
    clock: clock
      ? { timezone: clock.timezone, iso: clock.iso, dayKey: clock.dayKey, hhmm: clock.hhmm }
      : null,
    viewer: {
      present: !!viewer.present,
      room: viewer.room ?? null,
    },
    character: {
      id: character.id,
      name: character.name,
      room: character.room,
      action: character.action,
      stats: compactStats(character.stats),
    },
    roommates: roommates.map((other) => ({
      id: other.id,
      name: other.name,
      action: other.action,
      room: other.room,
      line: typeof other.line === "string" && other.line.trim() ? other.line.trim() : null,
    })),
    legalSpeechTargets: legalTargets,
    options: (options ?? []).map((o) => ({
      action: o.action,
      room: o.room,
      priority: o.priority,
    })),
  };
  if (recentRoommateLine) {
    context.recentRoommateLine = {
      id: recentRoommateLine.id,
      name: recentRoommateLine.name,
      line: recentRoommateLine.line.trim(),
    };
  }
  if (extras.identityCard) context.identityCard = extras.identityCard;
  if (extras.memorySummary) context.memorySummary = extras.memorySummary;
  if (extras.relationSummary) context.relationSummary = extras.relationSummary;
  return context;
}

function listRoommates(world, character) {
  if (!character?.room) return [];
  return Object.values(world?.characters ?? {}).filter((other) => (
    other?.id && other.id !== character.id && other.room === character.room
  ));
}

function compactStats(stats = {}) {
  const out = {};
  for (const key of ["energy", "hunger", "clean", "mood", "bond"]) {
    const n = Number(stats[key]);
    out[key] = Number.isFinite(n) ? Math.round(n) : 0;
  }
  return out;
}
