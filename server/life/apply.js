import { getAction, resolveRoom } from "./actions.js";
import { config } from "./config.js";
import { canEnter } from "./occupancy.js";
import { isOwnBedroom } from "../rooms.js";
import { clearLineIfNeeded } from "../think/speech/apply.js";

/**
 * Validate an intent and, if legal, write room / action / actionStartedAt.
 * Illegal intents are dropped: the world is not mutated.
 * Speech owns writing `line`. This module only asks speech to clear a leftover
 * line when the body goes to sleep or leaves the room.
 *
 * Intent shape: { action, room? }. If room is omitted, the registry's required
 * room is used. A mismatched room is rejected rather than silently corrected.
 */
export function intent(world, characterId, proposed, clock, cfg = config) {
  const character = world?.characters?.[characterId];
  if (!character) return { ok: false, reason: "unknown-character" };
  if (!proposed?.action) return { ok: false, reason: "missing-action" };

  const def = getAction(proposed.action);
  if (!def) return { ok: false, reason: "unknown-action" };
  if (def.id === "talk") return { ok: false, reason: "talk-reserved" };

  const required = resolveRoom(def, character);
  const room = proposed.room ?? required;
  if (!room) return { ok: false, reason: "missing-room" };
  if (def.id === "sleep" && !isOwnBedroom(room, character.id)) {
    return { ok: false, reason: "not-own-bedroom" };
  }
  if (def.id === "eat" && room !== "dining") {
    return { ok: false, reason: "wrong-room" };
  }
  if (def.id === "wash" && room !== "bathroom") {
    return { ok: false, reason: "wrong-room" };
  }
  if (required && room !== required) return { ok: false, reason: "wrong-room" };
  if (!canEnter(world, characterId, room)) {
    return { ok: false, reason: "occupied" };
  }
  if (def.canStart && !def.canStart({ world, character, clock, cfg })) {
    return { ok: false, reason: "cannot-start" };
  }

  const previousRoom = character.room;
  character.room = room;
  character.action = def.id;
  character.actionStartedAt = clock?.iso ?? new Date().toISOString();
  if (previousRoom !== room) {
    character.enteredRoomAt = character.actionStartedAt;
    character.lastRoomChangeAt = character.actionStartedAt;
  }
  clearLineIfNeeded(character, { previousRoom, action: def.id });
  return { ok: true };
}
