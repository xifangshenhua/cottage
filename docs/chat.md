# 玩家对话与插话

## 职责

处理你对屋子里的人说的话：按音量决定谁能听见、选出唯一的主回复者、请求模型、把台词写入世界，并给同场旁听者记一笔。主回复成功后，可能再对符合条件的旁听者做一轮插话判断。

不推进生活 catch-up，不经主动开口那套「对观众说话」门禁（除非打开 `countAgainstProactiveCap`）。插话失败不得撤销已经写下的主回复或记忆。NPC 对 NPC 谈话之后的第三方插话尚未做。

## 目录与入口

| 路径 | 作用 |
| --- | --- |
| [`../server/chat/index.js`](../server/chat/index.js) | `handleChat`、`listChatStyles` |
| [`../server/chat/config.js`](../server/chat/config.js) | 字数、超时、风格、寻址默认 |
| [`../server/chat/audience.js`](../server/chat/audience.js) | `resolveAudience` |
| [`../server/chat/policy.js`](../server/chat/policy.js) | `canChat` / `canHear` / `canReply`、`reasonText` |
| [`../server/chat/prompt.js`](../server/chat/prompt.js)、[`parse.js`](../server/chat/parse.js)、[`apply.js`](../server/chat/apply.js)、[`styles.js`](../server/chat/styles.js) | 提示词、解析、落笔、语气篇幅 |
| [`../server/chat/interject/`](../server/chat/interject/) | `maybeInterject` 及门禁、解析、落笔 |

主入口：`handleChat(world, { characterId, volume, text, style, now, memory, settings, provider, scheduleVoice, ... })`。HTTP 经 `world.chat` 串行调用。

## 对外接口

`POST /api/chat` 体：`{ characterId, text, volume?, style?: { tone, length } }`。`characterId` 可空，表示未点名。`GET /api/chat/styles?character=` 返回允许的语气、篇幅和音量列表。

音量登记在 `chat.addressing.volumes`：`whisper`（悄悄，必须有对象，只有对方听见）、`normal`（普通，同房）、`loud`（大声，全屋，受隔离房间配置约束）。缺省音量是寻址配置里的 `defaultVolume`。未点名时，按 `unaddressedPick`（默认亲近）和动作偏好在能回话的人里选一个主回复者。`maxResponders` 为 1。睡着的人默认不能回话，也不会被本模块唤醒；洗漱中默认不能回话。

主回复使用该角色的文本凭证（`getProviderWithCredentials(responder.id)`）。解析后的意图写入台词，并记 `world.lastChat`。随后对旁听者 `recordOverhear`，再调用 `maybeInterject`。成功时 `scheduleVoice` 会为主回复和已落地的插话排队。

返回经 world 门面补上公开状态，并带 `ok`、`reason`、`reasonCode`、`volume`、`targetId`、`responderId`、`hearerIds`、`interjectorIds`。失败码包括空输入、超长、忙、超时、provider 失败、无法听见或无法回话等，具体文案由 `reasonText` 给出。全屋锁默认开启（`HOUSE_CHAT_LOCK`），同一时间只处理一条对话。

`world.chat` 还有一层基于同一把锁的排队：锁被占用时立刻返回忙，不会把第二个请求送进模型。`handleChat` 自己也有 in-flight 集合，避免绕过门面时重入。解析出的回复若没有合法台词，不会写 `lastChat`，也不会开插话。

旁听写入与主回复是分开的：同房旁听者可以记下你的话和主回复；隔房的大声喊话只记下你的那句。关系事件 `overhear` 按旁听者计，不把他们当成第二回复者。

**插话。** `maybeInterject` 在主回复成功后运行。候选者必须是旁听者、能回话、默认同房，且未触达每日上限和最小间隔。悄悄话不插话。房屋每小时有场合上限；同一判断里多人开口只计一次场合。是否送去模型：`judgeUnaddressed` 为真时（默认）有候选就判断；为假时，仅当玩家点了名，或话语里提到在场者的名字才判断。插话批次走房屋模型与凭证，与 `resolveModel(null)` 一致，不使用某个角色的专属密钥。模型失败或解析为空时，跳过且不写插话记忆、关系或心情。

## 数据与状态

写入主回复者（及插话者）的 `line`、`lineTo`、`lineKind`（插话为 `"interject"`）、`lineAt`。`world.lastChat` 保存最近一次对你说的主回复。插话计数在 `world.interjectMeta` 和角色的 `interjectMeta` 上。记忆写入见 [memory.md](memory.md)。本模块不建表。

## 可配置项

`house.chat` 与人物 `chat`：输入 / 回复字数、超时、提示词与风格说明上限、睡觉或洗漱时能否说话、默认语气和篇幅及白名单。`chat.addressing` 只能全屋覆盖，人物不能改谁听得见。`chat.interject`：开关、每人每日上限、间隔、全屋每小时场合、每条消息最多几人、是否仅同房、是否判断未点名发言、插话字数和超时。默认值和校验看 `config.js`、`interject/config.js` 或设置页的「对话」「插话」。

## 调用关系

只经 `world.chat` 进入。复用思考层的文本 provider。记忆、关系（`playerChat` / `overhear` / `interject`）、心情、语音由本模块在成功路径上调用。不要从插话里再开一轮玩家对话，也不要穿越门面直接改生活状态。

风格由 `mergeStyle` 合并房屋默认、人物覆盖和请求里的 `tone` / `length`，未知值回退到允许列表中的默认。未点名发言时，风格按房屋默认再叠请求，而不是先假定某一个人的口吻。

提示词会带上身份卡、对话检索包、关系摘要、当前听众说明和玩家原文，总长度受 `maxPromptChars` 限制。模型只需返回一句对你说的话（以及可选的短 fact / topic），不必再选生活动作。

如果主回复已经写下，即使插话 provider 超时，HTTP 仍返回 `ok: true`，`interjectorIds` 为空。

## 扩展点

新的音量或风格维度登记在 `config.js` 的 volumes / tones / lengths，并在 `styles.js` 与设置目录同步。插话策略改 `interject/config.js` 和 `gates.js`。provider 扩展走 [think.md](think.md) 的工厂，不必在 chat 里另做一套。

## 不变量与禁区

- 对话与 tick 串行；忙时拒绝而不是并行
- 插话不得回滚主回复或已写记忆
- 密钥不进提示词存档、日志或 API 回显
- 寻址规则是房屋级的，人物设定改不了
- 不要唤醒睡着的角色
- 默认不把玩家对话计入主动开口每日配额

## 测试

- [`../server/chat/index.test.js`](../server/chat/index.test.js)、[`audience.test.js`](../server/chat/audience.test.js)、[`policy.test.js`](../server/chat/policy.test.js)、[`styles.test.js`](../server/chat/styles.test.js)
- [`../server/chat/interject/index.test.js`](../server/chat/interject/index.test.js)、[`gates.test.js`](../server/chat/interject/gates.test.js)、[`parse.test.js`](../server/chat/interject/parse.test.js)

注入 dummy 或假 `fetch`，不打真实 MiniMax。测试之间可调用 `resetChatLocks()`。

构造测试世界时请注入 memory 和 provider，不要依赖真实密钥或网络。

## 尚未实现

NPC 对 NPC 的第三方插话。唤醒睡着的角色。流式回复与 barge-in 也不在本模块。
