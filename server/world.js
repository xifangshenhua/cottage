import path from "node:path";
import { createStore } from "./store.js";
import { tickWorld } from "./life/index.js";
import { createMemory } from "./memory/index.js";
import { loadSettings, resolveChatAddressing, resolveModel, syncWorldFromSettings } from "./settings/index.js";
import { getProvider, getProviderWithCredentials } from "./think/provider/index.js";
import { resolveTextCredentials } from "./secrets/resolve.js";
import { HOUSE_CHAT_LOCK, handleChat, listChatStyles, reasonText } from "./chat/index.js";
import { tickThink } from "./think/index.js";
import { ensureRelations, observeLifeStep, presentRelations, tickRelations } from "./relations/index.js";
import { expireViewerIfAway } from "./viewer.js";
import { invalidatePresentationCatalog } from "./presentation/catalog.js";
import { presentVoice } from "./voice/index.js";

const STAT_KEYS = ["energy", "hunger", "clean", "mood", "bond"];

/**
 * Facade used by HTTP: publicState, tick, setViewer, chat, chatStyles.
 * Frontend and the process shell should depend on this, not on life, think, or chat internals.
 *
 * tick is async: life catch-up runs first (sync), then at most one think pass
 * against real now. Hours of downtime are not replayed as missed think slots.
 */
export function createWorld(dataDir, opts = {}) {
  const store = createStore(dataDir);
  let settings = opts.settings !== undefined ? opts.settings : loadSettings();
  if (settings) syncWorldFromSettings(store.getWorld(), settings);
  ensureRelations(store.getWorld(), { settings });

  const memory = opts.memory !== undefined
    ? opts.memory
    : createMemory({
      dbPath: opts.memoryPath ?? path.join(dataDir, "memory.sqlite"),
      settings,
    });

  const voice = opts.voice ?? null;
  const tickOpts = { ...opts, settings, memory, voice };
  if (typeof opts.scheduleVoice === "function") {
    tickOpts.scheduleVoice = opts.scheduleVoice;
  } else if (voice?.scheduleVoice) {
    tickOpts.scheduleVoice = (clip) => voice.scheduleVoice(clip);
  }
  let chain = runTick(store, opts.now ?? new Date(), tickOpts);

  /**
   * Swap the live settings reference used by think/chat/life/memory.
   * Does not reseed world.json, memory, or existing relations.
   * syncWorldFromSettings only refreshes display name / bedroom.
   */
  function applyLiveSettings(next) {
    settings = next;
    tickOpts.settings = next;
    if (typeof memory?.reloadConfig === "function") memory.reloadConfig(next);
    if (next) syncWorldFromSettings(store.getWorld(), next);
    invalidatePresentationCatalog();
    return next;
  }

  function reloadSettings(next) {
    const incoming = next !== undefined
      ? next
      : loadSettings({ reload: true, root: settings?.root });
    return applyLiveSettings(incoming);
  }

  function slimVoice() {
    return typeof voice?.publicConfig === "function" ? voice.publicConfig() : presentVoice(settings);
  }

  function publicState() {
    return present(store.getWorld(), slimVoice());
  }

  async function tick(now = new Date(), runOpts = {}) {
    const opts = { ...tickOpts, ...runOpts };
    chain = chain.then(() => runTick(store, now, opts), () => runTick(store, now, opts));
    await chain;
    // Nobody is listening: life/think/save already ran; skip assembling a full public state.
    if (typeof opts.sseClientCount === "number" && opts.sseClientCount <= 0) return null;
    return publicState();
  }

  function setViewer({ room, present: isPresent } = {}) {
    const world = store.getWorld();
    if (room) world.viewer.room = room;
    if (typeof isPresent === "boolean") world.viewer.present = isPresent;
    if (isPresent) world.viewer.lastSeenAt = new Date().toISOString();
    store.save();
    return publicState();
  }

  const chatting = new Set();

  async function chat(input = {}) {
    const addressing = resolveChatAddressing(settings);
    const id = typeof input.characterId === "string" ? input.characterId.trim() : "";
    const lockKey = addressing.houseLock !== false ? HOUSE_CHAT_LOCK : (id || HOUSE_CHAT_LOCK);
    if (chatting.has(lockKey)) {
      return presentChat(store, { ok: false, reasonCode: "busy", reason: reasonText("busy") }, slimVoice());
    }
    chatting.add(lockKey);
    const job = () => runChat(store, input, {
      ...tickOpts,
      sseClientCount: input.sseClientCount ?? tickOpts.sseClientCount,
      now: input.now ?? tickOpts.now,
    }).finally(() => {
      chatting.delete(lockKey);
    });
    chain = chain.then(job, job);
    return await chain;
  }

  function chatStyles(characterId) {
    return listChatStyles(characterId, settings);
  }

  return {
    publicState,
    tick,
    setViewer,
    chat,
    chatStyles,
    reloadSettings,
    get settings() { return settings; },
    get world() { return store.getWorld(); },
    get savedAt() { return store.getWorld()?.savedAt ?? null; },
    ready: chain,
    memory,
  };
}

