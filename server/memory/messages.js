/** Append-only message log. Never sent to the model in full. */

export function appendMessage(db, { characterId, kind, role, text, createdAt }) {
  const value = String(text ?? "").trim();
  if (!characterId || !value) return null;
  const at = createdAt || new Date().toISOString();
  const result = db.prepare(
    "INSERT INTO messages(character_id, kind, role, text, created_at) VALUES(?, ?, ?, ?, ?)",
  ).run(characterId, kind || "event", role ?? null, value, at);
  return result.lastInsertRowid;
}

export function recentMessages(db, characterId, limit) {
  const cap = Math.max(0, Number(limit) || 0);
  if (!characterId || !cap) return [];
  const rows = db.prepare(
    `SELECT id, character_id, kind, role, text, created_at
     FROM messages
     WHERE character_id = ?
     ORDER BY id DESC
     LIMIT ?`,
  ).all(characterId, cap);
  return rows.reverse();
}

export function pruneMessages(db, cfg) {
  const max = Number(cfg.messageRetentionMax);
  if (Number.isFinite(max) && max > 0) {
    db.prepare(
      `DELETE FROM messages WHERE id IN (
         SELECT id FROM messages ORDER BY id DESC LIMIT -1 OFFSET ?
       )`,
    ).run(max);
  }
  const days = Number(cfg.messageRetentionDays);
  if (Number.isFinite(days) && days > 0) {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    db.prepare("DELETE FROM messages WHERE created_at < ?").run(cutoff);
  }
}

export function messagesInRange(db, characterId, startIso, endIso) {
  if (!characterId || !startIso || !endIso) return [];
  return db.prepare(
    `SELECT id, character_id, kind, role, text, created_at
     FROM messages
     WHERE character_id = ? AND created_at >= ? AND created_at < ?
     ORDER BY id ASC`,
  ).all(characterId, startIso, endIso);
}
