/**
 * Keep viewer.present honest so proactive speech does not assume you are
 * still in the room after a crashed tab, failed beacon, or process restart.
 * lastSeenAt is the source of truth. An open SSE client is only a weak
 * signal and does not keep present=true after lastSeenAt has gone stale.
 */
import { resolveSpeech } from "./settings/index.js";

export const DEFAULT_VIEWER_AWAY_TIMEOUT_MIN = 5;

export function resolveViewerAwayTimeoutMin(settings) {
  const speech = resolveSpeech(null, settings);
  const n = Number(speech?.viewerAwayTimeoutMin);
  if (Number.isFinite(n) && n > 0) return n;
  return DEFAULT_VIEWER_AWAY_TIMEOUT_MIN;
}

/**
 * If present is true but lastSeenAt is missing or older than the timeout,
 * set present to false and keep the last room. Returns whether it changed.
 * Stale lastSeenAt expires even when sseClientCount > 0 so a half-dead
 * stream cannot pin presence forever.
 */
export function expireViewerIfAway(world, {
  now = new Date(),
  timeoutMin,
  settings,
  sseClientCount = 0,
} = {}) {
  const viewer = world?.viewer;
  if (!viewer || viewer.present !== true) return false;
  const minutes = timeoutMin ?? resolveViewerAwayTimeoutMin(settings);
  const timeoutMs = Math.max(0, Number(minutes) || DEFAULT_VIEWER_AWAY_TIMEOUT_MIN) * 60_000;
  const last = Date.parse(viewer.lastSeenAt);
  const at = now instanceof Date ? now.getTime() : Date.parse(now);
  const nowMs = Number.isFinite(at) ? at : Date.now();
  const stale = !Number.isFinite(last) || nowMs - last >= timeoutMs;
  if (!stale) return false;
  // sseClientCount is accepted so callers can pass it; it does not skip expiry.
  void sseClientCount;
  viewer.present = false;
  return true;
}

/** After an SSE client is removed, clear presence only when none remain. */
export function viewerPatchAfterSseClose(clientCountAfter, viewer) {
  if (Number(clientCountAfter) <= 0 && viewer?.present) {
    return { present: false };
  }
  return null;
}
