import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tickWorld } from "../life/index.js";
import { makeWorld, NOON } from "../life/test-helpers.js";
import { tickThink } from "./index.js";
import { createDummyProvider } from "./provider/dummy.js";

function hoursLater(iso, hours) {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}

describe("think coordinator", () => {
  it("does not call the provider during life catch-up over hours, and thinks at most once after", async () => {
    const start = NOON;
    const end = hoursLater(start, 8);
    const world = makeWorld({
      lastTickAt: start,
      nowIso: start,
      characters: {
        qingqing: { room: "living", action: "sit", stats: { energy: 90, hunger: 20, clean: 70 }, lastThinkAt: start },
        linxia: { room: "living", action: "sit", stats: { energy: 88, hunger: 22, clean: 30 }, lastThinkAt: start },
        xiaonan: { room: "living", action: "sit", stats: { energy: 85, hunger: 18, clean: 75 }, lastThinkAt: start },
      },
    });

    const calls = [];
    const provider = {
      name: "spy",
      complete: async (input) => {
        calls.push(input?.context?.character?.id ?? "unknown");
        return { characterId: calls[0], action: "sit", room: "living" };
      },
    };

    tickWorld(world, { now: new Date(end) });
    assert.equal(calls.length, 0, "life catch-up must not call the think provider");
    // Eight hours would be 48 missed 10-minute slots if think were replayed.
    await tickThink(world, { now: new Date(end), provider, settings: null });
    assert.equal(calls.length, 1, "at most one think pass after catch-up, not one per missed slot");
  });

  it("applies a legal action even when speech gates drop the line", async () => {
    const world = makeWorld({
      viewer: { present: false, room: "living", lastSeenAt: null },
      characters: {
        qingqing: {
          room: "living",
          action: "sit",
          line: null,
          lastThinkAt: "2026-11-21T03:50:00.000Z",
          lastProactiveAt: null,
          stats: { energy: 80, hunger: 20, clean: 80 },
        },
        linxia: { action: "sleep", room: "linxia", lastThinkAt: "2026-11-21T03:50:00.000Z" },
        xiaonan: { action: "sleep", room: "xiaonan", lastThinkAt: "2026-11-21T03:50:00.000Z" },
      },
    });

    const provider = {
      name: "spy",
      complete: async () => ({
        characterId: "qingqing",
        action: "eat",
        room: "dining",
        speech: { to: "viewer", line: "我去吃饭了。", reason: "饿了" },
      }),
    };

    await tickThink(world, { now: new Date(NOON), provider, settings: null });
    const qingqing = world.characters.qingqing;
    assert.equal(qingqing.action, "eat");
    assert.equal(qingqing.room, "dining");
    assert.equal(qingqing.line, null);
    assert.equal(qingqing.lastProactiveAt, null);
    assert.equal(qingqing.lastThinkAt, NOON);
  });

  it("writes a proactive line when gates pass and the provider asks to speak", async () => {
    const world = makeWorld({
      viewer: { present: true, room: "living", lastSeenAt: NOON },
      characters: {
        qingqing: {
          room: "living",
          action: "sit",
          lastThinkAt: "2026-11-21T03:50:00.000Z",
          lastProactiveAt: null,
          proactiveCountToday: 0,
          stats: { energy: 80, hunger: 80, clean: 80 },
        },
        linxia: { action: "sleep", room: "linxia", lastThinkAt: "2026-11-21T03:50:00.000Z" },
        xiaonan: { action: "sleep", room: "xiaonan", lastThinkAt: "2026-11-21T03:50:00.000Z" },
      },
    });
    const provider = {
      name: "spy",
      complete: async () => ({
        characterId: "qingqing",
        action: "sit",
        room: "living",
        speech: { to: "viewer", line: "你来了。", reason: "看见你进了客厅" },
      }),
    };
    await tickThink(world, { now: new Date(NOON), provider, settings: null });
    const qingqing = world.characters.qingqing;
    assert.equal(qingqing.action, "sit");
    assert.equal(qingqing.room, "living");
    assert.equal(qingqing.line, "你来了。");
    assert.equal(qingqing.lastProactiveAt, NOON);
    assert.equal(qingqing.proactiveCountToday, 1);
    assert.equal(qingqing.proactiveDayKey, "2026-11-21");
    assert.equal(qingqing.lastThinkAt, NOON);
    assert.equal(qingqing.stats.mood, 71);
    assert.equal(qingqing.moodMeta.proactiveGain, 1);
    assert.equal(world.characters.linxia.moodMeta, undefined);
    assert.equal(world.characters.xiaonan.moodMeta, undefined);
  });

  it("does not change mood when speech gates drop the line", async () => {
    const world = makeWorld({
      viewer: { present: false, room: "living", lastSeenAt: null },
      characters: {
        qingqing: {
          room: "living",
          action: "sit",
          line: null,
          lastThinkAt: "2026-11-21T03:50:00.000Z",
          lastProactiveAt: null,
          stats: { energy: 80, hunger: 20, clean: 80, mood: 50 },
        },
        linxia: { action: "sleep", room: "linxia", lastThinkAt: "2026-11-21T03:50:00.000Z" },
        xiaonan: { action: "sleep", room: "xiaonan", lastThinkAt: "2026-11-21T03:50:00.000Z" },
      },
    });
    await tickThink(world, {
      now: new Date(NOON),
      settings: null,
      provider: {
        name: "spy",
        complete: async () => ({
          characterId: "qingqing",
          action: "eat",
          room: "dining",
          speech: { to: "viewer", line: "我去吃饭了。", reason: "饿了" },
        }),
      },
    });
    assert.equal(world.characters.qingqing.line, null);
    assert.equal(world.characters.qingqing.stats.mood, 50);
    assert.equal(world.characters.qingqing.moodMeta, undefined);
  });

  it("records lastThinkAt when the dummy stays silent", async () => {
    const world = makeWorld({
      characters: {
        qingqing: { action: "sit", lastThinkAt: "2026-11-21T03:50:00.000Z", stats: { energy: 80, hunger: 80, clean: 80 } },
        linxia: { action: "sleep", room: "linxia", lastThinkAt: "2026-11-21T03:50:00.000Z" },
        xiaonan: { action: "sleep", room: "xiaonan", lastThinkAt: "2026-11-21T03:50:00.000Z" },
      },
    });
    await tickThink(world, { now: new Date(NOON), provider: createDummyProvider(), settings: null });
    assert.equal(world.characters.qingqing.lastThinkAt, NOON);
    assert.equal(world.characters.qingqing.line, null);
  });
});

