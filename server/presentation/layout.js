/**
 * Pure presentation layout: cover-fit mapping, pose resolution, and stable
 * slot assignment. No filesystem, no HTTP, no world mutation.
 */

import { DEFAULT_ASSETS, DEFAULT_PIVOT, DEFAULT_FRAME } from "./config.js";

/**
 * Map an art-space anchor (normalized 0–1) onto a viewport using object-fit.
 * Default fit is "cover" with object-position: center, matching #room-bg.
 */
export function mapAnchorToScreen(anchor, viewport, artSize, fit = "cover") {
  const transform = coverTransform(viewport, artSize, fit);
  const ax = Number(anchor?.x);
  const ay = Number(anchor?.y);
  const x = Number.isFinite(ax) ? transform.offsetX + ax * transform.displayWidth : transform.offsetX;
  const y = Number.isFinite(ay) ? transform.offsetY + ay * transform.displayHeight : transform.offsetY;
  return { x, y, coverScale: transform.coverScale, offsetX: transform.offsetX, offsetY: transform.offsetY };
}

/** Shared object-fit transform used by mapping and sprite sizing. */
export function coverTransform(viewport, artSize, fit = "cover") {
  const vw = Math.max(0, Number(viewport?.width) || 0);
  const vh = Math.max(0, Number(viewport?.height) || 0);
  const aw = Math.max(1, Number(artSize?.width) || 1);
  const ah = Math.max(1, Number(artSize?.height) || 1);
  const mode = fit === "contain" ? "contain" : "cover";
  const coverScale = mode === "contain"
    ? Math.min(vw / aw, vh / ah)
    : Math.max(vw / aw, vh / ah);
  const displayWidth = aw * coverScale;
  const displayHeight = ah * coverScale;
  const offsetX = (vw - displayWidth) / 2;
  const offsetY = (vh - displayHeight) / 2;
  return { coverScale, displayWidth, displayHeight, offsetX, offsetY, artWidth: aw, artHeight: ah };
}

/** Fill `{pack}` / `{roomId}` / `{characterId}` / `{pose}` in an asset path pattern. */
export function formatAssetPath(pattern, vars = {}) {
  const src = typeof pattern === "string" ? pattern : "";
  return src.replace(/\{(\w+)\}/g, (_, key) => {
    const value = vars[key];
    return value == null ? `{${key}}` : String(value);
  });
}

/**
 * Resolve an action to a pose and asset URL.
 * Alias first (talk/idle → sit), then character file, then fallback silhouette.
 * Never throws if a PNG is missing; last resort is the fallback URL.
 */
export function resolvePose(action, appearance = {}, config = {}, opts = {}) {
  const pack = config.pack || "v1";
  const alias = config.poseAlias || {};
  const fallbackPose = (config.fallbackPose || "sit").trim() || "sit";
  const requested = String(action || "").trim() || fallbackPose;
  const logical = (alias[requested] || requested).trim() || fallbackPose;
  const chain = unique([logical, requested, fallbackPose, alias[fallbackPose] || ""]);

  const characterId = opts.characterId || appearance.characterId || appearance.id || "";
  const dir = appearance.dir || characterId;
  const charPattern = config.assets?.characters || DEFAULT_ASSETS.characters;
  const fbPattern = config.assets?.fallback || DEFAULT_ASSETS.fallback;
  const exists = normalizeExists(opts, appearance, chain);

  for (const pose of chain) {
    if (!pose) continue;
    if (exists(pose, "character")) {
      const listed = appearance.poses?.[pose];
      const url = typeof listed === "string" && listed.trim()
        ? listed.trim()
        : formatAssetPath(charPattern, { pack, characterId: dir || characterId, pose });
      return { pose, requested, logical, source: "character", url };
    }
  }
  for (const pose of chain) {
    if (!pose) continue;
    if (exists(pose, "fallback")) {
      const listed = opts.fallbackPoses?.[pose];
      const url = typeof listed === "string" && listed.trim()
        ? listed.trim()
        : formatAssetPath(fbPattern, { pack, pose });
      return { pose, requested, logical, source: "fallback", url };
    }
  }
  const url = formatAssetPath(fbPattern, { pack, pose: fallbackPose });
  return { pose: fallbackPose, requested, logical, source: "fallback", url };
}

/**
 * Assign occupants to room anchors.
 * Preferred anchor wins if free and pose-compatible; otherwise the first
 * matching empty slot. Remaining people are ordered by closeness (desc) then
 * id. Same inputs always yield the same slots (no per-tick reshuffle).
 * Result is z-sorted by anchor y (higher y / lower on screen = in front).
 */
