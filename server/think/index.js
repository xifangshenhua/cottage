import { nowClock } from "../clock.js";
import { intent } from "../life/apply.js";
import { propose } from "../life/rules.js";
import { identityCard, loadSettings, resolveLife, resolveModel, resolveSpeech, resolveThink } from "../settings/index.js";
import { config as defaultConfig } from "./config.js";
import { assemble } from "./context.js";
import { decide } from "./decide.js";
import { whoMayThink } from "./policy.js";
import { buildPrompt } from "./prompt.js";
import { getProvider, getProviderWithCredentials } from "./provider/index.js";
import { applyNpcSpeech, applySpeech } from "./speech/apply.js";
import { isNpcSpeechTarget } from "./speech/gates.js";
import { applyEvent as applyRelationEvent, migrateRelations, queryPack as queryRelationPack } from "../relations/index.js";
import { applyEvent as applyMoodEvent } from "../mood/index.js";

/**
 * Think coordinator: whose turn, assemble, decide, apply the action, then speech.
 * Memory records after a think when `opts.memory` is provided. Later player chat
 * reuses parse + speech + life/apply, not a side channel.
 *
 * Runs once against real now. Do not call this inside each 30s life catch-up step.
 */
export async function tickThink(world, opts = {}) {
  const settings = opts.settings !== undefined ? opts.settings : loadSettings();
  const baseCfg = opts.cfg ?? defaultConfig;
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now ?? Date.now());
  const clock = opts.clock ?? world.clock ?? nowClock(now);

  const policyCfg = {
    ...baseCfg,
    intervalMsFor(character) {
      return resolveThink(character.id, settings, baseCfg).intervalMs;
    },
  };
  const due = whoMayThink(world, now, policyCfg);
  if (!due.length) return world;

  const character = due[0];
  const thinkCfg = resolveThink(character.id, settings, baseCfg);
  const speechCfg = resolveSpeech(character.id, settings);
  const lifeCfg = resolveLife(character.id, settings);
  const options = propose(world, character, clock, lifeCfg);

  const memory = opts.memory ?? null;
  migrateRelations(world, { settings });
  const memorySummary = memory?.loadForThink?.(world, character, clock, now) || null;
  const card = settings ? identityCard(character.id, settings, thinkCfg.identityCardChars) : "";
  const relationSummary = queryRelationPack(world, character.id, "idle", { settings });
  const context = assemble(world, character, options, clock, {
    identityCard: card || null,
    memorySummary,
    relationSummary,
    speechCfg,
    now,
  });
  const prompt = buildPrompt(context, thinkCfg);

  const provider = opts.provider ?? getProviderWithCredentials(character.id, {
    purpose: "think",
    settings,
    fetch: opts.fetch,
    allowLive: opts.allowLive,
  });

  const chosen = await decide({
    provider,
    prompt,
    context,
    options,
    character,
    clock,
    cfg: thinkCfg,
  });

  if (chosen?.action && (chosen.action !== character.action || (chosen.room && chosen.room !== character.room))) {
    intent(world, character.id, { action: chosen.action, room: chosen.room }, clock, lifeCfg);
  }

  let speechResult = null;
  let npcSpeech = false;
  if (chosen?.speech) {
    if (isNpcSpeechTarget(chosen.speech.to, world)) {
      speechResult = applyNpcSpeech(world, character, chosen.speech, clock, now, speechCfg);
      npcSpeech = !!speechResult?.ok;
    } else {
      speechResult = applySpeech(world, character, chosen.speech, clock, now, speechCfg);
    }
  }

  applyRelationEvent(world, {
    type: "idleThink",
    from: character.id,
    to: "viewer",
    now,
  }, { settings, now, clock });
  if (speechResult?.ok && npcSpeech) {
    const targetId = speechResult.to;
    applyRelationEvent(world, {
      type: "npcTalk",
      from: character.id,
      to: targetId,
      now,
    }, { settings, now, clock });
    applyRelationEvent(world, {
      type: "npcTalk",
      from: targetId,
      to: character.id,
      now,
    }, { settings, now, clock });
    applyMoodEvent(world, {
      type: "npcTalk",
      characterId: character.id,
      role: "speaker",
      now,
    }, { settings, now, clock });
    applyMoodEvent(world, {
      type: "npcTalk",
      characterId: targetId,
      role: "listener",
      now,
    }, { settings, now, clock });
    for (const other of Object.values(world.characters ?? {})) {
      if (!other?.id || other.id === character.id || other.id === targetId) continue;
      if (other.room !== character.room) continue;
      if (other.action === "sleep" || other.action === "wash") continue;
      applyRelationEvent(world, {
        type: "npcOverhear",
        from: character.id,
        to: other.id,
        now,
      }, { settings, now, clock });
    }
  } else if (speechResult?.ok) {
    applyRelationEvent(world, {
      type: "proactiveSpeech",
      from: character.id,
      to: "viewer",
      now,
    }, { settings, now, clock });
    applyMoodEvent(world, {
      type: "proactiveSpeech",
      characterId: character.id,
      now,
    }, { settings, now, clock });
  }

  if (speechResult?.ok && typeof opts.scheduleVoice === "function") {
    const landed = npcSpeech ? speechResult.visible !== false : true;
    const line = typeof speechResult.line === "string" ? speechResult.line.trim() : "";
    if (landed && line) {
      opts.scheduleVoice({
        characterId: character.id,
        text: line,
        lineAt: character.lineAt ?? null,
        lineTo: speechResult.to || (npcSpeech ? null : "viewer"),
        lineKind: null,
        volume: "normal",
        room: character.room ?? null,
      });
    }
  }

  character.lastThinkAt = now.toISOString();

  if (memory?.recordAfterThink) {
    memory.recordAfterThink({
      world,
      character,
      intent: chosen,
      clock,
      now,
      speechLanded: !!speechResult?.ok,
    });
  }
  if (npcSpeech && memory?.recordNpcTalk) {
    memory.recordNpcTalk({
      world,
      speaker: character,
      listener: world.characters[speechResult.to],
      line: speechResult.line,
      now,
      clock,
    });
  }

  return world;
}

export { config } from "./config.js";
export { whoMayThink } from "./policy.js";
export { assemble } from "./context.js";
export { buildPrompt } from "./prompt.js";
export { parse } from "./parse.js";
export { decide } from "./decide.js";
export { getProvider } from "./provider/index.js";
