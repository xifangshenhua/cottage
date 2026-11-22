/**
 * THE ONLY place for presentation / sprite-layout numbers and flags.
 * Merge order (later wins): code defaults ← settings/presentation.json
 * ← house.presentation. Character settings may add `appearance` only;
 * they cannot change house anchors, pack, or who is visible.
 * Do not put API keys here.
 */

export const DEFAULT_POSE_ALIAS = { talk: "sit", idle: "sit" };

export const DEFAULT_ASSETS = {
  rooms: "/assets/rooms/{pack}/{roomId}.jpg",
  characters: "/assets/characters/{pack}/{characterId}/{pose}.png",
  fallback: "/assets/characters/{pack}/fallback/{pose}.png",
};

export const DEFAULT_FRAME = { width: 600, height: 800 };
export const DEFAULT_PIVOT = { x: 0.5, y: 1.0 };

/** Anchors are in 1280×720 art space, pivot = sprite bottom-center / seat or feet. */
export const DEFAULT_ROOMS = {
  living: {
    id: "living",
    anchors: [
      { id: "sofa-left", x: 0.335, y: 0.508, poses: ["sit", "talk"], scale: 0.54 },
      { id: "sofa-right", x: 0.550, y: 0.460, poses: ["sit", "talk"], scale: 0.54 },
    ],
    props: [
      { id: "coffee-table", url: "/assets/rooms/v1/living-table.png", z: 0.85 },
    ],
  },
  dining: {
    id: "dining",
    anchors: [
      { id: "seat-near-left", x: 0.420, y: 0.835, poses: ["eat", "sit", "talk"], scale: 0.38 },
      { id: "seat-near-right", x: 0.700, y: 0.830, poses: ["eat", "sit", "talk"], scale: 0.38 },
      { id: "seat-far-left", x: 0.510, y: 0.580, poses: ["eat", "sit", "talk"], scale: 0.30 },
      { id: "seat-far-right", x: 0.790, y: 0.580, poses: ["eat", "sit", "talk"], scale: 0.30 },
    ],
    props: [
      { id: "dining-table", url: "/assets/rooms/v1/dining-table.png", z: 0.70 },
    ],
  },
  bathroom: {
    id: "bathroom",
    anchors: [
      { id: "sink", x: 0.80, y: 0.96, poses: ["wash"], scale: 0.70 },
    ],
    props: [],
  },
  qingqing: {
    id: "qingqing",
    anchors: [
      { id: "bed", x: 0.35, y: 0.57, poses: ["sleep", "sit", "talk"], scale: 0.60 },
    ],
    props: [
      { id: "duvet", url: "/assets/rooms/v1/qingqing-duvet.png", z: 0.85 },
    ],
  },
  linxia: {
    id: "linxia",
    anchors: [
      { id: "bed", x: 0.35, y: 0.70, poses: ["sleep", "sit", "talk"], scale: 0.58 },
    ],
    props: [
      { id: "duvet", url: "/assets/rooms/v1/linxia-duvet.png", z: 0.85 },
    ],
  },
  xiaonan: {
    id: "xiaonan",
    anchors: [
      { id: "bed", x: 0.64, y: 0.56, poses: ["sleep", "sit", "talk"], scale: 0.62 },
    ],
    props: [],
  },
};

export const config = {
  pack: "v1",
  presenter: "html",
  artWidth: 1280,
  artHeight: 720,
  fit: "cover",
  maxVisiblePerRoom: 3,
  fallbackPose: "sit",
  poseAlias: { ...DEFAULT_POSE_ALIAS },
  transitionMs: 200,
  clickToFocus: true,
  showNameplates: true,
  assets: { ...DEFAULT_ASSETS },
  rooms: cloneRooms(DEFAULT_ROOMS),
  /** Reserved for later furniture occlusion (e.g. living table). Empty in v1. */
  props: [],
};

export function getPresentation(cfg = config) {
  return cfg ?? config;
}

/**
 * Merge settings/presentation.json and optional house.presentation onto defaults.
 * Character appearance is not merged here.
 */
export function mergePresentation(base = config, ...overlays) {
  let root = clonePresentation(base || config);
  for (const overlay of overlays) {
    if (!isPlain(overlay)) continue;
    root = applyOverlay(root, overlay);
  }
  return root;
}

