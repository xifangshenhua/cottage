import { pick } from "../life/decide.js";
import { config as defaultConfig } from "./config.js";
import { parse } from "./parse.js";

/**
 * Ask the provider for a ThinkIntent. On timeout, throw, or unparsable /
 * illegal output, fall back to life/decide.pick (action only, no speech).
 * Never throws to the coordinator.
 */
export async function decide({
  provider,
  prompt,
  context,
  options,
  character,
  clock,
  cfg = defaultConfig,
} = {}) {
  try {
    if (!provider?.complete) throw new Error("missing-provider");
    const raw = await withTimeout(
      provider.complete({ prompt, context, options, character, clock }),
      cfg.timeoutMs,
    );
    const parsed = parse(raw, { character, options, cfg });
    if (!parsed.ok) throw new Error(parsed.reason);
    return parsed.intent;
  } catch {
    return fallback(options, { world: context?.world, character, clock }, character);
  }
}

function fallback(options, pickContext, character) {
  const chosen = pick(options, pickContext);
  if (!chosen) {
    if (!character) return null;
    return { characterId: character.id, action: character.action, room: character.room };
  }
  return { characterId: character.id, action: chosen.action, room: chosen.room };
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
