/**
 * Daily rule-first diary upgrade. One merged model job per eligible character
 * per closed game day, at most one job per tickDiary call. Never imported by
 * recordChat / recordAfterThink / recordOverhear / recordNpcTalk / tickThink.
 */
import { buildCompressPrompt, completeWithTimeout, parseCompressOutput } from "./compress.js";
import { getMeta, setMeta } from "./db.js";
import {
  collectDayHighlights,
  dayHadInteraction,
  getDiary,
  getLatestDiary,
  noteworthyText,
  writeDiary,
} from "./diaries.js";
import { listFacts, retireFact, upsertFact } from "./facts.js";
import { isoWeekKey, isIsoWeekBoundary, isMonthBoundary } from "./period.js";
import { listTopics, rememberTopic } from "./topics.js";

const LAST_CLOSED_KEY = "lastClosedDiaryDay";
const LAST_JOB_AT_KEY = "compress.lastJobAt";

export function lastClosedDiaryDay(db) {
  return getMeta(db, LAST_CLOSED_KEY);
}

export function setLastClosedDiaryDay(db, dayKey) {
  setMeta(db, LAST_CLOSED_KEY, dayKey);
}

export function compressEnabled(cfg) {
  return !!cfg?.compress?.enabled;
}

export function isDayEligibleForModel(highlights, cfg, { includeWeek = false, includeMonth = false } = {}) {
  const c = cfg?.compress ?? {};
  if (!c.enabled) return false;
  const quiet = isQuietDay(highlights);
  if (quiet) return !!c.modelIfQuietDay && (!!c.diaryUseModel || includeWeek || includeMonth);
  const noteworthy =
    (!!c.modelIfPlayerChat && (highlights?.playerChat?.length > 0))
    || (!!c.modelIfProactiveSpeech && (highlights?.proactive?.length > 0))
    || (!!c.modelIfNpcTalk && (highlights?.npc?.length > 0));
  if (!noteworthy) return false;
  const minChars = Number(c.minNewContentChars);
  if (Number.isFinite(minChars) && minChars > 0 && noteworthyText(highlights).length < minChars) {
    return false;
  }
  return !!c.diaryUseModel || includeWeek || includeMonth;
}

export function isQuietDay(highlights) {
  return !highlights?.playerChat?.length
    && !highlights?.replies?.length
    && !highlights?.proactive?.length
    && !highlights?.npc?.length
    && !dayHadInteraction(highlights);
}

export function jobMetaKey(characterId, dayKey) {
  return `compress.job.${characterId}.${dayKey}`;
}

export function houseJobMetaKey(gameDayKey) {
  return `compress.house.${gameDayKey}`;
}

export function readJob(db, characterId, dayKey) {
  const raw = getMeta(db, jobMetaKey(characterId, dayKey));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { status: raw };
  }
}

export function writeJob(db, characterId, dayKey, job) {
  setMeta(db, jobMetaKey(characterId, dayKey), JSON.stringify(job));
  return job;
}

