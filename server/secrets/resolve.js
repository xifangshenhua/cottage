/**
 * Resolve API keys and MiniMax base URL for think/chat/compress/voice.
 * Call this at request time; do not cache a key on the provider at startup.
 */
import { loadSettings, resolveMemory, resolveModel } from "../settings/index.js";
import {
  DEFAULT_MINIMAX_BASE_URL,
  cleanKey,
  loadSecrets,
} from "./index.js";

export function resolveMinimaxBaseUrl(settings = null, env = process.env) {
  const fromSettings = settings?.house?.model?.baseUrl ?? settings?.model?.baseUrl;
  if (typeof fromSettings === "string" && fromSettings.trim()) return stripTrailingSlash(fromSettings.trim());
  if (typeof env?.MINIMAX_BASE_URL === "string" && env.MINIMAX_BASE_URL.trim()) {
    return stripTrailingSlash(env.MINIMAX_BASE_URL.trim());
  }
  return DEFAULT_MINIMAX_BASE_URL;
}

/**
 * Text-model credentials for think, chat, or memory compress.
 * character key → house key → .env. Dummy has no key.
 */
export function resolveTextCredentials(characterId, opts = {}) {
  const env = opts.env ?? process.env;
  const settings = opts.settings !== undefined ? opts.settings : loadSettings({ root: opts.root });
  const secrets = opts.secrets ?? loadSecrets(opts.root ?? settings?.root, { reload: opts.reload });
  const purpose = opts.purpose || "think";
  const resolved = resolveTextModel(characterId, purpose, settings, env);
  const provider = resolved?.provider || "dummy";
  const model = resolved?.model || null;
  const baseUrl = resolveMinimaxBaseUrl(settings, env);
  if (provider !== "minimax" && provider !== "deepseek") {
    return { provider: provider || "dummy", model, apiKey: "", baseUrl, available: false, source: null };
  }
  const field = provider === "deepseek" ? "deepseekApiKey" : "minimaxApiKey";
  const envName = provider === "deepseek" ? "DEEPSEEK_API_KEY" : "MINIMAX_API_KEY";
  const charId = typeof characterId === "string" && characterId.trim() ? characterId.trim() : null;
  const fromChar = charId ? cleanKey(secrets.characters?.[charId]?.[field]) : "";
  const fromHouse = cleanKey(secrets.house?.[field]);
  const fromEnv = cleanKey(env[envName]);
  const apiKey = fromChar || fromHouse || fromEnv;
  const source = fromChar ? "character" : fromHouse ? "file" : fromEnv ? "env" : null;
  return { provider, model, apiKey, baseUrl, available: !!apiKey, source };
}

/**
 * TTS uses the speaking character's chain. Pass null for ASR (house + .env only).
 */
export function resolveVoiceCredentials(characterId, opts = {}) {
  const env = opts.env ?? process.env;
  const settings = opts.settings !== undefined ? opts.settings : loadSettings({ root: opts.root });
  const secrets = opts.secrets ?? loadSecrets(opts.root ?? settings?.root, { reload: opts.reload });
  const baseUrl = resolveMinimaxBaseUrl(settings, env);
  const charId = typeof characterId === "string" && characterId.trim() ? characterId.trim() : null;

  if (charId) {
    const row = secrets.characters?.[charId];
    const voice = cleanKey(row?.voiceApiKey);
    if (voice) return { apiKey: voice, baseUrl, available: true, source: "character-voice" };
    const text = cleanKey(row?.minimaxApiKey);
    if (text) return { apiKey: text, baseUrl, available: true, source: "character-minimax" };
  }

  const houseVoice = cleanKey(secrets.house?.voiceApiKey);
  if (houseVoice) return { apiKey: houseVoice, baseUrl, available: true, source: "file-voice" };
  const houseText = cleanKey(secrets.house?.minimaxApiKey);
  if (houseText) return { apiKey: houseText, baseUrl, available: true, source: "file-minimax" };
  const fromEnv = cleanKey(env.MINIMAX_API_KEY);
  if (fromEnv) return { apiKey: fromEnv, baseUrl, available: true, source: "env" };
  return { apiKey: "", baseUrl, available: false, source: null };
}

function resolveTextModel(characterId, purpose, settings, env) {
  if (purpose === "compress") {
    const memory = resolveMemory(settings);
    if (memory?.model?.provider) {
      return { provider: memory.model.provider, model: memory.model.model ?? null };
    }
  }
  return resolveModel(characterId, settings, env) ?? { provider: "dummy", model: null };
}

function stripTrailingSlash(url) {
  return url.replace(/\/+$/, "");
}
