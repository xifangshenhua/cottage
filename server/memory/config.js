/**
 * THE ONLY place for memory capacity, retrieval budgets, diary, and
 * fact/topic maintenance numbers. Override from settings/house.json
 * under the "memory" key without changing this file.
 *
 * Nested `memory.compress` and optional `memory.model` merge deeply
 * (see mergeMemoryConfig). Never put API keys in settings; keys stay in `.env`.
 */
export const config = {
  /** Rolling working-memory text (characters). Compiled from episodes; no model required. */
  workingMemoryChars: 2000,

  maxFacts: 40,
  factMaxChars: 80,

  maxTopics: 5,
  topicMaxChars: 20,

  diaryDayChars: 400,
  diaryWeekChars: 600,
  diaryMonthChars: 800,

  messageRetentionDays: 90,
  messageRetentionMax: 2000,
  episodeRetentionDays: 60,
  episodeRetentionMax: 500,

  /** Retrieval budgets. Hard caps; never send full transcripts. */
  idlePackChars: 500,
  engagedPackChars: 800,
  chatPackChars: 2000,

  idleFactCount: 6,
  idleTopicCount: 3,
  engagedFactCount: 10,
  engagedTopicCount: 5,
  chatFactCount: 12,
  chatRecentTurns: 8,
  /** Overhear messages are included in the recent-chat pack, within the existing turn budget. */
  includeOverhearInChatPack: true,

  todaySummaryChars: 120,
  lastLineChars: 80,

  /**
   * How many closed day diaries a retrieve pack may include.
   * Idle think packs stay small: 0 means only the existing "今日" summary.
   */
  idleDiaryDays: 0,
  /** Engaged think (viewer present / just spoke): last N day diaries, then the char cap. */
  engagedDiaryDays: 1,
  /** Chat packs: last N day diaries. If over cap, drop older diaries first. */
  chatDiaryDays: 3,
  /** Chat packs may also include the latest week / month diary when present. */
  chatIncludeWeek: true,
  chatIncludeMonth: true,

  /** Minutes after a landed proactive line (or later chat) still counts as "recent". */
  recentInteractionMin: 20,

  /** Which pack to use for each situation. */
  packs: {
    idle: "idle",
    viewerPresent: "engaged",
    justSpoke: "engaged",
    chat: "chat",
  },

  compressWhenWorkingExceedsCap: true,

  /**
   * Alias of compress.diaryUseModel, kept so older house.json / tests still work.
   * Prefer memory.compress.diaryUseModel. Default is on for the daily batch job.
   */
  diaryUseModel: true,
  /** Alias of compress.maxModelJobsPerCharacterDay. */
  maxModelCompressPerDay: 1,
  diaryAtHhmm: "07:00",
  skipModelOnNoInteraction: true,
  /** "short" writes a tiny rule summary on quiet days; "none" skips the diary. */
  writeDiaryIfNoInteraction: "short",

  /**
   * Daily memory-compress job. Full transcripts stay in SQLite; only a budgeted
   * short digest is sent to the model. Never runs on the chat or think hot path.
   * Override from settings/house.json under memory.compress.
   */
  compress: {
    /** Master switch; off = rule diaries only, zero memory model jobs. */
    enabled: true,
    /** Upgrade the day diary with the model when the day is eligible. */
    diaryUseModel: true,
    /** On an ISO-week boundary (Sunday close), include the week diary in the SAME job. */
    weekUseModel: true,
    /** On a month boundary, include the month diary in the SAME job. */
    monthUseModel: true,
    /** Mid-day working-memory fold; stay rule-trim for now. */
    episodeUseModel: false,
    /** Quiet days skip the model unless modelIfQuietDay is also true. */
    skipModelOnNoInteraction: true,
    /** Mirror of the top-level flag; do not fork a conflicting default. */
    writeDiaryIfNoInteraction: "short",
    /** A day with player chat is noteworthy. */
    modelIfPlayerChat: true,
    /** A day with a landed proactive line is noteworthy. */
    modelIfProactiveSpeech: true,
    /** A day with roommate talk is noteworthy. */
    modelIfNpcTalk: true,
    /** Completely quiet days do not use the model by default. */
    modelIfQuietDay: false,
    /** Skip the model if noteworthy text for the day is shorter than this. */
    minNewContentChars: 40,
    /** One merged job (day + facts + optional week/month) per character per closed day. */
    maxModelJobsPerCharacterDay: 1,
    /** Whole-house cap for model jobs started on a game day (covers retries). */
    maxModelJobsPerHouseDay: 6,
    /** At most one character job per world tick; wait this long between jobs. */
    staggerMs: 30_000,
    /** Provider timeout for one compress job. Failure keeps the rule draft. */
    timeoutMs: 20_000,
    /** Compress prompt cap; shorter than a think prompt. */
    maxPromptChars: 2500,
    /** Trim / reject overlong model output. */
    maxOutputChars: 1200,
    /** If the rule draft was written and the model failed, retry later the same day. */
    retryFailedUpgrade: true,
  },

  /**
   * Optional compress-model override: { provider, model }.
   * If null / omitted, use the house default model resolver. Keys stay in `.env`.
   */
  model: null,

  factImportanceDefault: 1,
  /** 0–1; used for a simple overlap / equality merge. */
  factMergeSimilarity: 0.8,
  /** Evict lowest importance, then oldest, when the fact table is full. */
  eviction: "lowest-importance-then-oldest",
  topicIdleTimeoutDays: 7,

  /**
   * Unused. Relation scores (familiarity / closeness / HUD bond) are owned
   * by server/relations/. Proactive-speech default delta there is 0.
   */
  bondOnProactiveLine: 0,

  /** Identity-card character cap used by settings when house.json omits it. */
  identityCardChars: 280,
};

