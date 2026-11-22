/**
 * Extensible style-dimension registry.
 * Adding a dimension later means registering a preset (and default/allowed
 * keys on chat config), not changing the main chat flow.
 */
import { config as defaultConfig } from "./config.js";

export const dimensions = [
  {
    id: "tone",
    label: "语气",
    defaultKey: "defaultTone",
    allowedKey: "allowedTones",
    presets: {
      natural: { id: "natural", label: "自然", instruction: "用自然、日常的语气说话。" },
      gentle: { id: "gentle", label: "温柔", instruction: "语气温柔、体贴，句子放缓。" },
      concise: { id: "concise", label: "简洁", instruction: "说话简洁克制，少用修饰。" },
      lively: { id: "lively", label: "活泼", instruction: "语气轻快、口语化，可以活泼一点。" },
    },
  },
  {
    id: "length",
    label: "篇幅",
    defaultKey: "defaultLength",
    allowedKey: "allowedLengths",
    presets: {
      short: { id: "short", label: "简短", instruction: "只说一两句，尽量短。" },
      medium: { id: "medium", label: "适中", instruction: "回复篇幅适中，两三句即可。" },
    },
  },
];

export function getDimension(id) {
  return dimensions.find((dim) => dim.id === id) ?? null;
}

/**
 * Merge global/character-resolved config with an optional request override.
 * Request wins if it is in the allowed list; otherwise clamp to the character
 * (resolved) default. Never throws.
 */
export function mergeStyle(cfg = defaultConfig, request = {}) {
  const src = isPlain(request) ? request : {};
  const style = isPlain(src.style) ? src.style : src;
  const out = {};
  for (const dim of dimensions) {
    const allowed = allowedIds(dim, cfg);
    const fallback = clampToAllowed(cfg[dim.defaultKey], allowed, allowed[0]);
    const requested = typeof style[dim.id] === "string" ? style[dim.id].trim() : "";
    out[dim.id] = allowed.includes(requested) ? requested : fallback;
  }
  return out;
}

/** Labels + allowed values + current defaults for the styles endpoint / UI. */
export function describeStyles(cfg = defaultConfig, { characterId } = {}) {
  const resolved = mergeStyle(cfg, {});
  return {
    characterId: characterId ?? null,
    maxInputChars: Number(cfg.maxInputChars) || defaultConfig.maxInputChars,
    defaults: resolved,
    dimensions: dimensions.map((dim) => {
      const allowed = allowedIds(dim, cfg);
      return {
        id: dim.id,
        label: dim.label,
        default: resolved[dim.id],
        allowed: allowed.map((id) => ({
          id,
          label: dim.presets[id]?.label ?? id,
        })),
      };
    }),
  };
}

/** Short, budgeted style instructions for the prompt. */
export function styleInstructions(resolved, cfg = defaultConfig) {
  const parts = [];
  for (const dim of dimensions) {
    const id = resolved?.[dim.id];
    const instruction = dim.presets[id]?.instruction;
    if (instruction) parts.push(instruction);
  }
  const text = parts.join("");
  const cap = Number(cfg.styleInstructionsChars);
  if (!Number.isFinite(cap) || cap <= 0) return text;
  return text.length <= cap ? text : text.slice(0, cap);
}

export function allowedIds(dim, cfg = defaultConfig) {
  const known = Object.keys(dim.presets);
  const raw = cfg?.[dim.allowedKey];
  if (!Array.isArray(raw) || !raw.length) return known;
  const allow = raw
    .map((id) => String(id).trim())
    .filter((id) => known.includes(id));
  return allow.length ? allow : known;
}

function clampToAllowed(value, allowed, fallback) {
  if (typeof value === "string" && allowed.includes(value)) return value;
  return fallback ?? allowed[0] ?? null;
}

function isPlain(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
