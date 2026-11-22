import { trimToCap } from "./compress.js";
import { getMeta, setMeta } from "./db.js";
import { episodesForDay, hasPlayerInteraction } from "./episodes.js";
import { messagesInRange } from "./messages.js";
import { gameDayUtcRange } from "./period.js";

/** Day / week / month diaries stored locally. Rule draft first; the model may upgrade later. */

const SOURCE_PREFIX = "diary.source.";

export function diarySourceKey(characterId, kind, periodKey) {
  return `${SOURCE_PREFIX}${characterId}.${kind}.${periodKey}`;
}

export function getDiarySource(db, characterId, kind, periodKey) {
  return getMeta(db, diarySourceKey(characterId, kind, periodKey)) || "rule";
}

export function setDiarySource(db, characterId, kind, periodKey, source) {
  setMeta(db, diarySourceKey(characterId, kind, periodKey), source);
}

export function getDiary(db, characterId, kind, periodKey) {
  return db.prepare(
    "SELECT id, character_id, kind, period_key, text, created_at FROM diaries WHERE character_id = ? AND kind = ? AND period_key = ?",
  ).get(characterId, kind, periodKey) ?? null;
}

export function writeDiary(db, { characterId, kind, periodKey, text, createdAt, cap, source } = {}) {
  const body = trimToCap(text, cap);
  if (!characterId || !kind || !periodKey || !body) return null;
  const at = createdAt || new Date().toISOString();
  db.prepare(
    `INSERT INTO diaries(character_id, kind, period_key, text, created_at) VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(character_id, kind, period_key) DO UPDATE SET text = excluded.text, created_at = excluded.created_at`,
  ).run(characterId, kind, periodKey, body, at);
  if (source) setDiarySource(db, characterId, kind, periodKey, source);
  return body;
}

export function listDayDiaries(db, characterId, periodKeys) {
  if (!periodKeys?.length) return [];
  const placeholders = periodKeys.map(() => "?").join(", ");
  return db.prepare(
    `SELECT period_key, text FROM diaries
     WHERE character_id = ? AND kind = 'day' AND period_key IN (${placeholders})
     ORDER BY period_key ASC`,
  ).all(characterId, ...periodKeys);
}

export function listRecentDayDiaries(db, characterId, limit) {
  const cap = Math.max(0, Number(limit) || 0);
  if (!characterId || !cap) return [];
  const rows = db.prepare(
    `SELECT period_key, text FROM diaries
     WHERE character_id = ? AND kind = 'day'
     ORDER BY period_key DESC
     LIMIT ?`,
  ).all(characterId, cap);
  return rows.reverse();
}

export function getLatestDiary(db, characterId, kind) {
  if (!characterId || !kind) return null;
  return db.prepare(
    `SELECT period_key, text FROM diaries
     WHERE character_id = ? AND kind = ?
     ORDER BY period_key DESC
     LIMIT 1`,
  ).get(characterId, kind) ?? null;
}

/**
 * Write the rule-based day diary if none exists yet.
 * Does not call a model; upgrades go through the daily compress job.
 */
export async function writeDayDiary(db, characterId, dayKey, cfg, { nowIso } = {}) {
  if (getDiary(db, characterId, "day", dayKey)) return getDiary(db, characterId, "day", dayKey);
  const highlights = collectDayHighlights(db, characterId, dayKey, cfg);
  const interacted = dayHadInteraction(highlights);
  if (!highlights.episodes.length && !interacted && cfg.writeDiaryIfNoInteraction === "none") return null;
  if (!interacted && cfg.writeDiaryIfNoInteraction === "none") return null;

  const text = trimToCap(
    ruleDayDiary(dayKey, highlights.episodes, interacted, highlights),
    cfg.diaryDayChars,
  );
  writeDiary(db, {
    characterId,
    kind: "day",
    periodKey: dayKey,
    text,
    createdAt: nowIso,
    cap: cfg.diaryDayChars,
    source: "rule",
  });
  return getDiary(db, characterId, "day", dayKey);
}

/**
 * Write or refresh a week diary from current day drafts.
 * `overwrite`: "if-missing" (default), "unless-model" (update a rule draft, never smash a model upgrade),
 * or "always".
 */
export function writeWeekDiary(db, characterId, weekKey, dayKeys, cfg, nowIso, opts = {}) {
  return writePeriodDiary(db, {
    characterId,
    kind: "week",
    periodKey: weekKey,
    dayKeys,
    cap: cfg.diaryWeekChars,
    nowIso,
    overwrite: opts.overwrite,
  });
}

