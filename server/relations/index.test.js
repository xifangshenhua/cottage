import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore, migrate } from "../store.js";
import { makeWorld, NOON } from "../life/test-helpers.js";
import { handleChat, resetChatLocks } from "../chat/index.js";
import { tickThink } from "../think/index.js";
import {
  applyEvent,
  getEdge,
  migrateRelations,
  observeLifeStep,
  snapshotEdges,
  tickRelations,
} from "./index.js";
import { config } from "./config.js";

const temps = [];

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "house-relations-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  resetChatLocks();
  while (temps.length) {
    rmSync(temps.pop(), { recursive: true, force: true });
  }
});

function frozen(character, world, id) {
  const c = world.characters[id];
  return {
    room: c.room,
    action: c.action,
    lastThinkAt: c.lastThinkAt,
    energy: c.stats.energy,
    hunger: c.stats.hunger,
    clean: c.stats.clean,
    mood: c.stats.mood,
  };
}

describe("relations migration and graph", () => {
  it("creates missing viewer edges from stats.bond and does not wipe rooms or stats", () => {
    const world = makeWorld({
      characters: {
        qingqing: { room: "dining", action: "eat", lastThinkAt: "2026-11-21T03:50:00.000Z", stats: { energy: 61, hunger: 40, clean: 77, mood: 72, bond: 18 } },
        linxia: { room: "living", action: "sit", lastThinkAt: "2026-11-21T03:40:00.000Z", stats: { energy: 55, hunger: 44, clean: 70, mood: 80, bond: 16 } },
        xiaonan: { room: "xiaonan", action: "sleep", lastThinkAt: "2026-11-21T03:30:00.000Z", stats: { energy: 30, hunger: 50, clean: 68, mood: 60, bond: 15 } },
      },
    });
    const before = {
      qingqing: frozen("qingqing", world, "qingqing"),
      linxia: frozen("linxia", world, "linxia"),
      xiaonan: frozen("xiaonan", world, "xiaonan"),
    };
    migrateRelations(world);
    const qv = getEdge(world, "qingqing", "viewer");
    const lv = getEdge(world, "linxia", "viewer");
    const xv = getEdge(world, "xiaonan", "viewer");
    assert.equal(qv.familiarity, 18);
    assert.equal(qv.closeness, 18);
    assert.equal(qv.stance, "companion");
    assert.equal(lv.familiarity, 16);
    assert.equal(lv.closeness, 16);
    assert.equal(xv.familiarity, 15);
    assert.equal(xv.closeness, 15);
    assert.equal(world.characters.qingqing.stats.bond, 18);
    assert.equal(world.characters.linxia.stats.bond, 16);
    assert.equal(world.characters.xiaonan.stats.bond, 15);
    assert.deepEqual(frozen("qingqing", world, "qingqing"), before.qingqing);
    assert.deepEqual(frozen("linxia", world, "linxia"), before.linxia);
    assert.deepEqual(frozen("xiaonan", world, "xiaonan"), before.xiaonan);
    assert.ok(getEdge(world, "qingqing", "linxia"));
    assert.ok(getEdge(world, "linxia", "qingqing"));
    assert.equal(getEdge(world, "qingqing", "xiaonan").stance, "friend");
    assert.equal(getEdge(world, "linxia", "qingqing").stance, "roommate");
  });

  it("never overwrites an existing world edge with a seed", () => {
    const world = makeWorld();
    world.relations = [{
      from: "qingqing",
      to: "linxia",
      familiarity: 40,
      closeness: 35,
      stance: "friend",
      updatedAt: NOON,
    }];
    migrateRelations(world);
    const edge = getEdge(world, "qingqing", "linxia");
    assert.equal(edge.familiarity, 40);
    assert.equal(edge.closeness, 35);
    assert.equal(edge.stance, "friend");
  });

  it("store migrate bumps the world version and preserves character state", () => {
    const world = makeWorld({
      characters: {
        qingqing: { room: "living", lastThinkAt: "2026-11-21T03:11:00.000Z", stats: { bond: 18, energy: 63 } },
      },
    });
    world.version = 2;
    delete world.relations;
    const roomsBefore = world.characters.qingqing.room;
    const thinkBefore = world.characters.qingqing.lastThinkAt;
    const migrated = migrate(world);
    assert.equal(migrated.version, 3);
    assert.equal(world.characters.qingqing.room, roomsBefore);
    assert.equal(world.characters.qingqing.lastThinkAt, thinkBefore);
    assert.equal(getEdge(world, "qingqing", "viewer").familiarity, 18);
    assert.equal(world.characters.qingqing.stats.bond, 18);
  });

  it("persists official edge fields in world.json after a scoring chat path", () => {
    const dir = tempDir();
    const initial = makeWorld({
      characters: {
        qingqing: { room: "living", action: "sit", lastThinkAt: "2026-11-21T03:50:00.000Z", stats: { bond: 18, energy: 70, hunger: 70, clean: 80, mood: 70 } },
      },
    });
    initial.version = 2;
    writeFileSync(path.join(dir, "world.json"), JSON.stringify(initial, null, 2));
    const store = createStore(dir);
    const world = store.getWorld();
    assert.equal(world.version, 3);
    applyEvent(world, {
      type: "playerChat",
      from: "qingqing",
      to: "viewer",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
    });
    store.save();
    const saved = JSON.parse(readFileSync(path.join(dir, "world.json"), "utf8"));
    const edge = saved.relations.find((item) => item.from === "qingqing" && item.to === "viewer");
    assert.ok(edge);
    assert.equal(typeof edge.familiarity, "number");
    assert.equal(typeof edge.closeness, "number");
    assert.equal(typeof edge.stance, "string");
    assert.equal(typeof edge.updatedAt, "string");
    assert.ok(edge.familiarity > 18 || edge.closeness > 18);
  });
});

