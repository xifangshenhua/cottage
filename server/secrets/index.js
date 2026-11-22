/**
 * UI-managed API keys. Stored in data/secrets.json (gitignored, mode 0600).
 * Never write these into settings/, world.json, memory, logs, or API responses.
 * .env remains a fallback; a saved file value wins for the same item.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SECRETS_FILE = "secrets.json";
export const SECRETS_VERSION = 1;
export const MAX_KEY_CHARS = 512;
export const DEFAULT_MINIMAX_BASE_URL = "https://api.minimax.cn/v1";

const HOUSE_FIELDS = ["minimaxApiKey", "deepseekApiKey", "voiceApiKey"];
const CHARACTER_FIELDS = ["minimaxApiKey", "deepseekApiKey", "voiceApiKey"];

const cache = new Map();

export function secretsPath(root) {
  return path.join(root, "data", SECRETS_FILE);
}

export function emptySecrets() {
  return { version: SECRETS_VERSION, house: {}, characters: {} };
}

export function loadSecrets(root, opts = {}) {
  if (!root) return emptySecrets();
  if (!opts.reload && cache.has(root)) return structuredClone(cache.get(root));
  const file = secretsPath(root);
  if (!existsSync(file)) {
    const empty = emptySecrets();
    cache.set(root, empty);
    return structuredClone(empty);
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const normalized = normalizeSecrets(parsed);
    cache.set(root, normalized);
    return structuredClone(normalized);
  } catch {
    // Do not crash the house over a damaged file; do not log its contents.
    const empty = emptySecrets();
    cache.set(root, empty);
    return structuredClone(empty);
  }
}

export function invalidateSecrets(root) {
  if (root) cache.delete(root);
  else cache.clear();
}

export function validateSecretsPatch(patch) {
  if (patch == null) return { ok: true, patch: {} };
  if (!isPlain(patch)) return { ok: false, error: "密钥格式不正确。" };
  const unknown = Object.keys(patch).filter((key) => key !== "house" && key !== "characters");
  if (unknown.length) return { ok: false, error: "不能修改的密钥项。" };

  const out = {};
  if (patch.house != null) {
    const house = validateGroup(patch.house, HOUSE_FIELDS, "全屋");
    if (!house.ok) return house;
    out.house = house.value;
  }
  if (patch.characters != null) {
    if (!isPlain(patch.characters)) return { ok: false, error: "人物密钥格式不正确。" };
    out.characters = {};
    for (const [id, value] of Object.entries(patch.characters)) {
      if (!isSafeId(id)) return { ok: false, error: "人物编号不合法。" };
      const allowed = [...CHARACTER_FIELDS, "modelApiKey"];
      const group = validateGroup(value, allowed, "人物");
      if (!group.ok) return group;
      out.characters[id] = group.value;
    }
  }
  return { ok: true, patch: out };
}

export function saveSecrets(root, patch, opts = {}) {
  if (!root) return { ok: false, error: "缺少数据目录。" };
  const checked = validateSecretsPatch(patch);
  if (!checked.ok) return checked;
  const current = loadSecrets(root, { reload: true });
  const mapped = mapCharacterProviderKeys(checked.patch, opts.settings, opts.env, opts.resolveModel);
  if (!mapped.ok) return mapped;
  applySecretsPatch(current, mapped.patch);
  if (!opts.dryRun) {
    atomicWriteSecrets(secretsPath(root), current);
    cache.set(root, current);
  }
  return { ok: true, secrets: current };
}

/**
 * Translate character `modelApiKey` into the provider-specific field
 * (minimaxApiKey / deepseekApiKey) using the character's resolved provider.
 */
export function mapCharacterProviderKeys(patch, settings, env, resolveModel) {
  const out = {
    house: patch.house ? { ...patch.house } : undefined,
    characters: patch.characters ? {} : undefined,
  };
  if (!patch.characters) return { ok: true, patch: { ...patch, ...out } };
  for (const [id, ops] of Object.entries(patch.characters)) {
    const next = { ...ops };
    const hasModelValue = typeof ops.modelApiKey === "string" && ops.modelApiKey.trim();
    const hasModelClear = !!ops.modelApiKeyClear;
    if (hasModelValue || hasModelClear) {
      const provider = resolveProviderName(id, settings, env, resolveModel);
      const field = providerKeyField(provider);
      if (!field) {
        return { ok: false, error: "当前未选择 MiniMax 或 DeepSeek，无法保存该角色的模型密钥。" };
      }
      if (hasModelClear) next[`${field}Clear`] = true;
      if (hasModelValue) next[field] = ops.modelApiKey.trim();
      delete next.modelApiKey;
      delete next.modelApiKeyClear;
    }
    out.characters[id] = next;
  }
  return { ok: true, patch: out };
}

