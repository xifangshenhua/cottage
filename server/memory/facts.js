/** Short dated facts with importance. Merge close duplicates; evict when full. */

export function listFacts(db, characterId, limit = null) {
  const sql = limit == null
    ? `SELECT id, character_id, text, importance, created_at, updated_at
       FROM facts WHERE character_id = ?
       ORDER BY importance DESC, updated_at DESC, id DESC`
    : `SELECT id, character_id, text, importance, created_at, updated_at
       FROM facts WHERE character_id = ?
       ORDER BY importance DESC, updated_at DESC, id DESC
       LIMIT ?`;
  return limit == null
    ? db.prepare(sql).all(characterId)
    : db.prepare(sql).all(characterId, limit);
}

export function countFacts(db, characterId) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM facts WHERE character_id = ?").get(characterId);
  return Number(row?.n) || 0;
}

/**
 * Validate and store a fact. Returns the stored row or null if rejected.
 * Does not rewrite persona settings.
 */
export function upsertFact(db, characterId, raw, cfg, nowIso) {
  const parsed = normalizeFact(raw, cfg);
  if (!parsed || !characterId) return null;
  const at = nowIso || new Date().toISOString();
  const existing = listFacts(db, characterId);
  const match = findSimilar(existing, parsed.text, cfg.factMergeSimilarity);
  if (match) {
    const text = parsed.text.length >= match.text.length ? parsed.text : match.text;
    const importance = Math.max(Number(match.importance) || 0, parsed.importance);
    db.prepare(
      "UPDATE facts SET text = ?, importance = ?, updated_at = ? WHERE id = ?",
    ).run(text, importance, at, match.id);
    return { ...match, text, importance, updated_at: at };
  }

  if (existing.length >= cfg.maxFacts) {
    evictOne(db, characterId);
  }
  const result = db.prepare(
    "INSERT INTO facts(character_id, text, importance, created_at, updated_at) VALUES(?, ?, ?, ?, ?)",
  ).run(characterId, parsed.text, parsed.importance, at, at);
  return {
    id: result.lastInsertRowid,
    character_id: characterId,
    text: parsed.text,
    importance: parsed.importance,
    created_at: at,
    updated_at: at,
  };
}

export function normalizeFact(raw, cfg) {
  let text = "";
  let importance = cfg.factImportanceDefault;
  if (typeof raw === "string") {
    text = raw.trim();
  } else if (raw && typeof raw === "object") {
    text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (Number.isFinite(Number(raw.importance))) importance = Number(raw.importance);
  }
  if (!text) return null;
  if (text.length > cfg.factMaxChars) text = text.slice(0, cfg.factMaxChars);
  return { text, importance };
}

function evictOne(db, characterId) {
  const row = db.prepare(
    `SELECT id FROM facts
     WHERE character_id = ?
     ORDER BY importance ASC, updated_at ASC, id ASC
     LIMIT 1`,
  ).get(characterId);
  if (row) db.prepare("DELETE FROM facts WHERE id = ?").run(row.id);
}

function findSimilar(existing, text, threshold) {
  const target = normalizeForCompare(text);
  let best = null;
  let bestScore = 0;
  for (const row of existing) {
    const score = similarity(target, normalizeForCompare(row.text));
    if (score >= threshold && score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

function normalizeForCompare(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, "");
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (longer.includes(shorter)) return shorter.length / longer.length;
  // Jaccard over character bigrams for a cheap overlap score.
  const aSet = ngrams(a);
  const bSet = ngrams(b);
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const g of aSet) if (bSet.has(g)) inter += 1;
  return inter / (aSet.size + bSet.size - inter);
}

function ngrams(text) {
  const set = new Set();
  if (text.length <= 1) {
    set.add(text);
    return set;
  }
  for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2));
  return set;
}

/** Remove a stored fact by exact or similar text. Used by the daily compress job. */
export function retireFact(db, characterId, raw, cfg) {
  const parsed = normalizeFact(typeof raw === "string" ? raw : { text: raw?.text }, cfg);
  if (!parsed || !characterId) return null;
  const existing = listFacts(db, characterId);
  const match = existing.find((row) => row.text === parsed.text)
    ?? findSimilar(existing, parsed.text, cfg.factMergeSimilarity);
  if (!match) return null;
  db.prepare("DELETE FROM facts WHERE id = ?").run(match.id);
  return match;
}
