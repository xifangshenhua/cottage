import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeWorld } from "../life/test-helpers.js";
import { migrateRelations, queryPack, snapshotEdges } from "./index.js";
import { config } from "./config.js";

describe("relations query packs", () => {
  it("keeps idle and chat packs under budget and omits the full graph", () => {
    const world = makeWorld();
    migrateRelations(world);
    const idle = queryPack(world, "qingqing", "idle");
    const chat = queryPack(world, "qingqing", "chat");
    assert.ok(idle.length > 0);
    assert.ok(chat.length >= idle.length);
    assert.ok(idle.length <= config.packs.idlePackChars, `idle ${idle.length} > ${config.packs.idlePackChars}: ${idle}`);
    assert.ok(chat.length <= config.packs.chatPackChars, `chat ${chat.length} > ${config.packs.chatPackChars}: ${chat}`);
    assert.equal(idle.includes("对你"), true);
    assert.equal(chat.includes("对你"), true);

    const all = snapshotEdges(world);
    assert.ok(all.length >= 12, "graph has viewer and housemate edges");
    for (const pack of [idle, chat]) {
      const mentionedKeys = all.filter((edge) => pack.includes(`${edge.from}->${edge.to}`));
      assert.equal(mentionedKeys.length, 0, "packs must not print edge keys");
      // Must not list every raw score.
      const scoreHits = all.filter((edge) => pack.includes(String(edge.familiarity)) && pack.includes(String(edge.closeness)));
      assert.ok(scoreHits.length < all.length);
    }
    // Idle pack is one-line qualitative and should not name every housemate pair in the house.
    assert.equal(idle.includes("viewer"), false);
    assert.ok(!idle.includes("familiarity") && !chat.includes("closeness"));
  });

  it("does not include every housemate edge in the idle pack", () => {
    const world = makeWorld();
    migrateRelations(world);
    const idle = queryPack(world, "qingqing", "idle");
    // Mentions at most the two other housemates by name, never a raw dump.
    const names = ["林夏", "小南"];
    const hits = names.filter((name) => idle.includes(name));
    assert.ok(hits.length <= 2);
    assert.ok(idle.length <= 60);
  });
});
