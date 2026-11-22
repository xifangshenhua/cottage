import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getProvider } from "./index.js";
import { createMinimaxProvider } from "./minimax.js";

const options = [
  { action: "eat", room: "dining", priority: 2 },
  { action: "sit", room: "living", priority: 4 },
];
const character = { id: "qingqing", name: "青青", action: "sit", room: "living" };
const prompt = '{"characterId":"qingqing","action":"sit"}';

describe("minimax provider", () => {
  it("stays on dummy by default even if MINIMAX_API_KEY is set", async () => {
    const previousKey = process.env.MINIMAX_API_KEY;
    const previousProvider = process.env.THINK_PROVIDER;
    const fetchCalls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      fetchCalls.push(args[0]);
      throw new Error("network should not be used");
    };
    process.env.MINIMAX_API_KEY = "sk-test-should-not-be-used";
    delete process.env.THINK_PROVIDER;
    try {
      const provider = getProvider();
      assert.equal(provider.name, "dummy");
      await provider.complete({ options, character });
      assert.equal(fetchCalls.length, 0);
    } finally {
      restoreEnv("MINIMAX_API_KEY", previousKey);
      restoreEnv("THINK_PROVIDER", previousProvider);
      restoreFetch(originalFetch);
    }
  });

  it("uses MiniMax when THINK_PROVIDER=minimax and extracts message content", async () => {
    const previousProvider = process.env.THINK_PROVIDER;
    const calls = [];
    const fetchFn = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        choices: [{ message: { content: '{"characterId":"qingqing","action":"sit","room":"living"}' } }],
      });
    };
    process.env.THINK_PROVIDER = "minimax";
    try {
      const provider = getProvider({ apiKey: "sk-test-fake", fetch: fetchFn });
      assert.equal(provider.name, "minimax");
      const raw = await provider.complete({ prompt, options, character });
      assert.match(raw, /"action":"sit"/);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "https://api.minimax.cn/v1/chat/completions");
      assert.equal(calls[0].init.method, "POST");
      assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test-fake");
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.model, "MiniMax-M3.1-Flash");
      assert.equal(body.stream, false);
      assert.equal(body.reasoning_effort, "low");
      assert.equal(body.messages[1].content, prompt);
    } finally {
      restoreEnv("THINK_PROVIDER", previousProvider);
    }
  });

  it("throws a status error that does not include the api key", async () => {
    const fetchFn = async () => new Response("denied", { status: 401 });
    const provider = createMinimaxProvider({ apiKey: "sk-secret-value", fetch: fetchFn });
    await assert.rejects(async () => {
      try {
        await provider.complete({ prompt });
      } catch (err) {
        assert.equal(err.message, "minimax-http-401");
        assert.equal(String(err).includes("sk-secret-value"), false);
        throw err;
      }
    }, /minimax-http-401/);
  });

  it("throws when the key is missing, and when the model returns no content", async () => {
    const missing = createMinimaxProvider({ apiKey: "", fetch: async () => jsonResponse({}) });
    await assert.rejects(() => missing.complete({ prompt }), /missing-minimax-key/);

    const empty = createMinimaxProvider({
      apiKey: "sk-test-fake",
      fetch: async () => jsonResponse({ choices: [{ message: { content: "" } }] }),
    });
    await assert.rejects(() => empty.complete({ prompt }), /minimax-empty/);
  });
});

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function restoreEnv(name, previous) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

function restoreFetch(originalFetch) {
  if (originalFetch) globalThis.fetch = originalFetch;
  else delete globalThis.fetch;
}
