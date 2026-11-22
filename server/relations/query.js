/**
 * Budgeted text packs for think (idle, ~one line) and chat prompts.
 * Never dumps the full graph or raw pairwise matrices.
 */

import { VIEWER_ID, config as defaultConfig } from "./config.js";
import { edgesFrom, getEdge } from "./graph.js";
import { stanceLabel } from "./schema.js";

export function queryPack(world, characterId, kind = "idle", cfg = defaultConfig) {
  if (!world || !characterId) return "";
  const cap = packCap(kind, cfg);
  const viewerId = cfg.viewerId ?? VIEWER_ID;
  const selfToViewer = getEdge(world, characterId, viewerId);
  const parts = [];

  if (selfToViewer) {
    if (kind === "chat") {
      parts.push(
        `对你：${famBand(selfToViewer.familiarity)}、${closeBand(selfToViewer.closeness)}，立场是${stanceLabel(selfToViewer.stance)}。`,
      );
    } else {
      parts.push(`对你${famBand(selfToViewer.familiarity)}、${closeBand(selfToViewer.closeness)}。`);
    }
  }

  const others = edgesFrom(world, characterId)
    .filter((edge) => edge.to !== viewerId && edge.to !== characterId)
    .sort((a, b) => (b.familiarity + b.closeness) - (a.familiarity + a.closeness));

  const limit = kind === "chat" ? 2 : 2;
  for (const edge of others.slice(0, limit)) {
    const name = displayName(world, edge.to);
    if (kind === "chat") {
      const back = getEdge(world, edge.to, characterId);
      let line = `和${name}：${famBand(edge.familiarity)}、${closeBand(edge.closeness)}，视其为${stanceLabel(edge.stance)}`;
      if (back) line += `；对方${closeBand(back.closeness)}`;
      parts.push(`${line}。`);
    } else {
      parts.push(`和${name}是${stanceLabel(edge.stance)}。`);
    }
  }

  return clip(parts.join(""), cap);
}

function packCap(kind, cfg) {
  if (kind === "chat") return Number(cfg.packs?.chatPackChars) || 160;
  return Number(cfg.packs?.idlePackChars) || 60;
}

export function famBand(value) {
  const n = Number(value) || 0;
  if (n < 11) return "还陌生";
  if (n < 31) return "认得";
  if (n < 56) return "熟悉";
  if (n < 76) return "很熟";
  return "极为熟悉";
}

export function closeBand(value) {
  const n = Number(value) || 0;
  if (n < 11) return "疏远";
  if (n < 31) return "客气";
  if (n < 56) return "有些亲近";
  if (n < 76) return "亲近";
  return "很亲";
}

function displayName(world, id) {
  if (id === VIEWER_ID) return "你";
  return world?.characters?.[id]?.name || id;
}

function clip(text, cap) {
  if (!text) return "";
  if (!Number.isFinite(cap) || cap <= 0 || text.length <= cap) return text;
  return text.slice(0, cap);
}
