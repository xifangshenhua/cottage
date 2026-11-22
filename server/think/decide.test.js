import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decide } from "./decide.js";

const character = { id: "qingqing", name: "青青", action: "sit", room: "living" };
const options = [
  { action: "eat", room: "dining", priority: 2 },
  { action: "sit", room: "living", priority: 4 },
];

describe("decide fallback", () => {
  it("falls back to the rule pick, without speech, when the provider throws", async () => {
    const result = await decide({
      provider: {
        complete: async () => {
          throw new Error("provider down");
        },
      },
      options,
      character,
    });
    assert.equal(result.action, "eat");
    assert.equal(result.room, "dining");
    assert.equal(result.speech, undefined);
    assert.equal(result.characterId, "qingqing");
  });

  it("falls back when the provider returns bad JSON, and does not throw", async () => {
    const result = await decide({
      provider: { complete: async () => "{not json" },
      options,
      character,
    });
    assert.equal(result.action, "eat");
    assert.equal(result.speech, undefined);
  });

  it("falls back when the chosen action is not in the legal options", async () => {
    const result = await decide({
      provider: {
        complete: async () => ({ characterId: "qingqing", action: "dance", room: "living" }),
      },
      options,
      character,
    });
    assert.equal(result.action, "eat");
    assert.equal(result.speech, undefined);
  });

  it("falls back on timeout and does not keep a late speech payload", async () => {
    const result = await decide({
      provider: {
        complete: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return {
            characterId: "qingqing",
            action: "sit",
            room: "living",
            speech: { to: "viewer", line: "迟到了", reason: "timeout-test" },
          };
        },
      },
      options,
      character,
      cfg: { timeoutMs: 10, maxLineChars: 80, maxReasonChars: 200 },
    });
    assert.equal(result.action, "eat");
    assert.equal(result.speech, undefined);
  });
});
