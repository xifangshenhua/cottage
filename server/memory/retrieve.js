import { trimToCap } from "./compress.js";
import { getLatestDiary, listRecentDayDiaries } from "./diaries.js";
import { episodesForDay } from "./episodes.js";
import { listFacts } from "./facts.js";
import { recentMessages } from "./messages.js";
import { listTopics } from "./topics.js";
import { getWorking } from "./working.js";

/**
 * Pick a budgeted memory pack.
 * idle: facts + topics + today summary + last line. Day diaries only if idleDiaryDays > 0.
 * engaged: same shape plus last engagedDiaryDays day diaries, still capped (drop older diaries first).
 * chat: working memory + facts + today + recent turns + last chatDiaryDays day diaries
 *       + latest week/month when enabled, still capped. Drop older diaries first; keep facts.
 */
export function retrieve(db, characterId, kind, cfg, { world, character, clock, now } = {}) {
  const packKind = kind === "chat" ? "chat" : kind === "engaged" ? "engaged" : "idle";
  if (packKind === "chat") return retrieveChat(db, characterId, cfg, { character, clock });
  return retrieveThink(db, characterId, packKind, cfg, { world, character, clock, now });
}

export function selectPackKind(world, character, now, cfg, mode = "think") {
  if (mode === "chat") return cfg.packs.chat || "chat";
  const nowMs = toMs(now);
  if (spokeRecently(character, nowMs, cfg) && cfg.packs.justSpoke) return cfg.packs.justSpoke;
  if (world?.viewer?.present && cfg.packs.viewerPresent) return cfg.packs.viewerPresent;
  return cfg.packs.idle || "idle";
}

function retrieveThink(db, characterId, packKind, cfg, { character, clock, now }) {
  const cap = packKind === "engaged" ? cfg.engagedPackChars : cfg.idlePackChars;
  const factCount = packKind === "engaged" ? cfg.engagedFactCount : cfg.idleFactCount;
  const topicCount = packKind === "engaged" ? cfg.engagedTopicCount : cfg.idleTopicCount;
  const nowMs = toMs(now) ?? Date.now();
  const diaryDays = packKind === "engaged" ? cfg.engagedDiaryDays : cfg.idleDiaryDays;

  const lastLine = lastSpokenLine(character, cfg);
  const today = todaySummary(db, characterId, clock, cfg);
  const topics = listTopics(db, characterId, cfg, nowMs).slice(0, topicCount).map((row) => row.text);
  const facts = listFacts(db, characterId, factCount).map((row) => row.text);

  const preferred = [];
  if (lastLine) preferred.push(`上次开口：${lastLine}`);
  if (today) preferred.push(`今日：${today}`);
  if (topics.length) preferred.push(`话题：${topics.join("、")}`);
  if (facts.length) preferred.push(`事实：${facts.join("；")}`);

  const diaries = dayDiarySections(listRecentDayDiaries(db, characterId, diaryDays));
  return assemblePack(preferred, diaries, cap);
}

function retrieveChat(db, characterId, cfg, { character, clock }) {
  const cap = cfg.chatPackChars;
  const facts = listFacts(db, characterId, cfg.chatFactCount).map((row) => row.text);
  const working = getWorking(db, characterId).text;
  const turns = recentChatTurns(db, characterId, cfg);
  const lastLine = lastSpokenLine(character, cfg);
  const today = todaySummary(db, characterId, clock, cfg);

  const preferred = [];
  if (working) preferred.push(`工作记忆：\n${working}`);
  if (facts.length) preferred.push(`事实：${facts.join("；")}`);
  if (today) preferred.push(`今日：${today}`);
  if (lastLine) preferred.push(`上次开口：${lastLine}`);
  if (turns.length) {
    const lines = turns.map((row) => `${row.role || row.kind}：${row.text}`);
    preferred.push(`最近对话：\n${lines.join("\n")}`);
  }

  const diaries = dayDiarySections(listRecentDayDiaries(db, characterId, cfg.chatDiaryDays));
  if (cfg.chatIncludeWeek) {
    const week = getLatestDiary(db, characterId, "week");
    if (week?.text) diaries.push({ key: `week:${week.period_key}`, text: `周记：${week.text}` });
  }
  if (cfg.chatIncludeMonth) {
    const month = getLatestDiary(db, characterId, "month");
    if (month?.text) diaries.push({ key: `month:${month.period_key}`, text: `月记：${month.text}` });
  }
  return assemblePack(preferred, diaries, cap);
}

/**
 * Keep preferred sections (facts, working memory, today, turns).
 * If over cap, drop older diary sections first; then week/month; never drop facts first.
 */
export function assemblePack(preferred, diaries, cap) {
  const limit = Number(cap);
  const core = preferred.filter(Boolean);
  const items = (diaries ?? []).filter((row) => row?.text);
  if (!Number.isFinite(limit) || limit <= 0) return "";

  const render = (list) => {
    const sections = list.length ? [...core, ...list.map((row) => row.text)] : [...core];
    return sections.join("\n");
  };

  let chosen = items.slice();
  while (chosen.length && render(chosen).length > limit) {
    chosen.shift();
  }
  const packed = render(chosen);
  if (packed.length <= limit) return packed;
  return trimToCap(core.join("\n"), limit);
}

function dayDiarySections(rows) {
  if (!rows?.length) return [];
  return rows.map((row) => ({
    key: row.period_key,
    text: `日记：${row.period_key}：${row.text}`,
  }));
}

function recentChatTurns(db, characterId, cfg) {
  const want = Math.max(0, Number(cfg.chatRecentTurns) || 0);
  if (!want) return [];
  if (cfg.includeOverhearInChatPack) return recentMessages(db, characterId, want);
  const window = Math.max(want * 3, want);
  return recentMessages(db, characterId, window)
    .filter((row) => row.kind !== "overhear")
    .slice(-want);
}

function todaySummary(db, characterId, clock, cfg) {
  const dayKey = clock?.dayKey;
  if (!dayKey) return "";
  const episodes = episodesForDay(db, characterId, dayKey);
  if (!episodes.length) return "";
  const bits = episodes.map((row) => row.summary || row.action).filter(Boolean);
  return trimToCap(unique(bits).join("，"), cfg.todaySummaryChars);
}

function lastSpokenLine(character, cfg) {
  const line = typeof character?.line === "string" ? character.line.trim() : "";
  if (!line) return "";
  return trimToCap(line, cfg.lastLineChars);
}

function spokeRecently(character, nowMs, cfg) {
  if (!Number.isFinite(nowMs)) return false;
  const last = Date.parse(character?.lastProactiveAt || "");
  if (!Number.isFinite(last)) return false;
  return nowMs - last >= 0 && nowMs - last <= cfg.recentInteractionMin * 60_000;
}

function toMs(now) {
  if (now instanceof Date) return now.getTime();
  const parsed = Date.parse(now);
  return Number.isFinite(parsed) ? parsed : null;
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
