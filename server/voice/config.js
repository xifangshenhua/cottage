/**
 * Voice module defaults. Overlay: code ← settings/house.json voice.*
 * ← settings/characters/<id>.json voice.
 * This is TTS/ASR only. Proactive / NPC-talk numbers stay in speech.*.
 * Never store or log API keys here.
 */

export const config = {
  enabled: true,
  micEnabled: true,
  autoSend: true,
  masterVolume: 1,
  model: "speech-2.8-turbo",
  asrModel: "asr-1.0",
  language: "zh",
  format: "mp3",
  sampleRate: 32_000,
  channel: 1,
  timeoutMs: 10_000,
  asrTimeoutMs: 15_000,
  retry: 1,
  synthConcurrency: 1,
  maxRecordSec: 15,
  maxTextChars: 500,
  cacheMaxFiles: 200,
  cacheMaxBytes: 80 * 1024 * 1024,
  memoryMaxClips: 40,
  memoryMaxBuffers: 8,
  bufferTtlMs: 30_000,
  vol: 1,
  pitch: 0,
  voiceId: "female-tianmei",
  speed: 1,
};

/** Official system voice_id + Chinese label. Shortlist only; no cloning. */
export const VOICE_OPTIONS = [
  { value: "Chinese (Mandarin)_Soft_Girl", label: "柔和少女" },
  { value: "Chinese (Mandarin)_Warm_Girl", label: "温暖少女" },
  { value: "female-tianmei", label: "甜美女性" },
  { value: "danya_xuejie", label: "淡雅学姐" },
  { value: "female-chengshu", label: "成熟女性" },
  { value: "female-yujie", label: "御姐" },
  { value: "qiaopi_mengmei", label: "俏皮萌妹" },
  { value: "female-shaonv", label: "少女" },
  { value: "Chinese (Mandarin)_Gentle_Senior", label: "温柔学姐" },
  { value: "Chinese (Mandarin)_Warm_Bestie", label: "温暖闺蜜" },
  { value: "Chinese (Mandarin)_Crisp_Girl", label: "清脆少女" },
  { value: "tianxin_xiaoling", label: "甜心小玲" },
];

export const CHARACTER_VOICE_DEFAULTS = {
  qingqing: { voiceId: "Chinese (Mandarin)_Soft_Girl", speed: 0.92, enabled: true },
  linxia: { voiceId: "danya_xuejie", speed: 1, enabled: true },
  xiaonan: { voiceId: "qiaopi_mengmei", speed: 1.08, enabled: true },
};

export const FALLBACK_CHARACTER_VOICE = {
  voiceId: "female-tianmei",
  speed: 1,
  enabled: true,
};

export function characterVoiceDefaults(characterId) {
  return CHARACTER_VOICE_DEFAULTS[characterId] ?? FALLBACK_CHARACTER_VOICE;
}

const PUNCT_ONLY = /^[\s\p{P}\p{S}]+$/u;

/** Skip empty, punctuation-only, or over-long lines. */
export function shouldSynthesize(text, maxChars = config.maxTextChars) {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return false;
  const cap = Number(maxChars);
  if (Number.isFinite(cap) && cap > 0 && value.length > cap) return false;
  if (PUNCT_ONLY.test(value)) return false;
  return true;
}

export function clampVolume(value, fallback = config.masterVolume) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function clampSpeed(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0.5) return 0.5;
  if (n > 2) return 2;
  return n;
}

export function truncateAsrText(text, maxChars = 200) {
  const value = typeof text === "string" ? text.trim() : "";
  const cap = Number(maxChars);
  if (!value) return "";
  if (!Number.isFinite(cap) || cap <= 0 || value.length <= cap) return value;
  return value.slice(0, cap);
}
