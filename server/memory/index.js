/**
 * Memory facade. Peer to life/ and think/.
 * Hooks: loadForThink into think/context; recordAfterThink after a think/speech.
 * loadForChat and recordChat are used by server/chat/; no model call on a chat turn.
 */
import { gameDayKey } from "../think/speech/gates.js";
import { getRoom } from "../rooms.js";
import { resolveMemory } from "../settings/index.js";
import { mergeMemoryConfig } from "./config.js";
import { getMeta, openDatabase, setMeta } from "./db.js";
import { writeDayDiary, writeMonthDiary, writeWeekDiary } from "./diaries.js";
import { daysInIsoWeek, daysInMonth, isoWeekKey } from "./period.js";
import {
  enqueueCompressJobs,
  lastClosedDiaryDay,
  pickRunnableJob,
  runNextCompressJob,
  setLastClosedDiaryDay,
} from "./upgrade.js";
import { appendEpisode, formatEpisode, pruneEpisodes } from "./episodes.js";
import { upsertFact } from "./facts.js";
import { appendMessage, pruneMessages } from "./messages.js";
import { retrieve, selectPackKind } from "./retrieve.js";
import { rememberTopic } from "./topics.js";
import { appendWorkingLine, getWorking, setWorking } from "./working.js";
import { browseCharacter as assembleBrowse } from "./browse.js";
import { exportAll as assembleExportAll, exportCharacter as assembleExport } from "./export.js";

export { config, mergeMemoryConfig } from "./config.js";
export { retrieve, selectPackKind, assemblePack } from "./retrieve.js";
export { trimToCap, maybeCompressWithModel, parseCompressOutput, buildCompressPrompt } from "./compress.js";
export { isDayEligibleForModel, readJob, houseJobCount } from "./upgrade.js";

