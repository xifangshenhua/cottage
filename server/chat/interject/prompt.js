import { config as defaultConfig } from "./config.js";

const TONE_LABELS = {
  natural: "自然",
  gentle: "温柔",
  concise: "简洁",
  lively: "活泼",
};

/** Short combined judge+lines prompt. No I/O. Does not include full transcripts. */
export function buildPrompt({
  text,
  audience,
  responder,
  primaryLine,
  candidates,
  tones,
  cfg = defaultConfig,
} = {}) {
  const volume = audience?.volume;
  const targetId = audience?.targetId || "";
  const target = targetId
    ? (audience?.hearers || []).find((item) => item.id === targetId)
      ?? (targetId === responder?.id ? responder : null)
    : null;
  const targetName = target?.name || targetId || "";
  const addressed = targetId
    ? `有，指定了${targetName || targetId}`
    : "无，没有点名";

  const lines = [
    "你在判断：屋子里刚有人对在场的人说了一句话，已经有人主回复了。现在请根据这句话的意思，决定其他在场的人要不要插话，以及各自说什么。",
    "只返回一个 JSON 对象，不要附加其它文字。不要编造不在候选人名单里的人。不必插话时返回空列表。",
    "格式：{\"interjections\":[{\"characterId\":\"id\",\"reason\":\"短理由\",\"line\":\"插话正文\"}]}",
    "根据这句话的意思判断：是在问在场的人、问「你们／有人」，还是只在对某一个人说话。若明显只问一个人，其他人应保持安静；若问题显然包括在场的人，他们可以回话。被点名的人优先，但最终仍看句子意思，不要靠关键词表。每人一句话，简短自然，符合各自语气和当前状态。",
    `她说的原文：${text ?? ""}`,
    `指定对象：${addressed}。音量：${volume?.label || volume?.id || "普通"}。`,
    `主回复：${responder?.name || responder?.id || "有人"}说：「${primaryLine ?? ""}」`,
    "候选人：",
    ...describeCandidates(candidates, tones),
    `每句最多${Number(cfg.maxReplyChars) || defaultConfig.maxReplyChars}字，最多返回${Number(cfg.maxPerMessage) || defaultConfig.maxPerMessage}人。`,
  ];

  const prompt = lines.join("\n");
  const cap = Number(cfg.maxPromptChars);
  if (!Number.isFinite(cap) || cap <= 0 || prompt.length <= cap) return prompt;
  return prompt.slice(0, cap);
}

function describeCandidates(candidates, tones = {}) {
  if (!candidates?.length) return ["（无）"];
  return candidates.map((character) => {
    const stats = character.stats || {};
    const toneId = tones[character.id];
    const tone = TONE_LABELS[toneId] || toneId || "";
    const bits = [
      `${character.name || character.id}（id=${character.id}）`,
      `动作：${character.action ?? "none"}`,
      formatStat("饱食", stats.hunger),
      formatStat("精力", stats.energy),
      formatStat("心情", stats.mood),
    ];
    if (tone) bits.push(`语气：${tone}`);
    return `- ${bits.filter(Boolean).join("，")}`;
  });
}

function formatStat(label, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${label} ${Math.round(n)}`;
}

export { TONE_LABELS };
