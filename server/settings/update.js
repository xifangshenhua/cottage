/**
 * Validate and apply settings-page updates.
 * Writes only catalog overrides; never dumps code defaults.
 * Rejects secrets; validation failure does not write any file.
 * Does not touch data/world.json or data/memory.sqlite.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CHARACTER_FACTORY,
  characterFields,
  characterOverrideIds,
  defaultCharacterValues,
  defaultHouseValues,
  deletePath,
  effectiveCharacterValues,
  effectiveHouseValues,
  fieldsForGroup,
  findField,
  flattenCharacterFile,
  GROUPS,
  houseFields,
  isHhmm,
  listCharacters,
  overrideIdsFromFile,
  publicField,
  setPath,
  valuesEqual,
} from "./catalog.js";
import { loadSettings, SECRET_KEY, sanitize } from "./index.js";
import { isAllowedListenHost, normalizeListenHost } from "./listen.js";

const PROVIDERS = new Set(["minimax", "deepseek", "dummy"]);

export function findSecretKey(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findSecretKey(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) return key;
    if (typeof key === "string" && /(^|\.)(api[_-]?key|secret|token|password|authorization)(\.|$)/i.test(key)) {
      return key;
    }
    const found = findSecretKey(child);
    if (found) return found;
  }
  return null;
}

export function buildSettingsResponse(settings) {
  const safe = sanitize(settings ?? {});
  const houseDefaults = defaultHouseValues();
  const houseEffective = effectiveHouseValues(safe);
  const characters = listCharacters(safe);
  const characterDefaults = {};
  const characterEffective = {};
  const characterOverrides = {};
  for (const item of characters) {
    characterDefaults[item.id] = defaultCharacterValues(item.id);
    characterEffective[item.id] = effectiveCharacterValues(item.id, safe);
    characterOverrides[item.id] = characterOverrideIds(item.id, safe.characters?.[item.id]);
  }
  return {
    ok: true,
    groups: GROUPS.map((group) => ({
      id: group.id,
      title: group.title,
      help: group.help,
      advanced: !!group.advanced,
      characterScoped: !!group.characterScoped,
    })),
    fields: [...houseFields(), ...characterFields()].map((field) => {
      const published = publicField(field);
      if (field.scope === "character") {
        published.default = null;
      } else {
        published.default = houseDefaults[field.id] ?? null;
      }
      return published;
    }),
    defaults: {
      house: houseDefaults,
      characters: characterDefaults,
    },
    effective: {
      house: houseEffective,
      characters: characterEffective,
    },
    overrides: {
      house: overrideIdsFromFile(safe.house),
      characters: characterOverrides,
    },
    characters,
  };
}

/**
 * Validate and write settings for `root`.
 * @returns {{ ok: true, settings } | { ok: false, error: string, status?: number }}
 */
