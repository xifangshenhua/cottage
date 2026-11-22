import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./parse.js";

const character = { id: "qingqing", action: "sit", room: "living" };
const options = [
  { action: "eat", room: "dining", priority: 2 },
  { action: "sit", room: "living", priority: 4 },
];

describe("parse ThinkIntent", () => {
  it("rejects an action that is not in the legal options", () => {
    const result = parse(
      { characterId: "qingqing", action: "wash", room: "bathroom" },
      { character, options },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "illegal-action");
  });

  it("rejects a legal action name with a room that does not match the option", () => {
    const result = parse(
      { characterId: "qingqing", action: "eat", room: "living" },
      { character, options },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "illegal-action");
  });

  it("accepts a legal option and keeps a short fact for memory", () => {
    const result = parse(
      { characterId: "qingqing", action: "eat", room: "dining", fact: "喜欢热茶" },
      { character, options },
    );
    assert.equal(result.ok, true);
    assert.equal(result.intent.action, "eat");
    assert.equal(result.intent.room, "dining");
    assert.equal(result.intent.fact.text, "喜欢热茶");
  });

  it("drops an empty fact without rejecting the action", () => {
    const result = parse(
      { characterId: "qingqing", action: "sit", room: "living", fact: "   " },
      { character, options },
    );
    assert.equal(result.ok, true);
    assert.equal("fact" in result.intent, false);
  });

  it("treats an omitted action as keep-current", () => {
    const result = parse({ characterId: "qingqing" }, { character, options });
    assert.equal(result.ok, true);
    assert.equal(result.intent.action, "sit");
    assert.equal(result.intent.room, "living");
  });

  it("parses a JSON string and drops malformed speech without rejecting the action", () => {
    const result = parse(
      JSON.stringify({ characterId: "qingqing", action: "sit", room: "living", speech: { line: "嗨" } }),
      { character, options },
    );
    assert.equal(result.ok, true);
    assert.equal(result.intent.action, "sit");
    assert.equal(result.intent.speech, undefined);
  });

  it("rejects unparsable JSON", () => {
    const result = parse("{not json", { character, options });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid-json");
  });
});
