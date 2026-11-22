/**
 * House settings panel. Renders the catalog from GET /api/settings.
 * Everyday groups first; advanced groups stay collapsed.
 */

const TONELESS = Object.create(null);

export function mountSettings({ button, panel } = {}) {
  const btn = button || document.getElementById("settings-btn");
  const root = panel || document.getElementById("settings-panel");
  if (!btn || !root) return;

  let catalog = null;
  let baseline = { house: {}, characters: {} };
  let draft = { house: {}, characters: {} };
  let secretDraft = emptySecretDraft();
  let characterId = "qingqing";
  let open = false;
  let busy = false;
  let status = { type: "", text: "" };

  btn.addEventListener("click", () => {
    if (open) close();
    else openPanel();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open) close();
  });

  if (location.hash === "#settings") openPanel();
  window.addEventListener("hashchange", () => {
    if (location.hash === "#settings" && !open) openPanel();
    if (location.hash !== "#settings" && open) close({ skipHash: true });
  });

  async function openPanel() {
    open = true;
    btn.classList.add("is-open");
    root.hidden = false;
    root.innerHTML = `<div class="settings-sheet"><p class="settings-status">正在读取设置…</p></div>`;
    if (location.hash !== "#settings") history.replaceState(null, "", `${location.pathname}${location.search}#settings`);
    try {
      catalog = await loadCatalog();
      characterId = catalog.characters[0]?.id || "qingqing";
      resetDraft();
      status = { type: "", text: "" };
      render();
    } catch {
      root.innerHTML = `<div class="settings-sheet">
        <header class="settings-head">
          <h1>房子设置</h1>
          <button type="button" class="settings-close" data-close>关闭</button>
        </header>
        <p class="settings-status is-error">没能读到设置，请稍后再试。</p>
      </div>`;
      root.querySelector("[data-close]")?.addEventListener("click", () => close());
    }
  }

  function close({ skipHash } = {}) {
    open = false;
    btn.classList.remove("is-open");
    root.hidden = true;
    root.innerHTML = "";
    if (!skipHash && location.hash === "#settings") {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
  }

  function resetDraft() {
    draft = {
      house: { ...catalog.effective.house },
      characters: {},
    };
    for (const item of catalog.characters) {
      draft.characters[item.id] = { ...catalog.effective.characters[item.id] };
    }
    baseline = structuredClone(draft);
    secretDraft = emptySecretDraft();
  }

  function render() {
    const everyday = catalog.groups.filter((group) => !group.advanced);
    const advanced = catalog.groups.filter((group) => group.advanced);
    const dirty = isDirty();
    root.innerHTML = `
      <div class="settings-sheet" role="dialog" aria-labelledby="settings-title">
        <header class="settings-head">
          <div>
            <h1 id="settings-title">房子设置</h1>
            <p class="settings-lead">改的是全屋规则。大部分保存后马上生效，不用重启，也不会重置房间或记忆。改监听地址后需要重启服务。</p>
          </div>
          <div class="settings-head-actions">
            <button type="button" class="settings-close" data-close>关闭</button>
            <button type="button" class="settings-save" data-save ${dirty && !busy ? "" : "disabled"}>${busy ? "保存中…" : "保存"}</button>
          </div>
        </header>
        ${status.text ? `<p class="settings-status ${status.type === "error" ? "is-error" : status.type === "warn" ? "is-warn" : "is-ok"}">${escapeHtml(status.text)}</p>` : ""}
        ${catalog.listen?.restartRequired ? `<p class="settings-status is-warn">监听地址已更改，需要重启服务后才会生效。当前进程仍在 ${escapeHtml(formatListen(catalog.listen.runtimeHost, catalog.listen.runtimePort))}。</p>` : ""}
        <div class="settings-body">
          ${everyday.map(renderGroup).join("")}
          <details class="settings-advanced">
            <summary>进阶</summary>
            <p class="settings-group-help">这些数字平时不用改。调错了可以用分组上的「恢复默认」改回去。</p>
            ${advanced.map(renderGroup).join("")}
          </details>
        </div>
      </div>
    `;
    bind(root);
  }

  function renderGroup(group) {
    const fields = catalog.fields.filter((field) => field.group === group.id);
    if (!fields.length) return "";
    const isCharacter = !!group.characterScoped;
    return `
      <section class="settings-group" data-group="${group.id}">
        <div class="settings-group-head">
          <div>
            <h2>${escapeHtml(group.title)}</h2>
            <p class="settings-group-help">${escapeHtml(group.help || "")}</p>
          </div>
          <button type="button" class="settings-restore" data-restore="${group.id}" ${busy ? "disabled" : ""}>恢复默认</button>
        </div>
        ${isCharacter ? renderSwitcher() : ""}
        <div class="settings-fields">
          ${fields.map((field) => renderField(field, isCharacter)).join("")}
        </div>
      </section>
    `;
  }

  function renderSwitcher() {
    return `<div class="settings-switcher" role="tablist" aria-label="人物">
      ${catalog.characters.map((item) => `
        <button type="button" class="settings-chip ${item.id === characterId ? "is-active" : ""}" data-character="${item.id}">
          ${escapeHtml(item.name)}
        </button>
      `).join("")}
    </div>`;
  }

  function renderField(field, isCharacter) {
    if (field.visibleWhen && !isVisible(field, isCharacter)) return "";
    const value = fieldValue(field, isCharacter);
    const def = fieldDefault(field, isCharacter);
    const changed = !sameValue(value, def);
    const dirty = isFieldDirty(field, isCharacter);
    const name = fieldName(field, isCharacter);
    return `
      <label class="settings-field ${changed ? "is-override" : ""} ${dirty ? "is-dirty" : ""}" data-field-id="${escapeHtml(field.id)}" data-scope="${isCharacter ? "character" : "house"}">
        <span class="settings-field-label">
          ${escapeHtml(field.label)}
          ${changed ? `<span class="settings-flag" title="与默认值不同">已改</span>` : ""}
        </span>
        <span class="settings-field-help">${escapeHtml(field.help || "")}</span>
        <span class="settings-control">
          ${controlHtml(field, name, value, isCharacter)}
          ${field.unit ? `<span class="settings-unit">${escapeHtml(field.unit)}</span>` : ""}
        </span>
        ${field.type === "secret" ? secretHint(field, isCharacter) : `<span class="settings-default">默认 ${formatDefault(field, def)}</span>`}
      </label>
    `;
  }

  function controlHtml(field, name, value, isCharacter = false) {
    if (field.type === "secret") {
      const key = secretFieldKey(field);
      const typed = secretTyped(key, isCharacter);
      const cleared = isSecretCleared(key, isCharacter);
      const presence = secretPresence(key, isCharacter);
      const placeholder = cleared
        ? "保存后将清除此密钥"
        : presence?.configured
          ? (presence.source === "env" ? "已从环境变量配置，输入新密钥可覆盖" : "已配置，输入新密钥可更换")
          : "尚未配置";
      const canClear = presence?.configured && presence.source === "file";
      return `<span class="settings-secret">
        <input type="password" name="${escapeHtml(name)}" value="${escapeHtml(typed)}" autocomplete="new-password" spellcheck="false" placeholder="${escapeHtml(placeholder)}" ${cleared ? "disabled" : ""} />
        ${canClear || cleared ? `<button type="button" class="settings-secret-clear" data-clear-secret="${escapeHtml(name)}" ${busy ? "disabled" : ""}>${cleared ? "撤销清除" : "清除"}</button>` : ""}
      </span>`;
    }
    if (field.type === "boolean") {
      return `<span class="settings-toggle"><input type="checkbox" name="${escapeHtml(name)}" ${value ? "checked" : ""} /><span></span></span>`;
    }
    if (field.type === "enum") {
      const options = (field.options || []).map((item) => {
        const selected = String(item.value) === String(value) ? "selected" : "";
        return `<option value="${escapeHtml(item.value)}" ${selected}>${escapeHtml(item.label)}</option>`;
      }).join("");
      return `<select name="${escapeHtml(name)}">${options}</select>`;
    }
    if (field.type === "time") {
      return `<input type="time" name="${escapeHtml(name)}" value="${escapeHtml(value || "")}" required />`;
    }
    if (field.type === "number") {
      const step = field.step ?? 1;
      const min = field.min != null ? `min="${field.min}"` : "";
      const max = field.max != null ? `max="${field.max}"` : "";
      return `<input type="number" name="${escapeHtml(name)}" value="${escapeAttrNumber(value)}" step="${step}" ${min} ${max} />`;
    }
    if (field.type === "text") {
      const max = field.maxChars ? `maxlength="${field.maxChars}"` : "";
      return `<textarea name="${escapeHtml(name)}" rows="3" ${max}>${escapeHtml(value || "")}</textarea>`;
    }
    if (field.type === "list") {
      const text = Array.isArray(value) ? value.join("、") : (value || "");
      const max = field.maxChars ? `maxlength="${field.maxChars}"` : "";
      return `<input type="text" name="${escapeHtml(name)}" value="${escapeHtml(text)}" ${max} placeholder="用顿号或逗号分开" />`;
    }
    const max = field.maxChars ? `maxlength="${field.maxChars}"` : "";
    return `<input type="text" name="${escapeHtml(name)}" value="${escapeHtml(value || "")}" ${max} />`;
  }

  function bind(node) {
    node.querySelector("[data-close]")?.addEventListener("click", () => close());
    node.querySelector("[data-save]")?.addEventListener("click", () => save());
    node.querySelectorAll("[data-character]").forEach((el) => {
      el.addEventListener("click", () => {
        readForm(node);
        characterId = el.dataset.character;
        render();
      });
    });
    node.querySelectorAll("[data-restore]").forEach((el) => {
      el.addEventListener("click", () => restoreGroup(el.dataset.restore));
    });
    node.querySelectorAll("[data-clear-secret]").forEach((el) => {
      el.addEventListener("click", () => {
        readForm(node);
        toggleSecretClear(el.dataset.clearSecret);
        render();
      });
    });
    node.querySelectorAll("input, select, textarea").forEach((el) => {
      el.addEventListener("input", (event) => onFormChange(node, event));
      el.addEventListener("change", (event) => onFormChange(node, event));
    });
  }

  function onFormChange(node, event) {
    const previousSeparate = !!draft.house["memory.useSeparateModel"];
    readForm(node);
    if (status.type) {
      status = { type: "", text: "" };
      const note = node.querySelector(".settings-status");
      if (note) note.remove();
    }
    const nowSeparate = !!draft.house["memory.useSeparateModel"];
    if (previousSeparate !== nowSeparate) {
      const focusName = event?.target?.name;
      render();
      if (focusName) root.querySelector(`[name="${cssEscape(focusName)}"]`)?.focus();
      return;
    }
    refreshChrome(node);
  }

  function refreshChrome(node) {
    const saveBtn = node.querySelector("[data-save]");
    if (saveBtn) {
      saveBtn.disabled = !isDirty() || busy;
      saveBtn.textContent = busy ? "保存中…" : "保存";
    }
    for (const label of node.querySelectorAll(".settings-field[data-field-id]")) {
      const id = label.dataset.fieldId;
      const isCharacter = label.dataset.scope === "character";
      const field = findField(id, isCharacter ? "character" : "house");
      if (!field) continue;
      const value = fieldValue(field, isCharacter);
      const def = fieldDefault(field, isCharacter);
      label.classList.toggle("is-override", !sameValue(value, def));
      label.classList.toggle("is-dirty", isFieldDirty(field, isCharacter));
      let flag = label.querySelector(".settings-flag");
      if (!sameValue(value, def)) {
        if (!flag) {
          label.querySelector(".settings-field-label")?.insertAdjacentHTML("beforeend", `<span class="settings-flag" title="与默认值不同">已改</span>`);
        }
      } else if (flag) {
        flag.remove();
      }
    }
  }

  function readForm(node) {
    const formEls = node.querySelectorAll("input[name], select[name], textarea[name]");
    for (const el of formEls) {
      const parsed = parseName(el.name);
      if (!parsed) continue;
      const field = findField(parsed.id, parsed.scope);
      if (!field) continue;
      if (field.type === "secret") {
        const key = secretFieldKey(field);
        if (el.disabled) continue;
        setSecretTyped(key, parsed.scope === "character", parsed.characterId, el.value);
        continue;
      }
      const value = readControl(el, field);
      if (parsed.scope === "character") {
        if (!draft.characters[parsed.characterId]) draft.characters[parsed.characterId] = {};
        draft.characters[parsed.characterId][field.id] = value;
      } else {
        draft.house[field.id] = value;
      }
    }
  }

  function readControl(el, field) {
    if (field.type === "boolean") return !!el.checked;
    if (field.type === "number") {
      const n = Number(el.value);
      return Number.isFinite(n) ? n : el.value;
    }
    if (field.type === "list") {
      return String(el.value || "").split(/[、,，]/).map((item) => item.trim()).filter(Boolean);
    }
    return String(el.value || "").trim();
  }

  async function save() {
    if (busy || !isDirty()) return;
    const body = buildPatch();
    const hostChanged = Object.prototype.hasOwnProperty.call(body.house || {}, "server.host");
    await submit(body, hostChanged
      ? "已保存。监听地址已更改，需要重启服务后才会生效。"
      : "已保存，正在使用新的设置。");
  }

  async function restoreGroup(groupId) {
    if (busy) return;
    const group = catalog.groups.find((item) => item.id === groupId);
    const body = group?.characterScoped
      ? { restore: { characters: { [characterId]: [groupId] } } }
      : { restore: { house: [groupId] } };
    await submit(body, `已将「${group?.title || "这组"}」恢复为默认。`);
  }

  async function submit(body, okText) {
    busy = true;
    status = { type: "", text: "" };
    render();
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        status = { type: "error", text: data.error || "没能保存，请检查填写后再试。" };
        return;
      }
      catalog = data;
      if (!catalog.characters.some((item) => item.id === characterId)) {
        characterId = catalog.characters[0]?.id || characterId;
      }
      resetDraft();
      status = {
        type: data.listen?.restartRequired ? "warn" : "ok",
        text: data.listen?.restartRequired
          ? "已保存。监听地址已更改，需要重启服务后才会生效。"
          : okText,
      };
    } catch {
      status = { type: "error", text: "暂时没能保存，请稍后再试。" };
    } finally {
      busy = false;
      render();
    }
  }

  function buildPatch() {
    const house = {};
    for (const field of catalog.fields.filter((item) => item.scope !== "character")) {
      if (field.type === "secret") continue;
      if (!sameValue(draft.house[field.id], baseline.house[field.id])) {
        house[field.id] = draft.house[field.id];
      }
    }
    if (house["memory.useSeparateModel"] === true) {
      if (house["memory.model.provider"] === undefined) house["memory.model.provider"] = draft.house["memory.model.provider"];
      if (house["memory.model.model"] === undefined) house["memory.model.model"] = draft.house["memory.model.model"];
    }
    const characters = {};
    for (const item of catalog.characters) {
      const patch = {};
      for (const field of catalog.fields.filter((entry) => entry.scope === "character")) {
        if (field.type === "secret") continue;
        if (!sameValue(draft.characters[item.id]?.[field.id], baseline.characters[item.id]?.[field.id])) {
          patch[field.id] = draft.characters[item.id][field.id];
        }
      }
      if (Object.keys(patch).length) characters[item.id] = patch;
    }
    const body = {};
    if (Object.keys(house).length) body.house = house;
    if (Object.keys(characters).length) body.characters = characters;
    const secrets = buildSecretsPatch();
    if (secrets) body.secrets = secrets;
    return body;
  }

  function isDirty() {
    const body = catalog ? buildPatch() : {};
    return !!(body.house || body.characters || body.secrets);
  }

  function isFieldDirty(field, isCharacter) {
    if (field.type === "secret") {
      const key = secretFieldKey(field);
      if (isSecretCleared(key, isCharacter)) return true;
      return !!secretTyped(key, isCharacter);
    }
    if (isCharacter) {
      return !sameValue(draft.characters[characterId]?.[field.id], baseline.characters[characterId]?.[field.id]);
    }
    return !sameValue(draft.house[field.id], baseline.house[field.id]);
  }

  function isVisible(field, isCharacter) {
    if (!field.visibleWhen) return true;
    const current = isCharacter
      ? draft.characters[characterId]?.[field.visibleWhen]
      : draft.house[field.visibleWhen];
    return !!current;
  }

  function fieldValue(field, isCharacter) {
    return isCharacter ? draft.characters[characterId]?.[field.id] : draft.house[field.id];
  }

  function fieldDefault(field, isCharacter) {
    if (isCharacter) return catalog.defaults.characters[characterId]?.[field.id];
    return catalog.defaults.house[field.id];
  }

  function fieldName(field, isCharacter) {
    return isCharacter ? `character:${characterId}:${field.id}` : `house:${field.id}`;
  }

  function parseName(name) {
    const character = name.match(/^character:([^:]+):(.+)$/);
    if (character) return { scope: "character", characterId: character[1], id: character[2] };
    const house = name.match(/^house:(.+)$/);
    if (house) return { scope: "house", id: house[1] };
    return null;
  }

  function findField(id, scope) {
    return catalog.fields.find((field) => field.id === id && (field.scope || "house") === scope);
  }

  function secretFieldKey(field) {
    return String(field.id || "").replace(/^secrets\./, "");
  }

  function secretTyped(key, isCharacter) {
    if (isCharacter) return secretDraft.characters[characterId]?.[key] || "";
    return secretDraft.house[key] || "";
  }

  function isSecretCleared(key, isCharacter) {
    if (isCharacter) return !!secretDraft.clearCharacters[characterId]?.[key];
    return !!secretDraft.clearHouse[key];
  }

  function setSecretTyped(key, isCharacter, character, value) {
    const text = String(value ?? "");
    if (isCharacter) {
      if (!secretDraft.characters[character]) secretDraft.characters[character] = {};
      if (!secretDraft.clearCharacters[character]) secretDraft.clearCharacters[character] = {};
      secretDraft.characters[character][key] = text;
      secretDraft.clearCharacters[character][key] = false;
      return;
    }
    secretDraft.house[key] = text;
    secretDraft.clearHouse[key] = false;
  }

  function toggleSecretClear(name) {
    const parsed = parseName(name);
    if (!parsed) return;
    const field = findField(parsed.id, parsed.scope);
    if (!field || field.type !== "secret") return;
    const key = secretFieldKey(field);
    if (parsed.scope === "character") {
      const id = parsed.characterId;
      if (!secretDraft.clearCharacters[id]) secretDraft.clearCharacters[id] = {};
      if (!secretDraft.characters[id]) secretDraft.characters[id] = {};
      const next = !secretDraft.clearCharacters[id][key];
      secretDraft.clearCharacters[id][key] = next;
      if (next) secretDraft.characters[id][key] = "";
      return;
    }
    const next = !secretDraft.clearHouse[key];
    secretDraft.clearHouse[key] = next;
    if (next) secretDraft.house[key] = "";
  }

  function secretPresence(key, isCharacter) {
    if (isCharacter) return catalog.secretStatus?.characters?.[characterId]?.[key] || null;
    return catalog.secretStatus?.house?.[key] || null;
  }

  function secretHint(field, isCharacter) {
    const key = secretFieldKey(field);
    const presence = secretPresence(key, isCharacter);
    const cleared = isSecretCleared(key, isCharacter);
    if (cleared) return `<span class="settings-default">保存后将清除此密钥</span>`;
    if (presence?.configured && presence.source === "env") {
      return `<span class="settings-default">当前来自环境变量，设置页保存的密钥优先</span>`;
    }
    if (presence?.configured) return `<span class="settings-default">已配置</span>`;
    if (presence?.fallsBackTo) return `<span class="settings-default">未单独配置，将使用回退密钥</span>`;
    return `<span class="settings-default">尚未配置</span>`;
  }

  function buildSecretsPatch() {
    const house = {};
    for (const [key, value] of Object.entries(secretDraft.house)) {
      if (String(value || "").trim()) house[key] = String(value).trim();
    }
    for (const [key, flagged] of Object.entries(secretDraft.clearHouse)) {
      if (flagged) house[`${key}Clear`] = true;
    }
    const characters = {};
    const ids = new Set([
      ...Object.keys(secretDraft.characters),
      ...Object.keys(secretDraft.clearCharacters),
    ]);
    for (const id of ids) {
      const row = {};
      for (const [key, value] of Object.entries(secretDraft.characters[id] || {})) {
        if (String(value || "").trim()) row[key] = String(value).trim();
      }
      for (const [key, flagged] of Object.entries(secretDraft.clearCharacters[id] || {})) {
        if (flagged) row[`${key}Clear`] = true;
      }
      if (Object.keys(row).length) characters[id] = row;
    }
    const patch = {};
    if (Object.keys(house).length) patch.house = house;
    if (Object.keys(characters).length) patch.characters = characters;
    return Object.keys(patch).length ? patch : null;
  }
}

