import { getRoom, occupants } from "../rooms.js";

/**
 * Whether characterId may be in roomId given current occupants.
 * Bathroom is single-occupant; dining and living can hold several.
 * Already being in the room is always allowed.
 */
export function canEnter(world, characterId, roomId) {
  const room = getRoom(roomId);
  if (!room) return false;
  const others = occupants(world, roomId).filter((c) => c.id !== characterId);
  const capacity = Number.isFinite(room.capacity) ? room.capacity : Infinity;
  return others.length < capacity;
}

export function isRoomFull(world, roomId, exceptCharacterId) {
  return !canEnter(world, exceptCharacterId, roomId);
}
