import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDummyProvider } from "./provider/dummy.js";
import { createVoiceService } from "./index.js";
import { handleVoiceRequest } from "./http.js";

const temps = [];
const servers = [];

after(async () => {
  for (const server of servers) {
    await new Promise((resolve) => server.close(() => resolve()));
  }
  for (const dir of temps) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "house-voice-http-"));
  temps.push(dir);
  return dir;
}

function listen(voice) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (await handleVoiceRequest(req, res, url, voice)) return;
    res.writeHead(404).end();
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe("voice http", () => {
  it("serves a ready clip as audio/mpeg and returns 404 for an unknown id", async () => {
    const voice = createVoiceService({
      dataDir: tempDir(),
      settings: { house: { voice: { enabled: true } }, characters: { qingqing: { voice: {} } } },
      provider: createDummyProvider({ audio: Buffer.from("ID3test") }),
    });
    const clip = voice.scheduleVoice({
      characterId: "qingqing",
      text: "你好呀。",
      lineTo: "viewer",
      volume: "normal",
      room: "living",
    });
    await voice.idle();
    const base = await listen(voice);
    const ok = await fetch(`${base}${clip.url}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "audio/mpeg");
    const bytes = Buffer.from(await ok.arrayBuffer());
    assert.equal(bytes.toString(), "ID3test");
    const missing = await fetch(`${base}/api/voice/clips/deadbeefdeadbeef`);
    assert.equal(missing.status, 404);
  });

  it("transcribes a multipart upload and does not leak secrets on failure", async () => {
    const voice = createVoiceService({
      dataDir: tempDir(),
      settings: { house: { voice: { micEnabled: true, enabled: true } }, characters: {} },
      provider: createDummyProvider({ text: "今天下雨了。" }),
    });
    const base = await listen(voice);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), "clip.webm");
    const res = await fetch(`${base}/api/voice/transcribe`, { method: "POST", body: form });
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.text, "今天下雨了。");

    const failing = createVoiceService({
      dataDir: tempDir(),
      settings: { house: { voice: { micEnabled: true } }, characters: {} },
      provider: createDummyProvider({ failTranscribe: true }),
    });
    const base2 = await listen(failing);
    const res2 = await fetch(`${base2}/api/voice/transcribe`, { method: "POST", body: form });
    const body2 = await res2.json();
    assert.equal(body2.ok, false);
    assert.equal(JSON.stringify(body2).includes("apiKey"), false);
    assert.equal(JSON.stringify(body2).includes("MINIMAX"), false);
  });
});
