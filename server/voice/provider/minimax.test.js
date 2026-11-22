import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMinimaxVoiceProvider } from "./minimax.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

describe("MiniMax voice provider", () => {
  it("does not call the network or mention the key when no API key is configured", async () => {
    const calls = [];
    const provider = createMinimaxVoiceProvider({
      apiKey: "",
      fetch: (...args) => {
        calls.push(args);
        return jsonResponse({});
      },
    });
    assert.equal(provider.available, false);
    const synth = await provider.synthesize({ text: "你好" });
    const asr = await provider.transcribe({ buffer: Buffer.from("abc"), mime: "audio/webm" });
    assert.equal(synth.ok, false);
    assert.equal(asr.ok, false);
    assert.equal(calls.length, 0);
    assert.equal(JSON.stringify(synth).includes("apiKey"), false);
    assert.equal(JSON.stringify(asr).includes("MINIMAX"), false);
  });

  it("decodes hex audio from t2a_v2 and treats a non-zero status as failure", async () => {
    const calls = [];
    const hex = Buffer.from("ID3ok").toString("hex");
    const provider = createMinimaxVoiceProvider({
      apiKey: "test-key-not-real",
      fetch: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({
          base_resp: { status_code: 0, status_msg: "success" },
          data: { audio: hex },
          extra_info: { audio_length: 320 },
        });
      },
    });
    const ok = await provider.synthesize({
      text: "你好",
      model: "speech-2.8-turbo",
      voiceId: "danya_xuejie",
      speed: 1,
      vol: 1,
      pitch: 0,
      format: "mp3",
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.audio.toString(), "ID3ok");
    assert.equal(ok.durationMs, 320);
    assert.equal(calls[0].url.endsWith("/t2a_v2"), true);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.stream, false);
    assert.equal(body.voice_setting.voice_id, "danya_xuejie");
    assert.equal(JSON.stringify(body).includes("test-key-not-real"), false);

    const failing = createMinimaxVoiceProvider({
      apiKey: "test-key-not-real",
      fetch: async () => jsonResponse({ base_resp: { status_code: 1001, status_msg: "bad" } }),
    });
    const failed = await failing.synthesize({ text: "你好" });
    assert.equal(failed.ok, false);
    assert.equal(JSON.stringify(failed).includes("test-key-not-real"), false);
  });

  it("returns recognized text from speech_to_text and fails closed on a bad payload", async () => {
    const provider = createMinimaxVoiceProvider({
      apiKey: "test-key-not-real",
      fetch: async () => jsonResponse({ base_resp: { status_code: 0 }, text: "  今天天气不错。  " }),
    });
    const ok = await provider.transcribe({ buffer: Buffer.from("abc"), mime: "audio/webm;codecs=opus" });
    assert.equal(ok.ok, true);
    assert.equal(ok.text, "今天天气不错。");

    const bad = createMinimaxVoiceProvider({
      apiKey: "test-key-not-real",
      fetch: async () => jsonResponse({ base_resp: { status_code: 2013 } }),
    });
    const failed = await bad.transcribe({ buffer: Buffer.from("abc") });
    assert.equal(failed.ok, false);
  });
});
