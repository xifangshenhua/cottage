import { config as defaultConfig } from "./config.js";
import { chatIntentDescription } from "./schema.js";
import { styleInstructions } from "./styles.js";

/** Build a compact chat prompt. No I/O. Does not include full transcripts. */
export function buildPrompt({
  character,
  clock,
  viewer,
  identityCard,
  memorySummary,
  relationSummary,
  style,
  text,
  audience,
  cfg = defaultConfig,
} = {}) {
  const lines = [
    "你是房屋里的一个角色，正在回应屋子里的人刚才说的话。请用符合人设的方式回答这一句。",
    "只返回一个 JSON 对象，不要附加其它文字。不要编造离开当前房间或开始睡觉、吃饭、洗漱的动作。",
    `格式：${chatIntentDescription}`,
  ];
  if (identityCard) lines.push(`身份：${identityCard}`);
  if (memorySummary) {
    lines.push("记忆：", memorySummary);
  }
  if (relationSummary) {
    lines.push(`关系：${relationSummary}`);
  }
  const styleText = styleInstructions(style, cfg);
  if (styleText) lines.push(`风格：${styleText}`);
  const audienceText = describeAudience(audience, character, cfg);
  if (audienceText) lines.push(audienceText);
  lines.push(
    `时间：${clock?.hhmm ?? "?"}（${clock?.timezone ?? "Asia/Shanghai"}）`,
    `房间：${character?.room ?? viewer?.room ?? "未知"}，动作：${character?.action ?? "none"}`,
    `角色：${character?.name ?? character?.id}（id=${character?.id}）`,
    `她对你说：${text ?? ""}`,
  );

  const prompt = lines.join("\n");
  const cap = Number(cfg.maxPromptChars);
  if (!Number.isFinite(cap) || cap <= 0 || prompt.length <= cap) return prompt;
  return prompt.slice(0, cap);
}

/** Volume / addressee / other hearers, capped by addressing.contextChars. */
export function describeAudience(audience, character, cfg = defaultConfig) {
  if (!audience?.volume) return "";
  const volume = audience.volume;
  const parts = [];
  parts.push(`音量：${volume.label || volume.id}。`);
  if (audience.targetId && audience.targetId === character?.id) {
    parts.push("她点名对你说。");
  } else if (audience.targetId) {
    parts.push("她点了别人的名，由你来接这一句。");
  } else {
    parts.push("她没有点名，由你来接这一句。");
  }
  const others = (audience.overhearers || []).map((item) => item.name || item.id).filter(Boolean);
  if (others.length) parts.push(`还有${others.join("、")}听见了。`);
  else parts.push("只有你听见。");
  parts.push("你是唯一接话的人，不要代别人说话。");
  const text = parts.join("");
  const cap = Number(cfg.addressing?.contextChars);
  if (!Number.isFinite(cap) || cap <= 0 || text.length <= cap) return text;
  return text.slice(0, cap);
}
