import { nowClock } from "../clock.js";
import { identityCard, loadSettings, resolveChat, resolveChatAddressing, resolveModel } from "../settings/index.js";
import { getProvider, getProviderWithCredentials } from "../think/provider/index.js";
import { applyReply } from "./apply.js";
import { resolveAudience } from "./audience.js";
import { HOUSE_CHAT_LOCK, config as defaultConfig } from "./config.js";
import { parse } from "./parse.js";
import { canChat, canHear, canReply, reasonText } from "./policy.js";
import { buildPrompt } from "./prompt.js";
import { describeStyles, mergeStyle } from "./styles.js";
import { applyEvent as applyRelationEvent, migrateRelations, queryPack as queryRelationPack } from "../relations/index.js";
import { applyEvent as applyMoodEvent } from "../mood/index.js";
import { maybeInterject } from "./interject/index.js";

const inflight = new Set();

/**
 * Player-chat coordinator.
 * Reuses model resolution, memory retrieve/record, and parse/validate.
 * Does not go through proactive speech gates unless countAgainstProactiveCap.
 * Never throws to the HTTP facade; failures return { ok, reason }.
 * characterId may be empty (unaddressed). volume selects the hearing range.
 * Only the picked responder gets the primary provider.complete and applyReply.
 * Eligible overhearers may interject afterward via a short second request.
 */
export async function handleChat(world, opts = {}) {
  const settings = opts.settings !== undefined ? opts.settings : loadSettings();
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now ?? Date.now());
  const clock = opts.clock ?? world?.clock ?? nowClock(now);

  const requestedId = typeof opts.characterId === "string" ? opts.characterId.trim() : "";
  const houseCfg = resolveChat(null, settings, opts.cfg ?? defaultConfig);

  const text = typeof opts.text === "string" ? opts.text.trim() : "";
  if (!text) return fail("empty-input", houseCfg);
  if (text.length > (Number(houseCfg.maxInputChars) || defaultConfig.maxInputChars)) {
    return fail("input-too-long", houseCfg);
  }

  const audience = resolveAudience(world, { characterId: requestedId, volume: opts.volume }, houseCfg);
  if (!audience.ok) {
    return fail(audience.reason, houseCfg, { volume: audience.volume, situation: audience.situation });
  }

  const responder = audience.responder;
  const cfg = resolveChat(responder.id, settings, opts.cfg ?? defaultConfig);
  const addressing = cfg.addressing ?? houseCfg.addressing;
  const lockKey = addressing?.houseLock !== false ? HOUSE_CHAT_LOCK : responder.id;

  if (inflight.has(lockKey)) return fail("busy", cfg);
  inflight.add(lockKey);

  try {
    const style = requestedId
      ? mergeStyle(cfg, opts.style)
      : mergeStyle(cfg, mergeStyle(houseCfg, opts.style));
    const memory = opts.memory ?? null;
    migrateRelations(world, { settings });
    const memorySummary = memory?.loadForChat?.(world, responder, clock, now) || null;
    const card = settings ? identityCard(responder.id, settings, cfg.identityCardChars) : "";
    const relationSummary = queryRelationPack(world, responder.id, "chat", { settings });
    const prompt = buildPrompt({
      character: responder,
      clock,
      viewer: world?.viewer,
      identityCard: card || null,
      memorySummary,
      relationSummary,
      style,
      text,
      audience,
      cfg,
    });

    const provider = opts.provider ?? getProviderWithCredentials(responder.id, {
      purpose: "chat",
      settings,
      fetch: opts.fetch,
      allowLive: opts.allowLive,
    });

    let raw;
    try {
      if (!provider?.complete) throw new Error("missing-provider");
      raw = await withTimeout(
        provider.complete({ prompt, character: responder, clock, text, style, audience }),
        cfg.timeoutMs,
      );
    } catch (err) {
      const code = err?.message === "timeout" ? "timeout" : "provider-failed";
      return fail(code, cfg);
    }

    const parsed = parse(raw, { character: responder, cfg });
    if (!parsed.ok) return fail("invalid-reply", cfg);

    applyReply(world, responder, parsed.intent, clock, now, cfg);
    applyRelationEvent(world, {
      type: "playerChat",
      from: responder.id,
      to: "viewer",
      text,
      now,
    }, { settings, now, clock });
    applyMoodEvent(world, {
      type: "playerChat",
      characterId: responder.id,
      text,
      now,
    }, { settings, now, clock });

    if (memory?.recordChat) {
      memory.recordChat({
        world,
        character: responder,
        userText: text,
        reply: parsed.intent.line,
        intent: parsed.intent,
        clock,
        now,
      });
    }

    const target = requestedId ? (world?.characters?.[requestedId] ?? responder) : null;
    const viewerRoom = world?.viewer?.room ?? null;
    for (const overhearer of audience.overhearers) {
      if (memory?.recordOverhear) {
        memory.recordOverhear({
          world,
          character: overhearer,
          userText: text,
          reply: parsed.intent.line,
          intent: parsed.intent,
          target,
          responder,
          volume: audience.volume,
          viewerRoom,
          now,
          clock,
        });
      }
      applyRelationEvent(world, {
        type: "overhear",
        from: overhearer.id,
        to: "viewer",
        text,
        now,
      }, { settings, now, clock });
    }

    world.lastChat = {
      responderId: responder.id,
      name: responder.name || responder.id,
      line: parsed.intent.line,
      volume: audience.volume.id,
      at: (now instanceof Date ? now : new Date(now)).toISOString(),
      viewerRoom,
    };

    let interjectorIds = [];
    try {
      const outcome = await maybeInterject(world, {
        text,
        audience,
        responder,
        primaryLine: parsed.intent.line,
        now,
        clock,
        settings,
        memory,
        chatCfg: houseCfg,
        provider: opts.interjectProvider,
        fetch: opts.fetch,
        allowLive: opts.allowLive,
      });
      interjectorIds = (outcome?.applied ?? []).map((item) => item.characterId);
    } catch {
      interjectorIds = [];
    }

    const result = {
      ok: true,
      reason: null,
      reasonCode: null,
      intent: parsed.intent,
      style,
      volume: audience.volume.id,
      targetId: audience.targetId || null,
      responderId: responder.id,
      hearerIds: audience.hearers.map((character) => character.id),
      interjectorIds,
    };
    scheduleChatVoice(opts.scheduleVoice, world, {
      responder,
      primaryLine: parsed.intent.line,
      volume: audience.volume.id,
      interjectorIds,
    });
    return result;
  } finally {
    inflight.delete(lockKey);
  }
}

