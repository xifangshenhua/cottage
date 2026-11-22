import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getProvider } from "./index.js";
import { createDummyProvider } from "./dummy.js";
import { createDeepSeekProvider } from "./deepseek.js";

const options = [
  { action: "eat", room: "dining", priority: 2 },
  { action: "sit", room: "living", priority: 4 },
];
const character = { id: "qingqing", name: "青青", action: "sit", room: "living" };

describe("think provider selection", () => {
  it("uses the dummy provider even if DEEPSEEK_API_KEY is set, and does not touch the network", async () => {
    const previous = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "sk-test-should-not-be-used";
    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      fetchCalls.push(args[0]);
      throw new Error("network should not be used");
    };
    try {
      const provider = getProvider();
      assert.equal(provider.name, "dummy");
      const intent = await provider.complete({ options, character });
      assert.equal(intent.action, "eat");
      assert.equal(intent.speech, undefined);
      assert.equal(fetchCalls.length, 0);

      const deepseek = createDeepSeekProvider();
      assert.equal(deepseek.name, "deepseek");
      await assert.rejects(() => deepseek.complete({ options, character }), /not wired/);
      assert.equal(fetchCalls.length, 0);
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previous;
      if (originalFetch) globalThis.fetch = originalFetch;
      else delete globalThis.fetch;
    }
  });

  it("may propose speech only when tests ask it to", async () => {
    const silent = createDummyProvider();
    const quiet = await silent.complete({ options, character });
    assert.equal(quiet.speech, undefined);

    const talking = createDummyProvider({ speak: true });
    const spoken = await talking.complete({ options, character });
    assert.equal(spoken.action, "eat");
    assert.ok(spoken.speech?.line);
    assert.ok(spoken.speech?.reason);
  });
});
