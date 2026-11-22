import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createSeed } from "./seed.js";
import { nowClock } from "./clock.js";
import { migrateRelations } from "./relations/index.js";

const WORLD_VERSION = 3;
const STAT_KEYS = ["energy", "hunger", "clean", "mood", "bond"];

/** Load, migrate, and atomically save world.json. No life-loop rules live here. */
export function createStore(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "world.json");
  let world = migrate(load(file));

  function getWorld() {
    return world;
  }

  function save() {
    world.savedAt = new Date().toISOString();
    world.clock = nowClock();
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(world, null, 2), "utf8");
    renameSync(tmp, file);
    return world;
  }

  return { getWorld, save };
}

function load(file) {
  if (!existsSync(file)) {
    return createSeed(nowClock());
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed?.version || !parsed.characters) throw new Error("invalid world");
    return parsed;
  } catch {
    return createSeed(nowClock());
  }
}

export function migrate(world) {
  if (!world || typeof world !== "object") return createSeed(nowClock());

  const lastTickAt = world.lastTickAt || world.savedAt || world.clock?.iso || new Date().toISOString();
  world.lastTickAt = lastTickAt;
  if (!world.viewer) {
    world.viewer = { present: false, room: "living", lastSeenAt: null };
  }
  if (!world.characters || typeof world.characters !== "object") {
    world.characters = {};
  }

  for (const character of Object.values(world.characters)) {
    if (!character.actionStartedAt) character.actionStartedAt = lastTickAt;
    if (!character.enteredRoomAt) character.enteredRoomAt = character.actionStartedAt;
    if (character.lastThinkAt === undefined) character.lastThinkAt = null;
    if (character.lastRoomChangeAt === undefined) character.lastRoomChangeAt = null;
    if (!character.stats || typeof character.stats !== "object") character.stats = {};
    for (const key of STAT_KEYS) {
      if (typeof character.stats[key] !== "number" || !Number.isFinite(character.stats[key])) {
        character.stats[key] = 50;
      }
    }
  }

  migrateRelations(world);

  if (!world.version || world.version < WORLD_VERSION) {
    world.version = WORLD_VERSION;
  }
  return world;
}
