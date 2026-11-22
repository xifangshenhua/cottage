import { trimToCap } from "./compress.js";

/** Rolling working-memory text, compiled from episodes without a model call. */

export function getWorking(db, characterId) {
  const row = db.prepare("SELECT text, updated_at FROM working WHERE character_id = ?").get(characterId);
  return row ? { text: row.text, updated_at: row.updated_at } : { text: "", updated_at: null };
}

export function setWorking(db, characterId, text, nowIso, cap) {
  const next = trimToCap(text, cap);
  const at = nowIso || new Date().toISOString();
  db.prepare(
    `INSERT INTO working(character_id, text, updated_at) VALUES(?, ?, ?)
     ON CONFLICT(character_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
  ).run(characterId, next, at);
  return next;
}

export function appendWorkingLine(db, characterId, line, nowIso, cap) {
  const current = getWorking(db, characterId).text;
  const next = current ? `${current}\n${line}` : line;
  return setWorking(db, characterId, next, nowIso, cap);
}

export function compileWorking(episodes, cap) {
  const lines = (episodes ?? []).map((row) => row.summary || formatLine(row)).filter(Boolean);
  return trimToCap(lines.join("\n"), cap);
}

function formatLine(row) {
  const bits = [];
  if (row.action) bits.push(row.action);
  if (row.room) bits.push(`@${row.room}`);
  let text = bits.join(" ");
  if (row.speech_landed && row.line) text += ` 开口：「${row.line}」`;
  return text.trim();
}