function applyOverlay(root, overlay) {
  const next = clonePresentation(root);
  if (typeof overlay.pack === "string" && overlay.pack.trim()) next.pack = overlay.pack.trim();
  if (typeof overlay.presenter === "string" && overlay.presenter.trim()) {
    next.presenter = overlay.presenter.trim();
  }
  if (typeof overlay.fit === "string" && overlay.fit.trim()) next.fit = overlay.fit.trim();
  if (typeof overlay.fallbackPose === "string" && overlay.fallbackPose.trim()) {
    next.fallbackPose = overlay.fallbackPose.trim();
  }
  for (const key of ["artWidth", "artHeight", "maxVisiblePerRoom", "transitionMs"]) {
    if (overlay[key] != null && Number.isFinite(Number(overlay[key]))) {
      next[key] = Number(overlay[key]);
    }
  }
  for (const key of ["clickToFocus", "showNameplates"]) {
    if (typeof overlay[key] === "boolean") next[key] = overlay[key];
  }
  if (isPlain(overlay.poseAlias)) {
    next.poseAlias = { ...next.poseAlias };
    for (const [from, to] of Object.entries(overlay.poseAlias)) {
      if (typeof from === "string" && typeof to === "string" && to.trim()) {
        next.poseAlias[from.trim()] = to.trim();
      }
    }
  }
  if (isPlain(overlay.assets)) {
    next.assets = { ...next.assets };
    for (const key of ["rooms", "characters", "fallback"]) {
      if (typeof overlay.assets[key] === "string" && overlay.assets[key].trim()) {
        next.assets[key] = overlay.assets[key].trim();
      }
    }
  }
  if (Array.isArray(overlay.props)) {
    next.props = overlay.props.map((item) => (isPlain(item) ? { ...item } : item)).filter(Boolean);
  }
  if (isPlain(overlay.rooms)) {
    next.rooms = mergeRooms(next.rooms, overlay.rooms);
  }
  return next;
}

function mergeRooms(baseRooms, overlayRooms) {
  const out = cloneRooms(baseRooms);
  for (const [id, raw] of Object.entries(overlayRooms)) {
    if (!isPlain(raw)) continue;
    const prev = out[id] || { id, anchors: [], props: [] };
    const room = { ...prev, id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : id };
    if (Array.isArray(raw.anchors)) room.anchors = mergeAnchors(prev.anchors, raw.anchors);
    if (Array.isArray(raw.props)) room.props = raw.props.map((item) => (isPlain(item) ? { ...item } : item));
    if (typeof raw.image === "string" && raw.image.trim()) room.image = raw.image.trim();
    out[id] = room;
  }
  return out;
}

function mergeAnchors(baseList, overlayList) {
  const byId = new Map((baseList || []).map((item) => [item.id, cloneAnchor(item)]));
  const order = (baseList || []).map((item) => item.id);
  for (const raw of overlayList) {
    if (!isPlain(raw)) continue;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id) continue;
    const prev = byId.get(id) || { id, x: 0.5, y: 0.5, poses: [], scale: 1 };
    const next = cloneAnchor({ ...prev, ...pickAnchor(raw), id });
    byId.set(id, next);
    if (!order.includes(id)) order.push(id);
  }
  return order.map((id) => byId.get(id)).filter(Boolean);
}

function pickAnchor(raw) {
  const out = {};
  for (const key of ["x", "y", "scale", "z"]) {
    if (raw[key] != null && Number.isFinite(Number(raw[key]))) out[key] = Number(raw[key]);
  }
  if (Array.isArray(raw.poses)) {
    out.poses = raw.poses.map((value) => String(value).trim()).filter(Boolean);
  }
  return out;
}

function clonePresentation(src) {
  const base = isPlain(src) ? src : config;
  return {
    ...config,
    ...base,
    poseAlias: { ...(base.poseAlias || DEFAULT_POSE_ALIAS) },
    assets: { ...DEFAULT_ASSETS, ...(isPlain(base.assets) ? base.assets : {}) },
    rooms: cloneRooms(base.rooms || DEFAULT_ROOMS),
    props: Array.isArray(base.props) ? base.props.map((item) => (isPlain(item) ? { ...item } : item)) : [],
  };
}

function cloneRooms(rooms) {
  const src = isPlain(rooms) ? rooms : DEFAULT_ROOMS;
  const out = {};
  for (const [id, room] of Object.entries(src)) {
    const anchors = Array.isArray(room?.anchors) ? room.anchors.map(cloneAnchor) : [];
    const props = Array.isArray(room?.props) ? room.props.map((item) => (isPlain(item) ? { ...item } : item)) : [];
    out[id] = { ...(isPlain(room) ? room : {}), id: room?.id || id, anchors, props };
  }
  return out;
}

function cloneAnchor(anchor) {
  const src = isPlain(anchor) ? anchor : {};
  const copy = {
    id: src.id,
    x: Number(src.x),
    y: Number(src.y),
    poses: Array.isArray(src.poses) ? [...src.poses] : [],
    scale: src.scale != null && Number.isFinite(Number(src.scale)) ? Number(src.scale) : 1,
  };
  if (src.z != null && Number.isFinite(Number(src.z))) copy.z = Number(src.z);
  return copy;
}

function isPlain(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export { cloneRooms, clonePresentation };
