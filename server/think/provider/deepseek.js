/**
 * Scaffold only. Reads the key from the environment for a later pass,
 * but does not send HTTP and is not the default provider.
 * Never log or write the API key.
 */
export function createDeepSeekProvider(opts = {}) {
  const apiKey = opts.apiKey ?? process.env.DEEPSEEK_API_KEY;
  void apiKey;
  return {
    name: "deepseek",
    async complete() {
      throw new Error("DeepSeek provider is not wired yet");
    },
  };
}
