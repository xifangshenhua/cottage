import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorld } from "./world.js";
import { createMemory, mergeMemoryConfig } from "./memory/index.js";
import {
  DEFAULT_VIEWER_AWAY_TIMEOUT_MIN,
  expireViewerIfAway,
  resolveViewerAwayTimeoutMin,
  viewerPatchAfterSseClose,
} from "./viewer.js";

const NOW = "2026-11-21T14:00:00.000Z";
const temps = [];
const memories = [];

after(() => {
  for (const memory of memories) {
    try { memory.close(); } catch { /* already closed */ }
  }
  for (const dir of temps) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function worldWith(viewer) {
  return { viewer: { room: "living", present: false, lastSeenAt: null, ...viewer } };
}

describe("expireViewerIfAway", () => {
  it("marks the viewer absent when lastSeenAt is older than the timeout", () => {
    const world = worldWith({
      present: true,
      room: "dining",
      lastSeenAt: "2026-11-21T13:54:00.000Z",
    });
    const changed = expireViewerIfAway(world, {
      now: new Date(NOW),
      timeoutMin: DEFAULT_VIEWER_AWAY_TIMEOUT_MIN,
    });
    assert.equal(changed, true);
    assert.equal(world.viewer.present, false);
    assert.equal(world.viewer.room, "dining");
    assert.equal(world.viewer.lastSeenAt, "2026-11-21T13:54:00.000Z");
  });

  it("keeps the viewer present when lastSeenAt is still recent", () => {
    const world = worldWith({
      present: true,
      lastSeenAt: "2026-11-21T13:58:00.000Z",
    });
    const changed = expireViewerIfAway(world, {
      now: new Date(NOW),
      timeoutMin: 5,
    });
    assert.equal(changed, false);
    assert.equal(world.viewer.present, true);
  });

  it("expires a stale lastSeenAt even if an SSE client is still listed", () => {
    const world = worldWith({
      present: true,
      lastSeenAt: "2026-11-21T13:50:00.000Z",
    });
    expireViewerIfAway(world, { now: new Date(NOW), timeoutMin: 5, sseClientCount: 1 });
    assert.equal(world.viewer.present, false);
  });

  it("treats a missing lastSeenAt as stale", () => {
    const world = worldWith({ present: true, lastSeenAt: null });
    expireViewerIfAway(world, { now: new Date(NOW), timeoutMin: 5 });
    assert.equal(world.viewer.present, false);
  });
});

describe("viewerPatchAfterSseClose", () => {
  it("clears presence when the last SSE client disconnects", () => {
    assert.deepEqual(
      viewerPatchAfterSseClose(0, { present: true, room: "living" }),
      { present: false },
    );
  });

  it("leaves presence alone when another SSE client remains", () => {
    assert.equal(viewerPatchAfterSseClose(1, { present: true }), null);
  });

  it("is a no-op when already absent", () => {
    assert.equal(viewerPatchAfterSseClose(0, { present: false }), null);
  });
});

describe("resolveViewerAwayTimeoutMin", () => {
  it("defaults to 5 minutes and accepts a house overlay", () => {
    assert.equal(resolveViewerAwayTimeoutMin(null), 5);
    assert.equal(
      resolveViewerAwayTimeoutMin({ house: { speech: { viewerAwayTimeoutMin: 8 } } }),
      8,
    );
  });
});

describe("createWorld tick expires a stale viewer", () => {
  function tempDir() {
    const dir = mkdtempSync(path.join(tmpdir(), "house-viewer-"));
    temps.push(dir);
    return dir;
  }

  function testMemory() {
    const memory = createMemory({
      dbPath: ":memory:",
      config: mergeMemoryConfig({ compress: { enabled: false } }),
    });
    memories.push(memory);
    return memory;
  }

  function dummyWorld(nowIso) {
    return createWorld(tempDir(), {
      memory: testMemory(),
      settings: { house: { model: { provider: "dummy", model: null } } },
      now: new Date(nowIso),
      provider: { name: "dummy", complete: async () => ({ action: "sit", room: "living" }) },
    });
  }

  it("clears a persisted present flag on tick when lastSeenAt is stale", async () => {
    const now = new Date(NOW);
    const world = dummyWorld(NOW);
    await world.ready;
    world.world.viewer.present = true;
    world.world.viewer.lastSeenAt = "2026-11-21T13:50:00.000Z";
    await world.tick(now);
    assert.equal(world.world.viewer.present, false);
  });

  it("keeps a recently seen viewer present through a tick", async () => {
    const now = new Date(NOW);
    const world = dummyWorld(NOW);
    await world.ready;
    world.world.viewer.present = true;
    world.world.viewer.lastSeenAt = "2026-11-21T13:59:00.000Z";
    await world.tick(now);
    assert.equal(world.world.viewer.present, true);
  });
});
