/**
 * Build the one-shot presentation catalog for GET /api/presentation.
 * Not included in SSE world.updated ticks. Never reads or returns secrets.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_FRAME, DEFAULT_PIVOT } from "./config.js";
import { formatAssetPath } from "./layout.js";

const POSES = ["sit", "eat", "wash", "sleep"];

let catalogCache = null;

/** Cached GET /api/presentation body. Invalidated when settings are reloaded. */
export function getPresentationCatalog(opts = {}) {
  if (catalogCache) return catalogCache;
  catalogCache = buildCatalog(opts);
  return catalogCache;
}

export function invalidatePresentationCatalog() {
  catalogCache = null;
}

export function buildCatalog(opts = {}) {
  const settings = opts.settings ?? null;
  const config = opts.config;
  if (!config) throw new Error("buildCatalog requires a resolved presentation config");
  const root = opts.root ?? settings?.root ?? "";
  const pack = config.pack || "v1";
  const artWidth = config.artWidth || 1280;
  const artHeight = config.artHeight || 720;

  const rooms = {};
  for (const [id, room] of Object.entries(config.rooms || {})) {
    const image = room.image || formatAssetPath(config.assets?.rooms, { pack, roomId: id });
    rooms[id] = {
      id,
      image,
      anchors: (room.anchors || []).map((anchor) => ({ ...anchor })),
      props: Array.isArray(room.props) ? room.props.map((item) => ({ ...item })) : [],
    };
  }

  const fallbackMeta = readMeta(root, "public/assets/characters", pack, "fallback");
  const fallback = {
    dir: "fallback",
    frame: fallbackMeta.frame,
    pivot: fallbackMeta.pivot,
    poses: {},
  };
  for (const pose of POSES) {
    const fileExists = poseExists(root, pack, "fallback", pose);
    const poseMeta = fallbackMeta.poses?.[pose];
    fallback.poses[pose] = {
      url: formatAssetPath(config.assets?.fallback, { pack, pose }),
      exists: fileExists,
      pivot: poseMeta?.pivot || fallbackMeta.pivot,
    };
  }

  const characters = {};
  for (const [id, spec] of Object.entries(settings?.characters || {})) {
    characters[id] = presentAppearance(id, spec, config, pack, root, fallbackMeta);
  }

  return {
    pack,
    presenter: config.presenter || "html",
    artWidth,
    artHeight,
    fit: config.fit || "cover",
    maxVisiblePerRoom: config.maxVisiblePerRoom ?? 3,
    fallbackPose: config.fallbackPose || "sit",
    poseAlias: { ...(config.poseAlias || {}) },
    transitionMs: config.transitionMs ?? 200,
    clickToFocus: config.clickToFocus !== false,
    showNameplates: config.showNameplates !== false,
    assets: { ...(config.assets || {}) },
    rooms,
    characters,
    fallback,
    props: Array.isArray(config.props) ? config.props.map((item) => (item && typeof item === "object" ? { ...item } : item)) : [],
  };
}

function presentAppearance(id, spec, config, pack, root, fallbackMeta) {
  const appearance = isPlain(spec?.appearance) ? spec.appearance : {};
  const identity = spec?.identity || {};
  const dir = typeof appearance.dir === "string" && appearance.dir.trim() ? appearance.dir.trim() : id;
  const meta = readMeta(root, "public/assets/characters", pack, dir);
  const scale = appearance.scale != null && Number.isFinite(Number(appearance.scale))
    ? Number(appearance.scale)
    : 1;
  const preferredAnchors = isPlain(appearance.preferredAnchors) ? { ...appearance.preferredAnchors } : {};
  const poses = {};
  for (const pose of POSES) {
    const fileExists = poseExists(root, pack, dir, pose);
    const poseMeta = meta.poses?.[pose];
    poses[pose] = {
      url: formatAssetPath(config.assets?.characters, { pack, characterId: dir, pose }),
      exists: fileExists,
      pivot: poseMeta?.pivot || meta.pivot,
    };
  }
  return {
    id,
    name: identity.name || id,
    dir,
    scale,
    preferredAnchors,
    frame: meta.frame,
    pivot: meta.pivot,
    poses,
  };
}

function poseExists(root, pack, characterId, pose) {
  if (!root) return false;
  const file = path.join(root, "public", "assets", "characters", pack, characterId, `${pose}.png`);
  return existsSync(file);
}

function readMeta(root, base, pack, dir) {
  const fallback = { frame: { ...DEFAULT_FRAME }, pivot: { ...DEFAULT_PIVOT }, poses: {} };
  if (!root) return fallback;
  const file = path.join(root, base, pack, dir, "meta.json");
  if (!existsSync(file)) return fallback;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (!isPlain(raw)) return fallback;
    const frame = isPlain(raw.frame)
      ? {
        width: Number(raw.frame.width) || DEFAULT_FRAME.width,
        height: Number(raw.frame.height) || DEFAULT_FRAME.height,
      }
      : { ...DEFAULT_FRAME };
    const pivot = isPlain(raw.pivot)
      ? {
        x: Number.isFinite(Number(raw.pivot.x)) ? Number(raw.pivot.x) : DEFAULT_PIVOT.x,
        y: Number.isFinite(Number(raw.pivot.y)) ? Number(raw.pivot.y) : DEFAULT_PIVOT.y,
      }
      : { ...DEFAULT_PIVOT };
    const poses = {};
    if (isPlain(raw.poses)) {
      for (const [pose, value] of Object.entries(raw.poses)) {
        if (!isPlain(value)) continue;
        const entry = { file: typeof value.file === "string" ? value.file : `${pose}.png` };
        if (isPlain(value.pivot)) {
          entry.pivot = {
            x: Number.isFinite(Number(value.pivot.x)) ? Number(value.pivot.x) : pivot.x,
            y: Number.isFinite(Number(value.pivot.y)) ? Number(value.pivot.y) : pivot.y,
          };
        }
        poses[pose] = entry;
      }
    }
    return { frame, pivot, poses };
  } catch {
    return fallback;
  }
}

function isPlain(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
