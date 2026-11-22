/**
 * Read-only diary panel. Browse today's draft, persisted diaries, facts
 * and topics; export Markdown or JSON. Does not save or rewrite memory.
 */

const CHARACTERS = [
  { id: "qingqing", name: "青青" },
  { id: "linxia", name: "林夏" },
  { id: "xiaonan", name: "小南" },
];

const SOURCE_LABELS = {
  today: "今日草稿",
  rule: "规则底稿",
  model: "模型整理",
};

export function mountDiary({ button, panel } = {}) {
  const btn = button || document.getElementById("diary-btn");
  const root = panel || document.getElementById("diary-panel");
  if (!btn || !root) return;

  let characterId = characterFromHash(location.hash) || "qingqing";
  let payload = null;
  let open = false;
  let status = { type: "", text: "" };

  btn.addEventListener("click", () => {
    if (open) close();
    else openPanel(characterFromHash(location.hash) || characterId);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open) close();
  });

  if (isDiaryHash(location.hash)) openPanel(characterFromHash(location.hash));
  window.addEventListener("hashchange", () => {
    if (isDiaryHash(location.hash)) {
      const next = characterFromHash(location.hash);
      if (!open || next !== characterId) openPanel(next);
    } else if (open) {
      close({ skipHash: true });
    }
  });

  async function openPanel(id = "qingqing") {
    open = true;
    characterId = CHARACTERS.some((item) => item.id === id) ? id : "qingqing";
    btn.classList.add("is-open");
    root.hidden = false;
    root.innerHTML = `<div class="settings-sheet diary-sheet"><p class="settings-status">正在读取日记…</p></div>`;
    setDiaryHash(characterId);
    try {
      payload = await loadBrowse(characterId);
      status = { type: "", text: "" };
      render();
    } catch {
      payload = null;
      root.innerHTML = `<div class="settings-sheet diary-sheet">
        <header class="settings-head">
          <h1>日记</h1>
          <button type="button" class="settings-close" data-close>关闭</button>
        </header>
        <p class="settings-status is-error">没能读到日记，请稍后再试。</p>
      </div>`;
      root.querySelector("[data-close]")?.addEventListener("click", () => close());
    }
  }

  function close({ skipHash } = {}) {
    open = false;
    btn.classList.remove("is-open");
    root.hidden = true;
    root.innerHTML = "";
    payload = null;
    if (!skipHash && isDiaryHash(location.hash)) {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
  }

  function render() {
    const name = payload?.character?.name || nameOf(characterId);
    const start = payload?.dayStartHhmm || "07:00";
    root.innerHTML = `
      <div class="settings-sheet diary-sheet" role="dialog" aria-labelledby="diary-title">
        <header class="settings-head">
          <div>
            <h1 id="diary-title">日记</h1>
            <p class="settings-lead">只读查看她们已经记住的内容。不会改记忆，也不会提前写下今天的日结。</p>
          </div>
          <div class="settings-head-actions">
            <button type="button" class="settings-save" data-export-one>导出这位</button>
            <button type="button" class="settings-restore" data-export-all>导出全部</button>
            <button type="button" class="settings-close" data-close>关闭</button>
          </div>
        </header>
        ${status.text ? `<p class="settings-status ${status.type === "error" ? "is-error" : "is-ok"}">${escapeHtml(status.text)}</p>` : ""}
        <div class="settings-switcher" role="tablist" aria-label="人物">
          ${CHARACTERS.map((item) => `
            <button type="button" class="settings-chip ${item.id === characterId ? "is-active" : ""}" data-character="${item.id}">
              ${escapeHtml(item.name)}
            </button>
          `).join("")}
        </div>
        <div class="settings-body diary-body">
          ${renderToday(payload, start, name)}
          ${renderPeriod("日记", payload?.diaries, "还没有落成的日记，先看上面的今日草稿。")}
          ${renderPeriod("周记", payload?.weeks, "还没有周记。")}
          ${renderPeriod("月记", payload?.months, "还没有月记。")}
          ${renderList("记得的事", payload?.facts, "还没有记下的事。", (row) => row.text)}
          ${renderList("话题", payload?.topics, "还没有话题。", (row) => row.text)}
        </div>
      </div>
    `;
    root.querySelector("[data-close]")?.addEventListener("click", () => close());
    root.querySelector("[data-export-one]")?.addEventListener("click", () => downloadExport(characterId));
    root.querySelector("[data-export-all]")?.addEventListener("click", () => downloadExport("all"));
    for (const chip of root.querySelectorAll("[data-character]")) {
      chip.addEventListener("click", () => {
        const next = chip.getAttribute("data-character");
        if (next && next !== characterId) openPanel(next);
      });
    }
  }

  function renderToday(data, start, name) {
    const draft = data?.today;
    if (!draft) {
      const already = (data?.diaries ?? []).some((row) => row.periodKey === data?.dayKey);
      const empty = already
        ? `${name}今天的日记已经定稿，见下方日记。`
        : "今天还没有草稿。";
      return `
        <section class="diary-section">
          <div class="settings-group-head">
            <div>
              <h2>今日草稿</h2>
              <p class="settings-group-help">次日 ${escapeHtml(start)} 才会定稿</p>
            </div>
          </div>
          <p class="diary-empty">${escapeHtml(empty)}</p>
        </section>
      `;
    }
    return `
      <section class="diary-section">
        <div class="settings-group-head">
          <div>
            <h2>今日草稿</h2>
            <p class="settings-group-help">次日 ${escapeHtml(start)} 才会定稿</p>
          </div>
        </div>
        <article class="diary-card">
          <header class="diary-card-head">
            <span class="diary-period">${escapeHtml(draft.dayKey)}</span>
            <span class="settings-flag">${escapeHtml(SOURCE_LABELS[draft.source] || "今日草稿")}</span>
          </header>
          <p class="diary-text">${escapeHtml(draft.text)}</p>
        </article>
      </section>
    `;
  }

  function renderPeriod(title, rows, emptyText) {
    const list = Array.isArray(rows) ? rows : [];
    return `
      <section class="diary-section">
        <div class="settings-group-head">
          <h2>${escapeHtml(title)}</h2>
        </div>
        ${list.length ? list.map((row) => `
          <article class="diary-card">
            <header class="diary-card-head">
              <span class="diary-period">${escapeHtml(row.periodKey)}</span>
              <span class="settings-flag">${escapeHtml(SOURCE_LABELS[row.source] || SOURCE_LABELS.rule)}</span>
              ${row.createdAt ? `<time class="diary-time">${escapeHtml(formatShanghai(row.createdAt))}</time>` : ""}
            </header>
            <p class="diary-text">${escapeHtml(row.text)}</p>
          </article>
        `).join("") : `<p class="diary-empty">${escapeHtml(emptyText)}</p>`}
      </section>
    `;
  }

  function renderList(title, rows, emptyText, pick) {
    const list = Array.isArray(rows) ? rows : [];
    return `
      <section class="diary-section">
        <div class="settings-group-head">
          <h2>${escapeHtml(title)}</h2>
        </div>
        ${list.length ? `<ul class="diary-list">${list.map((row) => {
          const extra = title === "记得的事" && row.updatedAt
            ? `<time class="diary-time">${escapeHtml(formatShanghai(row.updatedAt))}</time>`
            : row.lastMentionedAt
              ? `<time class="diary-time">${escapeHtml(formatShanghai(row.lastMentionedAt))}</time>`
              : "";
          return `<li><span>${escapeHtml(pick(row))}</span>${extra}</li>`;
        }).join("")}</ul>` : `<p class="diary-empty">${escapeHtml(emptyText)}</p>`}
      </section>
    `;
  }
}

async function loadBrowse(characterId) {
  const response = await fetch(`/api/memory/browse?character=${encodeURIComponent(characterId)}`, {
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error || "browse-failed");
  }
  return body;
}

function downloadExport(character) {
  const url = `/api/memory/export?character=${encodeURIComponent(character)}&format=md`;
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function isDiaryHash(hash) {
  return hash === "#diary" || hash.startsWith("#diary/");
}

function characterFromHash(hash) {
  const match = /^#diary(?:\/([a-z]+))?$/.exec(hash || "");
  if (!match) return null;
  const id = match[1];
  if (id && CHARACTERS.some((item) => item.id === id)) return id;
  return "qingqing";
}

function setDiaryHash(characterId) {
  const next = `#diary/${characterId}`;
  if (location.hash !== next) {
    history.replaceState(null, "", `${location.pathname}${location.search}${next}`);
  }
}

function nameOf(id) {
  return CHARACTERS.find((item) => item.id === id)?.name || id;
}

function formatShanghai(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  if (!parts.year) return "";
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
