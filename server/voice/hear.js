/**
 * Whether the viewer can hear a landed voice clip *right now*.
 * Uses the clip's room snapshot (land time), not a later walk.
 * Character/house enabled is also re-checked by the scheduler before synth.
 */

export function canHearVoice(clip, ctx = {}) {
  if (!clip) return false;
  if (ctx.enabled === false) return false;
  if (ctx.characterEnabled === false) return false;
  if (ctx.muted) return false;
  if (ctx.recording) return false;
  const viewer = ctx.viewer;
  if (!viewer?.present) return false;

  const volume = typeof clip.volume === "string" && clip.volume.trim()
    ? clip.volume.trim()
    : "normal";
  const lineTo = typeof clip.lineTo === "string" && clip.lineTo.trim()
    ? clip.lineTo.trim()
    : null;

  if (volume === "whisper") return lineTo === "viewer";
  if (volume === "loud") return true;

  // normal / default, and NPC talk that is only visible in the same room
  const npcOnlySameRoom = lineTo && lineTo !== "viewer" && ctx.lineVisibleOnlySameRoom !== false;
  if (volume === "normal" || volume === "default" || npcOnlySameRoom || !volume) {
    return !!clip.room && viewer.room === clip.room;
  }
  return !!clip.room && viewer.room === clip.room;
}
