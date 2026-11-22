/**
 * THE ONLY place for player-chat numbers and flags.
 * Override from settings/house.json under "chat", and from
 * settings/characters/<id>.json under "chat", via resolveChat.
 * House acoustics (who can hear, volume ranges) live under chat.addressing
 * and are resolved by resolveChatAddressing from house.chat only.
 * Do not put API keys here.
 */

export const HOUSE_CHAT_LOCK = "__house__";

export const DEFAULT_VOLUMES = [
  { id: "whisper", label: "悄悄", range: "target", requiresTarget: true },
  { id: "normal", label: "普通", range: "room", requiresTarget: false },
  { id: "loud", label: "大声", range: "house", requiresTarget: false },
];

export const DEFAULT_ADDRESSING = {
  /** Default volume id when the request omits one. */
  defaultVolume: "normal",
  /** Volume registry. Range is decided here, not by scattered if/else. */
  volumes: DEFAULT_VOLUMES,
  canHearWhenSleeping: false,
  canHearWhenWashing: true,
  /** Reserved: rooms that do not carry a house-wide shout. */
  isolatedRooms: [],
  maxResponders: 1,
  sameRoomFirst: true,
  unaddressedPick: "closeness",
  actionPreference: ["talk", "sit", "eat"],
  contextChars: 160,
  houseLock: true,
};

export const config = {
  /** Hard cap on a player message. Overlong input is rejected without a provider call. */
  maxInputChars: 200,
  /** Hard cap on a reply line. Slightly longer than proactive speech (80). */
  maxReplyChars: 100,
  /** Provider timeout; on timeout, return a safe error and do not write a line. */
  timeoutMs: 20_000,
  /** Prompt text cap (identity card + memory pack + style + user text). */
  maxPromptChars: 4_000,
  /** Style-instruction budget so personalization cannot blow the token cap. */
  styleInstructionsChars: 120,
  /** Identity-card cap; falls back to settings/house identityCardChars when omitted. */
  identityCardChars: 280,
  factMaxChars: 80,
  topicMaxChars: 20,

  /**
   * Legacy same-room flag, kept for backward-compatible canChat().
   * Audience visibility is decided by volume.range (normal still same-room,
   * loud can cross rooms). volume.range wins in resolveAudience.
   */
  mustShareRoom: true,
  /** Do not auto-wake a sleeper. Used by canReply / canChat. */
  canTalkWhenSleeping: false,
  /** Washing: deny reply unless this is true (then chat without interrupting). */
  canTalkWhenWashing: false,
  /** Player-chat replies do not spend the daily proactive quota by default. */
  countAgainstProactiveCap: false,

  /** v1 style-dimension defaults and allow-lists. New dimensions register here. */
  defaultTone: "natural",
  allowedTones: ["natural", "gentle", "concise", "lively"],
  defaultLength: "medium",
  allowedLengths: ["short", "medium"],

  addressing: { ...DEFAULT_ADDRESSING, volumes: DEFAULT_VOLUMES.map((v) => ({ ...v })), actionPreference: [...DEFAULT_ADDRESSING.actionPreference], isolatedRooms: [] },
};

export function getAddressing(cfg = config) {
  return cfg?.addressing ?? config.addressing;
}

/** Resolve a volume id against the registry. Unknown values fall back to the default. */
export function normalizeVolume(volume, cfg = config) {
  const addressing = getAddressing(cfg);
  const volumes = Array.isArray(addressing.volumes) && addressing.volumes.length
    ? addressing.volumes
    : DEFAULT_VOLUMES;
  const raw = typeof volume === "string" ? volume.trim() : "";
  const fallbackId = addressing.defaultVolume || "normal";
  const found = volumes.find((item) => item.id === raw)
    ?? volumes.find((item) => item.id === fallbackId)
    ?? volumes[0]
    ?? DEFAULT_VOLUMES[1];
  return {
    id: found.id,
    label: found.label || found.id,
    range: found.range || "room",
    requiresTarget: !!found.requiresTarget,
  };
}

/**
 * Merge house.chat.addressing onto code defaults.
 * Character settings must not be passed in here.
 */
export function mergeChatAddressing(base = DEFAULT_ADDRESSING, overlay = null) {
  const root = cloneAddressing(base || DEFAULT_ADDRESSING);
  if (!isPlain(overlay)) return root;
  if (typeof overlay.defaultVolume === "string" && overlay.defaultVolume.trim()) {
    root.defaultVolume = overlay.defaultVolume.trim();
  }
  for (const key of ["canHearWhenSleeping", "canHearWhenWashing", "sameRoomFirst", "houseLock"]) {
    if (typeof overlay[key] === "boolean") root[key] = overlay[key];
  }
  for (const key of ["maxResponders", "contextChars"]) {
    if (overlay[key] != null && Number.isFinite(Number(overlay[key]))) {
      root[key] = Number(overlay[key]);
    }
  }
  if (typeof overlay.unaddressedPick === "string" && overlay.unaddressedPick.trim()) {
    root.unaddressedPick = overlay.unaddressedPick.trim();
  }
  if (Array.isArray(overlay.isolatedRooms)) {
    root.isolatedRooms = overlay.isolatedRooms.map((value) => String(value).trim()).filter(Boolean);
  }
  if (Array.isArray(overlay.actionPreference)) {
    const list = overlay.actionPreference.map((value) => String(value).trim()).filter(Boolean);
    if (list.length) root.actionPreference = list;
  }
  if (Array.isArray(overlay.volumes) && overlay.volumes.length) {
    root.volumes = mergeVolumes(root.volumes, overlay.volumes);
  }
  return root;
}

function mergeVolumes(baseList, overlayList) {
  const byId = new Map((baseList || []).map((item) => [item.id, { ...item }]));
  const order = (baseList || []).map((item) => item.id);
  for (const raw of overlayList) {
    if (!isPlain(raw)) continue;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id) continue;
    const prev = byId.get(id) || { id };
    const next = { ...prev, id };
    if (typeof raw.label === "string" && raw.label.trim()) next.label = raw.label.trim();
    if (typeof raw.range === "string" && raw.range.trim()) next.range = raw.range.trim();
    if (typeof raw.requiresTarget === "boolean") next.requiresTarget = raw.requiresTarget;
    byId.set(id, next);
    if (!order.includes(id)) order.push(id);
  }
  return order.map((id) => byId.get(id)).filter(Boolean);
}

function cloneAddressing(src) {
  const base = isPlain(src) ? src : DEFAULT_ADDRESSING;
  return {
    ...DEFAULT_ADDRESSING,
    ...base,
    volumes: (Array.isArray(base.volumes) ? base.volumes : DEFAULT_VOLUMES).map((item) => ({ ...item })),
    actionPreference: [...(Array.isArray(base.actionPreference) ? base.actionPreference : DEFAULT_ADDRESSING.actionPreference)],
    isolatedRooms: [...(Array.isArray(base.isolatedRooms) ? base.isolatedRooms : [])],
  };
}

function isPlain(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
