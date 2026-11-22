import { rooms, roomById, applyPresentation, statusStatChips } from "./world.js";
import { selectVisibleDialog } from "./dialog.js";
import { navIcons, dialogIcons } from "./icons.js";
import { createPresenter } from "./sprites/index.js";
import { mountSettings } from "./settings.js";
import { mountDiary } from "./diary.js";
import { actorsViewSignature, roomNavSignature, statusSignature, stylesCacheKey, targetOptionsSignature } from "./hud.js";
import { mountVoice } from "./voice.js";

const STAT_EMOJI = {
  leaf: "🍃",
  apple: "🍎",
  sparkle: "✨",
  heart: "💗",
  person: "👤",
};

let currentRoomId = "living";
let focusedName = "青青";
let worldState = null;
let presentation = null;
let presenter = null;

const hud = document.getElementById("hud");
const navEl = document.getElementById("nav");
const clockEl = document.getElementById("clock");
const statusEl = document.getElementById("status");
const dialogEl = document.getElementById("dialog");
const dialogIcon = dialogEl.querySelector(".dialog-icon");
const dialogText = dialogEl.querySelector(".dialog-text");
const composeEl = document.getElementById("compose");
function formField(name) {
  if (!composeEl) return null;
  const named = composeEl.elements?.namedItem?.(name);
  if (named && typeof named === "object" && "tagName" in named) return named;
  return composeEl.querySelector(`[name="${name}"]`);
}
const toneSelect = formField("tone");
const lengthSelect = formField("length");
const targetSelect = formField("target");
const volumeSelect = formField("volume");
const textInput = formField("text");
const composeError = composeEl?.querySelector(".compose-error");
const HOUSE_STYLES_KEY = "__house__";
let focusedId = null;
let composeBusy = false;
let stylesForId = null;
const stylesCache = new Map();
let navSignature = null;
let targetSignature = null;
let lastActorsSignature = null;
let lastStatusSignature = null;
let voiceUi = null;

function characters() {
  return worldState?.characters ? Object.values(worldState.characters) : [];
}

function occupants(roomId) {
  return characters().filter((c) => c.room === roomId);
}

function renderClock() {
  if (!clockEl) return;
  const hhmm = worldState?.clock?.hhmm;
  if (!hhmm) {
    clockEl.hidden = true;
    return;
  }
  clockEl.hidden = false;
  clockEl.textContent = hhmm;
}

function renderHud() {
  const room = roomById(currentRoomId);
  hud.dataset.theme = room.theme;
  renderNav();
  renderClock();
  const people = occupants(room.id);
  const preferred =
    people.find((p) => p.name === focusedName) ||
    people.find((p) => p.line) ||
    people.find((p) => p.action === "talk") ||
    people[0];
  focusedName = preferred ? preferred.name : null;
  focusedId = preferred ? preferred.id : null;
  renderStatus(people);
  renderDialog(people, preferred);
  renderCompose();
}

async function showRoom(id, { report = true } = {}) {
  const room = roomById(id);
  currentRoomId = room.id;
  const roomBg = document.getElementById("room-bg");
  roomBg.src = room.image;
  const roomFg = document.getElementById("room-fg");
  if (roomFg) {
    const fg = (presentation?.rooms?.[room.id]?.props || []).find((item) => item && (item.url || item.image));
    if (fg) {
      roomFg.src = fg.url || fg.image;
      roomFg.hidden = false;
      const depth = Number.isFinite(Number(fg.z)) ? Number(fg.z) : 0.7;
      roomFg.style.zIndex = String(10 + Math.round(depth * 100));
    } else {
      roomFg.removeAttribute("src");
      roomFg.hidden = true;
      roomFg.style.zIndex = "";
    }
  }
  renderHud();
  syncActors();
  voiceUi?.onWorldUpdated();
  const url = new URL(window.location.href);
  url.searchParams.set("room", room.id);
  history.replaceState(null, "", url);
  if (report) reportView(room.id, !document.hidden);
}

