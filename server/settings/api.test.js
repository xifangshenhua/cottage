import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemory } from "../memory/index.js";
import { tickWorld } from "../life/index.js";
import { makeWorld, NOON } from "../life/test-helpers.js";
import { createWorld } from "../world.js";
import {
  loadSettings,
  resetSettingsCache,
  resolveLife,
  resolveMemory,
  resolveMood,
  resolveThink,
  syncWorldFromSettings,
} from "./index.js";
import { applySettingsUpdate, buildSettingsResponse, findSecretKey } from "./update.js";
import { getSettingsPayload, putSettingsPayload } from "./http.js";

const roots = [];
const memories = [];

after(() => {
  resetSettingsCache();
  for (const memory of memories) {
    try { memory.close(); } catch { /* already closed */ }
  }
  for (const root of roots) {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "house-settings-api-"));
  roots.push(root);
  mkdirSync(path.join(root, "settings", "characters"), { recursive: true });
  mkdirSync(path.join(root, "data"), { recursive: true });
  return root;
}

function writeJson(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function seedHouse(root, house = {}, characters = {}) {
  writeJson(path.join(root, "settings", "house.json"), house);
  const defaults = {
    qingqing: {
      identity: { id: "qingqing", name: "青青", bedroom: "qingqing", addressPlayerAs: "你" },
      persona: {
        traits: ["温柔", "细心", "爱照顾人"],
        speechStyle: "轻声慢语，句子不长，带一点关心",
        background: "习惯待在客厅，喜欢和大家说日常里的小事。",
        likes: ["一起喝茶", "安静聊天"],
        dislikes: ["被催促", "生硬的场面"],
      },
      chat: { defaultTone: "gentle", defaultLength: "short" },
    },
    linxia: {
      identity: { id: "linxia", name: "林夏", bedroom: "linxia", addressPlayerAs: "你" },
      persona: {
        traits: ["沉稳", "爱看书", "观察细致"],
        speechStyle: "简洁、克制，偶有一句点评",
        background: "常在客厅看书，话不多但会记住细节。",
        likes: ["阅读", "清早的安静"],
        dislikes: ["吵闹", "没来由的闲扯"],
      },
      chat: { defaultTone: "concise", defaultLength: "short" },
    },
    xiaonan: {
      identity: { id: "xiaonan", name: "小南", bedroom: "xiaonan", addressPlayerAs: "你" },
      persona: {
        traits: ["活泼", "直率", "容易困"],
        speechStyle: "口语化、轻快，偶尔跳过敬语",
        background: "白天也容易犯困，睡醒了才爱说话。",
        likes: ["晒太阳", "吃热乎的东西"],
        dislikes: ["一大早被叫醒", "繁琐规矩"],
      },
      chat: { defaultTone: "lively", defaultLength: "medium" },
    },
  };
  for (const [id, body] of Object.entries({ ...defaults, ...characters })) {
    writeJson(path.join(root, "settings", "characters", `${id}.json`), body);
  }
  return loadSettings({ root, reload: true });
}

describe("GET settings payload", () => {
  it("returns catalog, defaults, and merged effective values without secrets", () => {
    const root = tempRoot();
    const settings = seedHouse(root, {
      model: { provider: "minimax", model: "MiniMax-M3.1-Flash", apiKey: "should-not-survive" },
      think: { intervalMin: 12, timeoutMs: 20000 },
      memory: { compress: { enabled: false } },
    });
    const payload = buildSettingsResponse(settings);
    assert.equal(payload.ok, true);
    assert.ok(payload.groups.some((group) => group.id === "thinkSpeech"));
    assert.ok(payload.fields.some((field) => field.id === "think.intervalMin" && field.label.includes("思考间隔")));
    assert.equal(payload.defaults.house["think.intervalMin"], 10);
    assert.equal(payload.effective.house["think.intervalMin"], 12);
    assert.equal(payload.effective.house["memory.compress.enabled"], false);
    assert.equal(payload.defaults.house["memory.compress.enabled"], true);
    assert.equal(payload.defaults.house["memory.idleDiaryDays"], 0);
    assert.equal(payload.effective.house["memory.idleDiaryDays"], 0);
    assert.ok(payload.overrides.house.includes("think.intervalMin"));
    assert.equal(payload.characters[0].id, "qingqing");
    assert.equal(payload.defaults.characters.qingqing["chat.defaultTone"], "gentle");
    assert.equal(payload.effective.characters.qingqing["chat.defaultTone"], "gentle");
    const raw = JSON.stringify(payload);
    assert.equal(raw.includes("should-not-survive"), false);
    assert.equal(raw.includes("MINIMAX_API_KEY"), false);
    assert.ok(payload.fields.some((field) => field.id === "secrets.minimaxApiKey" && field.type === "secret"));
    assert.ok(payload.fields.some((field) => field.id === "server.host" && field.group === "server"));
    assert.equal(payload.defaults.house["server.host"], "127.0.0.1");
    assert.equal(payload.effective.house["secrets.minimaxApiKey"], "");
    assert.equal(payload.effective.house["secrets.voiceApiKey"], "");
    assert.ok(payload.fields.every((field) => field.type === "secret" || !/apiKey|token|password/i.test(field.id)));
    assert.ok(payload.groups.some((group) => group.id === "advancedMood" && group.title === "心情结算"));
    assert.ok(payload.groups.some((group) => group.id === "advancedInterject" && group.title === "插话"));
    const allowInterject = payload.fields.find((field) => field.id === "chat.interject.enabled");
    assert.equal(allowInterject?.group, "chat");
    assert.equal(allowInterject?.label, "允许插话");
    assert.equal(payload.defaults.house["chat.interject.enabled"], true);
    assert.equal(payload.defaults.house["chat.interject.maxPerCharacterDay"], 2);
    assert.equal(payload.effective.house["chat.interject.minGapMin"], 20);
    assert.ok(payload.fields.some((field) => field.id === "mood.interject.delta" && field.group === "advancedInterject"));
    const chatDelta = payload.fields.find((field) => field.id === "mood.playerChat.delta");
    assert.equal(chatDelta.label, "和你聊天时心情增加");
    assert.equal(chatDelta.group, "chat");
    assert.equal(payload.defaults.house["mood.playerChat.delta"], 2);
    assert.equal(payload.defaults.house["mood.playerChat.maxGainPerDay"], 10);
    assert.equal(payload.defaults.house["mood.playerChat.cooldownSec"], 45);
    assert.equal(payload.defaults.house["life.rates.sit.mood"], 1);
    assert.equal(payload.defaults.house["life.moodLowNeedThreshold"], 25);
    assert.equal(payload.effective.house["mood.playerChat.delta"], 2);
    assert.ok(payload.fields.some((field) => field.id === "mood.npcTalk.speakerDelta" && field.group === "advancedMood"));
  });
});

describe("PUT settings updates", () => {
  it("saves only overrides and keeps unrelated keys", () => {
    const root = tempRoot();
    seedHouse(root, {
      model: { provider: "minimax", model: "MiniMax-M3.1-Flash" },
      identityCardChars: 280,
      think: { intervalMin: 10, timeoutMs: 20000 },
      chat: {
        maxInputChars: 200,
        addressing: {
          defaultVolume: "normal",
          volumes: [{ id: "whisper", label: "悄悄", range: "target", requiresTarget: true }],
          houseLock: true,
        },
      },
    });
    const before = readJson(path.join(root, "settings", "house.json"));
    const result = applySettingsUpdate(root, { house: { "think.intervalMin": 15 } });
    assert.equal(result.ok, true);
    const after = readJson(path.join(root, "settings", "house.json"));
    assert.equal(after.think.intervalMin, 15);
    assert.equal(after.model.provider, "minimax");
    assert.equal(after.identityCardChars, 280);
    assert.equal(after.chat.maxInputChars, 200);
    assert.equal(after.chat.addressing.houseLock, true);
    assert.equal(after.chat.addressing.volumes[0].id, "whisper");
    assert.equal(after.think.timeoutMs, 20000);
    assert.equal("staggerMs" in (after.think ?? {}), false);
    assert.equal("stepMs" in after, false);
    const keys = Object.keys(after);
    assert.ok(keys.length < 20);
    assert.deepEqual(Object.keys(after.chat.addressing), Object.keys(before.chat.addressing));
    const loaded = loadSettings({ root, reload: true });
    assert.equal(resolveThink("qingqing", loaded).intervalMs, 15 * 60_000);
  });

  it("rejects secrets and does not write the file", () => {
    const root = tempRoot();
    seedHouse(root, { think: { intervalMin: 10 } });
    const before = readFileSync(path.join(root, "settings", "house.json"), "utf8");
    const result = applySettingsUpdate(root, {
      house: { "think.intervalMin": 20 },
      apiKey: "leak-me",
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /密钥|令牌/);
    assert.equal(readFileSync(path.join(root, "settings", "house.json"), "utf8"), before);
    assert.equal(findSecretKey({ model: { token: "x" } }), "token");
  });

  it("rejects secret-looking field ids without writing", () => {
    const root = tempRoot();
    seedHouse(root, { think: { intervalMin: 10 } });
    const before = readFileSync(path.join(root, "settings", "house.json"), "utf8");
    const result = applySettingsUpdate(root, { house: { "model.apiKey": "nope" } });
    assert.equal(result.ok, false);
    assert.equal(readFileSync(path.join(root, "settings", "house.json"), "utf8"), before);
  });

  it("rejects invalid values and does not write", () => {
    const root = tempRoot();
    seedHouse(root, { think: { intervalMin: 10 } });
    const before = readFileSync(path.join(root, "settings", "house.json"), "utf8");

    const negative = applySettingsUpdate(root, { house: { "speech.maxPerGameDay": -1 } });
    assert.equal(negative.ok, false);
    assert.match(negative.error, /不能小于|不能为负/);

    const badTime = applySettingsUpdate(root, { house: { "schedule.dayStartHhmm": "25:00" } });
    assert.equal(badTime.ok, false);
    assert.match(badTime.error, /HH:MM/);

    const cap = applySettingsUpdate(root, { house: { "memory.compress.maxPromptChars": 20000 } });
    assert.equal(cap.ok, false);
    assert.match(cap.error, /不能大于/);

    assert.equal(readFileSync(path.join(root, "settings", "house.json"), "utf8"), before);
  });

  it("does not touch world.json or memory.sqlite", () => {
    const root = tempRoot();
    seedHouse(root, { think: { intervalMin: 10 } });
    const worldFile = path.join(root, "data", "world.json");
    const memoryFile = path.join(root, "data", "memory.sqlite");
    const startedAt = "2026-11-21T02:17:31.039Z";
    writeJson(worldFile, {
      version: 2,
      startedAt,
      characters: {
        qingqing: { id: "qingqing", room: "living", stats: { bond: 18 } },
      },
      relations: { "qingqing:viewer": { familiarity: 18, closeness: 18 } },
    });
    writeFileSync(memoryFile, "sqlite-placeholder");
    const worldBefore = readFileSync(worldFile, "utf8");
    const memoryBefore = readFileSync(memoryFile);

    const result = applySettingsUpdate(root, {
      house: { "think.intervalMin": 16 },
      characters: { qingqing: { "persona.background": "只是改设定。" } },
    });
    assert.equal(result.ok, true);
    assert.equal(readFileSync(worldFile, "utf8"), worldBefore);
    assert.deepEqual(readFileSync(memoryFile), memoryBefore);
    const world = readJson(worldFile);
    assert.equal(world.startedAt, startedAt);
    assert.equal(world.characters.qingqing.room, "living");
    assert.equal(world.relations["qingqing:viewer"].familiarity, 18);
  });

  it("restores a group by clearing those overrides", () => {
    const root = tempRoot();
    seedHouse(root, {
      think: { intervalMin: 15, timeoutMs: 25000 },
      memory: { compress: { enabled: false, maxPromptChars: 1000 } },
    });
    const result = applySettingsUpdate(root, { restore: { house: ["memory"] } });
    assert.equal(result.ok, true);
    const after = readJson(path.join(root, "settings", "house.json"));
    assert.equal(after.memory?.compress?.enabled, undefined);
    assert.equal(after.memory?.compress?.maxPromptChars, 1000);
    assert.equal(after.think.intervalMin, 15);
    const memory = resolveMemory(loadSettings({ root, reload: true }));
    assert.equal(memory.compress.enabled, true);
    assert.equal(memory.compress.maxPromptChars, 1000);
  });

  it("edits persona in the character file only", () => {
    const root = tempRoot();
    seedHouse(root);
    const result = applySettingsUpdate(root, {
      characters: {
        qingqing: {
          "identity.addressPlayerAs": "朋友",
          "persona.speechStyle": "再轻一点",
        },
      },
    });
    assert.equal(result.ok, true);
    const file = readJson(path.join(root, "settings", "characters", "qingqing.json"));
    assert.equal(file.identity.addressPlayerAs, "朋友");
    assert.equal(file.identity.name, "青青");
    assert.equal(file.persona.speechStyle, "再轻一点");
    assert.deepEqual(file.persona.traits, ["温柔", "细心", "爱照顾人"]);
    const linxia = readJson(path.join(root, "settings", "characters", "linxia.json"));
    assert.equal(linxia.persona.speechStyle, "简洁、克制，偶有一句点评");
  });
});

describe("life loop reads house.life after reload", () => {
  it("sends a character to sleep at noon when night starts at 12:00", () => {
    const settings = {
      house: { life: { nightStartHhmm: "12:00", dayStartHhmm: "07:00" } },
      characters: {},
    };
    assert.equal(resolveLife("qingqing", settings).nightStartHhmm, "12:00");
    const world = makeWorld({
      lastTickAt: "2026-11-21T03:59:30.000Z",
      nowIso: NOON,
      characters: {
        qingqing: { room: "living", action: "sit", stats: { energy: 90, hunger: 80, clean: 80 } },
        linxia: { room: "living", action: "sit", stats: { energy: 88, hunger: 80, clean: 80 } },
        xiaonan: { room: "living", action: "sit", stats: { energy: 85, hunger: 80, clean: 80 } },
      },
    });
    tickWorld(world, { now: new Date(NOON), settings });
    for (const character of Object.values(world.characters)) {
      assert.equal(character.action, "sleep", character.id);
      assert.equal(character.room, character.id, character.id);
    }
  });

  it("does not treat noon as night when house.life is left at the default", () => {
    const world = makeWorld({
      lastTickAt: "2026-11-21T03:59:30.000Z",
      nowIso: NOON,
      characters: {
        qingqing: { room: "living", action: "sit", stats: { energy: 90, hunger: 80, clean: 80 } },
        linxia: { room: "living", action: "sit", stats: { energy: 88, hunger: 80, clean: 80 } },
        xiaonan: { room: "living", action: "sit", stats: { energy: 85, hunger: 80, clean: 80 } },
      },
    });
    tickWorld(world, { now: new Date(NOON), settings: { house: {}, characters: {} } });
    for (const character of Object.values(world.characters)) {
      assert.notEqual(character.action, "sleep", character.id);
    }
  });
});

describe("live world settings reload", () => {
  it("updates think interval and memory config without reseeding world or relations", async () => {
    const root = tempRoot();
    const settings = seedHouse(root, {
      think: { intervalMin: 10 },
      memory: { compress: { enabled: true } },
    });
    const startedAt = "2026-11-21T02:17:31.039Z";
    const dataDir = path.join(root, "data");
    writeJson(path.join(dataDir, "world.json"), {
      version: 2,
      startedAt,
      savedAt: startedAt,
      lastTickAt: NOON,
      clock: { timezone: "Asia/Shanghai", iso: NOON, dayKey: "2026-11-21", hhmm: "12:00" },
      viewer: { present: false, room: "living", lastSeenAt: null },
      characters: {
        qingqing: {
          id: "qingqing",
          name: "青青",
          bedroom: "qingqing",
          room: "dining",
          action: "eat",
          line: "先吃饭。",
          stats: { energy: 77, hunger: 66, clean: 55, mood: 44, bond: 18 },
          lastThinkAt: "2026-11-21T03:00:00.000Z",
        },
      },
      relations: [
        { from: "qingqing", to: "viewer", familiarity: 22, closeness: 19, stance: "roommate", updatedAt: startedAt },
      ],
    });
    const memory = createMemory({ dbPath: ":memory:", settings });
    memories.push(memory);
    const world = createWorld(dataDir, {
      settings,
      memory,
      now: new Date(NOON),
      provider: { name: "dummy", complete: async () => ({ action: "eat", room: "dining" }) },
      allowLive: false,
    });
    await world.ready;
    assert.equal(world.world.startedAt, startedAt);
    assert.equal(world.world.characters.qingqing.room, "dining");
    assert.equal(world.world.characters.qingqing.stats.energy, 77);
    const edgeBefore = world.world.relations.find((edge) => edge.from === "qingqing" && edge.to === "viewer");
    assert.equal(edgeBefore.familiarity, 22);

    applySettingsUpdate(root, {
      house: {
        "think.intervalMin": 18,
        "memory.compress.enabled": false,
      },
    });
    const reloaded = loadSettings({ root, reload: true });
    world.reloadSettings(reloaded);

    assert.equal(resolveThink("qingqing", world.settings).intervalMs, 18 * 60_000);
    assert.equal(world.memory.config.compress.enabled, false);
    assert.equal(world.world.startedAt, startedAt);
    assert.equal(world.world.characters.qingqing.room, "dining");
    assert.equal(world.world.characters.qingqing.action, "eat");
    assert.equal(world.world.characters.qingqing.stats.energy, 77);
    const edgeAfter = world.world.relations.find((edge) => edge.from === "qingqing" && edge.to === "viewer");
    assert.equal(edgeAfter.familiarity, 22);
    assert.equal(edgeAfter.closeness, 19);
    syncWorldFromSettings(world.world, world.settings);
    assert.equal(world.world.characters.qingqing.stats.energy, 77);
  });

  it("lets PUT reload the live world through the HTTP helper", async () => {
    const root = tempRoot();
    const settings = seedHouse(root, { think: { intervalMin: 10 } });
    const dataDir = path.join(root, "data");
    writeJson(path.join(dataDir, "world.json"), {
      version: 2,
      startedAt: "2026-11-21T02:17:31.039Z",
      savedAt: NOON,
      lastTickAt: NOON,
      clock: { timezone: "Asia/Shanghai", iso: NOON, dayKey: "2026-11-21", hhmm: "12:00" },
      viewer: { present: false, room: "living", lastSeenAt: null },
      characters: {
        qingqing: {
          id: "qingqing",
          name: "青青",
          room: "living",
          action: "sit",
          stats: { energy: 70, hunger: 70, clean: 80, mood: 70, bond: 18 },
        },
      },
    });
    const memory = createMemory({ dbPath: ":memory:", settings });
    memories.push(memory);
    const world = createWorld(dataDir, {
      settings,
      memory,
      now: new Date(NOON),
      provider: { name: "dummy", complete: async () => ({ action: "sit", room: "living" }) },
    });
    await world.ready;
    const get = getSettingsPayload(world);
    assert.equal(get.effective.house["think.intervalMin"], 10);
    const put = putSettingsPayload(world, { house: { "think.intervalMin": 11 } }, { root });
    assert.equal(put.status, 200);
    assert.equal(put.body.effective.house["think.intervalMin"], 11);
    assert.equal(resolveThink("qingqing", world.settings).intervalMs, 11 * 60_000);
  });

  it("writes the virtual day-start into mood and hot-reloads a mood number without resetting the world", async () => {
    const root = tempRoot();
    const settings = seedHouse(root, { think: { timeoutMs: 20000 } });
    const dataDir = path.join(root, "data");
    const startedAt = "2026-11-21T02:17:31.039Z";
    writeJson(path.join(dataDir, "world.json"), {
      version: 2,
      startedAt,
      savedAt: NOON,
      lastTickAt: NOON,
      clock: { timezone: "Asia/Shanghai", iso: NOON, dayKey: "2026-11-21", hhmm: "12:00" },
      viewer: { present: false, room: "living", lastSeenAt: null },
      characters: {
        qingqing: {
          id: "qingqing",
          name: "青青",
          room: "dining",
          action: "eat",
          stats: { energy: 77, hunger: 70, clean: 80, mood: 61, bond: 18 },
        },
      },
    });
    const memory = createMemory({ dbPath: ":memory:", settings });
    memories.push(memory);
    const world = createWorld(dataDir, {
      settings,
      memory,
      now: new Date(NOON),
      provider: { name: "dummy", complete: async () => ({ action: "eat", room: "dining" }) },
      allowLive: false,
    });
    await world.ready;
    assert.equal(world.world.startedAt, startedAt);
    assert.equal(world.world.characters.qingqing.stats.mood, 61);

    const day = applySettingsUpdate(root, { house: { "schedule.dayStartHhmm": "08:00" } });
    assert.equal(day.ok, true);
    const houseAfterDay = readJson(path.join(root, "settings", "house.json"));
    assert.equal(houseAfterDay.life.dayStartHhmm, "08:00");
    assert.equal(houseAfterDay.speech.dayStartHhmm, "08:00");
    assert.equal(houseAfterDay.relations.dayStartHhmm, "08:00");
    assert.equal(houseAfterDay.mood.dayStartHhmm, "08:00");
    assert.equal(houseAfterDay.chat.interject.dayStartHhmm, "08:00");

    const put = putSettingsPayload(world, { house: { "mood.playerChat.delta": 3 } }, { root });
    assert.equal(put.status, 200);
    assert.equal(put.body.effective.house["mood.playerChat.delta"], 3);
    assert.equal(resolveMood(world.settings).playerChat.delta, 3);
    assert.equal(world.world.startedAt, startedAt);
    assert.equal(world.world.characters.qingqing.room, "dining");
    assert.equal(world.world.characters.qingqing.stats.mood, 61);

    const file = readJson(path.join(root, "settings", "house.json"));
    assert.equal(file.mood.playerChat.delta, 3);
    assert.equal("maxGainPerDay" in (file.mood.playerChat ?? {}), false);
    assert.equal("highMoodStart" in (file.mood ?? {}), false);
  });

  it("rejects an out-of-range mood factor and does not write", () => {
    const root = tempRoot();
    seedHouse(root, { think: { intervalMin: 10 } });
    const before = readFileSync(path.join(root, "settings", "house.json"), "utf8");
    const result = applySettingsUpdate(root, { house: { "mood.highMoodFactor": 1.5 } });
    assert.equal(result.ok, false);
    assert.match(result.error, /不能大于/);
    assert.equal(readFileSync(path.join(root, "settings", "house.json"), "utf8"), before);
  });

  it("stores chat mood cooldown in seconds without dumping default mood keys", () => {
    const root = tempRoot();
    seedHouse(root, { think: { timeoutMs: 20000 } });
    const result = applySettingsUpdate(root, { house: { "mood.playerChat.cooldownSec": 30 } });
    assert.equal(result.ok, true);
    const after = readJson(path.join(root, "settings", "house.json"));
    assert.equal(after.mood.playerChat.cooldownSec, 30);
    assert.equal("cooldownMs" in after.mood.playerChat, false);
    assert.equal("delta" in after.mood.playerChat, false);
    const loaded = loadSettings({ root, reload: true });
    assert.equal(resolveMood(loaded).playerChat.cooldownMs, 30_000);
  });
});

describe("interject settings", () => {
  it("accepts interject fields and rejects an out-of-range value without writing", () => {
    const root = tempRoot();
    seedHouse(root, { think: { timeoutMs: 20000 } });
    const ok = applySettingsUpdate(root, {
      house: {
        "chat.interject.enabled": true,
        "chat.interject.maxPerCharacterDay": 3,
        "chat.interject.minGapMin": 15,
        "relations.interject.familiarityDelta": 0.25,
        "mood.interject.delta": 1.0,
      },
    });
    assert.equal(ok.ok, true);
    const after = readJson(path.join(root, "settings", "house.json"));
    assert.equal(after.chat.interject.maxPerCharacterDay, 3);
    assert.equal(after.chat.interject.minGapMin, 15);
    assert.equal(after.relations.interject.familiarityDelta, 0.25);
    assert.equal(after.mood.interject.delta, 1.0);
    assert.equal("timeoutMs" in (after.chat.interject ?? {}), false);

    const before = readFileSync(path.join(root, "settings", "house.json"), "utf8");
    const bad = applySettingsUpdate(root, { house: { "chat.interject.maxPerMessage": 8 } });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /不能大于/);
    assert.equal(readFileSync(path.join(root, "settings", "house.json"), "utf8"), before);
  });
});

describe("listen address and secrets via settings HTTP", () => {
  it("saves a listen host and reports restart required when it differs from the running process", () => {
    const root = tempRoot();
    seedHouse(root, { think: { intervalMin: 10 } });
    const settings = loadSettings({ root, reload: true });
    const first = getSettingsPayload({ settings }, settings, {
      root,
      env: {},
      runtimeHost: "127.0.0.1",
      runtimePort: 8787,
    });
    assert.equal(first.listen.host, "127.0.0.1");
    assert.equal(first.listen.restartRequired, false);
    assert.equal(first.effective.house["server.host"], "127.0.0.1");

    const result = putSettingsPayload({ settings, reloadSettings() {} }, { house: { "server.host": "0.0.0.0" } }, {
      root,
      env: {},
      runtimeHost: "127.0.0.1",
      runtimePort: 8787,
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.listen.host, "0.0.0.0");
    assert.equal(result.body.listen.runtimeHost, "127.0.0.1");
    assert.equal(result.body.listen.restartRequired, true);
    const saved = JSON.parse(readFileSync(path.join(root, "settings", "house.json"), "utf8"));
    assert.equal(saved.server.host, "0.0.0.0");
  });

  it("rejects a hostname that is not a literal IP", () => {
    const root = tempRoot();
    seedHouse(root, {});
    const settings = loadSettings({ root, reload: true });
    const result = putSettingsPayload({ settings }, { house: { "server.host": "example.com" } }, { root, env: {} });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /IP/);
  });

  it("stores keys in data/secrets.json and never echoes them", () => {
    const root = tempRoot();
    seedHouse(root, { model: { provider: "minimax", model: "MiniMax-M3.1-Flash" } });
    const settings = loadSettings({ root, reload: true });
    const result = putSettingsPayload({ settings, reloadSettings() {} }, {
      secrets: {
        house: { minimaxApiKey: "house-live-key", voiceApiKey: "house-voice-key" },
        characters: { qingqing: { modelApiKey: "qingqing-text-key" } },
      },
    }, { root, env: {} });
    assert.equal(result.status, 200);
    const raw = JSON.stringify(result.body);
    assert.equal(raw.includes("house-live-key"), false);
    assert.equal(raw.includes("house-voice-key"), false);
    assert.equal(raw.includes("qingqing-text-key"), false);
    assert.equal(result.body.secretStatus.house.minimaxApiKey.configured, true);
    assert.equal(result.body.secretStatus.house.minimaxApiKey.source, "file");
    assert.equal(result.body.secretStatus.characters.qingqing.modelApiKey.configured, true);
    assert.equal(result.body.effective.house["secrets.minimaxApiKey"], "");
    const file = path.join(root, "data", "secrets.json");
    assert.equal(existsSync(file), true);
    const stored = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(stored.house.minimaxApiKey, "house-live-key");
    assert.equal(stored.characters.qingqing.minimaxApiKey, "qingqing-text-key");
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });

  it("leaves a stored key unchanged when the field is sent empty", () => {
    const root = tempRoot();
    seedHouse(root, { model: { provider: "minimax" } });
    mkdirSync(path.join(root, "data"), { recursive: true });
    writeFileSync(path.join(root, "data", "secrets.json"), JSON.stringify({
      version: 1,
      house: { minimaxApiKey: "keep-me" },
      characters: {},
    }), "utf8");
    const settings = loadSettings({ root, reload: true });
    const result = putSettingsPayload({ settings, reloadSettings() {} }, {
      secrets: { house: { minimaxApiKey: "" } },
    }, { root, env: {} });
    assert.equal(result.status, 200);
    const stored = JSON.parse(readFileSync(path.join(root, "data", "secrets.json"), "utf8"));
    assert.equal(stored.house.minimaxApiKey, "keep-me");
  });

  it("does not clear keys when a group is restored", () => {
    const root = tempRoot();
    seedHouse(root, { model: { provider: "minimax", model: "MiniMax-M3.1-Flash" }, think: { intervalMin: 12 } });
    mkdirSync(path.join(root, "data"), { recursive: true });
    writeFileSync(path.join(root, "data", "secrets.json"), JSON.stringify({
      version: 1,
      house: { minimaxApiKey: "keep-on-restore" },
      characters: {},
    }), "utf8");
    const settings = loadSettings({ root, reload: true });
    const result = putSettingsPayload({ settings, reloadSettings() {} }, {
      restore: { house: ["model"] },
    }, { root, env: {} });
    assert.equal(result.status, 200);
    const stored = JSON.parse(readFileSync(path.join(root, "data", "secrets.json"), "utf8"));
    assert.equal(stored.house.minimaxApiKey, "keep-on-restore");
  });
});