async function runChat(store, input, opts = {}) {
  try {
    const result = await handleChat(store.getWorld(), {
      characterId: input.characterId,
      volume: input.volume,
      text: input.text,
      style: input.style,
      now: input.now ?? opts.now ?? new Date(),
      memory: opts.memory,
      settings: opts.settings,
      provider: opts.provider ?? input.provider,
      fetch: opts.fetch ?? input.fetch,
      allowLive: opts.allowLive,
      scheduleVoice: bindScheduleVoice(store, opts),
    });
    if (result?.ok) store.save();
    return presentChat(store, result, opts.voice?.publicConfig?.() ?? presentVoice(opts.settings));
  } catch {
    return presentChat(store, { ok: false, reasonCode: "provider-failed", reason: reasonText("provider-failed") }, opts.voice?.publicConfig?.() ?? presentVoice(opts.settings));
  }
}

function presentChat(store, result = {}, voice = null) {
  return {
    ...present(store.getWorld(), voice),
    ok: result.ok !== false,
    reason: result.reason ?? null,
    reasonCode: result.reasonCode ?? null,
    volume: result.volume ?? null,
    targetId: result.targetId ?? null,
    responderId: result.responderId ?? null,
    hearerIds: Array.isArray(result.hearerIds) ? result.hearerIds : [],
    interjectorIds: Array.isArray(result.interjectorIds) ? result.interjectorIds : [],
  };
}

async function runTick(store, now = new Date(), opts = {}) {
  expireViewerIfAway(store.getWorld(), {
    now,
    settings: opts.settings,
    sseClientCount: opts.sseClientCount ?? 0,
  });
  const relationOpts = { now, settings: opts.settings };
  tickWorld(store.getWorld(), {
    now,
    settings: opts.settings,
    afterStep: (world, dtMs, at) => observeLifeStep(world, dtMs, at, relationOpts),
  });
  tickRelations(store.getWorld(), relationOpts);
  await tickThink(store.getWorld(), {
    now,
    provider: opts.provider,
    cfg: opts.cfg,
    memory: opts.memory,
    settings: opts.settings,
    fetch: opts.fetch,
    allowLive: opts.allowLive,
    scheduleVoice: bindScheduleVoice(store, opts),
  });
  if (opts.memory?.tickDiary) {
    await opts.memory.tickDiary(store.getWorld(), {
      now,
      provider: resolveDiaryProvider(opts),
      getProvider: opts.provider
        ? undefined
        : (characterId) => resolveDiaryProvider({
          memory: opts.memory,
          settings: opts.settings,
          fetch: opts.fetch,
          allowLive: opts.allowLive,
          getProvider: opts.getProvider,
          env: opts.env,
          characterId,
        }),
    });
  }
  store.save();
}


/**
 * Re-bind scheduleVoice for this run so chat/think actually enqueue TTS,
 * and drop the job when nobody can receive audio.
 */
