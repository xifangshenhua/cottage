/** Current topic phrases, capped and expired after an idle timeout. */

export function listTopics(db, characterId, cfg, nowMs = Date.now()) {
  expireTopics(db, characterId, cfg, nowMs);
  return db.prepare(
    `SELECT id, character_id, text, created_at, last_mentioned_at
     FROM topics WHERE character_id = ?
     ORDER BY last_mentioned_at DESC, id DESC`,
  ).all(characterId);
}

export function rememberTopic(db, characterId, raw, cfg, nowIso) {
  const text = normalizeTopic(raw, cfg);
  if (!text || !characterId) return null;
  const at = nowIso || new Date().toISOString();
  const existing = db.prepare(
    "SELECT id, text FROM topics WHERE character_id = ? ORDER BY last_mentioned_at DESC",
  ).all(characterId);
  const match = existing.find((row) => normalizeForCompare(row.text) === normalizeForCompare(text));
  if (match) {
    db.prepare("UPDATE topics SET last_mentioned_at = ? WHERE id = ?").run(at, match.id);
    return { ...match, last_mentioned_at: at };
  }
  while (existing.length >= cfg.maxTopics) {
    const oldest = db.prepare(
      `SELECT id FROM topics WHERE character_id = ?
       ORDER BY last_mentioned_at ASC, id ASC LIMIT 1`,
    ).get(characterId);
    if (!oldest) break;
    db.prepare("DELETE FROM topics WHERE id = ?").run(oldest.id);
    existing.shift();
  }
  const result = db.prepare(
    "INSERT INTO topics(character_id, text, created_at, last_mentioned_at) VALUES(?, ?, ?, ?)",
  ).run(characterId, text, at, at);
  return { id: result.lastInsertRowid, character_id: characterId, text, created_at: at, last_mentioned_at: at };
}

export function expireTopics(db, characterId, cfg, nowMs = Date.now()) {
  const days = Number(cfg.topicIdleTimeoutDays);
  if (!Number.isFinite(days) || days <= 0) return;
  const cutoff = new Date(nowMs - days * 86_400_000).toISOString();
  db.prepare("DELETE FROM topics WHERE character_id = ? AND last_mentioned_at < ?").run(characterId, cutoff);
}

function normalizeTopic(raw, cfg) {
  const text = typeof raw === "string" ? raw.trim() : typeof raw?.text === "string" ? raw.text.trim() : "";
  if (!text) return "";
  return text.length > cfg.topicMaxChars ? text.slice(0, cfg.topicMaxChars) : text;
}

function normalizeForCompare(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, "");
}
