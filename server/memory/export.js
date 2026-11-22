/**
 * Format a browse payload as Markdown or JSON for download.
 * Does not write diaries, world state, or a file on disk.
 */
import { nowClock, TIMEZONE } from "../clock.js";
import {
  CHARACTER_IDS,
  SOURCE_LABELS,
  browseCharacter,
  currentGameDay,
} from "./browse.js";

export function exportMarkdown(payload, opts = {}) {
  if (payload?.characters && Array.isArray(payload.characters)) {
    return renderAllMarkdown(payload.characters, opts);
  }
  return renderOneMarkdown(payload, opts);
}

export function exportJson(payload, opts = {}) {
  const exportedAt = toIso(opts.now);
  if (payload?.characters && Array.isArray(payload.characters)) {
    return `${JSON.stringify({
      ok: true,
      exportedAt,
      characters: payload.characters,
    }, null, 2)}\n`;
  }
  return `${JSON.stringify({ ...payload, exportedAt }, null, 2)}\n`;
}

/** Merge three browse payloads in fixed 青青 / 林夏 / 小南 order. */
export function mergeCharacterExports(payloads, opts = {}) {
  const list = Array.isArray(payloads) ? payloads : [];
  const byId = new Map(list.map((item) => [item?.character?.id, item]));
  const characters = CHARACTER_IDS.map((id) => byId.get(id)).filter(Boolean);
  return {
    ok: true,
    exportedAt: toIso(opts.now),
    characters,
  };
}

export function exportCharacter(db, characterId, opts = {}) {
  const payload = browseCharacter(db, characterId, opts);
  return packExport(payload, opts);
}

export function exportAll(db, opts = {}) {
  const names = opts.names || {};
  const payloads = CHARACTER_IDS.map((id) => browseCharacter(db, id, { ...opts, name: names[id] }));
  const merged = mergeCharacterExports(payloads, opts);
  return packExport(merged, { ...opts, all: true, dayKey: payloads[0]?.dayKey });
}

export function packExport(payload, opts = {}) {
  const format = opts.format === "json" ? "json" : "md";
  const { dayKey } = currentGameDay(opts);
  const key = opts.dayKey || payload?.dayKey || payload?.today?.dayKey || payload?.characters?.[0]?.dayKey || dayKey;
  const body = format === "json" ? exportJson(payload, opts) : exportMarkdown(payload, opts);
  return {
    format,
    filename: exportFilename({
      all: opts.all || Array.isArray(payload?.characters),
      name: payload?.character?.name,
      dayKey: key,
      format,
    }),
    body,
    payload,
  };
}

export function exportFilename({ all = false, name, dayKey, format } = {}) {
  const ext = format === "json" ? "json" : "md";
  const day = dayKey || "diary";
  if (all) return `房子日记-${day}.${ext}`;
  const who = String(name || "日记").trim() || "日记";
  return `${who}日记-${day}.${ext}`;
}

export function contentDisposition(filename) {
  const safe = String(filename || "diary.md").replace(/[\r\n"]/g, "");
  const ascii = asciiFilename(safe);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export function formatExportTime(now) {
  const at = now instanceof Date ? now : now != null ? new Date(now) : new Date();
  const clock = nowClock(Number.isNaN(at.getTime()) ? new Date() : at);
  return `${clock.dayKey} ${clock.hhmm}（${TIMEZONE}）`;
}

function renderAllMarkdown(characters, opts) {
  const lines = [
    "# 房子日记",
    `导出时间：${formatExportTime(opts.now)}`,
    "",
  ];
  for (const payload of characters) {
    lines.push(renderOneMarkdown(payload, { ...opts, includeTime: false }).trimEnd());
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function renderOneMarkdown(payload, opts = {}) {
  const name = payload?.character?.name || payload?.character?.id || "日记";
  const lines = [`# ${name}的日记`];
  if (opts.includeTime !== false) {
    lines.push(`导出时间：${formatExportTime(opts.now)}`);
  }
  lines.push("");

  lines.push("## 今日草稿（尚未日结）");
  lines.push(payload?.today?.text?.trim() || "（暂无）");
  lines.push("");

  pushPeriodSection(lines, "日记", payload?.diaries);
  pushPeriodSection(lines, "周记", payload?.weeks);
  pushPeriodSection(lines, "月记", payload?.months);

  lines.push("## 记得的事");
  if (!payload?.facts?.length) {
    lines.push("（还没有记下的事。）");
  } else {
    for (const fact of payload.facts) {
      lines.push(`- ${String(fact.text || "").trim()}`);
    }
  }
  lines.push("");

  lines.push("## 话题");
  if (!payload?.topics?.length) {
    lines.push("（还没有话题。）");
  } else {
    for (const topic of payload.topics) {
      lines.push(`- ${String(topic.text || "").trim()}`);
    }
  }
  lines.push("");
  return `${lines.join("\n").trimEnd()}\n`;
}

function pushPeriodSection(lines, title, rows) {
  lines.push(`## ${title}`);
  if (!rows?.length) {
    lines.push(title === "日记" ? "（还没有落成的日记。）" : `（还没有${title}。）`);
    lines.push("");
    return;
  }
  for (const row of rows) {
    const label = SOURCE_LABELS[row.source] || SOURCE_LABELS.rule;
    lines.push(`### ${row.periodKey}（${label}）`);
    lines.push(String(row.text || "").trim());
    lines.push("");
  }
}

function asciiFilename(filename) {
  const mapped = String(filename)
    .replace(/青青/g, "qingqing")
    .replace(/林夏/g, "linxia")
    .replace(/小南/g, "xiaonan")
    .replace(/房子日记/g, "house-diary")
    .replace(/日记/g, "-diary");
  const ascii = mapped.replace(/[^\x20-\x7E]/g, "_").replace(/_+/g, "_").replace(/"/g, "");
  return ascii || "diary.bin";
}

function toIso(now) {
  if (now instanceof Date) return now.toISOString();
  if (now == null) return new Date().toISOString();
  const parsed = Date.parse(now);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}
