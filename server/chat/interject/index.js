import { loadSettings, resolveChat, resolveChatAddressing, resolveInterject, resolveModel } from "../../settings/index.js";
import { applyEvent as applyRelationEvent } from "../../relations/index.js";
import { applyEvent as applyMoodEvent } from "../../mood/index.js";
import { getProvider, getProviderWithCredentials } from "../../think/provider/index.js";
import { applyInterjection, bumpHouseOccasion } from "./apply.js";
import { houseOccasionFull, isEligible, listCandidates, shouldJudge } from "./gates.js";
import { parse } from "./parse.js";
import { buildPrompt } from "./prompt.js";

/**
 * After a successful primary player-chat reply, maybe let present overhearers
 * interject. Failures (timeout, parse, empty) leave the primary reply intact
 * and write no interject memory, relations, mood, or counters.
 */
export async function maybeInterject(world, opts = {}) {
  const settings = opts.settings !== undefined ? opts.settings : loadSettings();
  const cfg = opts.cfg ?? resolveInterject(settings);
  if (cfg.enabled === false) return { applied: [], skipped: "disabled" };

  const audience = opts.audience;
  const responder = opts.responder;
  const now = opts.now instanceof Date ? opts.now : new Date(opts.now ?? Date.now());
  const clock = opts.clock ?? world?.clock;
  const chatCfg = opts.chatCfg ?? resolveChat(null, settings);
  const ctx = { audience, responder, now, clock, chatCfg };

  const candidates = listCandidates(world, ctx, cfg);
  if (!candidates.length) return { applied: [], skipped: "no-candidates" };
  if (houseOccasionFull(world, clock, cfg)) return { applied: [], skipped: "house-hour-cap" };
  if (!shouldJudge({ text: opts.text, audience, world, cfg })) {
    return { applied: [], skipped: "unaddressed" };
  }

  const tones = {};
  for (const character of candidates) {
    tones[character.id] = resolveChat(character.id, settings, chatCfg).defaultTone;
  }
  const prompt = buildPrompt({
    text: opts.text,
    audience,
    responder,
    primaryLine: opts.primaryLine,
    candidates,
    tones,
    cfg,
  });

  const provider = opts.provider ?? getProviderWithCredentials(null, {
    purpose: "chat",
    settings,
    fetch: opts.fetch,
    allowLive: opts.allowLive,
  });

  let raw;
  try {
    if (!provider?.complete) throw new Error("missing-provider");
    raw = await withTimeout(
      provider.complete({ prompt, purpose: "interject", candidates, audience, text: opts.text }),
      cfg.timeoutMs,
    );
  } catch (err) {
    const code = err?.message === "timeout" ? "timeout" : "provider-failed";
    return { applied: [], skipped: code };
  }

  const parsed = parse(raw, { eligibleIds: candidates.map((item) => item.id), cfg });
  if (!parsed.ok) return { applied: [], skipped: parsed.reason || "invalid-json" };

  const kept = [];
  for (const item of parsed.interjections) {
    const character = world?.characters?.[item.characterId];
    if (!character) continue;
    if (!isEligible(character, world, ctx, cfg)) continue;
    kept.push({ item, character });
    if (kept.length >= (Number(cfg.maxPerMessage) || 0)) break;
  }
  if (!kept.length) return { applied: [], skipped: "empty" };

  bumpHouseOccasion(world, clock);
  const addressing = resolveChatAddressing(settings, chatCfg);
  const applied = [];
  for (const { item, character } of kept) {
    const result = applyInterjection(world, character, item, clock, now, cfg);
    if (!result.ok) continue;
    applied.push({
      characterId: character.id,
      line: result.line,
      reason: item.reason,
    });
    if (opts.memory?.recordInterject) {
      opts.memory.recordInterject({
        world,
        character,
        line: result.line,
        now,
        canHearWhenSleeping: addressing.canHearWhenSleeping === true,
        canHearWhenWashing: addressing.canHearWhenWashing !== false,
      });
    }
    applyRelationEvent(world, {
      type: "interject",
      from: character.id,
      to: "viewer",
      text: opts.text,
      now,
    }, { settings, now, clock });
    applyMoodEvent(world, {
      type: "interject",
      characterId: character.id,
      text: opts.text,
      now,
    }, { settings, now, clock });
  }

  return { applied, skipped: applied.length ? null : "apply-failed" };
}

function withTimeout(promise, ms) {
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

export { config, mergeInterjectConfig } from "./config.js";
export { listCandidates, isEligible, shouldJudge, houseOccasionFull, houseOccasionCount, characterDayCount } from "./gates.js";
export { parse } from "./parse.js";
export { buildPrompt } from "./prompt.js";
export { applyInterjection, bumpHouseOccasion } from "./apply.js";
export { formatLineLabel } from "./label.js";
