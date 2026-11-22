/**
 * On-disk LRU cache for synthesized clips.
 * Not written to world.json or sqlite. Key is a hash of
 * model + voiceId + speed + vol + pitch + format + text.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export function cacheKey({ model, voiceId, speed, vol, pitch, format, text } = {}) {
  const raw = [
    model ?? "",
    voiceId ?? "",
    String(speed ?? ""),
    String(vol ?? ""),
    String(pitch ?? ""),
    format ?? "",
    text ?? "",
  ].join("\0");
  return createHash("sha256").update(raw).digest("hex");
}

export function createVoiceCache(opts = {}) {
  const dir = opts.dir;
  const maxFiles = Number.isFinite(Number(opts.maxFiles)) ? Number(opts.maxFiles) : 200;
  const maxBytes = Number.isFinite(Number(opts.maxBytes)) ? Number(opts.maxBytes) : 80 * 1024 * 1024;
  if (dir) mkdirSync(dir, { recursive: true });

  const indexPath = dir ? path.join(dir, "index.json") : null;
  let entries = loadIndex(indexPath);
  let clock = maxUsed(entries);

  function fileFor(key) {
    return path.join(dir, `${key}.mp3`);
  }

  function get(key) {
    if (!dir || !key) return null;
    const file = entries[key]?.file ? path.join(dir, path.basename(entries[key].file)) : fileFor(key);
    if (!existsSync(file)) {
      if (entries[key]) {
        delete entries[key];
        saveIndex(indexPath, entries);
      }
      return null;
    }
    const info = statSync(file);
    entries[key] = {
      file: path.basename(file),
      bytes: info.size,
      lastUsed: ++clock,
    };
    // Keep lastUsed in memory; persist on put/evict so a hit is not a disk write.
    return { key, file, buffer: readFileSync(file), bytes: info.size };
  }

  function put(key, buffer) {
    if (!dir || !key) return null;
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const file = fileFor(key);
    writeFileSync(file, buf);
    entries[key] = {
      file: path.basename(file),
      bytes: buf.length,
      lastUsed: ++clock,
    };
    evict();
    saveIndex(indexPath, entries);
    return { key, file, bytes: buf.length };
  }

  function evict() {
    const items = Object.entries(entries).map(([key, meta]) => ({ key, ...meta }));
    items.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
    let files = items.length;
    let bytes = items.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);
    while (items.length && (files > maxFiles || bytes > maxBytes)) {
      const victim = items.shift();
      const file = path.join(dir, path.basename(victim.file || `${victim.key}.mp3`));
      try { rmSync(file, { force: true }); } catch { /* ignore */ }
      delete entries[victim.key];
      files -= 1;
      bytes -= Number(victim.bytes) || 0;
    }
  }

  function size() {
    const items = Object.values(entries);
    return {
      files: items.length,
      bytes: items.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0),
    };
  }

  return { get, put, evict, size, key: cacheKey, dir };
}

function loadIndex(file) {
  if (!file || !existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && parsed.entries && typeof parsed.entries === "object"
      ? parsed.entries
      : (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {});
  } catch {
    return {};
  }
}

function saveIndex(file, entries) {
  if (!file) return;
  writeFileSync(file, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8");
}

function maxUsed(entries) {
  let max = 0;
  for (const meta of Object.values(entries || {})) {
    const n = Number(meta?.lastUsed);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}