export function writeMonthDiary(db, characterId, monthKey, dayKeys, cfg, nowIso, opts = {}) {
  return writePeriodDiary(db, {
    characterId,
    kind: "month",
    periodKey: monthKey,
    dayKeys,
    cap: cfg.diaryMonthChars,
    nowIso,
    overwrite: opts.overwrite,
  });
}

function writePeriodDiary(db, { characterId, kind, periodKey, dayKeys, cap, nowIso, overwrite = "if-missing" }) {
  const existing = getDiary(db, characterId, kind, periodKey);
  const source = existing ? getDiarySource(db, characterId, kind, periodKey) : null;
  if (existing && source === "model" && overwrite !== "always") return existing;
  if (existing && overwrite === "if-missing") return existing;
  const days = listDayDiaries(db, characterId, dayKeys);
  if (!days.length) return existing ?? null;
  const text = trimToCap(days.map((row) => `${row.period_key}：${row.text}`).join("\n"), cap);
  writeDiary(db, {
    characterId,
    kind,
    periodKey,
    text,
    createdAt: nowIso,
    cap,
    source: "rule",
  });
  return getDiary(db, characterId, kind, periodKey);
}

export function ruleDayDiary(dayKey, episodes, interacted, extras = {}) {
  const chatLines = extras.playerChat ?? extras.chatLines ?? [];
  const replyLines = extras.replies ?? extras.replyLines ?? [];
  const interjectLines = extras.interject ?? extras.interjectLines ?? [];
  const npcLines = extras.npc ?? extras.npcLines ?? [];
  const overhearLines = extras.overhear ?? extras.overhearLines ?? [];
  if (!episodes?.length && !chatLines.length && !replyLines.length && !interjectLines.length && !npcLines.length && !overhearLines.length) {
    return `${dayKey}：这一天很安静。`;
  }
  const actions = unique((episodes ?? []).map((row) => describeAction(row)).filter(Boolean));
  const spoken = unique([
    ...(episodes ?? []).filter((row) => Number(row.speech_landed) === 1 && row.line).map((row) => row.line),
    ...replyLines,
    ...interjectLines,
  ]);
  let text = `${dayKey}：${actions.join("，") || "过了一天"}。`;
  if (chatLines.length) text += `你说了「${chatLines.join("」「")}」。`;
  if (spoken.length) text += `对你说了「${spoken.join("」「")}」。`;
  else if (!interacted && !npcLines.length) text += "没有和你说话。";
  if (npcLines.length) text += `和同伴说了「${npcLines.join("」「")}」。`;
  if (overhearLines.length) text += `听见了「${overhearLines.join("」「")}」。`;
  return text;
}

export function collectDayHighlights(db, characterId, dayKey, cfg = {}) {
  const episodes = episodesForDay(db, characterId, dayKey);
  const range = gameDayUtcRange(dayKey, cfg.diaryAtHhmm || "07:00");
  const rows = range ? messagesInRange(db, characterId, range.start, range.end) : [];
  const playerChat = rows.filter((row) => row.kind === "chat" && row.role === "user").map((row) => row.text);
  const replies = rows.filter((row) => row.kind === "chat" && row.role === "character").map((row) => row.text);
  const fromSpeech = rows.filter((row) => row.kind === "speech").map((row) => row.text);
  const fromEpisodes = episodes.filter((row) => Number(row.speech_landed) === 1 && row.line).map((row) => row.line);
  const proactive = unique([...fromSpeech, ...fromEpisodes]);
  const npc = rows.filter((row) => row.kind === "npc").map((row) => row.text);
  const interject = rows.filter((row) => row.kind === "interject").map((row) => row.text);
  const overhear = unique(rows.filter((row) => row.kind === "overhear").map((row) => row.text));
  return { episodes, playerChat, replies, proactive, npc, interject, overhear, messages: rows };
}

export function dayHadInteraction(highlights) {
  if (!highlights) return false;
  if (highlights.playerChat?.length || highlights.replies?.length) return true;
  if (highlights.proactive?.length || highlights.npc?.length || highlights.interject?.length) return true;
  if (highlights.overhear?.length) return true;
  return hasPlayerInteraction(highlights.episodes);
}

export function noteworthyText(highlights) {
  const bits = [
    ...(highlights?.playerChat ?? []),
    ...(highlights?.replies ?? []),
    ...(highlights?.proactive ?? []),
    ...(highlights?.npc ?? []),
    ...(highlights?.interject ?? []),
    ...(highlights?.overhear ?? []),
  ].map((text) => String(text || "").trim()).filter(Boolean);
  return unique(bits).join("\n");
}

function describeAction(row) {
  if (row.summary) return row.summary.replace(/ 开口：.*$/, "");
  if (row.action && row.room) return `${row.action}@${row.room}`;
  return row.action || "";
}

function unique(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