export function mergeMemoryConfig(overrides = {}, base = config) {
  const root = base && typeof base === "object" ? base : config;
  if (!overrides || typeof overrides !== "object") {
    return finalizeMemoryConfig(cloneMemoryBase(root), {});
  }
  return finalizeMemoryConfig(cloneMemoryBase(root), overrides);
}

function cloneMemoryBase(root) {
  return {
    ...root,
    packs: { ...(root.packs ?? {}) },
    compress: { ...(root.compress ?? {}) },
    model: root.model && typeof root.model === "object" ? { ...root.model } : root.model ?? null,
  };
}

function finalizeMemoryConfig(merged, overrides) {
  if (overrides.packs && typeof overrides.packs === "object") {
    merged.packs = { ...merged.packs, ...overrides.packs };
  }
  if (overrides.compress && typeof overrides.compress === "object") {
    merged.compress = { ...merged.compress, ...overrides.compress };
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (key === "packs" || key === "compress" || key === "model") continue;
    if (!(key in merged) && key !== "diaryUseModel" && key !== "maxModelCompressPerDay") continue;
    merged[key] = value;
  }

  if (Object.prototype.hasOwnProperty.call(overrides, "model")) {
    merged.model = sanitizeMemoryModel(overrides.model, merged.model);
  }

  // Flat legacy flags map onto compress.* when still set at the top level.
  if (typeof overrides.diaryUseModel === "boolean") {
    merged.compress.diaryUseModel = overrides.diaryUseModel;
  }
  if (Number.isFinite(Number(overrides.maxModelCompressPerDay))) {
    merged.compress.maxModelJobsPerCharacterDay = Number(overrides.maxModelCompressPerDay);
  }
  if (typeof overrides.skipModelOnNoInteraction === "boolean") {
    merged.compress.skipModelOnNoInteraction = overrides.skipModelOnNoInteraction;
  }
  if (typeof overrides.writeDiaryIfNoInteraction === "string") {
    merged.compress.writeDiaryIfNoInteraction = overrides.writeDiaryIfNoInteraction;
  }

  merged.diaryUseModel = !!merged.compress.diaryUseModel;
  merged.maxModelCompressPerDay = Number(merged.compress.maxModelJobsPerCharacterDay) || 1;
  merged.skipModelOnNoInteraction = !!merged.compress.skipModelOnNoInteraction;
  if (typeof merged.compress.writeDiaryIfNoInteraction === "string") {
    merged.writeDiaryIfNoInteraction = merged.compress.writeDiaryIfNoInteraction;
  } else {
    merged.compress.writeDiaryIfNoInteraction = merged.writeDiaryIfNoInteraction;
  }
  return merged;
}

function sanitizeMemoryModel(raw, fallback = null) {
  if (raw == null) return null;
  if (!raw || typeof raw !== "object") return fallback ?? null;
  const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  if (!provider && !model) return fallback ?? null;
  return {
    provider: provider || fallback?.provider || null,
    model: model || fallback?.model || null,
  };
}