function renderNav() {
  const signature = roomNavSignature(rooms);
  if (navSignature !== signature) {
    navEl.innerHTML = rooms
      .map(
        (r) => `<button class="nav-btn" data-room="${r.id}" type="button">
        ${navIcons[r.icon] ?? ""}
        <span>${r.name}</span>
      </button>`
      )
      .join("");
    navSignature = signature;
  }
  for (const btn of navEl.querySelectorAll("[data-room]")) {
    btn.classList.toggle("is-active", btn.dataset.room === currentRoomId);
  }
}

function renderStatus(people) {
  if (!people.length) {
    if (lastStatusSignature !== "") {
      statusEl.innerHTML = "";
      lastStatusSignature = "";
    }
    return;
  }
  const focused = people.find((p) => p.name === focusedName) || people[0];
  const chips = statusStatChips(focused, worldState?.relations);
  const signature = statusSignature({ people, focusedName, chips });
  if (signature === lastStatusSignature) return;
  lastStatusSignature = signature;
  const names = people
    .map(
      (p) =>
        `<button class="chip chip-name${p.name === focusedName ? " is-active" : ""}" type="button" data-name="${p.name}">${p.name}</button>`
    )
    .join("");
  const stats = chips
    .map(
      (s) =>
        `<span class="chip"><span class="ico">${STAT_EMOJI[s.icon] ?? ""}</span>${s.label} <span class="num">${s.value}</span></span>`
    )
    .join("");
  statusEl.innerHTML = names + stats;
}

function renderDialog(people, focused) {
  const selected = selectVisibleDialog({
    people,
    focused,
    lastChat: worldState?.lastChat,
    currentRoomId,
    nowMs: Date.parse(worldState?.clock?.iso) || Date.now(),
  });
  dialogIcon.innerHTML = dialogIcons[selected.icon] ?? dialogIcons.empty;
  dialogText.textContent = selected.text;
  dialogEl.hidden = false;
}

function renderCompose() {
  if (!composeEl) return;
  composeEl.hidden = false;
  fillTargetSelect();
  syncWhisperAvailability();
  updateComposePlaceholder();
  const targetId = targetSelect?.value || "";
  ensureStyles(targetId);
}

function fillTargetSelect() {
  if (!targetSelect) return;
  const previous = targetSelect.value;
  const people = characters().slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const signature = targetOptionsSignature(people);
  if (signature === targetSignature && targetSelect.options.length === people.length + 1) {
    return;
  }
  targetSelect.replaceChildren();
  targetSelect.append(new Option("不指定", ""));
  for (const person of people) {
    targetSelect.append(new Option(person.name || person.id, person.id));
  }
  const stillThere = people.some((person) => person.id === previous);
  targetSelect.value = stillThere ? previous : "";
  targetSignature = signature;
}

function selectedTarget() {
  const id = targetSelect?.value || "";
  if (!id) return null;
  return characters().find((person) => person.id === id) || null;
}

function updateComposePlaceholder() {
  if (!textInput) return;
  const target = selectedTarget();
  textInput.placeholder = target ? `对${target.name}说…` : "说点什么…";
}

function syncWhisperAvailability() {
  if (!volumeSelect) return;
  const hasTarget = !!(targetSelect && targetSelect.value);
  for (const option of volumeSelect.options) {
    if (option.value === "whisper") option.disabled = !hasTarget;
  }
  if (!hasTarget && volumeSelect.value === "whisper") {
    volumeSelect.value = "normal";
  }
}

