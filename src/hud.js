/**
 * Pure helpers for HUD / compose / actor-view signatures.
 * Used to skip DOM rebuilds on unchanged SSE ticks.
 */

export function roomNavSignature(rooms) {
  return (rooms || [])
    .map((room) => `${room.id}\t${room.name ?? ""}\t${room.icon ?? ""}`)
    .join("|");
}

export function targetOptionsSignature(people) {
  return (people || [])
    .map((person) => `${person.id}\t${person.name || person.id}`)
    .join("|");
}

/**
 * Occupants / poses / focus / room / viewport fingerprint.
 * Clock and need stats are omitted so a 30s tick does not relayout actors
 * when nobody moved or changed pose.
 */
export function actorsViewSignature({ roomId, focusedId, theme, viewport, occupants } = {}) {
  const people = (occupants || [])
    .map((person) => `${person.id}\t${person.name ?? ""}\t${person.action ?? ""}`)
    .join("|");
  const width = Number(viewport?.width) || 0;
  const height = Number(viewport?.height) || 0;
  return [roomId ?? "", focusedId ?? "", theme ?? "", width, height, people].join(";");
}

export function stylesCacheKey(characterId, houseKey = "__house__") {
  return characterId || houseKey;
}

/**
 * Status chips / name row fingerprint.
 * Skip rewriting the status element when names, focus, and rounded
 * 熟悉 / 亲密 / need chips have not changed. Clock and dialog use their own paths.
 */
export function statusSignature({ people, focusedName, chips } = {}) {
  const names = (people || [])
    .map((person) => `${person.id ?? ""}	${person.name ?? ""}`)
    .join("|");
  const chipPart = (chips || [])
    .map((chip) => `${chip.key ?? ""}	${chip.label ?? ""}	${chip.value ?? ""}`)
    .join("|");
  return `${names}#${focusedName ?? ""}#${chipPart}`;
}