describe("think uses the same life settings as the life loop", () => {
  /** 21:30 Asia/Shanghai — still daytime under the default 22:00 night start. */
  const EVENING = "2026-11-21T13:30:00.000Z";

  function eveningWorld() {
    return makeWorld({
      nowIso: EVENING,
      lastTickAt: EVENING,
      characters: {
        qingqing: {
          room: "living",
          action: "sit",
          lastThinkAt: "2026-11-21T13:00:00.000Z",
          stats: { energy: 90, hunger: 80, clean: 80 },
        },
        linxia: { action: "sleep", room: "linxia", lastThinkAt: "2026-11-21T13:00:00.000Z" },
        xiaonan: { action: "sleep", room: "xiaonan", lastThinkAt: "2026-11-21T13:00:00.000Z" },
      },
    });
  }

  it("proposes and applies sleep at 21:30 when nightStart is 21:00, not the 22:00 default", async () => {
    const world = eveningWorld();
    let options = null;
    const provider = {
      name: "spy",
      complete: async (input) => {
        options = input.options ?? [];
        return { characterId: "qingqing", action: "sleep", room: "qingqing" };
      },
    };
    await tickThink(world, {
      now: new Date(EVENING),
      provider,
      settings: { house: { life: { nightStartHhmm: "21:00" } } },
    });
    assert.ok(options.some((row) => row.action === "sleep"), "propose should offer sleep after 21:00");
    assert.equal(world.characters.qingqing.action, "sleep");
    assert.equal(world.characters.qingqing.room, "qingqing");
  });

  it("does not propose sleep at 21:30 under the default night start", async () => {
    const world = eveningWorld();
    let options = null;
    const provider = {
      name: "spy",
      complete: async (input) => {
        options = input.options ?? [];
        return { characterId: "qingqing", action: "sleep", room: "qingqing" };
      },
    };
    await tickThink(world, { now: new Date(EVENING), provider, settings: null });
    assert.ok(!options.some((row) => row.action === "sleep"));
    assert.equal(world.characters.qingqing.action, "sit");
    assert.equal(world.characters.qingqing.room, "living");
  });
});
