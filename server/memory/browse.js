/**
 * Read-only assembly of one character's diaries, facts, and topics.
 * Today's draft is computed with collectDayHighlights + ruleDayDiary and
 * is never written to the diaries table.
 */
import { nowClock } from "../clock.js";
import { resolveMemory } from "../settings/index.js";
import { gameDayKey } from "../think/speech/gates.js";
import { trimToCap } from "./compress.js";
import { mergeMemoryConfig } from "./config.js";
import {
  collectDayHighlights,
  dayHadInteraction,
  getDiary,
  getDiarySource,
  ruleDayDiary,
} from "./diaries.js";
import { listFacts } from "./facts.js";

export const CHARACTER_IDS = ["qingqing", "linxia", "xiaonan"];

export const DEFAULT_CHARACTER_NAMES = {
  qingqing: "青青",
  linxia: "林夏",
  xiaonan: "小南",
};

export const SOURCE_LABELS = {
  today: "今日草稿",
  rule: "规则底稿",
  model: "模型整理",
};

export function isKnownCharacterId(id) {
  return CHARACTER_IDS.includes(id);
}

export function characterNameOf(id, names = {}) {
  if (names && typeof names[id] === "string" && names[id].trim()) return names[id].trim();
  return DEFAULT_CHARACTER_NAMES[id] || id;
}

export function browseConfig(opts = {}) {
  if (opts.config) return opts.config;
  if (opts.settings) return resolveMemory(opts.settings);
  return mergeMemoryConfig();
}

/**
 * Current game day using diaryAtHhmm / the house "游戏日起点" (default 07:00).
 */
export function currentGameDay(opts = {}) {
  const cfg = browseConfig(opts);
  const at = toDate(opts.now);
  const clock = opts.clock ?? nowClock(at);
  const dayStartHhmm = normalizeHhmm(cfg.diaryAtHhmm || "07:00");
  const dayKey = gameDayKey(clock, { dayStartHhmm }) || clock?.dayKey || null;
  return { dayKey, dayStartHhmm, clock, now: at, config: cfg };
}

export function browseCharacter(db, characterId, opts = {}) {
  const { dayKey, dayStartHhmm, config: cfg } = currentGameDay(opts);
  const today = dayKey ? buildTodayDraft(db, characterId, dayKey, cfg) : null;
  const listed = listPersistedDiaries(db, characterId, today?.dayKey ?? null);
  return {
    ok: true,
    character: {
      id: characterId,
      name: characterNameOf(characterId, opts.names || { [characterId]: opts.name }),
    },
    dayStartHhmm,
    dayKey,
    today,
    diaries: listed.diaries,
    weeks: listed.weeks,
    months: listed.months,
    facts: presentFacts(db, characterId),
    topics: presentTopics(db, characterId),
  };
}

/**
 * Compute the in-memory rule draft for the current game day.
 * Returns null when a persisted day diary already exists, or when a quiet
 * day would not be written (`writeDiaryIfNoInteraction === "none"`).
 */
export function buildTodayDraft(db, characterId, dayKey, cfg) {
  if (!db || !characterId || !dayKey) return null;
  if (getDiary(db, characterId, "day", dayKey)) return null;
  const highlights = collectDayHighlights(db, characterId, dayKey, cfg);
  const interacted = dayHadInteraction(highlights);
  if (!interacted && cfg.writeDiaryIfNoInteraction === "none") return null;
  const text = trimToCap(
    ruleDayDiary(dayKey, highlights.episodes, interacted, highlights),
    cfg.diaryDayChars,
  );
  if (!text) return null;
  return {
    dayKey,
    kind: "day",
    source: "today",
    text,
    persisted: false,
  };
}

export function listPersistedDiaries(db, characterId, excludeDayKey = null) {
  return {
    diaries: listKind(db, characterId, "day").filter((row) => row.periodKey !== excludeDayKey),
    weeks: listKind(db, characterId, "week"),
    months: listKind(db, characterId, "month"),
  };
}

function listKind(db, characterId, kind) {
  const rows = db.prepare(
    `SELECT kind, period_key, text, created_at
     FROM diaries
     WHERE character_id = ? AND kind = ?
     ORDER BY period_key DESC`,
  ).all(characterId, kind);
  return rows.map((row) => ({
    kind: row.kind,
    periodKey: row.period_key,
    text: row.text,
    source: sanitizeSource(getDiarySource(db, characterId, kind, row.period_key)),
    createdAt: row.created_at,
    persisted: true,
  }));
}

function presentFacts(db, characterId) {
  return listFacts(db, characterId).map((row) => ({
    text: row.text,
    importance: row.importance,
    updatedAt: row.updated_at,
  }));
}

/** Read-only: do not expire/delete topics during a browse or export GET. */
function presentTopics(db, characterId) {
  const rows = db.prepare(
    `SELECT text, last_mentioned_at
     FROM topics WHERE character_id = ?
     ORDER BY last_mentioned_at DESC, id DESC`,
  ).all(characterId);
  return rows.map((row) => ({
    text: row.text,
    lastMentionedAt: row.last_mentioned_at,
  }));
}

function sanitizeSource(source) {
  return source === "model" ? "model" : "rule";
}

function normalizeHhmm(hhmm) {
  const raw = typeof hhmm === "string" && /^\d{1,2}:\d{2}/.test(hhmm) ? hhmm : "07:00";
  const [h, m] = raw.split(":");
  return `${String(Number(h)).padStart(2, "0")}:${String(Number(m)).padStart(2, "0")}`;
}

function toDate(now) {
  if (now instanceof Date) return now;
  if (now == null) return new Date();
  const parsed = Date.parse(now);
  return Number.isFinite(parsed) ? new Date(parsed) : new Date();
}