export function houseJobCount(db, gameDayKey) {
  const n = Number(getMeta(db, houseJobMetaKey(gameDayKey)));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function incrementHouseJobCount(db, gameDayKey) {
  const next = houseJobCount(db, gameDayKey) + 1;
  setMeta(db, houseJobMetaKey(gameDayKey), String(next));
  return next;
}

export function enqueueCompressJobs(db, characterIds, dayKey, cfg) {
  const includeWeek = isIsoWeekBoundary(dayKey) && !!cfg?.compress?.weekUseModel;
  const includeMonth = isMonthBoundary(dayKey) && !!cfg?.compress?.monthUseModel;
  const queued = [];
  for (const characterId of characterIds) {
    const existing = readJob(db, characterId, dayKey);
    if (existing?.status === "done" || existing?.status === "skipped") continue;
    if (existing?.status === "pending" || existing?.status === "failed") {
      queued.push(existing);
      continue;
    }
    if (!compressEnabled(cfg)) {
      queued.push(writeJob(db, characterId, dayKey, { characterId, dayKey, status: "skipped", reason: "disabled" }));
      continue;
    }
    const highlights = collectDayHighlights(db, characterId, dayKey, cfg);
    if (!isDayEligibleForModel(highlights, cfg, { includeWeek, includeMonth })) {
      queued.push(writeJob(db, characterId, dayKey, {
        characterId,
        dayKey,
        status: "skipped",
        reason: "ineligible",
        includeWeek,
        includeMonth,
      }));
      continue;
    }
    queued.push(writeJob(db, characterId, dayKey, {
      characterId,
      dayKey,
      status: "pending",
      attempts: 0,
      includeWeek,
      includeMonth,
    }));
  }
  return queued;
}

/**
 * Run at most one pending / retryable job for the closed day.
 * Returns the job record, or null if none ran.
 */
export async function runNextCompressJob(db, characterIds, dayKey, cfg, { now, provider, getProvider, currentGameDay } = {}) {
  if (!compressEnabled(cfg)) return null;
  const at = toDate(now);
  const lastAt = Date.parse(getMeta(db, LAST_JOB_AT_KEY) || "");
  const stagger = Number(cfg.compress?.staggerMs);
  if (Number.isFinite(stagger) && stagger > 0 && Number.isFinite(lastAt) && at.getTime() - lastAt < stagger) {
    return { skipped: "stagger" };
  }
  const houseDay = currentGameDay || dayKey;
  const houseCap = Number(cfg.compress?.maxModelJobsPerHouseDay);
  if (Number.isFinite(houseCap) && houseCap >= 0 && houseJobCount(db, houseDay) >= houseCap) {
    return { skipped: "house-budget" };
  }

  const job = pickRunnableJob(db, characterIds, dayKey, cfg);
  if (!job) return null;
  const live = typeof getProvider === "function" ? getProvider(job.characterId) : provider;
  if (!live?.complete) return null;

  const characterMax = Number(cfg.compress?.maxModelJobsPerCharacterDay) || 1;
  if ((Number(job.attempts) || 0) >= characterMax + (cfg.compress?.retryFailedUpgrade ? 1 : 0)) {
    return writeJob(db, job.characterId, dayKey, { ...job, status: "failed", reason: "character-budget" });
  }

  const started = writeJob(db, job.characterId, dayKey, {
    ...job,
    status: "running",
    attempts: (Number(job.attempts) || 0) + 1,
  });
  incrementHouseJobCount(db, houseDay);
  setMeta(db, LAST_JOB_AT_KEY, at.toISOString());

  try {
    const applied = await upgradeWithModel(db, started, cfg, { nowIso: at.toISOString(), provider: live });
    if (applied.ok) {
      return writeJob(db, job.characterId, dayKey, {
        ...started,
        status: "done",
        includeWeek: started.includeWeek,
        includeMonth: started.includeMonth,
      });
    }
    return writeJob(db, job.characterId, dayKey, {
      ...started,
      status: "failed",
      reason: applied.reason || "invalid",
    });
  } catch (err) {
    return writeJob(db, job.characterId, dayKey, {
      ...started,
      status: "failed",
      reason: err?.message === "timeout" ? "timeout" : "provider-error",
    });
  }
}

export function pickRunnableJob(db, characterIds, dayKey, cfg) {
  const retry = cfg?.compress?.retryFailedUpgrade !== false;
  for (const characterId of characterIds) {
    const job = readJob(db, characterId, dayKey);
    if (!job) continue;
    if (job.status === "pending") return job;
    if (job.status === "failed" && retry && (Number(job.attempts) || 0) < 2) return job;
  }
  return null;
}

export async function upgradeWithModel(db, job, cfg, { nowIso, provider } = {}) {
  const characterId = job.characterId;
  const dayKey = job.dayKey;
  const ruleDay = getDiary(db, characterId, "day", dayKey)?.text || "";
  const highlights = collectDayHighlights(db, characterId, dayKey, cfg);
  const facts = listFacts(db, characterId).map((row) => row.text);
  const topics = listTopics(db, characterId, cfg, Date.parse(nowIso) || Date.now()).map((row) => row.text);
  const weekKey = isoWeekKey(dayKey);
  const monthKey = String(dayKey).slice(0, 7);
  const ruleWeek = job.includeWeek ? (getDiary(db, characterId, "week", weekKey)?.text || getLatestDiary(db, characterId, "week")?.text || "") : "";
  const ruleMonth = job.includeMonth ? (getDiary(db, characterId, "month", monthKey)?.text || "") : "";
  const prompt = buildCompressPrompt({
    characterId,
    dayKey,
    ruleDay,
    digest: buildDayDigest(highlights),
    facts,
    topics,
    includeWeek: !!job.includeWeek,
    includeMonth: !!job.includeMonth,
    ruleWeek,
    ruleMonth,
    cfg,
  });

  const raw = await completeWithTimeout(provider, { prompt, purpose: "memory-compress" }, cfg.compress?.timeoutMs);
  const parsed = parseCompressOutput(raw, cfg);
  if (!parsed) return { ok: false, reason: "invalid" };
  applyCompressResult(db, job, parsed, cfg, nowIso);
  return { ok: true, parsed };
}

export function applyCompressResult(db, job, parsed, cfg, nowIso) {
  const characterId = job.characterId;
  const dayKey = job.dayKey;
  if (parsed.dayDiary) {
    writeDiary(db, {
      characterId,
      kind: "day",
      periodKey: dayKey,
      text: parsed.dayDiary,
      createdAt: nowIso,
      cap: cfg.diaryDayChars,
      source: "model",
    });
  }
  if (job.includeWeek && parsed.weekDiary) {
    writeDiary(db, {
      characterId,
      kind: "week",
      periodKey: isoWeekKey(dayKey),
      text: parsed.weekDiary,
      createdAt: nowIso,
      cap: cfg.diaryWeekChars,
      source: "model",
    });
  }
  if (job.includeMonth && parsed.monthDiary) {
    writeDiary(db, {
      characterId,
      kind: "month",
      periodKey: String(dayKey).slice(0, 7),
      text: parsed.monthDiary,
      createdAt: nowIso,
      cap: cfg.diaryMonthChars,
      source: "model",
    });
  }
  for (const fact of parsed.facts ?? []) {
    upsertFact(db, characterId, fact, cfg, nowIso);
  }
  for (const text of parsed.retireFacts ?? []) {
    retireFact(db, characterId, text, cfg);
  }
  for (const topic of parsed.topics ?? []) {
    rememberTopic(db, characterId, topic, cfg, nowIso);
  }
}

function buildDayDigest(highlights) {
  const lines = [];
  for (const text of highlights?.playerChat ?? []) lines.push(`你：「${clip(text, 60)}」`);
  for (const text of highlights?.replies ?? []) lines.push(`回复：「${clip(text, 60)}」`);
  for (const text of highlights?.proactive ?? []) lines.push(`开口：「${clip(text, 60)}」`);
  for (const text of highlights?.npc ?? []) lines.push(`同伴：「${clip(text, 60)}」`);
  const actions = (highlights?.episodes ?? []).map((row) => row.summary || row.action).filter(Boolean);
  if (actions.length) lines.push(`行动：${unique(actions).slice(0, 8).join("，")}`);
  return lines.join("\n");
}

function clip(text, cap) {
  const value = String(text ?? "").trim();
  if (!value) return "";
  if (!Number.isFinite(cap) || cap <= 0 || value.length <= cap) return value;
  return value.slice(0, cap);
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

function toDate(now) {
  if (now instanceof Date) return now;
  const parsed = Date.parse(now);
  return Number.isFinite(parsed) ? new Date(parsed) : new Date();
}