export function assignSlots(occupants, roomAnchors, prefs = {}, config = {}) {
  const anchors = normalizeAnchors(roomAnchors);
  const people = Array.isArray(occupants) ? occupants.filter((item) => item && item.id) : [];
  if (!people.length || !anchors.length) return [];

  const max = positiveInt(config.maxVisiblePerRoom, 3);
  const alias = config.poseAlias || {};
  const fallbackPose = (config.fallbackPose || "sit").trim() || "sit";

  const decorated = people.map((person) => {
    const action = String(person.action || "").trim() || "idle";
    const pose = (alias[action] || action).trim() || fallbackPose;
    const preferred = preferredAnchorId(prefs, person.id);
    return {
      id: String(person.id),
      action,
      pose,
      closeness: Number.isFinite(Number(person.closeness)) ? Number(person.closeness) : 0,
      preferred,
      occupant: person,
    };
  });

  const visible = pickVisible(decorated, anchors, max);
  const used = new Set();
  const assigned = new Map();

  const withPref = visible
    .filter((person) => person.preferred)
    .sort(compareId);
  for (const person of withPref) {
    const anchor = anchors.find((item) => item.id === person.preferred);
    if (!anchor || used.has(anchor.id)) continue;
    if (!poseCompatible(person, anchor)) continue;
    used.add(anchor.id);
    assigned.set(person.id, anchor);
  }

  const remaining = visible
    .filter((person) => !assigned.has(person.id))
    .sort(compareClosenessThenId);
  for (const person of remaining) {
    const anchor = anchors.find((item) => !used.has(item.id) && poseCompatible(person, item));
    if (!anchor) continue;
    used.add(anchor.id);
    assigned.set(person.id, anchor);
  }

  const slots = visible
    .filter((person) => assigned.has(person.id))
    .map((person) => {
      const anchor = assigned.get(person.id);
      return {
        id: person.id,
        action: person.action,
        pose: person.pose,
        closeness: person.closeness,
        anchorId: anchor.id,
        anchor,
        occupant: person.occupant,
      };
    });

  slots.sort((a, b) => {
    const za = Number.isFinite(a.anchor.z) ? a.anchor.z : a.anchor.y;
    const zb = Number.isFinite(b.anchor.z) ? b.anchor.z : b.anchor.y;
    if (za !== zb) return za - zb;
    return a.id.localeCompare(b.id);
  });
  slots.forEach((slot, index) => {
    slot.z = index;
  });
  return slots;
}

export function poseCompatible(person, anchor) {
  const allowed = Array.isArray(anchor?.poses) ? anchor.poses : [];
  if (!allowed.length) return true;
  const pose = person?.pose;
  const action = person?.action;
  return allowed.includes(pose) || (action && allowed.includes(action));
}

export { DEFAULT_FRAME, DEFAULT_PIVOT };

function pickVisible(decorated, anchors, max) {
  if (decorated.length <= max) {
    return decorated.slice().sort(compareId);
  }
  const ranked = decorated.slice().sort((a, b) => {
    const ap = a.preferred && hasCompatibleAnchor(a, anchors) ? 1 : 0;
    const bp = b.preferred && hasCompatibleAnchor(b, anchors) ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return compareClosenessThenId(a, b);
  });
  return ranked.slice(0, max).sort(compareId);
}

function hasCompatibleAnchor(person, anchors) {
  if (person.preferred) {
    const preferred = anchors.find((item) => item.id === person.preferred);
    if (preferred && poseCompatible(person, preferred)) return true;
  }
  return anchors.some((item) => poseCompatible(person, item));
}

function preferredAnchorId(prefs, id) {
  if (!prefs) return "";
  const value = prefs[id];
  if (typeof value === "string") return value.trim();
  if (isPlain(value) && typeof value.anchor === "string") return value.anchor.trim();
  return "";
}

function normalizeAnchors(roomAnchors) {
  const list = Array.isArray(roomAnchors)
    ? roomAnchors
    : (roomAnchors && Array.isArray(roomAnchors.anchors) ? roomAnchors.anchors : []);
  return list
    .filter((item) => item && typeof item.id === "string" && item.id.trim())
    .map((item) => ({
      ...item,
      id: item.id.trim(),
      x: Number(item.x),
      y: Number(item.y),
      poses: Array.isArray(item.poses) ? item.poses : [],
      scale: item.scale != null && Number.isFinite(Number(item.scale)) ? Number(item.scale) : 1,
    }));
}

function normalizeExists(opts, appearance, chain) {
  if (typeof opts.exists === "function") return opts.exists;
  if (typeof opts.hasPose === "function") return opts.hasPose;
  const available = opts.available;
  if (isPlain(available)) {
    const char = new Set(asList(available.character ?? available.characters));
    const fallback = new Set(asList(available.fallback));
    const hasCharList = available.character != null || available.characters != null;
    const hasFbList = available.fallback != null;
    return (pose, source) => {
      if (source === "fallback") return hasFbList ? fallback.has(pose) : true;
      return hasCharList ? char.has(pose) : false;
    };
  }
  if (isPlain(appearance?.poses)) {
    const listed = new Set(Object.keys(appearance.poses).filter((key) => appearance.poses[key] !== false && appearance.poses[key] != null));
    return (pose, source) => (source === "character" ? listed.has(pose) : true);
  }
  // No inventory given: do not assume a character PNG exists; allow fallback URLs.
  return (pose, source) => source === "fallback" && chain.includes(pose);
}

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (isPlain(value)) return Object.keys(value).filter((key) => value[key]);
  return [];
}

function compareClosenessThenId(a, b) {
  if (a.closeness !== b.closeness) return b.closeness - a.closeness;
  return a.id.localeCompare(b.id);
}

function compareId(a, b) {
  return a.id.localeCompare(b.id);
}

function unique(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const value = typeof item === "string" ? item.trim() : "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function isPlain(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