describe("relations household events", () => {
  it("shared-room, meal, and npc-talk events only move the involved character–character edges", () => {
    const world = makeWorld({
      characters: {
        qingqing: { room: "dining", action: "eat" },
        linxia: { room: "dining", action: "eat" },
        xiaonan: { room: "xiaonan", action: "sleep" },
      },
    });
    migrateRelations(world);
    const snap = snapshotEdges(world);
    const byKey = (from, to) => snap.find((e) => e.from === from && e.to === to);

    // 16 minutes together eating: meal (8m) × 2 and shared-room (10m) × 1, both directions.
    observeLifeStep(world, 16 * 60_000, new Date(NOON));
    tickRelations(world, { now: new Date(NOON), clock: world.clock, cfg: config });

    const ql = getEdge(world, "qingqing", "linxia");
    const lq = getEdge(world, "linxia", "qingqing");
    const startQL = byKey("qingqing", "linxia");
    const startLQ = byKey("linxia", "qingqing");
    assert.ok(ql.familiarity > startQL.familiarity);
    assert.ok(ql.closeness > startQL.closeness);
    assert.ok(lq.familiarity > startLQ.familiarity);
    assert.ok(lq.closeness > startLQ.closeness);

    const qx = getEdge(world, "qingqing", "xiaonan");
    const startQX = byKey("qingqing", "xiaonan");
    assert.equal(qx.familiarity, startQX.familiarity);
    assert.equal(qx.closeness, startQX.closeness);
    assert.equal(getEdge(world, "qingqing", "viewer").familiarity, byKey("qingqing", "viewer").familiarity);
    assert.equal(getEdge(world, "qingqing", "viewer").closeness, byKey("qingqing", "viewer").closeness);
    assert.equal(world.characters.qingqing.stats.bond, 18);
  });

  it("npc talk in the living room does not score a sleeper in another room", () => {
    const world = makeWorld({
      characters: {
        qingqing: { room: "living", action: "talk" },
        linxia: { room: "living", action: "sit" },
        xiaonan: { room: "xiaonan", action: "sleep" },
      },
    });
    migrateRelations(world);
    const xq = getEdge(world, "xiaonan", "qingqing").familiarity;
    observeLifeStep(world, 12 * 60_000, new Date(NOON));
    tickRelations(world, { now: new Date(NOON), clock: world.clock, cfg: config });
    assert.ok(getEdge(world, "qingqing", "linxia").familiarity > 22 || getEdge(world, "qingqing", "linxia").closeness > 20);
    assert.equal(getEdge(world, "xiaonan", "qingqing").familiarity, xq);
  });
});

