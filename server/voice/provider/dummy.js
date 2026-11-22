/**
 * Offline voice provider. Never calls the network.
 * Tests inject behavior via opts.synthesize / opts.transcribe.
 */

const SILENT_MP3 = Buffer.from("dummy-mp3");

export function createDummyProvider(opts = {}) {
  const calls = opts.calls ?? [];
  return {
    name: "dummy",
    available: opts.available !== false,
    async synthesize(input = {}) {
      calls.push({ kind: "synthesize", input });
      if (typeof opts.synthesize === "function") return opts.synthesize(input);
      if (opts.failSynthesize) return { ok: false, error: opts.failSynthesize === true ? "synth-failed" : String(opts.failSynthesize) };
      return { ok: true, audio: opts.audio ?? SILENT_MP3, durationMs: opts.durationMs ?? 400 };
    },
    async transcribe(input = {}) {
      calls.push({ kind: "transcribe", input });
      if (typeof opts.transcribe === "function") return opts.transcribe(input);
      if (opts.failTranscribe) return { ok: false, error: opts.failTranscribe === true ? "asr-failed" : String(opts.failTranscribe) };
      const text = opts.text ?? "你好。";
      return { ok: true, text };
    },
  };
}
