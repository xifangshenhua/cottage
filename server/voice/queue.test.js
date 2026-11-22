import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createQueue } from "./queue.js";

describe("voice synth queue", () => {
  it("runs jobs FIFO at concurrency 1 so the primary line is synthesized before an interjection", async () => {
    const queue = createQueue({ concurrency: 1 });
    const started = [];
    const finished = [];
    let releasePrimary;
    const primaryGate = new Promise((resolve) => { releasePrimary = resolve; });

    const primary = queue.enqueue(async () => {
      started.push("primary");
      await primaryGate;
      finished.push("primary");
      return "primary";
    });
    const interject = queue.enqueue(async () => {
      started.push("interject");
      finished.push("interject");
      return "interject";
    });

    await Promise.resolve();
    assert.deepEqual(started, ["primary"]);
    assert.deepEqual(finished, []);
    releasePrimary();
    assert.deepEqual(await Promise.all([primary, interject]), ["primary", "interject"]);
    assert.deepEqual(started, ["primary", "interject"]);
    assert.deepEqual(finished, ["primary", "interject"]);
  });
});
