#!/usr/bin/env node
/**
 * Offline / live-safe check for roommate talk.
 * Does not call a model, does not expose an HTTP debug endpoint,
 * and does not move characters or reset stats/relations/memory.
 *
 *   node scripts/demo-npc-talk.js           # print whether a line could land
 *   node scripts/demo-npc-talk.js --apply   # land one line if already legal
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nowClock } from "../server/clock.js";
import { createMemory } from "../server/memory/index.js";
import { applyEvent, migrateRelations } from "../server/relations/index.js";
import { loadSettings } from "../server/settings/index.js";
import { createStore } from "../server/store.js";
import { applyNpcSpeech } from "../server/think/speech/apply.js";
import { canSpeakToNpc, legalNpcSpeechTargets } from "../server/think/speech/gates.js";
import { resolveSpeech } from "../server/settings/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const apply = process.argv.includes("--apply");
const now = new Date();
const clock = nowClock(now);
const settings = loadSettings();
const store = createStore(DATA);
const world = store.getWorld();

const occupants = Object.values(world.characters ?? {}).map((c) => ({
  id: c.id,
  name: c.name,
  room: c.room,
  action: c.action,
}));

const pair = findLegalPair(world, clock, now, settings);
if (!pair) {
  console.log(JSON.stringify({
    ok: false,
    applied: false,
    reason: "no-legal-pair",
    clock: clock.hhmm,
    viewer: world.viewer,
    occupants,
  }, null, 2));
  process.exit(0);
}

const speechCfg = resolveSpeech(pair.speaker.id, settings);
const speech = {
  to: pair.target.id,
  line: "一起坐一会儿吧。",
  reason: `${pair.target.name}刚和我在同一间房`,
};
const gate = canSpeakToNpc(world, pair.speaker, pair.target, speech, clock, now, speechCfg);

if (!apply) {
  console.log(JSON.stringify({
    ok: gate.ok,
    applied: false,
    reason: gate.reason,
    speaker: pair.speaker.id,
    target: pair.target.id,
    clock: clock.hhmm,
    viewer: world.viewer,
    occupants,
    wouldShowBubble: gate.ok && world.viewer?.present && world.viewer.room === pair.speaker.room,
  }, null, 2));
  process.exit(0);
}

if (!gate.ok) {
  console.log(JSON.stringify({
    ok: false,
    applied: false,
    reason: gate.reason,
    speaker: pair.speaker.id,
    target: pair.target.id,
    occupants,
  }, null, 2));
  process.exit(0);
}

const memory = createMemory({
  dbPath: path.join(DATA, "memory.sqlite"),
  settings,
});
migrateRelations(world, { settings });
const result = applyNpcSpeech(world, pair.speaker, speech, clock, now, speechCfg);
if (!result.ok) {
  memory.close();
  console.log(JSON.stringify({ ok: false, applied: false, reason: result.reason, occupants }, null, 2));
  process.exit(0);
}

applyEvent(world, { type: "npcTalk", from: pair.speaker.id, to: pair.target.id, now }, { settings, now, clock });
applyEvent(world, { type: "npcTalk", from: pair.target.id, to: pair.speaker.id, now }, { settings, now, clock });
for (const other of Object.values(world.characters ?? {})) {
  if (!other?.id || other.id === pair.speaker.id || other.id === pair.target.id) continue;
  if (other.room !== pair.speaker.room) continue;
  if (other.action === "sleep" || other.action === "wash") continue;
  applyEvent(world, { type: "npcOverhear", from: pair.speaker.id, to: other.id, now }, { settings, now, clock });
}
memory.recordNpcTalk({
  world,
  speaker: pair.speaker,
  listener: pair.target,
  line: result.line,
  now,
  clock,
});
store.save();
memory.close();

console.log(JSON.stringify({
  ok: true,
  applied: true,
  speaker: pair.speaker.id,
  target: pair.target.id,
  line: result.line,
  visible: result.visible,
  action: pair.speaker.action,
  lineTo: pair.speaker.lineTo,
  occupants: Object.values(world.characters).map((c) => ({
    id: c.id,
    name: c.name,
    room: c.room,
    action: c.action,
  })),
}, null, 2));

function findLegalPair(world, clock, now, settings) {
  const people = Object.values(world.characters ?? {});
  for (const speaker of people) {
    const cfg = resolveSpeech(speaker.id, settings);
    const targets = legalNpcSpeechTargets(world, speaker, clock, now, cfg);
    if (targets.length) return { speaker, target: targets[0], cfg };
  }
  return null;
}

