import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cacheKey, createVoiceCache } from "./cache.js";

const temps = [];
after(() => {
  for (const dir of temps) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "house-voice-cache-"));
  temps.push(dir);
  return dir;
}

const base = {
  model: "speech-2.8-turbo",
  voiceId: "danya_xuejie",
  speed: 1,
  vol: 1,
  pitch: 0,
  format: "mp3",
  text: "你好。",
};

describe("voice cache", () => {
  it("uses the same key for the same model, voice, speed, volume, pitch, format, and text", () => {
    const a = cacheKey(base);
    const b = cacheKey({ ...base });
    const other = cacheKey({ ...base, text: "再见。" });
    assert.equal(a, b);
    assert.notEqual(a, other);
    assert.match(a, /^[a-f0-9]{64}$/);
  });

  it("returns a cached clip on hit and evicts the least recently used when over the file or byte limit", () => {
    const cache = createVoiceCache({ dir: tempDir(), maxFiles: 2, maxBytes: 30 });
    cache.put(cacheKey({ ...base, text: "一" }), Buffer.from("aaaa"));
    cache.put(cacheKey({ ...base, text: "二" }), Buffer.from("bbbb"));
    const firstKey = cacheKey({ ...base, text: "一" });
    assert.ok(cache.get(firstKey));
    cache.put(cacheKey({ ...base, text: "三" }), Buffer.from("cccc"));
    assert.ok(cache.get(firstKey), "recently used key should be kept");
    assert.equal(cache.get(cacheKey({ ...base, text: "二" })), null);
    assert.ok(cache.get(cacheKey({ ...base, text: "三" })));
    assert.equal(cache.size().files, 2);

    const tight = createVoiceCache({ dir: tempDir(), maxFiles: 10, maxBytes: 6 });
    tight.put("a", Buffer.from("1234"));
    tight.put("b", Buffer.from("1234"));
    assert.equal(tight.get("a"), null);
    assert.ok(tight.get("b"));
    assert.ok(tight.size().bytes <= 6);
  });
});
