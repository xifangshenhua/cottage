/**
 * UI label contract for a landed line.
 * Primary player-chat (and other viewer-directed) lines: 「青青对你说：…」
 * Interjections: 「林夏插话说：…」
 * Roommate lines keep 「林夏对青青说：…」.
 */
export function formatLineLabel(person) {
  const line = person?.line ?? "";
  const name = person?.name || person?.id || "";
  if (person?.lineKind === "interject") {
    return `${name}插话说：${line}`;
  }
  const to = person?.lineTo;
  if (to && to !== "viewer") {
    const toName = person.lineToName || to;
    return `${name}对${toName}说：${line}`;
  }
  if (to === "viewer" && name) {
    return `${name}对你说：${line}`;
  }
  return line;
}