export function listChatStyles(characterId, settings = null, base = defaultConfig) {
  const source = settings !== undefined && settings !== null ? settings : loadSettings();
  const id = typeof characterId === "string" ? characterId.trim() : "";
  const cfg = resolveChat(id || null, source, base);
  const addressing = resolveChatAddressing(source, base);
  const described = describeStyles(cfg, { characterId: id || null });
  described.defaultVolume = addressing.defaultVolume;
  described.volumes = (addressing.volumes || []).map((volume) => ({
    id: volume.id,
    label: volume.label,
    range: volume.range,
    requiresTarget: !!volume.requiresTarget,
  }));
  return described;
}

function scheduleChatVoice(scheduleVoice, world, { responder, primaryLine, volume, interjectorIds }) {
  if (typeof scheduleVoice !== "function") return;
  const text = typeof primaryLine === "string" ? primaryLine.trim() : "";
  if (text && responder) {
    scheduleVoice({
      characterId: responder.id,
      text,
      lineAt: responder.lineAt ?? null,
      lineTo: responder.lineTo || "viewer",
      lineKind: null,
      volume,
      room: responder.room ?? null,
    });
  }
  for (const id of interjectorIds || []) {
    const character = world?.characters?.[id];
    const line = typeof character?.line === "string" ? character.line.trim() : "";
    if (!line) continue;
    scheduleVoice({
      characterId: id,
      text: line,
      lineAt: character.lineAt ?? null,
      lineTo: character.lineTo || "viewer",
      lineKind: "interject",
      volume,
      room: character.room ?? null,
    });
  }
}

function fail(code, cfg, ctx = {}) {
  return {
    ok: false,
    reason: reasonText(code, cfg, ctx),
    reasonCode: code,
    volume: ctx.volume?.id ?? (typeof ctx.volume === "string" ? ctx.volume : null),
    targetId: ctx.targetId ?? null,
    responderId: null,
    hearerIds: [],
    interjectorIds: [],
  };
}

export function withTimeout(promise, ms) {
  const limit = Number(ms);
  if (!Number.isFinite(limit) || limit <= 0) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), limit);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Test-only: clear the in-flight lock between cases. */
export function resetChatLocks() {
  inflight.clear();
}

export { config, HOUSE_CHAT_LOCK } from "./config.js";
export { canChat, canHear, canReply, isInRange, reasonText } from "./policy.js";
export { resolveAudience } from "./audience.js";
export { mergeStyle, describeStyles, styleInstructions, dimensions } from "./styles.js";
export { buildPrompt, describeAudience } from "./prompt.js";
export { parse } from "./parse.js";
export { applyReply } from "./apply.js";