export function applySettingsUpdate(root, body, opts = {}) {
  const secret = findSecretKey(body);
  if (secret) {
    return { ok: false, status: 400, error: "不能在设置里写入密钥或令牌。" };
  }

  const housePatch = isPlain(body?.house) ? body.house : {};
  const characterPatches = isPlain(body?.characters) ? body.characters : {};
  const restore = isPlain(body?.restore) ? body.restore : {};
  const restoreHouseGroups = Array.isArray(restore.house) ? restore.house : [];
  const restoreCharacterGroups = isPlain(restore.characters) ? restore.characters : {};

  const errors = [];
  const houseOps = [];
  const characterOps = {};

  for (const groupId of restoreHouseGroups) {
    const groupFields = fieldsForGroup(groupId).filter((field) => field.scope !== "character");
    if (!groupFields.length) errors.push(`未知的分组：${groupId}`);
    for (const field of groupFields) houseOps.push({ type: "restore", field });
  }

  for (const [id, value] of Object.entries(housePatch)) {
    const field = findField(id, "house");
    if (!field) {
      errors.push(`不能修改的项：${id}`);
      continue;
    }
    const parsed = parseFieldValue(field, value);
    if (!parsed.ok) {
      errors.push(`${field.label}：${parsed.error}`);
      continue;
    }
    houseOps.push({ type: "set", field, value: parsed.value });
  }

  const allCharacterIds = new Set([
    ...Object.keys(characterPatches),
    ...Object.keys(restoreCharacterGroups),
  ]);
  for (const characterId of allCharacterIds) {
    if (!isSafeId(characterId)) {
      errors.push("人物编号不合法。");
      continue;
    }
    const ops = [];
    const groups = Array.isArray(restoreCharacterGroups[characterId]) ? restoreCharacterGroups[characterId] : [];
    for (const groupId of groups) {
      const groupFields = fieldsForGroup(groupId).filter((field) => field.scope === "character");
      if (!groupFields.length) errors.push(`未知的人物分组：${groupId}`);
      for (const field of groupFields) ops.push({ type: "restore", field });
    }
    const patch = isPlain(characterPatches[characterId]) ? characterPatches[characterId] : {};
    for (const [id, value] of Object.entries(patch)) {
      const field = findField(id, "character");
      if (!field) {
        errors.push(`不能修改的人物项：${id}`);
        continue;
      }
      const parsed = parseFieldValue(field, value);
      if (!parsed.ok) {
        errors.push(`${field.label}：${parsed.error}`);
        continue;
      }
      ops.push({ type: "set", field, value: parsed.value });
    }
    characterOps[characterId] = ops;
  }

  const coupled = coupleModelFields(houseOps);
  if (!coupled.ok) errors.push(coupled.error);

  if (errors.length) {
    return { ok: false, status: 400, error: errors[0], errors };
  }

  const settingsDir = path.join(root, "settings");
  const housePath = path.join(settingsDir, "house.json");
  const existingHouse = readJsonFile(housePath, {});
  const nextHouse = structuredClone(isPlain(existingHouse) ? existingHouse : {});
  const houseDefaults = defaultHouseValues();
  applyHouseOps(nextHouse, houseOps, houseDefaults);

  const characterWrites = [];
  for (const [characterId, ops] of Object.entries(characterOps)) {
    const file = path.join(settingsDir, "characters", `${characterId}.json`);
    if (!existsSync(file) && !ops.length) continue;
    if (!existsSync(file)) {
      return { ok: false, status: 400, error: `没有这个人的设定：${characterId}` };
    }
    const existing = readJsonFile(file, null);
    if (!isPlain(existing)) {
      return { ok: false, status: 400, error: `无法读取${characterId}的设定。` };
    }
    const next = structuredClone(existing);
    applyCharacterOps(next, characterId, ops);
    characterWrites.push({ file, next, characterId });
  }

  const pending = [];
  if (houseOps.length) {
    pending.push({ file: housePath, data: nextHouse });
  }
  for (const item of characterWrites) {
    pending.push({ file: item.file, data: item.next });
  }

  if (!opts.dryRun && pending.length) {
    for (const item of pending) atomicWriteJson(item.file, item.data);
  }

  const settings = loadSettings({ root, reload: true });
  return { ok: true, settings, written: pending.map((item) => item.file) };
}

function coupleModelFields(houseOps) {
  const useField = houseOps.find((op) => op.field.id === "memory.useSeparateModel" && op.type === "set");
  const providerOp = houseOps.find((op) => op.field.id === "memory.model.provider" && op.type === "set");
  const modelOp = houseOps.find((op) => op.field.id === "memory.model.model" && op.type === "set");
  if (useField && useField.value === true) {
    const provider = providerOp?.value;
    if (!provider) {
      return { ok: false, error: "使用另一套压缩模型时，请选择服务商。" };
    }
  }
  if (useField && useField.value === false) {
    // Clearing the flag also clears memory.model, even if model fields were sent.
  }
  return { ok: true };
}

