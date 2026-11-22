/**
 * Client voice: play landed clips in order, hold-to-talk, local mute.
 * Mirrors server hearing rules. Never talks to MiniMax directly.
 */

export function canHearVoice(clip, ctx = {}) {
  if (!clip) return false;
  if (ctx.enabled === false) return false;
  if (ctx.characterEnabled === false) return false;
  if (ctx.muted) return false;
  if (ctx.recording) return false;
  const viewer = ctx.viewer;
  if (!viewer?.present) return false;
  const volume = typeof clip.volume === "string" && clip.volume.trim() ? clip.volume.trim() : "normal";
  const lineTo = typeof clip.lineTo === "string" && clip.lineTo.trim() ? clip.lineTo.trim() : null;
  if (volume === "whisper") return lineTo === "viewer";
  if (volume === "loud") return true;
  return !!clip.room && viewer.room === clip.room;
}

export function decideTranscriptAction({ ok, text, autoSend, error } = {}) {
  const value = typeof text === "string" ? text.trim() : "";
  if (!ok || !value) {
    return { send: false, fill: "", error: error || "没能识别出内容。" };
  }
  if (autoSend) return { send: true, fill: value, error: null };
  return { send: false, fill: value, error: null };
}

/** Drop unplayed older clips for the same character when a newer line arrives. */
export function enqueueClip(queue, clip) {
  const list = Array.isArray(queue) ? queue.slice() : [];
  if (!clip) return list;
  const kept = list.filter((item) => item.characterId !== clip.characterId || newerLine(item, clip));
  kept.push(clip);
  return kept;
}

function newerLine(existing, incoming) {
  if (!existing.lineAt || !incoming.lineAt) return false;
  return existing.lineAt > incoming.lineAt;
}

export function hearContext(world, { muted, recording, room, characterId } = {}) {
  const voice = world?.voice || {};
  const viewer = {
    present: world?.viewer?.present !== false,
    room: room || world?.viewer?.room || null,
  };
  return {
    enabled: voice.enabled !== false,
    characterEnabled: characterVoiceEnabled(voice, characterId),
    muted: !!muted,
    recording: !!recording,
    viewer,
  };
}

/** Per-character 朗读 flag from the slim public voice object. Missing means on. */
export function characterVoiceEnabled(voice, characterId) {
  if (!characterId) return true;
  return voice?.characters?.[characterId]?.enabled !== false;
}

export function recordLimitMs(voice, fallbackSec = 15) {
  const sec = Number(voice?.maxRecordSec);
  const fallback = Number.isFinite(Number(fallbackSec)) && Number(fallbackSec) > 0
    ? Number(fallbackSec)
    : 15;
  if (Number.isFinite(sec) && sec > 0) return sec * 1000;
  return fallback * 1000;
}

export function isMicBlocked({ micEnabled, available, recognizing, composeBusy } = {}) {
  return micEnabled === false || available === false || !!recognizing || !!composeBusy;
}

/** Capture the pointer so a drag off the mic button still ends the recording. */
export function captureHoldPointer(event) {
  const target = event?.currentTarget;
  if (target && typeof target.setPointerCapture === "function" && event.pointerId != null) {
    try { target.setPointerCapture(event.pointerId); } catch { /* ignore */ }
  }
}

