/** Room catalog used by occupancy and life rules. Bedroom id equals character id. */

export const rooms = {
  living: { id: "living", name: "客厅", capacity: Infinity },
  dining: { id: "dining", name: "餐厅", capacity: Infinity },
  bathroom: { id: "bathroom", name: "洗手间", capacity: 1 },
  qingqing: { id: "qingqing", name: "青青房", capacity: Infinity, bedroomOf: "qingqing" },
  linxia: { id: "linxia", name: "林夏房", capacity: Infinity, bedroomOf: "linxia" },
  xiaonan: { id: "xiaonan", name: "小南房", capacity: Infinity, bedroomOf: "xiaonan" },
};

export function getRoom(roomId) {
  return rooms[roomId] ?? null;
}

export function bedroomOf(characterId) {
  return characterId;
}

export function isOwnBedroom(roomId, characterId) {
  return roomId === characterId;
}

export function occupants(world, roomId) {
  return Object.values(world?.characters ?? {}).filter((c) => c.room === roomId);
}

export function occupancyCount(world, roomId) {
  return occupants(world, roomId).length;
}
