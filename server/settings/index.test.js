import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  identityCard,
  loadSettings,
  resetSettingsCache,
  resolveChat,
  resolveChatAddressing,
  resolveModel,
  resolvePresentation,
  resolveMemory,
  resolveSpeech,
  resolveThink,
  resolveLife,
  resolveMood,
  resolveInterject,
  resolveVoice,
  sanitize,
  syncWorldFromSettings,
} from "./index.js";

const roots = [];

function writeSettings({ house, characters }) {
  const root = mkdtempSync(path.join(tmpdir(), "house-settings-"));
  roots.push(root);
  mkdirSync(path.join(root, "settings", "characters"), { recursive: true });
  writeFileSync(path.join(root, "settings", "house.json"), JSON.stringify(house, null, 2));
  for (const [id, body] of Object.entries(characters)) {
    writeFileSync(path.join(root, "settings", "characters", `${id}.json`), JSON.stringify(body, null, 2));
  }
  return loadSettings({ root, reload: true });
}

after(() => {
  resetSettingsCache();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("settings merge and resolve", () => {
  it("lets a character model and think interval override the global defaults", () => {
    const settings = writeSettings({
      house: {
        model: { provider: "minimax", model: "MiniMax-M3.1-Flash" },
        think: { intervalMin: 10, timeoutMs: 20000 },
      },
      characters: {
        qingqing: {
          identity: { id: "qingqing", name: "青青" },
          persona: { traits: ["温柔"], speechStyle: "轻声" },
        },
        xiaonan: {
          identity: { id: "xiaonan", name: "小南" },
          think: { intervalMin: 15 },
          model: { provider: "minimax", model: "MiniMax-M2.5" },
        },
      },
    });

    const globalModel = resolveModel("qingqing", settings, {});
    assert.deepEqual(globalModel, { provider: "minimax", model: "MiniMax-M3.1-Flash" });

    const override = resolveModel("xiaonan", settings, {});
    assert.deepEqual(override, { provider: "minimax", model: "MiniMax-M2.5" });

    assert.equal(resolveThink("qingqing", settings).intervalMs, 10 * 60 * 1000);
    assert.equal(resolveThink("xiaonan", settings).intervalMs, 15 * 60 * 1000);
  });

  it("falls back from house.model to env, then dummy, and settings files never need a key field", () => {
    const settings = writeSettings({
      house: { think: { intervalMin: 10 } },
      characters: {
        linxia: { identity: { id: "linxia", name: "林夏" } },
      },
    });
    assert.equal("apiKey" in (settings.house), false);
    assert.equal(settings.characters.linxia.model, null);

    const fromEnv = resolveModel("linxia", settings, {
      THINK_PROVIDER: "minimax",
      MINIMAX_MODEL: "MiniMax-M3.1-Flash",
    });
    assert.deepEqual(fromEnv, { provider: "minimax", model: "MiniMax-M3.1-Flash" });

    const dummy = resolveModel("linxia", settings, {});
    assert.deepEqual(dummy, { provider: "dummy", model: null });
  });

  it("strips secret-looking keys instead of keeping them on the merged object", () => {
    const cleaned = sanitize({
      model: { provider: "minimax", model: "MiniMax-M3.1-Flash" },
      apiKey: "should-not-survive",
      nested: { token: "nope", keep: "yes" },
    });
    assert.equal("apiKey" in cleaned, false);
    assert.equal("token" in cleaned.nested, false);
    assert.equal(cleaned.nested.keep, "yes");
    assert.equal(cleaned.model.provider, "minimax");
  });

  it("truncates the identity card to the configured cap", () => {
    const settings = writeSettings({
      house: { identityCardChars: 280 },
      characters: {
        qingqing: {
          identity: { id: "qingqing", name: "青青", addressPlayerAs: "你" },
          persona: {
            traits: ["温柔", "细心"],
            speechStyle: "轻声慢语",
            background: "很长的一段背景介绍，用来确认身份卡会被截断。".repeat(10),
            likes: ["喝茶"],
            dislikes: ["被催"],
          },
        },
      },
    });
    const card = identityCard("qingqing", settings, 40);
    assert.ok(card.length <= 40);
    assert.ok(card.startsWith("青青。"));
    const defaulted = identityCard("qingqing", settings);
    assert.ok(defaulted.length <= 280);
    assert.ok(defaulted.length > 40);
  });

  it("syncs display name from settings without wiping stats or positions", () => {
    const settings = writeSettings({
      house: {},
      characters: {
        qingqing: {
          identity: { id: "qingqing", name: "青青", bedroom: "qingqing" },
          startingStats: { energy: 10, hunger: 10, clean: 10, mood: 10, bond: 1 },
        },
      },
    });
    const world = {
      characters: {
        qingqing: {
          id: "qingqing",
          name: "旧名",
          room: "dining",
          action: "eat",
          stats: { energy: 77, hunger: 66, clean: 55, mood: 44, bond: 18 },
          lastThinkAt: "2026-11-21T03:00:00.000Z",
        },
      },
    };
    syncWorldFromSettings(world, settings);
    const character = world.characters.qingqing;
    assert.equal(character.name, "青青");
    assert.equal(character.bedroom, "qingqing");
    assert.equal(character.room, "dining");
    assert.equal(character.action, "eat");
    assert.equal(character.stats.energy, 77);
    assert.equal(character.lastThinkAt, "2026-11-21T03:00:00.000Z");
  });

  it("lets a character chat style override the house default", () => {
    const settings = writeSettings({
      house: {
        chat: {
          defaultTone: "natural",
          allowedTones: ["natural", "gentle", "concise", "lively"],
          defaultLength: "medium",
          maxInputChars: 200,
        },
      },
      characters: {
        qingqing: {
          identity: { id: "qingqing", name: "青青" },
          chat: {
            defaultTone: "gentle",
            allowedTones: ["natural", "gentle", "concise"],
            defaultLength: "short",
          },
        },
      },
    });
    const chat = resolveChat("qingqing", settings);
    assert.equal(chat.defaultTone, "gentle");
    assert.equal(chat.defaultLength, "short");
    assert.deepEqual(chat.allowedTones, ["natural", "gentle", "concise"]);
    assert.equal(chat.maxInputChars, 200);
    assert.equal(chat.countAgainstProactiveCap, false);
    assert.equal(chat.mustShareRoom, true);
  });
  it("lets house.chat.addressing override defaults but ignores character.chat.addressing", () => {
    const settings = writeSettings({
      house: {
        chat: {
          defaultTone: "natural",
          addressing: {
            defaultVolume: "loud",
            canHearWhenSleeping: true,
            contextChars: 80,
          },
        },
      },
      characters: {
        qingqing: {
          identity: { id: "qingqing", name: "青青" },
          chat: {
            defaultTone: "gentle",
            addressing: {
              defaultVolume: "whisper",
              canHearWhenSleeping: false,
              contextChars: 10,
            },
          },
        },
      },
    });
    const house = resolveChatAddressing(settings);
    assert.equal(house.defaultVolume, "loud");
    assert.equal(house.canHearWhenSleeping, true);
    assert.equal(house.contextChars, 80);
    const chat = resolveChat("qingqing", settings);
    assert.equal(chat.defaultTone, "gentle");
    assert.equal(chat.addressing.defaultVolume, "loud");
    assert.equal(chat.addressing.canHearWhenSleeping, true);
    assert.equal(chat.addressing.contextChars, 80);
  });

  it("keeps character appearance and merges presentation.json under house.presentation", () => {
    const rootWrite = writeSettings({
      house: {
        presentation: { pack: "v2", maxVisiblePerRoom: 2 },
      },
      characters: {
        qingqing: {
          identity: { id: "qingqing", name: "青青" },
          persona: { traits: ["温柔"], speechStyle: "轻声" },
          appearance: { dir: "qingqing", preferredAnchors: { living: "sofa-left" } },
        },
      },
    });
    const appearance = rootWrite.characters.qingqing.appearance;
    assert.equal(appearance.dir, "qingqing");
    assert.equal(appearance.preferredAnchors.living, "sofa-left");
    assert.equal(rootWrite.characters.qingqing.persona.speechStyle, "轻声");

    // presentation.json is optional; house.presentation still overrides code defaults
    const resolved = resolvePresentation(rootWrite);
    assert.equal(resolved.pack, "v2");
    assert.equal(resolved.maxVisiblePerRoom, 2);
    assert.equal(resolved.presenter, "html");
    assert.equal(resolved.fallbackPose, "sit");
    assert.equal(resolved.rooms.living.anchors[0].id, "sofa-left");
  });

  it("merges house.speech.npcTalk over code defaults without dropping other speech numbers", () => {
    const settings = writeSettings({
      house: {
        speech: {
          maxPerGameDay: 4,
          minGapMin: 45,
          npcTalk: {
            maxPerGameDay: 2,
            minGapMin: 20,
            enabled: true,
            forbiddenRooms: ["bathroom", "dining"],
          },
        },
      },
      characters: {
        qingqing: { identity: { id: "qingqing", name: "青青" } },
      },
    });
    const speech = resolveSpeech("qingqing", settings);
    assert.equal(speech.maxPerGameDay, 4);
    assert.equal(speech.minGapMs, 45 * 60 * 1000);
    assert.equal(speech.viewerAwayTimeoutMin, 5);
    assert.equal(speech.npcTalk.enabled, true);
    assert.equal(speech.npcTalk.maxPerGameDay, 2);
    assert.equal(speech.npcTalk.minGapMin, 20);
    assert.equal(speech.npcTalk.houseMaxPerHour, 2);
    assert.equal(speech.npcTalk.mouthCooldownMin, 3);
    assert.equal(speech.npcTalk.requiresViewer, false);
    assert.deepEqual(speech.npcTalk.forbiddenRooms, ["bathroom", "dining"]);
    assert.equal(speech.npcTalk.canTalkWhenEating, true);
  });

  it("merges house.mood numbers and inherits the life day start when mood omits it", () => {
    const settings = writeSettings({
      house: {
        life: { dayStartHhmm: "08:30" },
        mood: { playerChat: { delta: 3, cooldownSec: 20 } },
      },
      characters: {
        qingqing: { identity: { id: "qingqing", name: "青青" } },
      },
    });
    const mood = resolveMood(settings);
    assert.equal(mood.playerChat.delta, 3);
    assert.equal(mood.playerChat.cooldownMs, 20_000);
    assert.equal(mood.playerChat.maxGainPerDay, 10);
    assert.equal(mood.dayStartHhmm, "08:30");
    assert.equal(mood.highMoodStart, 80);
    assert.equal(mood.npcTalk.speakerDelta, 0.8);
  });

  it("merges house.chat.interject and inherits the life day start", () => {
    const settings = writeSettings({
      house: {
        life: { dayStartHhmm: "08:30" },
        chat: { interject: { maxPerCharacterDay: 1, minGapMin: 10 } },
      },
      characters: {
        qingqing: { identity: { id: "qingqing", name: "青青" } },
      },
    });
    const interject = resolveInterject(settings);
    assert.equal(interject.enabled, true);
    assert.equal(interject.maxPerCharacterDay, 1);
    assert.equal(interject.minGapMin, 10);
    assert.equal(interject.maxOccasionsPerHouseHour, 3);
    assert.equal(interject.dayStartHhmm, "08:30");
    assert.equal(interject.sameRoomOnly, true);
  });

  it("merges life mood rates without dropping other need rates", () => {
    const settings = writeSettings({
      house: {
        life: {
          moodLowNeedThreshold: 20,
          rates: { sit: { mood: 1.5 }, awake: { mood: -1 } },
        },
      },
      characters: {
        qingqing: { identity: { id: "qingqing", name: "青青" } },
      },
    });
    const life = resolveLife("qingqing", settings);
    assert.equal(life.moodLowNeedThreshold, 20);
    assert.equal(life.moodLowNeedPenaltyPerHour, 2);
    assert.equal(life.rates.sit.mood, 1.5);
    assert.equal(life.rates.sit.energy, -4.5);
    assert.equal(life.rates.awake.mood, -1);
    assert.equal(life.rates.eat.mood, 1.0);
  });
});

describe("resolveMemory", () => {
  it("deep-merges memory.compress and honors a flat diaryUseModel flag", () => {
    const enabled = resolveMemory({
      house: {
        memory: {
          chatDiaryDays: 2,
          compress: { maxPromptChars: 1000, modelIfQuietDay: true },
        },
      },
    });
    assert.equal(enabled.chatDiaryDays, 2);
    assert.equal(enabled.idleDiaryDays, 0);
    assert.equal(enabled.compress.enabled, true);
    assert.equal(enabled.compress.diaryUseModel, true);
    assert.equal(enabled.compress.maxPromptChars, 1000);
    assert.equal(enabled.compress.modelIfQuietDay, true);
    assert.equal(enabled.compress.staggerMs, 30_000);
    assert.equal(enabled.diaryUseModel, true);

    const off = resolveMemory({
      house: { memory: { diaryUseModel: false, maxModelCompressPerDay: 1 } },
    });
    assert.equal(off.compress.diaryUseModel, false);
    assert.equal(off.diaryUseModel, false);
    assert.equal(off.compress.enabled, true);
    assert.equal(off.compress.maxModelJobsPerCharacterDay, 1);
  });
});

describe("resolveVoice", () => {
  it("uses character timbre defaults and requires both house and character switches to synthesize", () => {
    const settings = writeSettings({
      house: { voice: { enabled: true, masterVolume: 0.8 } },
      characters: {
        qingqing: { identity: { id: "qingqing", name: "青青" }, voice: { enabled: false } },
        linxia: { identity: { id: "linxia", name: "林夏" } },
      },
    });
    const qingqing = resolveVoice("qingqing", settings);
    const linxia = resolveVoice("linxia", settings);
    const house = resolveVoice(null, settings);
    assert.equal(house.enabled, true);
    assert.equal(house.masterVolume, 0.8);
    assert.equal(qingqing.enabled, false);
    assert.equal(qingqing.characterEnabled, false);
    assert.equal(qingqing.houseEnabled, true);
    assert.equal(qingqing.voiceId, "Chinese (Mandarin)_Soft_Girl");
    assert.equal(qingqing.speed, 0.92);
    assert.equal(linxia.enabled, true);
    assert.equal(linxia.voiceId, "danya_xuejie");
    assert.equal(linxia.speed, 1);
  });
});