function bindScheduleVoice(store, opts = {}) {
  const schedule = opts.scheduleVoice;
  if (typeof schedule !== "function") return undefined;
  return (clip) => {
    if (typeof opts.sseClientCount === "number" && opts.sseClientCount <= 0) return null;
    if (store.getWorld()?.viewer?.present === false) return null;
    return schedule(clip);
  };
}

/**
 * Provider for the daily memory-compress job only.
 * Uses an explicit test/provider inject first, then memory.model, then the house model.
 * Tests still inject a dummy; getProvider refuses live calls in the test runner
 * unless fetch or allowLive is passed. Keys stay in `.env` and are never logged.
 */
export function resolveDiaryProvider(opts = {}) {
  if (opts.provider) return opts.provider;
  if (!opts.memory?.config?.compress?.enabled) return null;
  const get = opts.getProvider ?? getProvider;
  const creds = resolveTextCredentials(opts.characterId ?? null, {
    purpose: "compress",
    settings: opts.settings,
    root: opts.settings?.root,
    env: opts.env,
  });
  const memModel = opts.memory.config.model;
  const args = {
    name: memModel?.provider || creds.provider,
    model: memModel?.provider ? (memModel.model ?? null) : creds.model,
    fetch: opts.fetch,
    allowLive: opts.allowLive,
  };
  if (creds.apiKey) {
    args.apiKey = creds.apiKey;
    args.baseUrl = creds.baseUrl;
  }
  return get(args);
}

function present(world, voice = null) {
  const characters = {};
  for (const [id, character] of Object.entries(world.characters ?? {})) {
    characters[id] = presentCharacter(character, world);
  }
  return {
    version: world.version,
    startedAt: world.startedAt,
    savedAt: world.savedAt,
    clock: world.clock,
    viewer: world.viewer,
    characters,
    relations: presentRelations(world),
    lastChat: presentLastChat(world.lastChat),
    voice: voice ?? presentVoice(null),
  };
}

function presentCharacter(character, world) {
  const stats = {};
  for (const key of STAT_KEYS) {
    stats[key] = Math.round(Number(character.stats?.[key]) || 0);
  }
  const lineTo = typeof character.lineTo === "string" && character.lineTo.trim()
    ? character.lineTo.trim()
    : null;
  return {
    id: character.id,
    name: character.name,
    room: character.room,
    action: character.action,
    line: character.line ?? null,
    lineTo,
    lineToName: lineToDisplayName(world, lineTo),
    lineKind: character.lineKind === "interject" ? "interject" : null,
    lineAt: typeof character.lineAt === "string" && character.lineAt.trim() ? character.lineAt : null,
    stats,
    lastThinkAt: character.lastThinkAt ?? null,
    enteredRoomAt: character.enteredRoomAt ?? null,
    lastProactiveAt: character.lastProactiveAt ?? null,
    proactiveCountToday: character.proactiveCountToday ?? 0,
    proactiveDayKey: character.proactiveDayKey ?? null,
  };
}

function lineToDisplayName(world, lineTo) {
  if (!lineTo) return null;
  if (lineTo === "viewer") return "你";
  const target = world?.characters?.[lineTo];
  return target?.name || lineTo;
}

function presentLastChat(lastChat) {
  if (!lastChat || typeof lastChat !== "object") return null;
  const line = typeof lastChat.line === "string" ? lastChat.line.trim() : "";
  const responderId = typeof lastChat.responderId === "string" ? lastChat.responderId.trim() : "";
  if (!line || !responderId) return null;
  return {
    responderId,
    name: typeof lastChat.name === "string" && lastChat.name.trim() ? lastChat.name.trim() : responderId,
    line,
    volume: typeof lastChat.volume === "string" ? lastChat.volume : null,
    at: typeof lastChat.at === "string" ? lastChat.at : null,
    viewerRoom: typeof lastChat.viewerRoom === "string" ? lastChat.viewerRoom : null,
  };
}