function emptySecretDraft() {
  return { house: {}, characters: {}, clearHouse: {}, clearCharacters: {} };
}

function formatListen(host, port) {
  const name = host || "127.0.0.1";
  const shown = name.includes(":") && !name.startsWith("[") ? `[${name}]` : name;
  return `${shown}:${port ?? 8787}`;
}

async function loadCatalog() {

  const res = await fetch("/api/settings", { cache: "no-store" });
  if (!res.ok) throw new Error("settings failed");
  const data = await res.json();
  if (!data?.fields) throw new Error("bad settings");
  return data;
}

function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = Array.isArray(a) ? a.map(String) : [];
    const right = Array.isArray(b) ? b.map(String) : [];
    return left.length === right.length && left.every((item, i) => item === right[i]);
  }
  if (typeof a === "boolean" || typeof b === "boolean") return !!a === !!b;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a ?? "") === String(b ?? "");
}

function formatDefault(field, value) {
  if (field.type === "boolean") return value ? "开" : "关";
  if (field.type === "list") return Array.isArray(value) && value.length ? value.join("、") : "（空）";
  if (field.type === "enum") {
    const label = (field.options || []).find((item) => item.value === value)?.label;
    return label || String(value ?? "（空）");
  }
  if (value == null || value === "") return "（空 / 跟随环境）";
  return field.unit ? `${value} ${field.unit}` : String(value);
}

function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return String(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttrNumber(value) {
  return Number.isFinite(Number(value)) ? String(value) : "";
}

export { TONELESS };
