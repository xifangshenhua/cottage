const PACK_FALLBACK = "v1";

function defaultRoomImage(id) {
  return `/assets/rooms/${PACK_FALLBACK}/${id}.jpg`;
}

export const rooms = [
  { id: "living", name: "客厅", theme: "day", icon: "home" },
  { id: "dining", name: "餐厅", theme: "day", icon: "dining" },
  { id: "bathroom", name: "洗手间", theme: "day", icon: "bath" },
  { id: "qingqing", name: "青青房", theme: "day", icon: "bed" },
  { id: "linxia", name: "林夏房", theme: "day", icon: "bed" },
  { id: "xiaonan", name: "小南房", theme: "night", icon: "bed" },
].map((room) => ({ ...room, image: defaultRoomImage(room.id) }));

export const characters = {
  qingqing: {
    name: "青青",
    room: "living",
    action: "talk",
    line: "你来了。我刚在和林夏聊刚才那本书。",
    stats: { energy: 74, hunger: 66, clean: 82, mood: 71, bond: 18 },
  },
  linxia: {
    name: "林夏",
    room: "living",
    action: "sit",
    line: null,
    stats: { energy: 70, hunger: 58, clean: 80, mood: 76, bond: 16 },
  },
  xiaonan: {
    name: "小南",
    room: "xiaonan",
    action: "sleep",
    line: null,
    stats: { energy: 42, hunger: 58, clean: 76, mood: 64, bond: 15 },
  },
};

export const statMeta = [
  { key: "energy", label: "精力", icon: "leaf" },
  { key: "hunger", label: "饱食", icon: "apple" },
  { key: "clean", label: "整洁", icon: "sparkle" },
  { key: "mood", label: "心情", icon: "heart" },
  { key: "bond", label: "关系", icon: "person" },
];

function roundHud(value) {
  return Math.round(Number(value) || 0);
}

/**
 * Status-bar chips for the focused person.
 * When viewer-relation scores exist, show 熟悉 and 亲密 instead of the
 * composite stats.bond (which is not itself 熟悉度).
 * Offline fallback characters without relations keep a single 关系 chip.
 */
export function statusStatChips(focused, relations) {
  const chips = [];
  const stats = focused?.stats ?? {};
  for (const meta of statMeta) {
    if (meta.key === "bond") continue;
    chips.push({
      key: meta.key,
      label: meta.label,
      icon: meta.icon,
      value: roundHud(stats[meta.key]),
    });
  }
  const rel = focused?.id && relations && typeof relations === "object"
    ? relations[focused.id]
    : null;
  if (rel && typeof rel === "object") {
    chips.push(
      { key: "familiarity", label: "熟悉", icon: "person", value: roundHud(rel.familiarity) },
      { key: "closeness", label: "亲密", icon: "person", value: roundHud(rel.closeness) },
    );
  } else {
    chips.push({
      key: "bond",
      label: "关系",
      icon: "person",
      value: roundHud(stats.bond),
    });
  }
  return chips;
}

/** Apply room image URLs from GET /api/presentation. Falls back to /assets/rooms/v1/{id}.jpg. */
export function applyPresentation(catalog) {
  for (const room of rooms) {
    const entry = catalog?.rooms?.[room.id];
    room.image = (entry && typeof entry.image === "string" && entry.image.trim())
      ? entry.image
      : defaultRoomImage(room.id);
  }
  return rooms;
}

export function occupants(roomId) {
  return Object.values(characters).filter((c) => c.room === roomId);
}

export function roomById(id) {
  return rooms.find((r) => r.id === id) ?? rooms[0];
}