async function ensureStyles(characterId) {
  if (!toneSelect || !lengthSelect) return;
  const key = stylesCacheKey(characterId, HOUSE_STYLES_KEY);
  if (stylesForId === key && stylesCache.has(key)) return;
  let data = stylesCache.get(key);
  if (!data) {
    try {
      const url = characterId
        ? `/api/chat/styles?character=${encodeURIComponent(characterId)}`
        : "/api/chat/styles";
      const res = await fetch(url);
      if (!res.ok) return;
      data = await res.json();
      stylesCache.set(key, data);
    } catch {
      return;
    }
  }
  const currentTarget = targetSelect?.value || "";
  if ((characterId || "") !== currentTarget) return;
  fillStyleSelects(data);
  fillVolumeSelect(data);
  stylesForId = key;
  if (data.maxInputChars && textInput) textInput.maxLength = data.maxInputChars;
}

function fillVolumeSelect(data) {
  if (!volumeSelect || !data?.volumes) return;
  const previous = volumeSelect.value;
  const volumes = data.volumes;
  const currentIds = [...volumeSelect.options].map((option) => option.value);
  const nextIds = volumes.map((volume) => volume.id);
  const same = currentIds.length === nextIds.length && currentIds.every((id, i) => id === nextIds[i]);
  if (!same) {
    volumeSelect.replaceChildren();
    for (const volume of volumes) {
      volumeSelect.append(new Option(volume.label || volume.id, volume.id));
    }
  }
  const allowed = nextIds;
  const fallback = data.defaultVolume && allowed.includes(data.defaultVolume) ? data.defaultVolume : (allowed.includes("normal") ? "normal" : allowed[0]);
  volumeSelect.value = allowed.includes(previous) ? previous : fallback || "";
  syncWhisperAvailability();
}

function fillStyleSelects(data) {
  const current = {
    tone: toneSelect.value,
    length: lengthSelect.value,
  };
  for (const dim of data.dimensions || []) {
    const select = formField(dim.id);
    if (!select) continue;
    const previous = current[dim.id];
    select.replaceChildren();
    for (const opt of dim.allowed || []) {
      select.append(new Option(opt.label, opt.id));
    }
    const allowed = (dim.allowed || []).map((o) => o.id);
    select.value = allowed.includes(previous) ? previous : dim.default;
  }
}

function showComposeError(message) {
  if (!composeError) return;
  composeError.textContent = message || "现在不方便说话。";
  composeError.hidden = false;
}

function hideComposeError() {
  if (!composeError) return;
  composeError.hidden = true;
  composeError.textContent = "";
}

function setComposeBusy(busy) {
  composeBusy = busy;
  voiceUi?.syncMic?.();
  if (!composeEl) return;
  if (targetSelect) targetSelect.disabled = busy;
  if (volumeSelect) volumeSelect.disabled = busy;
  if (toneSelect) toneSelect.disabled = busy;
  if (lengthSelect) lengthSelect.disabled = busy;
  if (textInput) textInput.disabled = busy;
  const submit = composeEl.querySelector('button[type="submit"]');
  if (submit) {
    submit.disabled = busy;
    submit.dataset.busy = busy ? "true" : "";
    submit.textContent = busy ? "发送中…" : "发送";
  }
}

async function loadState() {
  const res = await fetch("/api/state");
  if (!res.ok) throw new Error(`state ${res.status}`);
  return res.json();
}

function applyState(state) {
  worldState = state;
  renderHud();
  syncActors();
  voiceUi?.onWorldUpdated();
}

async function loadPresentation() {
  const res = await fetch("/api/presentation");
  if (!res.ok) throw new Error(`presentation ${res.status}`);
  return res.json();
}

function syncActors() {
  if (!presenter) return;
  const room = roomById(currentRoomId);
  const payload = {
    roomId: currentRoomId,
    occupants: occupants(currentRoomId),
    focusedId,
    theme: room.theme,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    catalog: presentation,
  };
  const signature = actorsViewSignature(payload);
  if (signature === lastActorsSignature) return;
  lastActorsSignature = signature;
  presenter.update(payload);
}