describe("relations hooks from chat and think", () => {
  it("a successful long chat syncs stats.bond to the composite", async () => {
    const world = makeWorld({
      viewer: { present: true, room: "living", lastSeenAt: NOON },
    });
    const result = await handleChat(world, {
      characterId: "qingqing",
      text: "今天过得怎么样，有没有休息好？",
      now: new Date(NOON),
      settings: null,
      provider: {
        name: "spy",
        async complete() {
          return { characterId: "qingqing", line: "还不错，刚刚在客厅坐着。" };
        },
      },
    });
    assert.equal(result.ok, true);
    const edge = getEdge(world, "qingqing", "viewer");
    assert.ok(edge.familiarity > 18 || edge.closeness > 18);
    const expected = Math.round(0.4 * edge.familiarity + 0.6 * edge.closeness);
    assert.equal(world.characters.qingqing.stats.bond, expected);
    assert.ok(world.relations.some((e) => e.from === "qingqing" && e.to === "viewer" && e.stance && e.updatedAt));
  });

  it("idle think and a landed proactive line do not change relation scores", async () => {
    const world = makeWorld({
      viewer: { present: true, room: "living", lastSeenAt: NOON },
      characters: {
        qingqing: {
          room: "living",
          action: "sit",
          lastThinkAt: "2026-11-21T03:50:00.000Z",
          lastProactiveAt: null,
          proactiveCountToday: 0,
          stats: { energy: 80, hunger: 80, clean: 80, mood: 70, bond: 18 },
        },
        linxia: { action: "sleep", room: "linxia", lastThinkAt: "2026-11-21T03:50:00.000Z" },
        xiaonan: { action: "sleep", room: "xiaonan", lastThinkAt: "2026-11-21T03:50:00.000Z" },
      },
    });
    migrateRelations(world);
    const before = snapshotEdges(world);
    await tickThink(world, {
      now: new Date(NOON),
      settings: null,
      provider: {
        name: "spy",
        async complete() {
          return {
            characterId: "qingqing",
            action: "sit",
            room: "living",
            speech: { to: "viewer", line: "你来了。", reason: "看见你进了客厅" },
          };
        },
      },
    });
    assert.equal(world.characters.qingqing.line, "你来了。");
    assert.deepEqual(
      snapshotEdges(world).map((e) => [e.from, e.to, e.familiarity, e.closeness, e.stance]),
      before.map((e) => [e.from, e.to, e.familiarity, e.closeness, e.stance]),
    );
    assert.equal(world.characters.qingqing.stats.bond, 18);
  });

  it("does not hit the network", async () => {
    const world = makeWorld({ viewer: { present: true, room: "living", lastSeenAt: NOON } });
    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      fetchCalls.push(args[0]);
      throw new Error("network should not be used");
    };
    try {
      migrateRelations(world);
      applyEvent(world, {
        type: "playerChat",
        from: "qingqing",
        to: "viewer",
        text: "今天过得怎么样，有没有休息好？",
        now: new Date(NOON),
      });
      assert.equal(fetchCalls.length, 0);
    } finally {
      if (originalFetch) globalThis.fetch = originalFetch;
      else delete globalThis.fetch;
    }
  });
});

describe("relations ownership", () => {
  it("life needs and memory no longer write raw relation scores", async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const memorySrc = readFileSync(path.join(root, "memory/index.js"), "utf8");
    assert.equal(memorySrc.includes("character.stats.bond ="), false);
    const needsSrc = readFileSync(path.join(root, "life/needs.js"), "utf8");
    assert.equal(needsSrc.includes("stats.bond =") || needsSrc.includes("next.bond = current.bond"), true);
    assert.equal(/next\.bond\s*=\s*(?!current)/.test(needsSrc.replace("next.bond = current.bond", "")), false);
  });
});
