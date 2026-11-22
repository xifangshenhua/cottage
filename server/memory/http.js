/**
 * HTTP parsing and responses for the read-only memory browse and export APIs.
 * Never writes the diaries table, lastDiaryGameDay, or a file on disk.
 */
import {
  CHARACTER_IDS,
  browseCharacter,
  characterNameOf,
  isKnownCharacterId,
} from "./browse.js";
import { contentDisposition, exportAll, exportCharacter } from "./export.js";

const KNOWN_EXPORT_IDS = new Set([...CHARACTER_IDS, "all"]);

export function getMemoryBrowseResponse(world, url, opts = {}) {
  const params = searchParamsOf(url);
  const character = readCharacterParam(params);
  if (character.error) {
    return { status: 400, body: { ok: false, error: character.error } };
  }
  if (!isAllowedCharacter(character.id, world) || character.id === "all") {
    return { status: 400, body: { ok: false, error: "unknown-character" } };
  }
  const ctx = browseContext(world, opts);
  const body = world.memory.browseCharacter
    ? world.memory.browseCharacter(character.id, ctx)
    : browseCharacter(world.memory.db, character.id, ctx);
  return { status: 200, body };
}

export function getMemoryExportResponse(world, url, opts = {}) {
  const params = searchParamsOf(url);
  const character = readCharacterParam(params);
  if (character.error) {
    return { status: 400, body: { ok: false, error: character.error } };
  }
  if (!KNOWN_EXPORT_IDS.has(character.id) || (character.id !== "all" && !isAllowedCharacter(character.id, world))) {
    return { status: 400, body: { ok: false, error: "unknown-character" } };
  }
  const format = parseExportFormat(params.get("format"));
  if (!format) {
    return { status: 400, body: { ok: false, error: "invalid-format" } };
  }
  const ctx = { ...browseContext(world, opts), format };
  const packed = character.id === "all"
    ? (world.memory.exportAll ? world.memory.exportAll(ctx) : exportAll(world.memory.db, ctx))
    : (world.memory.exportCharacter
      ? world.memory.exportCharacter(character.id, ctx)
      : exportCharacter(world.memory.db, character.id, ctx));
  const type = format === "json"
    ? "application/json; charset=utf-8"
    : "text/markdown; charset=utf-8";
  return {
    status: 200,
    body: packed.body,
    headers: {
      "Content-Type": type,
      "Content-Disposition": contentDisposition(packed.filename),
      "Cache-Control": "no-store",
    },
    filename: packed.filename,
  };
}

export function parseExportFormat(raw) {
  if (raw == null || raw === "") return "md";
  const value = String(raw).trim().toLowerCase();
  if (value === "md") return "md";
  if (value === "json") return "json";
  return null;
}

function readCharacterParam(params) {
  if (!params.has("character")) return { error: "missing-character" };
  const raw = params.get("character");
  if (raw == null || !String(raw).trim()) return { error: "missing-character" };
  return { id: String(raw).trim() };
}

function isAllowedCharacter(id, world) {
  if (!isKnownCharacterId(id)) return false;
  const ids = characterIds(world);
  if (!ids.length) return true;
  return ids.includes(id);
}

function browseContext(world, opts = {}) {
  const live = world?.world ?? null;
  const names = characterNames(world);
  return {
    settings: opts.settings ?? world?.settings,
    config: opts.config ?? world?.memory?.config,
    clock: opts.clock ?? live?.clock,
    now: opts.now,
    names,
    name: undefined,
  };
}

function characterIds(world) {
  const live = world?.world?.characters;
  if (live && typeof live === "object") return Object.keys(live);
  return [];
}

function characterNames(world) {
  const names = {};
  for (const id of CHARACTER_IDS) names[id] = characterNameOf(id);
  const live = world?.world?.characters ?? {};
  for (const [id, character] of Object.entries(live)) {
    if (character?.name) names[id] = character.name;
  }
  return names;
}

function searchParamsOf(url) {
  if (url instanceof URL) return url.searchParams;
  if (url && typeof url === "object" && url.searchParams) return url.searchParams;
  return new URL(String(url || "/"), "http://127.0.0.1").searchParams;
}
