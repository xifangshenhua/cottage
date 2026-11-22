import { DEFAULT_FRAME, DEFAULT_PIVOT } from "../../server/presentation/config.js";
import { assignSlots, mapAnchorToScreen, resolvePose } from "../../server/presentation/layout.js";

/**
 * HTML overlay presenter. Mounts character sprites between the room still and the HUD.
 * Clicking a sprite reports focus via onFocus; the caller must not change the compose target.
 */
export function createHtmlPresenter(layer, options = {}) {
  let catalog = options.catalog || null;
  const nodes = new Map();
  const leaving = new Map();
  const onFocus = typeof options.onFocus === "function" ? options.onFocus : null;

  function mount(nextCatalog) {
    catalog = nextCatalog || catalog;
    if (layer && catalog?.transitionMs != null) {
      layer.style.setProperty("--actor-fade", `${catalog.transitionMs}ms`);
    }
  }

  function update(state = {}) {
    if (!layer) return;
    if (state.catalog) catalog = state.catalog;
    if (!catalog) {
      clearAll();
      return;
    }
    const roomId = state.roomId;
    const room = catalog.rooms?.[roomId];
    const occupants = Array.isArray(state.occupants) ? state.occupants : [];
    if (state.theme) layer.dataset.theme = state.theme;
    layer.style.setProperty("--actor-fade", `${catalog.transitionMs ?? 200}ms`);

    if (!room || !occupants.length) {
      fadeOutMissing(new Set());
      return;
    }

    const prefs = {};
    for (const person of occupants) {
      const preferred = catalog.characters?.[person.id]?.preferredAnchors?.[roomId];
      if (typeof preferred === "string" && preferred) prefs[person.id] = preferred;
    }
    const slots = assignSlots(occupants, room.anchors || [], prefs, catalog);
    const viewport = state.viewport || layerViewport(layer);
    const artSize = { width: catalog.artWidth || 1280, height: catalog.artHeight || 720 };
    const fit = catalog.fit || "cover";
    const visible = new Set();

    for (const slot of slots) {
      visible.add(slot.id);
      const person = slot.occupant || occupants.find((item) => item.id === slot.id) || { id: slot.id };
      const node = ensureNode(person);
      placeNode(node, slot, person, viewport, artSize, fit, state.focusedId);
    }
    fadeOutMissing(visible);
  }

  function destroy() {
    for (const timer of leaving.values()) clearTimeout(timer);
    leaving.clear();
    nodes.clear();
    preserveRoomFg(layer);
  }

  function ensureNode(person) {
    const pending = leaving.get(person.id);
    if (pending) {
      clearTimeout(pending);
      leaving.delete(person.id);
    }
    let el = nodes.get(person.id);
    if (el) return el;
    el = document.createElement("button");
    el.type = "button";
    el.className = "actor";
    el.dataset.id = person.id;
    const img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    img.addEventListener("error", onImageError);
    const name = document.createElement("span");
    name.className = "actor-name";
    el.append(img, name);
    el.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!catalog || catalog.clickToFocus === false) return;
      const nameText = el.dataset.name || person.name || person.id;
      onFocus?.({ id: person.id, name: nameText });
    });
    layer.append(el);
    nodes.set(person.id, el);
    requestAnimationFrame(() => {
      el.classList.add("is-on");
    });
    return el;
  }

  function placeNode(el, slot, person, viewport, artSize, fit, focusedId) {
    const appearance = catalog.characters?.[person.id] || {};
    const resolved = resolvePose(person.action || slot.action, appearanceFor(appearance), catalog, {
      characterId: person.id,
      exists: makeExists(person.id),
      fallbackPoses: fallbackUrls(),
    });
    const screen = mapAnchorToScreen(slot.anchor, viewport, artSize, fit);
    const frame = appearance.frame || catalog.fallback?.frame || DEFAULT_FRAME;
    const pivot = pivotFor(resolved.pose, appearance);
    const scale = screen.coverScale * (slot.anchor.scale ?? 1) * (appearance.scale ?? 1);
    const width = (frame.width || DEFAULT_FRAME.width) * scale;
    const height = (frame.height || DEFAULT_FRAME.height) * scale;
    const displayName = person.name || appearance.name || person.id;

    el.dataset.name = displayName;
    el.dataset.pose = resolved.pose;
    el.setAttribute("aria-label", displayName);
    el.style.left = `${screen.x}px`;
    el.style.top = `${screen.y}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.style.zIndex = String(depthToZ(slot.anchor));
    el.style.transform = `translate(${-pivot.x * 100}%, ${-pivot.y * 100}%)`;
    el.classList.toggle("is-focused", !!(focusedId && focusedId === person.id));
    el.classList.add("is-on");
    el.classList.remove("is-leaving");

    const img = el.querySelector("img");
    if (img && img.dataset.resolved !== resolved.url) {
      img.dataset.resolved = resolved.url;
      img.dataset.fallback = fallbackUrl(resolved.pose);
      img.src = resolved.url;
    }
    const nameEl = el.querySelector(".actor-name");
    if (nameEl) {
      nameEl.textContent = displayName;
      nameEl.hidden = catalog.showNameplates === false;
    }
  }

  function appearanceFor(appearance) {
    const poses = {};
    for (const [pose, entry] of Object.entries(appearance.poses || {})) {
      if (entry?.exists && entry.url) poses[pose] = entry.url;
    }
    return {
      id: appearance.id,
      dir: appearance.dir,
      scale: appearance.scale,
      poses,
    };
  }

  function makeExists(characterId) {
    return (pose, source) => {
      if (source === "character") return !!catalog.characters?.[characterId]?.poses?.[pose]?.exists;
      const entry = catalog.fallback?.poses?.[pose];
      return entry ? entry.exists !== false : true;
    };
  }

  function fallbackUrls() {
    const out = {};
    for (const [pose, entry] of Object.entries(catalog.fallback?.poses || {})) {
      if (entry?.url) out[pose] = entry.url;
    }
    return out;
  }

  function fallbackUrl(pose) {
    return catalog.fallback?.poses?.[pose]?.url
      || catalog.fallback?.poses?.[catalog.fallbackPose || "sit"]?.url
      || `/assets/characters/${catalog.pack || "v1"}/fallback/${pose || "sit"}.png`;
  }

  function pivotFor(pose, appearance) {
    const posePivot = appearance.poses?.[pose]?.pivot
      || catalog.fallback?.poses?.[pose]?.pivot
      || catalog.characters?.[appearance.id]?.poses?.[pose]?.pivot;
    if (posePivot && Number.isFinite(Number(posePivot.x)) && Number.isFinite(Number(posePivot.y))) {
      return { x: Number(posePivot.x), y: Number(posePivot.y) };
    }
    return appearance.pivot || catalog.fallback?.pivot || DEFAULT_PIVOT;
  }

  function fadeOutMissing(visible) {
    const ms = catalog?.transitionMs ?? 200;
    for (const [id, el] of nodes) {
      if (visible.has(id)) continue;
      if (leaving.has(id)) continue;
      el.classList.remove("is-on");
      el.classList.add("is-leaving");
      const timer = setTimeout(() => {
        leaving.delete(id);
        nodes.delete(id);
        el.remove();
      }, ms + 20);
      leaving.set(id, timer);
    }
  }

  function clearAll() {
    for (const timer of leaving.values()) clearTimeout(timer);
    leaving.clear();
    nodes.clear();
    preserveRoomFg(layer);
  }

  function onImageError(event) {
    const img = event.currentTarget;
    const fallback = img?.dataset.fallback;
    if (!fallback || img.dataset.usedFallback === "1") return;
    img.dataset.usedFallback = "1";
    img.src = fallback;
  }

  return { mount, update, destroy };
}


function preserveRoomFg(layer) {
  if (!layer) return;
  const fg = layer.querySelector("#room-fg");
  layer.replaceChildren(...(fg ? [fg] : []));
}

/** CSS z-index from an anchor or prop depth (0–1, closer to camera is larger). */
function depthToZ(item) {
  const raw = Number(item?.z);
  const fallback = Number(item?.y);
  const depth = Number.isFinite(raw) ? raw : Number.isFinite(fallback) ? fallback : 0;
  return 10 + Math.round(depth * 100);
}

function layerViewport(layer) {
  const rect = layer.getBoundingClientRect();
  return {
    width: rect.width || window.innerWidth || 0,
    height: rect.height || window.innerHeight || 0,
  };
}