export function createMemory(opts = {}) {
  let cfg = opts.config
    ? mergeMemoryConfig(opts.config)
    : resolveMemory(opts.settings);
  const db = opts.db ?? openDatabase(opts.dbPath ?? ":memory:");

  function reloadConfig(settingsOrCfg) {
    if (!settingsOrCfg) {
      cfg = resolveMemory(null);
      return cfg;
    }
    const looksLikeMemoryConfig = settingsOrCfg.compress
      && settingsOrCfg.house == null
      && settingsOrCfg.memory == null
      && settingsOrCfg.characters == null;
    cfg = looksLikeMemoryConfig ? mergeMemoryConfig(settingsOrCfg) : resolveMemory(settingsOrCfg);
    return cfg;
  }

  function loadForThink(world, character, clock, now = new Date()) {
    const kind = selectPackKind(world, character, now, cfg, "think");
    return retrieve(db, character.id, kind, cfg, { world, character, clock, now });
  }

  function loadForChat(world, character, clock, now = new Date()) {
    return retrieve(db, character.id, "chat", cfg, { world, character, clock, now });
  }

  /**
   * Append the player's message and the character's reply, trim working memory
   * by rule (no model call), and store a validated fact/topic when present.
   */
  function recordChat({ character, userText, reply, intent, now } = {}) {
    if (!character?.id) return null;
    const at = toIso(now);
    const player = String(userText ?? "").trim();
    const line = String(reply ?? intent?.line ?? character.line ?? "").trim();
    if (player) {
      appendMessage(db, {
        characterId: character.id,
        kind: "chat",
        role: "user",
        text: player,
        createdAt: at,
      });
    }
    if (line) {
      appendMessage(db, {
        characterId: character.id,
        kind: "chat",
        role: "character",
        text: line,
        createdAt: at,
      });
    }
    const who = character.name || character.id;
    const summary = `你：「${clip(player, 40)}」 ${who}：「${clip(line, 40)}」`.trim();
    if (player || line) {
      appendWorkingLine(db, character.id, summary, at, cfg.workingMemoryChars);
      if (cfg.compressWhenWorkingExceedsCap) {
        const current = getWorking(db, character.id).text;
        if (current.length > cfg.workingMemoryChars) {
          setWorking(db, character.id, current, at, cfg.workingMemoryChars);
        }
      }
    }
    if (intent?.fact) {
      upsertFact(db, character.id, intent.fact, cfg, at);
    }
    if (intent?.topic) {
      rememberTopic(db, character.id, intent.topic, cfg, at);
    }
    pruneMessages(db, cfg);
    return { userText: player, reply: line };
  }


  /**
   * Note that this character overheard a player line. Kind is "overhear",
   * not a direct chat turn. No fact/topic extraction and no model call.
   * If they share the responder's room they may also note the reply;
   * a cross-room shout records only the player's line.
   */
  function recordOverhear({
    character,
    userText,
    reply,
    target,
    responder,
    volume,
    viewerRoom,
    now,
  } = {}) {
    if (!character?.id) return null;
    const at = toIso(now);
    const player = String(userText ?? "").trim();
    const line = String(reply ?? "").trim();
    if (!player && !line) return null;

    const sameRoom = !!(responder?.room && character.room === responder.room);
    const summary = formatOverhearLine({
      player,
      reply: line,
      target,
      responder,
      volume,
      viewerRoom,
      sameRoom,
    });
    if (player) {
      appendMessage(db, {
        characterId: character.id,
        kind: "overhear",
        role: "user",
        text: player,
        createdAt: at,
      });
    }
    if (sameRoom && line) {
      appendMessage(db, {
        characterId: character.id,
        kind: "overhear",
        role: "character",
        text: line,
        createdAt: at,
      });
    }
    if (summary) {
      appendWorkingLine(db, character.id, summary, at, cfg.workingMemoryChars);
      if (cfg.compressWhenWorkingExceedsCap) {
        const current = getWorking(db, character.id).text;
        if (current.length > cfg.workingMemoryChars) {
          setWorking(db, character.id, current, at, cfg.workingMemoryChars);
        }
      }
    }
    pruneMessages(db, cfg);
    return { userText: player, reply: sameRoom ? line : "", summary };
  }

  function recordAfterThink({ world, character, intent, clock, now, speechLanded } = {}) {
    if (!character?.id) return null;
    const at = toIso(now);
    const dayKey = gameDayKey(clock, { dayStartHhmm: cfg.diaryAtHhmm }) || clock?.dayKey || "";
    const line = speechLanded ? (intent?.speech?.line ?? character.line ?? null) : null;
    const reason = speechLanded ? (intent?.speech?.reason ?? null) : null;
    const episode = {
      characterId: character.id,
      dayKey,
      action: intent?.action ?? character.action ?? null,
      room: intent?.room ?? character.room ?? null,
      speechLanded: !!speechLanded,
      line,
      reason,
      createdAt: at,
    };
    episode.summary = formatEpisode(episode);
    appendEpisode(db, episode);
    appendWorkingLine(db, character.id, episode.summary, at, cfg.workingMemoryChars);
    if (cfg.compressWhenWorkingExceedsCap) {
      const current = getWorking(db, character.id).text;
      if (current.length > cfg.workingMemoryChars) {
        setWorking(db, character.id, current, at, cfg.workingMemoryChars);
      }
    }

    if (intent?.fact) {
      upsertFact(db, character.id, intent.fact, cfg, at);
    }
    if (intent?.topic) {
      rememberTopic(db, character.id, intent.topic, cfg, at);
    }

    appendMessage(db, {
      characterId: character.id,
      kind: "think",
      role: "system",
      text: episode.summary,
      createdAt: at,
    });
    if (speechLanded && line) {
      appendMessage(db, {
        characterId: character.id,
        kind: "speech",
        role: "character",
        text: line,
        createdAt: at,
      });
      // Relation scores are owned by server/relations/. Idle think and
      // proactive speech default to a zero delta; do not write stats.bond here.
    }

    pruneMessages(db, cfg);
    pruneEpisodes(db, cfg);
    return episode;
  }

  async function tickDiary(world, { now, provider, getProvider } = {}) {
    const at = now instanceof Date ? now : new Date(now ?? Date.now());
    const clock = world?.clock ?? null;
    const currentKey = gameDayKey(clock, { dayStartHhmm: cfg.diaryAtHhmm }) || clock?.dayKey;
    if (!currentKey) return [];
    const last = getMeta(db, "lastDiaryGameDay");
    if (!last) {
      setMeta(db, "lastDiaryGameDay", currentKey);
      return [];
    }

    const written = [];
    const ids = Object.keys(world?.characters ?? {});
    let closedDay = lastClosedDiaryDay(db);

    // Same game day and no leftover upgrade job: skip the rest of the 30s tick.
    if (last === currentKey && !pickRunnableJob(db, ids, closedDay, cfg)) {
      return [];
    }

    if (last !== currentKey) {
      closedDay = last;
      for (const id of ids) {
        const row = await writeDayDiary(db, id, last, cfg, { nowIso: at.toISOString() });
        if (row) written.push(row);
      }
      maybeRollWeekAndMonth(db, ids, last, cfg, at.toISOString());
      setLastClosedDiaryDay(db, closedDay);
      setMeta(db, "lastDiaryGameDay", currentKey);
      enqueueCompressJobs(db, ids, closedDay, cfg);
    }

    if (closedDay) {
      await runNextCompressJob(db, ids, closedDay, cfg, {
        now: at,
        provider,
        getProvider,
        currentGameDay: currentKey,
      });
    }
    return written;
  }

  /**
   * Record a landed roommate line: speaker and addressee get kind "npc"
   * (included in the chat retrieve pack). Same-room bystanders get kind
   * "overhear" only, with no model call.
   */
  function recordNpcTalk({ world, speaker, listener, line, now } = {}) {
    if (!speaker?.id || !listener?.id) return null;
    const at = toIso(now);
    const text = String(line ?? "").trim();
    if (!text) return null;
    const speakerName = speaker.name || speaker.id;
    const listenerName = listener.name || listener.id;

    rememberNpcLine(speaker.id, `对${listenerName}说：${text}`, text, at);
    rememberNpcLine(listener.id, `${speakerName}对我说：${text}`, text, at);

    const bystanders = [];
    for (const other of Object.values(world?.characters ?? {})) {
      if (!other?.id || other.id === speaker.id || other.id === listener.id) continue;
      if (other.room !== speaker.room) continue;
      if (other.action === "sleep" || other.action === "wash") continue;
      const summary = `听见${speakerName}对${listenerName}说：${text}`;
      appendMessage(db, {
        characterId: other.id,
        kind: "overhear",
        role: "character",
        text,
        createdAt: at,
      });
      appendWorkingLine(db, other.id, summary, at, cfg.workingMemoryChars);
      trimWorkingIfNeeded(other.id, at);
      bystanders.push(other.id);
    }
    pruneMessages(db, cfg);
    return { line: text, speakerId: speaker.id, listenerId: listener.id, bystanders };
  }

  function rememberNpcLine(characterId, summary, text, at) {
    appendMessage(db, {
      characterId,
      kind: "npc",
      role: "character",
      text,
      createdAt: at,
    });
    appendWorkingLine(db, characterId, summary, at, cfg.workingMemoryChars);
    trimWorkingIfNeeded(characterId, at);
  }

  /**
   * Record a landed interjection: the speaker gets kind "interject".
   * Same-room others (including the primary responder) get kind "overhear".
   * Sleepers do not hear; washing follows canHearWhenWashing (default true).
   */
  function recordInterject({
    world,
    character,
    line,
    now,
    canHearWhenSleeping = false,
    canHearWhenWashing = true,
  } = {}) {
    if (!character?.id) return null;
    const at = toIso(now);
    const text = String(line ?? "").trim();
    if (!text) return null;
    const speakerName = character.name || character.id;
    appendMessage(db, {
      characterId: character.id,
      kind: "interject",
      role: "character",
      text,
      createdAt: at,
    });
    appendWorkingLine(db, character.id, `插话说：「${clip(text, 40)}」`, at, cfg.workingMemoryChars);
    trimWorkingIfNeeded(character.id, at);

    const bystanders = [];
    for (const other of Object.values(world?.characters ?? {})) {
      if (!other?.id || other.id === character.id) continue;
      if (other.room !== character.room) continue;
      if (other.action === "sleep" && !canHearWhenSleeping) continue;
      if (other.action === "wash" && !canHearWhenWashing) continue;
      appendMessage(db, {
        characterId: other.id,
        kind: "overhear",
        role: "character",
        text,
        createdAt: at,
      });
      appendWorkingLine(db, other.id, `听见${speakerName}插话说：「${clip(text, 40)}」`, at, cfg.workingMemoryChars);
      trimWorkingIfNeeded(other.id, at);
      bystanders.push(other.id);
    }
    pruneMessages(db, cfg);
    return { line: text, characterId: character.id, bystanders };
  }

    function trimWorkingIfNeeded(characterId, at) {
    if (!cfg.compressWhenWorkingExceedsCap) return;
    const current = getWorking(db, characterId).text;
    if (current.length > cfg.workingMemoryChars) {
      setWorking(db, characterId, current, at, cfg.workingMemoryChars);
    }
  }

  function browseCharacter(characterId, opts = {}) {
    return assembleBrowse(db, characterId, { config: cfg, ...opts });
  }

  function exportCharacter(characterId, opts = {}) {
    return assembleExport(db, characterId, { config: cfg, ...opts });
  }

  function exportAll(opts = {}) {
    return assembleExportAll(db, { config: cfg, ...opts });
  }

  function close() {
    db.close();
  }

  return {
    get config() { return cfg; },
    reloadConfig,
    db,
    loadForThink,
    loadForChat,
    recordAfterThink,
    recordChat,
    recordOverhear,
    recordNpcTalk,
    recordInterject,
    tickDiary,
    browseCharacter,
    exportCharacter,
    exportAll,
    close,
  };
}

