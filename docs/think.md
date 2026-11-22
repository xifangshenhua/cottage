# 思考与主动开口

## 职责

在真实「现在」为到期的角色做至多一轮思考：组装上下文、请求文本模型、把合法动作写回生活层，并尝试主动对观众或同伴开口。随后记录记忆、结算关系和心情，必要时排队 TTS。

不补演停机漏掉的思考槽，不进入玩家对话主路径（对话复用同一套 provider 与部分解析约定，见 [chat.md](chat.md)）。不写盘（由 world 门面在 tick 末尾保存）。不管理密钥文件。

## 目录与入口

| 路径 | 作用 |
| --- | --- |
| [`../server/think/index.js`](../server/think/index.js) | `tickThink` |
| [`../server/think/config.js`](../server/think/config.js) | 间隔、错开、超时、字数上限 |
| [`../server/think/policy.js`](../server/think/policy.js) | `whoMayThink` |
| [`../server/think/context.js`](../server/think/context.js) | `assemble` |
| [`../server/think/prompt.js`](../server/think/prompt.js) | `buildPrompt` |
| [`../server/think/schema.js`](../server/think/schema.js) | ThinkIntent 形状说明 |
| [`../server/think/decide.js`](../server/think/decide.js) | `decide`：调用 provider 并在失败时回退 |
| [`../server/think/parse.js`](../server/think/parse.js) | 解析并校验模型输出 |
| [`../server/think/speech/`](../server/think/speech/) | 主动开口与同伴对话的门禁和落笔 |
| [`../server/think/provider/`](../server/think/provider/) | `getProvider`、`getProviderWithCredentials` |

主入口：`tickThink(world, { now, settings, memory, provider, fetch, allowLive, scheduleVoice })`。

## 对外接口

`whoMayThink` 跳过正在睡觉的角色；到期条件是 `lastThinkAt + interval`，首次思考则从 `world.startedAt` 加上按 id 排序的 `staggerMs`。同一轮只返回一个人（更早到期者优先）。

`tickThink` 对该角色：`propose` 合法生活选项 → 取身份卡、记忆包、关系摘要 → `assemble` / `buildPrompt` → `decide`。模型超时、抛错或输出不合法时，回退到生活层的 `pick`（只选动作，不开口）。若选出的动作或房间与当前不同，调用 `intent` 写入。开口再走 `applySpeech` 或 `applyNpcSpeech`；门禁失败只丢掉台词，不撤销已经写下的动作。

ThinkIntent 允许：`characterId`、`action`（必须是本次选项之一，省略表示保持当前动作）、`room`、`speech: { to, line, reason }`、可选短 `fact`。`speech.to` 为 `"viewer"` 或同伴 id。无效的 speech / fact 被丢弃，不连带着拒绝动作。

对观众开口和对同伴开口是两套门禁，数字在 `speech/config.js` 的顶层与 `npcTalk` 下。同伴台词默认仅当观众在同一房间时显示；无论是否显示，记忆都可以记下落地的句子。

对观众主动开口通常还要满足间隔、每日上限、安静时段，以及「自己在客厅且观众正在看」这类门禁；刚进客厅的窗口也在 `speech` 配置里。对同伴说话不要求观众在看，但会检查房间禁区、睡眠 / 洗漱、全屋每小时上限和口腔冷却等。具体条件以 `speech/gates.js` 为准，不要在决定层再抄一套。

同一 tick 里若有多人到期，只服务一个，其余人等到后续 tick。这与 `staggerMs` 一起，避免三个模型请求挤在同一拍。

文本 provider 约定：`{ name, complete({ prompt, context, ... }) }`。`getProvider({ name, model, fetch, allowLive, apiKey?, baseUrl? })` 在测试运行器中，若未给 `fetch` 或 `allowLive`，会拒绝出网并返回 dummy。`getProviderWithCredentials` 在调用时解析密钥；没有密钥时不要把空的 `apiKey` 放进参数对象。当前 `minimax` 会发聊天补全请求；`dummy` 按生活优先级静默选动作；`deepseek` 工厂存在但 `complete` 会抛出未接线错误。

## 数据与状态

写入角色的 `lastThinkAt`，以及开口成功时的 `line` / `lineTo` / `lineKind` / `lineAt`、主动开口或 `npcTalk` 计数。房屋级 `world.npcTalkMeta` 记录每小时同伴对话次数。可选 `fact` 交给记忆层，不会写回人设文件。

## 可配置项

`think`：间隔（可用 `intervalMin` 覆盖）、错开、超时、台词 / 理由 / 提示词长度。`speech`：能否主动开口、每日上限、最小间隔、安静时段、游戏日起点、刚进客厅窗口、观众离开超时，以及 `npcTalk`（开关、禁区房间、睡眠 / 洗漱 / 吃饭 / 安静时段能否说话、每日与每小时上限、冷却、是否仅同房可见等）。经 `resolveThink` / `resolveSpeech` 与房屋、人物设定合并。默认思考间隔约 10 分钟。不要在这些文件里放密钥。

## 调用关系

只由 `runTick` 在生活 catch-up 和关系 tick 之后调用。它调用生活的 `propose` / `intent`、记忆的 `loadForThink` / `recordAfterThink` / `recordNpcTalk`、关系与心情的 `applyEvent`、语音的 `scheduleVoice`。密钥经 [settings.md](settings.md) 在调用时解析。日记压缩不要复用这一次 think 的 provider 实例或工厂名，见 [memory.md](memory.md) 与 `resolveDiaryProvider`。

生活 catch-up 可以一次补很多步，思考始终只跟在后面跑一轮。若模型选了不在本次 `propose` 列表里的动作，`parse` 会整段拒绝并回退到 `pick`，不会部分采用非法动作。

## 扩展点

新增文本服务商：实现 `create*Provider`，在 [`../server/think/provider/index.js`](../server/think/provider/index.js) 按 `name` 分支，并保证测试可注入 `fetch` 或走 dummy。开口规则只改 `speech/config.js` 和 `gates.js`。不要在 parse 里发明生活层没有的动作。

## 不变量与禁区

- 每轮 tick 至多思考一个角色，且只针对真实 now
- 睡着的角色不思考
- 开口门禁失败不得回滚已写入的动作
- 空 `apiKey` 不进 provider 对象；密钥不进日志或提示词存档
- `fact` 不得改写人设文件
- 测试默认不出网

## 测试

- [`../server/think/index.test.js`](../server/think/index.test.js)、[`../server/think/npc-tick.test.js`](../server/think/npc-tick.test.js)
- [`../server/think/decide.test.js`](../server/think/decide.test.js)、[`../server/think/parse.test.js`](../server/think/parse.test.js)、[`../server/think/policy.test.js`](../server/think/policy.test.js)
- [`../server/think/speech/gates.test.js`](../server/think/speech/gates.test.js)、[`../server/think/speech/npc.test.js`](../server/think/speech/npc.test.js)
- [`../server/think/provider/dummy.test.js`](../server/think/provider/dummy.test.js)、[`../server/think/provider/minimax.test.js`](../server/think/provider/minimax.test.js)

用 dummy 或假 `fetch`，不打真实 MiniMax。

## 尚未实现

DeepSeek provider 尚未接线（`complete` 会抛错）。语音克隆、流式 TTS、唤醒睡着的角色都不在本模块。NPC 对 NPC 的第三方插话属于对话层，见 [chat.md](chat.md)。
