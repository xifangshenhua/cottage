import { resolveTextCredentials } from "../../secrets/resolve.js";
import { createDummyProvider } from "./dummy.js";
import { createDeepSeekProvider } from "./deepseek.js";
import { createMinimaxProvider } from "./minimax.js";

/**
 * Select the think provider.
 * Pass `{ name, model }` from settings.resolveModel. Default is dummy when
 * THINK_PROVIDER is unset AND settings did not ask for a live provider.
 * Do not auto-select just because a key is present in the environment,
 * so tests never hit the network by accident.
 *
 * In the test runner, live providers are created only when a fake `fetch`
 * or `{ allowLive: true }` is passed. The API key is never logged.
 */
export function getProvider(opts = {}) {
  if (opts.provider) return opts.provider;
  const name = opts.name ?? process.env.THINK_PROVIDER ?? "dummy";
  const live = name === "minimax" || name === "deepseek";
  if (live && inTestContext() && !opts.fetch && !opts.allowLive) {
    return createDummyProvider(opts);
  }
  if (name === "minimax") return createMinimaxProvider(opts);
  if (name === "deepseek") return createDeepSeekProvider(opts);
  return createDummyProvider(opts);
}

/**
 * Build a provider with keys resolved at call time (character → house → .env).
 * Callers that already injected opts.provider are left alone.
 */
export function getProviderWithCredentials(characterId, opts = {}) {
  if (opts.provider) return opts.provider;
  const creds = resolveTextCredentials(characterId, {
    purpose: opts.purpose,
    settings: opts.settings,
    root: opts.root ?? opts.settings?.root,
    env: opts.env,
  });
  const args = {
    name: creds.provider,
    model: creds.model,
    fetch: opts.fetch,
    allowLive: opts.allowLive,
  };
  if (creds.apiKey) {
    args.apiKey = creds.apiKey;
    args.baseUrl = creds.baseUrl;
  } else if (creds.baseUrl) {
    args.baseUrl = creds.baseUrl;
  }
  return getProvider(args);
}

function inTestContext() {
  return process.env.NODE_TEST_CONTEXT != null;
}
