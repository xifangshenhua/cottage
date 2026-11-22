# 记忆与日记

## 职责

为每个角色保存工作记忆、事实、话题、事件和日记，并在思考 / 对话时提供有预算的检索包。游戏日切到下一天后，把刚结束的那一天落成正式日记，再按规则或模型做压缩升级。浏览和导出是只读的。

不在聊天或思考的热路径上调用模型。不改人设文件，不改关系分，不写 `world.json`。HTTP 层不写日记表，也不改 `lastDiaryGameDay`。

## 目录与入口

| 路径 | 作用 |
| --- | --- |
| [`../server/memory/index.js`](../server/memory/index.js) | `createMemory` 门面 |
| [`../server/memory/config.js`](../server/memory/config.js) | 容量、检索预算、压缩开关 |
| [`../server/memory/db.js`](../server/memory/db.js) | 打开 SQLite、建表 |
| [`../server/memory/retrieve.js`](../server/memory/retrieve.js) | 检索包 |
| [`../server/memory/working.js`](../server/memory/working.js)、[`messages.js`](../server/memory/messages.js)、[`facts.js`](../server/memory/facts.js)、[`topics.js`](../server/memory/topics.js)、[`episodes.js`](../server/memory/episodes.js) | 各类写入与裁剪 |
| [`../server/memory/diaries.js`](../server/memory/diaries.js)、[`period.js`](../server/memory/period.js) | 日 / 周 / 月日记与周期键 |
| [`../server/memory/compress.js`](../server/memory/compress.js)、[`upgrade.js`](../server/memory/upgrade.js) | 规则底稿与模型升级任务 |
| [`../server/memory/browse.js`](../server/memory/browse.js)、[`export.js`](../server/memory/export.js)、[`http.js`](../server/memory/http.js) | 浏览与导出 |

主入口：`createMemory({ dbPath, settings, db, config })`。世界门面默认打开 `data/memory.sqlite`。

## 对外接口

门面方法：

- `loadForThink` / `loadForChat`：按情景选包（闲置 / 有人在看或刚说过话 / 对话），返回有字数上限的短摘要，不含完整逐字稿
- `recordAfterThink`、`recordChat`、`recordOverhear`、`recordNpcTalk`、`recordInterject`：写入消息和工作记忆；聊天与思考可附带已校验的 `fact` / `topic`；旁听和插话不再跑模型
- `tickDiary(world, { now, provider, getProvider })`：若游戏日已切换，为每个角色写昨天的正式日记并滚动周 / 月底稿，再至多跑一个压缩任务
- `browseCharacter`、`exportCharacter`、`exportAll`、`reloadConfig`、`close`

`runTick` 里的日记 provider 必须走 [`../server/world.js`](../server/world.js) 的 `resolveDiaryProvider`：有测试注入的 `provider` 时用它；否则先看 `memory.config.model`，再按 `purpose: "compress"` 解析密钥。不要把本轮思考用的 `getProvider` 名字或实例直接当成日记工厂。

HTTP：

- `GET /api/memory/browse?character=<id>`：返回该角色的今日草稿、已落定日记、事实和话题。今日草稿是现算的，不写入日记表
- `GET /api/memory/export?character=<id|all>&format=md|json`：附件下载。`format` 缺省为 `md`。不接受其它格式

角色 id 必须是已知人物（内置三人，或当前世界里存在的对应 id）；导出可用 `all`。

## 数据与状态

SQLite 表（见 `db.js` 的 `SCHEMA`）：`messages`、`facts`、`topics`、`working`、`episodes`、`diaries`、`meta`。压缩任务状态记在 `meta` 里（按角色和日键），不是单独一张业务表。可能用 WAL。默认库路径 `data/memory.sqlite`。

消息 `kind` 包括 `chat`、`think`、`speech`、`overhear`、`npc`、`interject` 等。日记有规则底稿和模型整理两种来源；已用模型升级的周 / 月日记不会被规则底稿覆盖。`meta.lastDiaryGameDay` 记录日记模块认定的当前游戏日；第一次 tick 若还没有这个键，只记下当天并返回空，所以刚启动或仍在同一天时，正式日记可能是空的。

## 可配置项

经 `resolveMemory` 合并 `house.memory`。可调组包括：工作记忆与事实 / 话题容量、日记篇幅、消息和事件保留、各类检索包的字数和条数、闲置 / 互动 / 对话各带几天日记、是否带周月、压缩总开关、日 / 周 / 月是否用模型、安静日策略、每日每角色和全屋的模型任务上限、错开与超时，以及可选的 `memory.model`（只含服务商和模型名）。游戏日分界默认用 `diaryAtHhmm`（与作息起点一致时通常是 07:00）。默认值和校验看 `config.js` 或设置页的「记忆」与「记忆容量与保留」。

## 调用关系

`createWorld` 持有 memory 实例；`reloadSettings` 会 `reloadConfig`。思考和对话只调用 load / record。`runTick` 在思考之后调用 `tickDiary`。HTTP 只读。压缩任务使用独立的日记凭证链，见 [settings.md](settings.md)。

## 扩展点

检索包的情景和预算在 `config.packs` 与字数键里调。新的消息种类需要同时改写入、检索和裁剪。模型压缩的提示词与解析在 `compress.js`；任务调度在 `upgrade.js`。不要在热路径上新加模型调用。

## 不变量与禁区

- 检索包必须有硬字数上限，不得把完整逐字稿送给模型
- 日记压缩优先 `memory.config.model` 再解析密钥；失败时保留规则底稿
- 密钥不得写入数据库、导出文件或浏览接口
- 浏览 / 导出不得写日记表
- 培养只改记忆内容，不改人设文件
- 不要删除 `data/memory.sqlite` 除非有意忘记过去

## 测试

- [`../server/memory/index.test.js`](../server/memory/index.test.js)
- [`../server/memory/browse.test.js`](../server/memory/browse.test.js)、[`http.test.js`](../server/memory/http.test.js)
- [`../server/memory/compress.test.js`](../server/memory/compress.test.js)、[`diaries.test.js`](../server/memory/diaries.test.js)
- [`../server/memory/retrieve.test.js`](../server/memory/retrieve.test.js)

压缩测试注入 dummy 或假 `fetch`，不打真实 MiniMax。可用 `:memory:` 库。

## 尚未实现

朗读历史或日记（语音模块不会把日记拿去 TTS）。导出接口目前实现的是 `md` 和 `json`，没有其它格式。工作记忆在超帽时默认用规则裁剪；`compress.episodeUseModel` 目前是关闭的。
