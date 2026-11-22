/**
 * Rule-based trim plus the daily diary-upgrade hook.
 * maybeCompressWithModel still does not call a provider unless useModel is true.
 * Structured compress jobs live in upgrade.js and never run on chat / think paths.
 */

export function trimToCap(text, cap) {
  const value = text == null ? "" : String(text);
  const limit = Number(cap);
  if (!Number.isFinite(limit) || limit <= 0) return "";
  if (value.length <= limit) return value;
  const lines = value.split("\n");
  while (lines.length > 1 && lines.join("\n").length > limit) {
    lines.shift();
  }
  let out = lines.join("\n");
  if (out.length > limit) out = out.slice(out.length - limit);
  return out;
}

/**
 * Hook for a later model-written compress / diary.
 * This pass must not call provider.complete unless useModel is explicitly true.
 */
export async function maybeCompressWithModel(text, { cap, useModel, provider, alreadyUsedToday } = {}) {
  if (!useModel || !provider?.complete) return trimToCap(text, cap);
  if (alreadyUsedToday) return trimToCap(text, cap);
  const raw = await provider.complete({ prompt: text, purpose: "memory-compress" });
  const next = typeof raw === "string" ? raw : raw?.text ?? String(raw ?? "");
  return trimToCap(next, cap);
}

export async function completeWithTimeout(provider, input, timeoutMs) {
  if (!provider?.complete) throw new Error("no-provider");
  const limit = Number(timeoutMs);
  const ms = Number.isFinite(limit) && limit > 0 ? limit : 20_000;
  let timer;
  try {
    return await Promise.race([
      provider.complete(input),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
        if (typeof timer.unref === "function") timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Build a budgeted compress prompt. Does not include raw transcripts. */
export function buildCompressPrompt({
  characterId,
  dayKey,
  ruleDay,
  digest,
  facts = [],
  topics = [],
  includeWeek = false,
  includeMonth = false,
  ruleWeek = "",
  ruleMonth = "",
  cfg,
} = {}) {
  const cap = Number(cfg?.compress?.maxPromptChars) || 2500;
  const dayCap = Number(cfg?.diaryDayChars) || 400;
  const weekCap = Number(cfg?.diaryWeekChars) || 600;
  const monthCap = Number(cfg?.diaryMonthChars) || 800;
  const factCap = Number(cfg?.factMaxChars) || 80;
  const parts = [
    "你在整理角色的记忆摘要。只返回一个 JSON 对象，不要附加其它文字。",
    `角色：${characterId}。日期：${dayKey}。`,
    `字段：dayDiary（必填，不超过${dayCap}字）、facts（[{text, importance}]，每条不超过${factCap}字）、topics（[{text}]）、retireFacts（[text]）。`,
  ];
  if (includeWeek) parts.push(`若提供了周记草稿，同时给出 weekDiary（不超过${weekCap}字）。`);
  if (includeMonth) parts.push(`若提供了月记草稿，同时给出 monthDiary（不超过${monthCap}字）。`);
  parts.push("保留重要事实，不要改写人设，不要编造没出现过的事。");
  if (ruleDay) parts.push(`当日规则日记：\n${trimToCap(ruleDay, dayCap)}`);
  if (digest) parts.push(`当日要点（非完整对话）：\n${trimToCap(digest, 800)}`);
  if (facts.length) parts.push(`已有事实：${trimToCap(facts.join("；"), 400)}`);
  if (topics.length) parts.push(`当前话题：${trimToCap(topics.join("、"), 120)}`);
  if (includeWeek && ruleWeek) parts.push(`本周规则周记：\n${trimToCap(ruleWeek, weekCap)}`);
  if (includeMonth && ruleMonth) parts.push(`本月规则月记：\n${trimToCap(ruleMonth, monthCap)}`);
  return trimToCap(parts.join("\n"), cap);
}

export function parseCompressOutput(raw, cfg = {}) {
  const text = rawToText(raw);
  if (!text) return null;
  const limited = trimToCap(text, Number(cfg?.compress?.maxOutputChars) || 1200);
  const parsed = extractJson(limited) ?? extractJson(text);
  if (!parsed || typeof parsed !== "object") return null;
  const dayDiary = cleanText(parsed.dayDiary);
  if (!dayDiary) return null;
  const out = {
    dayDiary: trimToCap(dayDiary, cfg.diaryDayChars ?? 400),
  };
  const weekDiary = cleanText(parsed.weekDiary);
  if (weekDiary) out.weekDiary = trimToCap(weekDiary, cfg.diaryWeekChars ?? 600);
  const monthDiary = cleanText(parsed.monthDiary);
  if (monthDiary) out.monthDiary = trimToCap(monthDiary, cfg.diaryMonthChars ?? 800);
  out.facts = asFactList(parsed.facts, cfg);
  out.topics = asTopicList(parsed.topics, cfg);
  out.retireFacts = asTextList(parsed.retireFacts, cfg.factMaxChars ?? 80);
  return out;
}

function rawToText(raw) {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw.text === "string") return raw.text.trim();
  if (typeof raw.content === "string") return raw.content.trim();
  return "";
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asFactList(raw, cfg) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const text = trimToCap(typeof item === "string" ? item.trim() : String(item?.text ?? "").trim(), cfg.factMaxChars ?? 80);
    if (!text) continue;
    const importance = Number.isFinite(Number(item?.importance)) ? Number(item.importance) : cfg.factImportanceDefault ?? 1;
    out.push({ text, importance });
  }
  return out;
}

function asTopicList(raw, cfg) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const text = trimToCap(typeof item === "string" ? item.trim() : String(item?.text ?? "").trim(), cfg.topicMaxChars ?? 20);
    if (!text) continue;
    out.push({ text });
  }
  return out;
}

function asTextList(raw, cap) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => trimToCap(typeof item === "string" ? item.trim() : String(item?.text ?? "").trim(), cap)).filter(Boolean);
}
