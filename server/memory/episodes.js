/** Short think / speech episodes stored locally. */

export function appendEpisode(db, record) {
  const characterId = record.characterId;
  if (!characterId) return null;
  const result = db.prepare(
    `INSERT INTO episodes(
       character_id, day_key, action, room, speech_landed, line, reason, summary, created_at
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    characterId,
    record.dayKey || "",
    record.action ?? null,
    record.room ?? null,
    record.speechLanded ? 1 : 0,
    record.line ?? null,
    record.reason ?? null,
    record.summary ?? formatEpisode(record),
    record.createdAt || new Date().toISOString(),
  );
  return result.lastInsertRowid;
}

export function episodesForDay(db, characterId, dayKey) {
  return db.prepare(
    `SELECT id, character_id, day_key, action, room, speech_landed, line, reason, summary, created_at
     FROM episodes
     WHERE character_id = ? AND day_key = ?
     ORDER BY id ASC`,
  ).all(characterId, dayKey);
}

export function recentEpisodes(db, characterId, limit) {
  const cap = Math.max(0, Number(limit) || 0);
  if (!cap) return [];
  const rows = db.prepare(
    `SELECT id, character_id, day_key, action, room, speech_landed, line, reason, summary, created_at
     FROM episodes
     WHERE character_id = ?
     ORDER BY id DESC
     LIMIT ?`,
  ).all(characterId, cap);
  return rows.reverse();
}

export function pruneEpisodes(db, cfg) {
  const max = Number(cfg.episodeRetentionMax);
  if (Number.isFinite(max) && max > 0) {
    db.prepare(
      `DELETE FROM episodes WHERE id IN (
         SELECT id FROM episodes ORDER BY id DESC LIMIT -1 OFFSET ?
       )`,
    ).run(max);
  }
  const days = Number(cfg.episodeRetentionDays);
  if (Number.isFinite(days) && days > 0) {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    db.prepare("DELETE FROM episodes WHERE created_at < ?").run(cutoff);
  }
}

export function formatEpisode(record) {
  const bits = [];
  if (record.action) bits.push(record.action);
  if (record.room) bits.push(`@${record.room}`);
  let text = bits.join(" ") || "想了一下";
  if (record.speechLanded && record.line) text += ` 开口：「${record.line}」`;
  return text;
}

export function hasPlayerInteraction(episodes) {
  return (episodes ?? []).some((row) => Number(row.speech_landed) === 1 && row.line);
}
