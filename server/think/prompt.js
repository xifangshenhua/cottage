import { config as defaultConfig } from "./config.js";
import { thinkIntentDescription } from "./schema.js";

const ACTION_LABEL = {
  sit: "坐着",
  talk: "说话",
  eat: "吃饭",
  sleep: "睡觉",
  wash: "洗漱",
};

/** Build prompt text from a compact context. No I/O. */
export function buildPrompt(context, cfg = defaultConfig) {
  const character = context?.character ?? {};
  const clock = context?.clock ?? {};
  const viewer = context?.viewer ?? {};
  const options = context?.options ?? [];
  const optionLines = options.length
    ? options.map((o) => `- ${o.action} @ ${o.room}`).join("\n")
    : "- (none; keep the current action)";

  const lines = [
    "你是房屋里的一个角色，正在决定下一步做什么。只能从合法选项里选，不要发明新动作。",
    "通常保持沉默。若要开口，必须给出具体理由，不要闲聊刷屏，并且可能仍会被规则拦住。",
    "对同伴说话不需要观众在看；对观众说话仍须自己在客厅、且对方正在看。",
    "只返回一个 JSON 对象，不要附加其它文字。",
    `格式：${thinkIntentDescription}`,
  ];
  if (context?.identityCard) {
    lines.push(`身份：${context.identityCard}`);
  }
  if (context?.memorySummary) {
    lines.push("记忆：", context.memorySummary);
  }
  if (context?.relationSummary) {
    lines.push(`关系：${context.relationSummary}`);
  }
  lines.push(
    `时间：${clock.hhmm ?? "?"}（${clock.timezone ?? "Asia/Shanghai"}）`,
    `观众：${viewer.present ? "在看" : "不在"}，房间 ${viewer.room ?? "未知"}`,
    `角色：${character.name ?? character.id}（id=${character.id}）`,
    `当前位置：${character.room}，动作：${character.action ?? "none"}`,
    `数值：精力${character.stats?.energy} 饱食${character.stats?.hunger} 清洁${character.stats?.clean} 心情${character.stats?.mood}`,
    roommateLine(context),
    legalTargetLine(context),
    "对观众说话时 to 写 viewer（仍走客厅门禁）；对同伴说话时 to 写对方 id。",
    "合法选项：",
    optionLines,
  );
  if (context?.recentRoommateLine) {
    const recent = context.recentRoommateLine;
    lines.splice(lines.indexOf(roommateLine(context)) + 1, 0, `最近同伴的话：${recent.name}：「${recent.line}」`);
  }

  const text = lines.join("\n");
  if (text.length <= cfg.maxPromptChars) return text;
  return text.slice(0, cfg.maxPromptChars);
}

function roommateLine(context) {
  const roommates = context?.roommates ?? [];
  if (!roommates.length) return "同屋：没有其他人";
  const bits = roommates.map((other) => {
    const action = ACTION_LABEL[other.action] || other.action || "在";
    return `${other.name || other.id}（id=${other.id}，${action}）`;
  });
  return `同屋：${bits.join("，")}`;
}

function legalTargetLine(context) {
  const targets = context?.legalSpeechTargets ?? [];
  if (!targets.length) return "合法同伴对象：无";
  const bits = targets.map((other) => `${other.name || other.id}（id=${other.id}）`);
  return `合法同伴对象：${bits.join("，")}`;
}