export function mountVoice(opts = {}) {
  const audio = opts.audio || (typeof Audio !== "undefined" ? new Audio() : null);
  const muteBtn = opts.muteButton || (typeof document !== "undefined" ? document.getElementById("mute-btn") : null);
  const micBtn = opts.micButton || (typeof document !== "undefined" ? document.getElementById("mic-btn") : null);
  let muted = false;
  let recording = false;
  let recognizing = false;
  let pending = [];
  let playing = null;
  let recorder = null;
  let chunks = [];
  let recordTimer = null;
  let savedPlaceholder = "";
  let savedText = "";

  function world() {
    return typeof opts.getWorld === "function" ? opts.getWorld() : null;
  }

  function roomId() {
    return typeof opts.getRoom === "function" ? opts.getRoom() : world()?.viewer?.room;
  }

  function voiceCfg() {
    return world()?.voice || {};
  }

  function applyVolume() {
    if (!audio) return;
    const master = Number(voiceCfg().masterVolume);
    audio.volume = Number.isFinite(master) ? Math.min(1, Math.max(0, master)) : 1;
    audio.muted = muted;
  }

  function ctx(clip) {
    return hearContext(world(), {
      muted,
      recording,
      room: roomId(),
      characterId: clip?.characterId,
    });
  }

  function composeBusy() {
    return typeof opts.isComposeBusy === "function" ? !!opts.isComposeBusy() : false;
  }

  function stopCurrent() {
    if (audio) {
      try {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      } catch { /* ignore */ }
    }
    playing = null;
  }

  function clearPending() {
    pending = [];
  }

  function playNext() {
    if (playing || recording) return;
    applyVolume();
    while (pending.length) {
      const clip = pending.shift();
      if (!canHearVoice(clip, ctx(clip)) || muted) continue;
      playing = clip;
      if (!audio) {
        playing = null;
        continue;
      }
      audio.src = clip.url;
      applyVolume();
      const start = audio.play();
      if (start && typeof start.catch === "function") start.catch(() => advance());
      return;
    }
  }

  function advance() {
    playing = null;
    playNext();
  }

  if (audio) {
    audio.addEventListener("ended", advance);
    audio.addEventListener("error", advance);
  }

  function onVoiceReady(clip) {
    if (!clip?.url) return;
    pending = enqueueClip(pending, clip);
    playNext();
  }

  function onWorldUpdated() {
    if (playing && (!canHearVoice(playing, ctx(playing)) || muted)) stopCurrent();
    pending = pending.filter((clip) => canHearVoice(clip, ctx(clip)));
    if (!playing) playNext();
    syncMic();
    syncMute();
  }

  function setMuted(next) {
    muted = !!next;
    if (audio) audio.muted = muted;
    if (muted) {
      stopCurrent();
      // keep pending so unmuting can resume if still hearable
    } else {
      playNext();
    }
    syncMute();
  }

  function syncMute() {
    if (!muteBtn) return;
    muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    muteBtn.classList.toggle("is-muted", muted);
    muteBtn.textContent = muted ? "取消静音" : "静音";
  }

  function syncMic() {
    if (!micBtn) return;
    const cfg = voiceCfg();
    const micOn = cfg.micEnabled !== false;
    const available = cfg.available !== false;
    const blocked = isMicBlocked({
      micEnabled: micOn,
      available,
      recognizing,
      composeBusy: composeBusy(),
    });
    micBtn.disabled = blocked;
    if (!available) micBtn.title = "语音识别暂时不可用。";
    else if (!micOn) micBtn.title = "麦克风已关闭。";
    else micBtn.title = "按住说话";
    micBtn.classList.toggle("is-recording", recording);
    micBtn.classList.toggle("is-recognizing", recognizing);
    micBtn.textContent = recognizing ? "识别中…" : (recording ? "松手结束" : "按住说话");
  }

  function compose() {
    return typeof opts.getCompose === "function" ? opts.getCompose() : {};
  }

  function maxRecordMs() {
    return recordLimitMs(voiceCfg());
  }

  async function startRecord(event) {
    event?.preventDefault?.();
    if (recording || recognizing || composeBusy()) return;
    const cfg = voiceCfg();
    if (cfg.micEnabled === false) {
      compose().showError?.("麦克风已关闭。");
      return;
    }
    if (cfg.available === false) {
      compose().showError?.("语音识别暂时不可用。");
      return;
    }
    const input = compose().textInput;
    compose().hideError?.();
    stopCurrent();
    clearPending();
    recording = true;
    syncMic();
    try {
      const stream = await (opts.getStream || defaultStream)();
      const mime = pickMime();
      const rec = opts.createRecorder
        ? opts.createRecorder(stream, mime)
        : new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks = [];
      recorder = rec;
      rec.addEventListener("dataavailable", (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      });
      rec.addEventListener("stop", () => {
        stream.getTracks?.().forEach((track) => track.stop());
        finishRecord(rec.mimeType || mime || "audio/webm");
      });
      rec.start();
      recordTimer = setTimeout(() => stopRecord(), maxRecordMs());
    } catch {
      recording = false;
      syncMic();
      compose().showError?.("没有麦克风权限，请打字发送。");
    }
  }

  function stopRecord(event) {
    event?.preventDefault?.();
    if (recordTimer) {
      clearTimeout(recordTimer);
      recordTimer = null;
    }
    if (!recording) return;
    recording = false;
    const rec = recorder;
    recorder = null;
    if (rec && rec.state !== "inactive") {
      try { rec.stop(); } catch { finishRecord("audio/webm"); }
    } else if (!recognizing) {
      syncMic();
    }
  }

  async function finishRecord(mime) {
    recognizing = true;
    syncMic();
    const input = compose().textInput;
    if (input) {
      savedPlaceholder = input.placeholder;
      savedText = input.value;
      input.placeholder = "正在识别…";
      input.value = "";
    }
    try {
      const blob = new Blob(chunks, { type: mime || "audio/webm" });
      chunks = [];
      if (!blob.size) {
        restoreInput();
        compose().showError?.("没能识别出内容。");
        return;
      }
      const transcribe = opts.transcribe || defaultTranscribe;
      const result = await transcribe(blob, mime);
      const decision = decideTranscriptAction({
        ok: result?.ok,
        text: result?.text,
        autoSend: voiceCfg().autoSend !== false,
        error: result?.error,
      });
      if (input) input.value = decision.fill || "";
      if (decision.error) {
        if (input && !decision.fill) input.value = savedText;
        compose().showError?.(decision.error);
        return;
      }
      if (decision.send && typeof compose().send === "function") {
        await compose().send();
      }
    } catch {
      restoreInput();
      compose().showError?.("语音识别暂时不可用。");
    } finally {
      recognizing = false;
      if (input && input.placeholder === "正在识别…") {
        input.placeholder = savedPlaceholder || input.placeholder;
      }
      syncMic();
    }
  }

  function restoreInput() {
    const input = compose().textInput;
    if (input) {
      input.value = savedText;
      input.placeholder = savedPlaceholder || input.placeholder;
    }
  }

  function bind() {
    muteBtn?.addEventListener("click", () => setMuted(!muted));
    if (micBtn) {
      micBtn.addEventListener("pointerdown", (event) => {
        captureHoldPointer(event);
        startRecord(event);
      });
      micBtn.addEventListener("pointerup", stopRecord);
      micBtn.addEventListener("pointercancel", stopRecord);
      micBtn.addEventListener("contextmenu", (event) => event.preventDefault());
    }
    syncMute();
    syncMic();
  }

  function attachEvents(source) {
    if (!source?.addEventListener) return;
    source.addEventListener("voice.ready", (event) => {
      try { onVoiceReady(JSON.parse(event.data)); } catch { /* ignore */ }
    });
    source.addEventListener("voice.failed", () => {});
    source.addEventListener("world.updated", () => onWorldUpdated());
  }

  bind();
  applyVolume();

  return {
    onVoiceReady,
    onWorldUpdated,
    attachEvents,
    setMuted,
    get muted() { return muted; },
    get pending() { return pending; },
    get playing() { return playing; },
    startRecord,
    stopRecord,
    syncMic,
  };
}

function pickMime() {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported?.("audio/webm")) return "audio/webm";
  return "";
}

async function defaultStream() {
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

async function defaultTranscribe(blob, mime) {
  const form = new FormData();
  form.append("file", blob, mime && mime.includes("ogg") ? "clip.ogg" : "clip.webm");
  const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
  return res.json();
}
