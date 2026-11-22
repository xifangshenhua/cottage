/**
 * MiniMax China (platform.minimax.cn) chat-completions provider.
 * Auth is Bearer API key only; v2 / OpenAI-compatible path needs no GroupId.
 * Never log or write the API key.
 */
const DEFAULT_BASE_URL = "https://api.minimax.cn/v1";
const DEFAULT_MODEL = "MiniMax-M3.1-Flash";

export function createMinimaxProvider(opts = {}) {
  const apiKey = opts.apiKey ?? process.env.MINIMAX_API_KEY;
  const baseUrl = normalizeBaseUrl(opts.baseUrl ?? process.env.MINIMAX_BASE_URL ?? DEFAULT_BASE_URL);
  const model = opts.model ?? process.env.MINIMAX_MODEL ?? DEFAULT_MODEL;
  const fetchFn = opts.fetch ?? globalThis.fetch;

  return {
    name: "minimax",
    async complete({ prompt } = {}) {
      if (!apiKey) throw new Error("missing-minimax-key");
      if (typeof fetchFn !== "function") throw new Error("missing-fetch");

      const res = await fetchFn(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          stream: false,
          temperature: 0.7,
          max_tokens: 400,
          max_completion_tokens: 400,
          reasoning_effort: "low",
          messages: [
            { role: "system", content: "只返回一个 JSON 对象，不要附加其它文字。" },
            { role: "user", content: prompt ?? "" },
          ],
        }),
      });

      if (!res.ok) {
        throw new Error(`minimax-http-${res.status}`);
      }

      const data = await res.json();
      const message = data?.choices?.[0]?.message ?? {};
      const content = firstText(message.content) || firstText(message.reasoning_content);
      if (!content) throw new Error("minimax-empty");
      return content;
    },
  };
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).trim().replace(/\/$/, "");
}

function firstText(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const part of value) {
      if (typeof part === "string" && part.trim()) return part.trim();
      if (part && typeof part.text === "string" && part.text.trim()) return part.text.trim();
    }
  }
  return "";
}
