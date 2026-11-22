import { loadSettings, startingStatsFor } from "./settings/index.js";

export const defaultCharacters = {
  qingqing: {
    id: "qingqing",
    name: "青青",
    room: "living",
    action: "talk",
    line: "你来了。我刚在和林夏聊刚才那本书。",
    stats: { energy: 74, hunger: 66, clean: 82, mood: 71, bond: 18 },
    lastThinkAt: null,
    lastProactiveAt: null,
    proactiveCountToday: 0,
    proactiveDayKey: null,
  },
  linxia: {
    id: "linxia",
    name: "林夏",
    room: "living",
    action: "sit",
    line: null,
    stats: { energy: 70, hunger: 58, clean: 80, mood: 76, bond: 16 },
    lastThinkAt: null,
    lastProactiveAt: null,
    proactiveCountToday: 0,
    proactiveDayKey: null,
  },
  xiaonan: {
    id: "xiaonan",
    name: "小南",
    room: "xiaonan",
    action: "sleep",
    line: null,
    stats: { energy: 42, hunger: 58, clean: 76, mood: 64, bond: 15 },
    lastThinkAt: null,
    lastProactiveAt: null,
    proactiveCountToday: 0,
    proactiveDayKey: null,
  },
};

export function createSeed(clock) {
  const settings = tryLoadSettings();
  const characters = structuredClone(defaultCharacters);
  if (settings?.characters) {
    for (const [id, spec] of Object.entries(settings.characters)) {
      const identity = spec.identity ?? {};
      if (!characters[id]) {
        characters[id] = {
          id,
          name: identity.name || id,
          room: "living",
          action: "sit",
          line: null,
          stats: startingStatsFor(spec),
          lastThinkAt: null,
          lastProactiveAt: null,
          proactiveCountToday: 0,
          proactiveDayKey: null,
        };
      } else {
        if (identity.name) characters[id].name = identity.name;
        if (identity.bedroom) characters[id].bedroom = identity.bedroom;
        characters[id].stats = startingStatsFor(spec, characters[id].stats);
      }
    }
  }
  for (const character of Object.values(characters)) {
    character.actionStartedAt = clock.iso;
    character.enteredRoomAt = clock.iso;
    character.lastThinkAt = null;
  }
  return {
    version: 3,
    startedAt: clock.iso,
    savedAt: clock.iso,
    lastTickAt: clock.iso,
    clock,
    viewer: {
      present: false,
      room: "living",
      lastSeenAt: null,
    },
    characters,
  };
}

function tryLoadSettings() {
  try {
    return loadSettings();
  } catch {
    return null;
  }
}