export function secretStatus(secrets, opts = {}) {
  const env = opts.env ?? process.env;
  const settings = opts.settings ?? null;
  const source = secrets ?? emptySecrets();
  const houseMinimax = presence(source.house?.minimaxApiKey, env.MINIMAX_API_KEY);
  const houseDeepseek = presence(source.house?.deepseekApiKey, env.DEEPSEEK_API_KEY);
  const houseVoiceStored = cleanKey(source.house?.voiceApiKey);
  const houseVoice = houseVoiceStored
    ? { configured: true, source: "file" }
    : { configured: false, source: null, fallsBackTo: "minimaxApiKey" };

  const characters = {};
  const ids = characterIds(settings, source);
  for (const id of ids) {
    const provider = resolveProviderName(id, settings, env, opts.resolveModel);
    const field = providerKeyField(provider);
    const stored = field ? cleanKey(source.characters?.[id]?.[field]) : "";
    const voiceStored = cleanKey(source.characters?.[id]?.voiceApiKey);
    characters[id] = {
      modelApiKey: stored
        ? { configured: true, source: "file" }
        : { configured: false, source: null, fallsBackTo: "house" },
      voiceApiKey: voiceStored
        ? { configured: true, source: "file" }
        : { configured: false, source: null, fallsBackTo: "house" },
    };
  }

  return {
    house: {
      minimaxApiKey: houseMinimax,
      deepseekApiKey: houseDeepseek,
      voiceApiKey: houseVoice,
    },
    characters,
  };
}

function presence(fileValue, envValue) {
  if (cleanKey(fileValue)) return { configured: true, source: "file" };
  if (cleanKey(envValue)) return { configured: true, source: "env" };
  return { configured: false, source: null };
}

function characterIds(settings, secrets) {
  const ids = [];
  const seen = new Set();
  const fromSettings = settings?.characters && typeof settings.characters === "object"
    ? Object.keys(settings.characters)
    : [];
  for (const id of fromSettings) {
    if (!isSafeId(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  for (const id of Object.keys(secrets.characters ?? {})) {
    if (!isSafeId(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function resolveProviderName(characterId, settings, env, resolveModel) {
  if (typeof resolveModel === "function") {
    const resolved = resolveModel(characterId, settings, env);
    return resolved?.provider || "dummy";
  }
  const fromChar = settings?.characters?.[characterId]?.model?.provider;
  if (typeof fromChar === "string" && fromChar.trim()) return fromChar.trim();
  const fromHouse = settings?.house?.model?.provider ?? settings?.model?.provider;
  if (typeof fromHouse === "string" && fromHouse.trim()) return fromHouse.trim();
  const fromEnv = typeof env?.THINK_PROVIDER === "string" ? env.THINK_PROVIDER.trim() : "";
  return fromEnv || "dummy";
}

function providerKeyField(provider) {
  if (provider === "minimax") return "minimaxApiKey";
  if (provider === "deepseek") return "deepseekApiKey";
  return null;
}

function validateGroup(raw, fields, label) {
  if (!isPlain(raw)) return { ok: false, error: `${label}密钥格式不正确。` };
  const allowed = new Set(fields);
  const value = {};
  for (const [key, rawValue] of Object.entries(raw)) {
    if (key.endsWith("Clear")) {
      const field = key.slice(0, -"Clear".length);
      if (!allowed.has(field)) return { ok: false, error: `不能修改的密钥项。` };
      if (rawValue !== true && rawValue !== false) return { ok: false, error: "清除标记不正确。" };
      if (rawValue === true) value[key] = true;
      continue;
    }
    if (!allowed.has(key)) return { ok: false, error: "不能修改的密钥项。" };
    if (rawValue == null || rawValue === "") continue;
    if (typeof rawValue !== "string") return { ok: false, error: "密钥必须是文字。" };
    const text = rawValue.trim();
    if (!text) continue;
    if (text.length > MAX_KEY_CHARS) return { ok: false, error: `密钥不能超过 ${MAX_KEY_CHARS} 个字符。` };
    value[key] = text;
  }
  return { ok: true, value };
}

function applySecretsPatch(current, patch) {
  if (isPlain(patch.house)) applyGroupOps(current.house, patch.house, HOUSE_FIELDS);
  if (isPlain(patch.characters)) {
    if (!isPlain(current.characters)) current.characters = {};
    for (const [id, ops] of Object.entries(patch.characters)) {
      if (!current.characters[id]) current.characters[id] = {};
      applyGroupOps(current.characters[id], ops, CHARACTER_FIELDS);
      if (!Object.keys(current.characters[id]).length) delete current.characters[id];
    }
  }
}

function applyGroupOps(target, ops, fields) {
  for (const field of fields) {
    if (ops[`${field}Clear`] === true) delete target[field];
    else if (typeof ops[field] === "string" && ops[field].trim()) target[field] = ops[field].trim();
  }
}

function normalizeSecrets(raw) {
  const out = emptySecrets();
  if (!isPlain(raw)) return out;
  out.house = pickStored(raw.house, HOUSE_FIELDS);
  if (isPlain(raw.characters)) {
    for (const [id, value] of Object.entries(raw.characters)) {
      if (!isSafeId(id)) continue;
      const picked = pickStored(value, CHARACTER_FIELDS);
      if (Object.keys(picked).length) out.characters[id] = picked;
    }
  }
  return out;
}

function pickStored(obj, fields) {
  const out = {};
  if (!isPlain(obj)) return out;
  for (const field of fields) {
    const text = cleanKey(obj[field]);
    if (text) out[field] = text;
  }
  return out;
}

export function cleanKey(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || text.length > MAX_KEY_CHARS) return "";
  return text;
}

function atomicWriteSecrets(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const body = `${JSON.stringify({
    version: SECRETS_VERSION,
    house: data.house ?? {},
    characters: data.characters ?? {},
  }, null, 2)}\n`;
  writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* best effort on platforms without chmod */ }
}

function isSafeId(id) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9_-]{0,30}$/i.test(id);
}

function isPlain(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
