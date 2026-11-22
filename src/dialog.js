/** Leftover lastChat should not outlive seed talk lines (life.talkExpireMin). */
export const LAST_CHAT_EXPIRE_MIN = 3;

export const ACTION_COPY = {
  sleep: (name) => `${name}在睡觉，没有主动说话。`,
  eat: (name) => `${name}正在吃饭。`,
  wash: (name) => `${name}正在洗漱。`,
  sit: (name) => `${name}坐在这里休息。`,
};

export function formatSpokenLine(person) {
  const line = person?.line ?? "";
  if (person?.lineKind === "interject") {
    return `${person.name}插话说：${line}`;
  }
  const to = person?.lineTo;
  if (to && to !== "viewer") {
    const name = person.lineToName || to;
    return `${person.name}对${name}说：${line}`;
  }
  if (to === "viewer") {
    return `${person.name}对你说：${line}`;
  }
  return line;
}

export function formatLastChat(lastChat) {
  if (!lastChat?.line) return "";
  const name = lastChat.name || lastChat.responderId || "";
  return `${name}对你说：${lastChat.line}`;
}

/** lastChat is visible in this room if the responder is here, or it was spoken while the viewer was here. */
export function visibleLastChat(lastChat, people, currentRoomId) {
  if (!lastChat?.line) return null;
  const here = (people ?? []).some((person) => person.id === lastChat.responderId);
  const fromHere = lastChat.viewerRoom === currentRoomId;
  return here || fromHere ? lastChat : null;
}

export function parseSpeechTime(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function isLastChatExpired(lastChat, nowMs, expireMin = LAST_CHAT_EXPIRE_MIN) {
  const time = parseSpeechTime(lastChat?.at);
  if (time == null || !Number.isFinite(nowMs)) return false;
  const windowMs = Math.max(0, Number(expireMin) || LAST_CHAT_EXPIRE_MIN) * 60_000;
  return nowMs - time > windowMs;
}

/**
 * Pick what the room dialog should show.
 * Prefers the freshest visible speech in the current room so a stale lastChat
 * cannot cover a newer reply, proactive line, roommate line, or interjection.
 */
export function selectVisibleDialog({
  people = [],
  focused = null,
  lastChat = null,
  currentRoomId = null,
  nowMs = null,
  expireMin = LAST_CHAT_EXPIRE_MIN,
} = {}) {
  const subject = focused || people[0] || null;
  const speech = pickSpeech({
    people,
    focused: subject,
    lastChat,
    currentRoomId,
    nowMs,
    expireMin,
  });
  if (speech) {
    return { source: "speech", icon: "talk", text: speech.text };
  }
  const actionLine = subject ? ACTION_COPY[subject.action] : null;
  if (actionLine) {
    return {
      source: "action",
      icon: subject.action,
      text: actionLine(subject.name),
    };
  }
  if (!people.length) {
    return { source: "empty", icon: "empty", text: "这个房间现在没人。" };
  }
  return {
    source: "idle",
    icon: "empty",
    text: `${subject.name}在这里，暂时没有说话。`,
  };
}

function pickSpeech({ people, focused, lastChat, currentRoomId, nowMs, expireMin }) {
  const roomLines = (people ?? []).filter((person) => hasLine(person));
  const last = eligibleLastChat(lastChat, people, currentRoomId, nowMs, expireMin);
  const items = roomLines.map((person) => ({
    kind: "person",
    person,
    t: parseSpeechTime(person.lineAt),
    text: formatSpokenLine(person),
  }));
  if (last) {
    items.push({
      kind: "lastChat",
      person: null,
      t: parseSpeechTime(last.at),
      text: formatLastChat(last),
    });
  }
  if (!items.length) return null;

  const allDated = items.every((item) => item.t != null);
  if (allDated) return pickNewest(items, focused);

  // Incomplete timestamps: prefer a current in-room line over lastChat.
  const persons = items.filter((item) => item.kind === "person");
  if (persons.length) return pickPreferredPerson(persons, focused);
  return items[0];
}

function eligibleLastChat(lastChat, people, currentRoomId, nowMs, expireMin) {
  const visible = visibleLastChat(lastChat, people, currentRoomId);
  if (!visible) return null;
  if (isLastChatExpired(visible, nowMs, expireMin)) return null;
  return visible;
}

function pickNewest(items, focused) {
  let best = items[0];
  for (const item of items.slice(1)) {
    if (item.t > best.t) {
      best = item;
      continue;
    }
    if (item.t < best.t) continue;
    if (item.kind === "person" && best.kind === "lastChat") {
      best = item;
      continue;
    }
    if (item.kind === "person" && best.kind === "person" && isFocusedPerson(item.person, focused)) {
      best = item;
    }
  }
  return best;
}

function pickPreferredPerson(persons, focused) {
  return persons.find((item) => isFocusedPerson(item.person, focused)) || persons[0];
}

function isFocusedPerson(person, focused) {
  if (!person || !focused) return false;
  if (focused.id && person.id === focused.id) return true;
  if (focused.name && person.name === focused.name) return true;
  return false;
}

function hasLine(person) {
  return typeof person?.line === "string" && person.line.trim() !== "";
}