function applyHouseOps(target, ops, defaults) {
  for (const op of ops) {
    const field = op.field;
    if (field.type === "secret" || (Array.isArray(field.paths) && field.paths.length === 0)) continue;
    if (field.id === "memory.useSeparateModel") {
      if (op.type === "restore" || op.value === false) {
        deletePath(target, "memory.model");
      }
      continue;
    }
    if (field.id === "memory.model.provider" || field.id === "memory.model.model") {
      const useOff = ops.some((other) => other.field.id === "memory.useSeparateModel" && (other.type === "restore" || other.value === false));
      if (useOff) continue;
    }
    if (op.type === "restore" || valuesEqual(op.value, defaults[field.id])) {
      for (const p of field.paths || [field.id]) deletePath(target, p);
      if (field.id === "model.provider" || field.id === "model.model") {
        maybePruneEmptyModel(target);
      }
      continue;
    }
    applyFieldWrite(target, field, op.value);
  }
}

function applyFieldWrite(target, field, value) {
  if (field.id === "model.provider" || field.id === "model.model") {
    if (!isPlain(target.model)) target.model = {};
    if (field.id === "model.provider") target.model.provider = value;
    else target.model.model = value;
    maybePruneEmptyModel(target);
    return;
  }
  if (field.id === "memory.model.provider" || field.id === "memory.model.model") {
    if (!isPlain(target.memory)) target.memory = {};
    if (!isPlain(target.memory.model)) target.memory.model = {};
    if (field.id === "memory.model.provider") target.memory.model.provider = value;
    else target.memory.model.model = value;
    return;
  }
  if (field.id === "think.intervalMin") {
    deletePath(target, "think.intervalMs");
    setPath(target, "think.intervalMin", value);
    return;
  }
  if (field.id === "speech.minGapMin") {
    deletePath(target, "speech.minGapMs");
    setPath(target, "speech.minGapMin", value);
    return;
  }
  if (field.id === "mood.playerChat.cooldownSec") {
    deletePath(target, "mood.playerChat.cooldownMs");
    setPath(target, "mood.playerChat.cooldownSec", value);
    return;
  }
  for (const p of field.paths || [field.id]) setPath(target, p, value);
}

function maybePruneEmptyModel(target) {
  if (!isPlain(target.model)) return;
  if (!target.model.provider && !target.model.model) delete target.model;
}

function applyCharacterOps(target, characterId, ops) {
  const factory = defaultCharacterValues(characterId);
  for (const op of ops) {
    if (op.field.type === "secret" || (Array.isArray(op.field.paths) && op.field.paths.length === 0)) continue;
    const value = op.type === "restore" ? cloneValue(factory[op.field.id]) : op.value;
    writeCharacterField(target, op.field, value, factory);
  }
}

function writeCharacterField(target, field, value, factory = {}) {
  if (field.id === "model.provider" || field.id === "model.model") {
    const isDefault = !value || valuesEqual(value, factory[field.id]);
    if (isDefault) {
      deletePath(target, field.id);
      maybePruneEmptyModel(target);
      return;
    }
    if (!isPlain(target.model)) target.model = {};
    if (field.id === "model.provider") target.model.provider = value;
    else target.model.model = value;
    return;
  }
  if (typeof field.id === "string" && field.id.startsWith("voice.")) {
    const path = (field.paths && field.paths[0]) || field.id;
    const isDefault = valuesEqual(value, factory[field.id])
      || (field.id === "voice.customVoiceId" && !value)
      || (field.id === "voice.enabled" && value === true && factory[field.id] !== false);
    if (isDefault) {
      deletePath(target, path);
      if (isPlain(target.voice) && Object.keys(target.voice).length === 0) delete target.voice;
      return;
    }
    setPath(target, path, value);
    return;
  }
  if (field.id === "identity.addressPlayerAs") {
    if (!isPlain(target.identity)) target.identity = {};
    target.identity.addressPlayerAs = value;
    return;
  }
  if (field.id === "chat.defaultTone" || field.id === "chat.defaultLength") {
    if (!isPlain(target.chat)) target.chat = {};
    if (field.id === "chat.defaultTone") target.chat.defaultTone = value;
    else target.chat.defaultLength = value;
    return;
  }
  if (!isPlain(target.persona)) target.persona = {};
  if (field.id === "persona.traits") target.persona.traits = Array.isArray(value) ? [...value] : [];
  else if (field.id === "persona.speechStyle") target.persona.speechStyle = value;
  else if (field.id === "persona.background") target.persona.background = value;
  else if (field.id === "persona.likes") target.persona.likes = Array.isArray(value) ? [...value] : [];
  else if (field.id === "persona.dislikes") target.persona.dislikes = Array.isArray(value) ? [...value] : [];
}