function connectEvents() {
  const es = new EventSource("/api/events");
  es.addEventListener("world.updated", (e) => {
    try {
      applyState(JSON.parse(e.data));
    } catch (err) {
      console.warn("bad world event", err);
    }
  });
  voiceUi?.attachEvents(es);
  es.onerror = () => {
    /* browser will retry */
  };
  return es;
}

const VIEW_HEARTBEAT_MS = 60_000;
let viewHeartbeat = null;

async function reportView(room, present = true) {
  try {
    await fetch("/api/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, present }),
    });
  } catch {
    /* offline or service restarting */
  }
}

function startViewHeartbeat() {
  if (viewHeartbeat != null) return;
  viewHeartbeat = setInterval(() => {
    if (document.hidden) return;
    reportView(currentRoomId, true);
  }, VIEW_HEARTBEAT_MS);
}

navEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-room]");
  if (btn) showRoom(btn.dataset.room);
});

statusEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-name]");
  if (!btn) return;
  focusedName = btn.dataset.name;
  renderHud();
  syncActors();
});

composeEl?.addEventListener("change", (e) => {
  const name = e.target?.name;
  if (name === "target") {
    syncWhisperAvailability();
    updateComposePlaceholder();
    ensureStyles(targetSelect?.value || "");
  }
});

async function submitCompose() {
  if (composeBusy) return false;
  const text = (textInput?.value || "").trim();
  if (!text) {
    showComposeError("请先说点什么。");
    return false;
  }
  const characterId = targetSelect?.value || "";
  let volume = volumeSelect?.value || "normal";
  if (!characterId && volume === "whisper") {
    volume = "normal";
    if (volumeSelect) volumeSelect.value = "normal";
  }
  setComposeBusy(true);
  hideComposeError();
  try {
    const body = {
      volume,
      text,
      style: {
        tone: formField("tone")?.value,
        length: formField("length")?.value,
      },
    };
    if (characterId) body.characterId = characterId;
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.characters) applyState(data);
    if (data.ok === false) {
      showComposeError(data.reason || "现在不方便说话。");
      return false;
    }
    if (textInput) textInput.value = "";
    return true;
  } catch {
    showComposeError("暂时没能发出去，稍后再试试。");
    return false;
  } finally {
    setComposeBusy(false);
    textInput?.focus();
  }
}

composeEl?.addEventListener("submit", async (e) => {
  e.preventDefault();
  await submitCompose();
});

document.addEventListener("visibilitychange", () => {
  reportView(currentRoomId, document.visibilityState === "visible");
});

window.addEventListener("beforeunload", () => {
  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      "/api/view",
      new Blob([JSON.stringify({ room: currentRoomId, present: false })], {
        type: "application/json",
      })
    );
  }
});

async function start() {
  const initial = new URLSearchParams(location.search).get("room");
  try {
    worldState = await loadState();
  } catch (err) {
    console.warn("failed to load world state", err);
  }
  try {
    presentation = await loadPresentation();
    applyPresentation(presentation);
  } catch (err) {
    console.warn("failed to load presentation catalog, using v1 room paths", err);
    applyPresentation(null);
  }
  const actorsEl = document.getElementById("actors");
  presenter = createPresenter(presentation?.presenter || "html", actorsEl, {
    catalog: presentation,
    onFocus: (person) => {
      if (!person) return;
      focusedName = person.name;
      focusedId = person.id;
      renderHud();
      syncActors();
    },
  });
  presenter.mount(presentation);
  mountSettings();
  mountDiary();
  voiceUi = mountVoice({
    getWorld: () => worldState,
    getRoom: () => currentRoomId,
    isComposeBusy: () => composeBusy,
    getCompose: () => ({
      textInput,
      showError: showComposeError,
      hideError: hideComposeError,
      send: submitCompose,
    }),
  });
  await showRoom(roomById(initial || worldState?.viewer?.room).id);
  connectEvents();
  startViewHeartbeat();
  window.addEventListener("resize", syncActors);
}

start();
