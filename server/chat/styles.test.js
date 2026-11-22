import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { config } from "./config.js";
import { describeStyles, mergeStyle, styleInstructions } from "./styles.js";

describe("chat style merge", () => {
  it("lets a requested tone win when it is on the allowed list", () => {
    const cfg = {
      ...config,
      defaultTone: "gentle",
      allowedTones: ["natural", "gentle", "concise"],
      defaultLength: "short",
      allowedLengths: ["short", "medium"],
    };
    const merged = mergeStyle(cfg, { tone: "concise", length: "medium" });
    assert.equal(merged.tone, "concise");
    assert.equal(merged.length, "medium");
  });

  it("clamps a disallowed requested tone to the character default", () => {
    const cfg = {
      ...config,
      defaultTone: "gentle",
      allowedTones: ["natural", "gentle", "concise"],
      defaultLength: "short",
      allowedLengths: ["short", "medium"],
    };
    const merged = mergeStyle(cfg, { tone: "lively", length: "epic" });
    assert.equal(merged.tone, "gentle");
    assert.equal(merged.length, "short");
  });

  it("keeps style instructions under the configured budget", () => {
    const merged = mergeStyle(config, { tone: "gentle", length: "short" });
    const text = styleInstructions(merged, { ...config, styleInstructionsChars: 40 });
    assert.ok(text.length <= 40);
    assert.ok(text.length > 0);
  });

  it("describes dimensions with zh-CN labels for the UI", () => {
    const described = describeStyles({
      ...config,
      defaultTone: "gentle",
      allowedTones: ["natural", "gentle"],
    }, { characterId: "qingqing" });
    assert.equal(described.characterId, "qingqing");
    const tone = described.dimensions.find((d) => d.id === "tone");
    assert.equal(tone.label, "语气");
    assert.equal(tone.default, "gentle");
    assert.deepEqual(tone.allowed.map((o) => o.id), ["natural", "gentle"]);
    assert.ok(tone.allowed.every((o) => typeof o.label === "string" && o.label.length > 0));
  });
});