function maybeRollWeekAndMonth(db, ids, dayKey, cfg, nowIso) {
  const weekKey = isoWeekKey(dayKey);
  const monthKey = String(dayKey).slice(0, 7);
  const weekDays = daysInIsoWeek(dayKey);
  const monthDays = daysInMonth(dayKey);
  // Refresh a rule draft through the period, but never smash a model-upgraded diary.
  for (const id of ids) {
    writeWeekDiary(db, id, weekKey, weekDays, cfg, nowIso, { overwrite: "unless-model" });
    writeMonthDiary(db, id, monthKey, monthDays, cfg, nowIso, { overwrite: "unless-model" });
  }
}


function formatOverhearLine({ player, reply, target, responder, volume, viewerRoom, sameRoom }) {
  const spoken = clip(player, 40);
  const who = target?.name || target?.id || "";
  const roomName = getRoom(viewerRoom)?.name || viewerRoom || "这里";
  const loud = volume?.id === "loud" || volume?.label === "大声";
  let head;
  if (who) head = loud ? `你大声对${who}说：「${spoken}」` : `你对${who}说：「${spoken}」`;
  else head = loud ? `你在${roomName}大声说：「${spoken}」` : `你在${roomName}说：「${spoken}」`;
  if (sameRoom && reply) {
    const speaker = responder?.name || responder?.id || who || "她";
    return `${head} ${speaker}：「${clip(reply, 40)}」（我听见了）`;
  }
  return `${head}（我听见了）`;
}

function clip(text, cap) {
  const value = String(text ?? "").trim();
  if (!value) return "";
  if (!Number.isFinite(cap) || cap <= 0 || value.length <= cap) return value;
  return value.slice(0, cap);
}

function toIso(now) {
  if (now instanceof Date) return now.toISOString();
  const parsed = Date.parse(now);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}