export function parseFieldValue(field, raw) {
  const label = field.label;
  if (field.type === "boolean") {
    if (typeof raw === "boolean") return { ok: true, value: raw };
    if (raw === "true" || raw === "false") return { ok: true, value: raw === "true" };
    return { ok: false, error: "请选择开或关。" };
  }
  if (field.type === "time") {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!isHhmm(text)) return { ok: false, error: "请使用 HH:MM 的时间格式。" };
    return { ok: true, value: text };
  }
  if (field.type === "enum") {
    const text = typeof raw === "string" ? raw.trim() : "";
    const allowed = (field.options || []).map((item) => item.value);
    if (!allowed.includes(text)) return { ok: false, error: "不在可选范围内。" };
    return { ok: true, value: text };
  }
  if (field.type === "number") {
    const n = typeof raw === "number" ? raw : Number(typeof raw === "string" ? raw.trim() : raw);
    if (!Number.isFinite(n)) return { ok: false, error: "请填写数字。" };
    if (field.min != null && n < field.min) return { ok: false, error: `不能小于 ${field.min}。` };
    if (field.max != null && n > field.max) return { ok: false, error: `不能大于 ${field.max}。` };
    if (n < 0 && (field.min == null || field.min >= 0)) return { ok: false, error: "不能为负数。" };
    return { ok: true, value: n };
  }
  if (field.type === "list") {
    const list = Array.isArray(raw) ? raw : parseList(raw);
    const cleaned = list.map((item) => String(item).trim()).filter(Boolean);
    const joined = cleaned.join("、");
    if (field.maxChars && joined.length > field.maxChars) {
      return { ok: false, error: `不能超过 ${field.maxChars} 字。` };
    }
    return { ok: true, value: cleaned };
  }
  if (field.type === "secret") {
    return { ok: false, error: "密钥请用专门的保存方式，不能写进普通设定。" };
  }
  if (field.type === "string" || field.type === "text") {
    if (raw == null) return { ok: true, value: "" };
    if (typeof raw !== "string") return { ok: false, error: "请填写文字。" };
    const text = raw.trim();
    if (field.maxChars && text.length > field.maxChars) {
      return { ok: false, error: `不能超过 ${field.maxChars} 字。` };
    }
    if (field.id === "model.provider" || field.id === "memory.model.provider") {
      if (text && !PROVIDERS.has(text)) return { ok: false, error: "不支持的服务商。" };
    }
    if (field.id === "server.host") {
      if (!text) return { ok: true, value: "127.0.0.1" };
      if (!isAllowedListenHost(text)) return { ok: false, error: "请填写 IP 地址，例如 127.0.0.1 或 0.0.0.0。" };
      return { ok: true, value: normalizeListenHost(text) };
    }
    return { ok: true, value: text };
  }
  return { ok: false, error: `${label}的类型无法识别。` };
}

function parseList(raw) {
  if (typeof raw !== "string") return [];
  return raw.split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
}

function atomicWriteJson(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

function readJsonFile(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed;
  } catch {
    return fallback;
  }
}

function isSafeId(id) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9_-]{0,30}$/i.test(id);
}

function isPlain(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === "object") return { ...value };
  return value;
}

export { flattenCharacterFile };
