# 关系

## 职责

维护角色与角色、角色与观众之间的有向关系图，处理事件加减分、同处累计和日常衰减，并把合成后的 `stats.bond` 同步给 HUD。其它模块只许发事件或查询摘要，不许直接改分数。

不改人设，不改立场种子去覆盖已有边，不处理心情的连续衰减（那是生活层）或离散心情事件（见 [mood.md](mood.md)）。信任维度尚未设计，配置里也未启用。

## 目录与入口

| 路径 | 作用 |
| --- | --- |
| [`../server/relations/index.js`](../server/relations/index.js) | 门面：`migrateRelations` / `ensureRelations`、`applyEvent`、`tickRelations`、`queryPack`、`presentRelations` |
| [`../server/relations/config.js`](../server/relations/config.js) | 维度、事件加减、衰减数字 |
| [`../server/relations/schema.js`](../server/relations/schema.js) | 边形状、立场列表、默认种子 |
| [`../server/relations/graph.js`](../server/relations/graph.js) | 边的读写与观众视角投影 |
| [`../server/relations/events.js`](../server/relations/events.js) | 事件类型、同处累计、`drainHouseholdEvents` |
| [`../server/relations/apply.js`](../server/relations/apply.js) | 真正改分、日上限、合成 bond |
| [`../server/relations/decay.js`](../server/relations/decay.js) | 按游戏日衰减 |
| [`../server/relations/query.js`](../server/relations/query.js) | 思考 / 对话用的关系摘要 |

玩家节点 id 是 `viewer`（`VIEWER_ID`）。

## 对外接口

`migrateRelations(world, { settings, seeds })` 在缺边时补边：已有边（含立场和分数）永不被覆盖。角色→观众的缺边若角色已有 `stats.bond`，会按迁移比例把 bond 抄到熟悉和亲近，使合成值保持不变。`settings/relations.json` 的种子只用于仍缺失的边。然后 `syncAllBonds`。

`applyEvent(world, event, opts)` 的 `event.type` 见 `EVENT_TYPES`：`playerChat`、`sharedRoom`、`mealTogether`、`npcTalk`、`overhear`、`npcOverhear`、`idleThink`、`proactiveSpeech`、`interject`、`decay`。思考和对话模块在成功路径上调用，不要自己改 `world.relations`。

`observeLifeStep` 在每个生活步进里累计同处（以及一起吃饭等）时间，不立刻改分。`tickRelations` 先 `drainHouseholdEvents` 结算这些累计，再 `tickDecay`。

`queryPack(world, characterId, kind)` 给思考（`idle`）或对话（`chat`）一段短摘要。`presentRelations(world)` 只投影「该角色 → viewer」的熟悉、亲近和立场，供 `publicState` 使用；完整边数组不会进 SSE。

## 数据与状态

`world.relations` 是有向边数组。持久化字段：`from`、`to`、`familiarity`、`closeness`、`stance`、`updatedAt`。边上还可以有交互时间、按日计数等簿记字段，这些不进入公开状态。`world.relationsMeta` 保存上次衰减的游戏日和同处累计。`stats.bond` 是熟悉与亲近的加权合成（默认熟悉 40%、亲近 60%），只是 HUD 值，不是真源。

立场枚举：`companion`、`roommate`、`friend`、`acquaintance`。培养过程不得改写已有边的立场。

## 可配置项

`house.relations` 覆盖 [`../server/relations/config.js`](../server/relations/config.js)。可调组包括：维度上下限与合成权重、缺边时的默认角色间边、各类事件的增量与每日上限、玩家对话的最小字数和冷却、同处 / 一起吃饭的累计单位和排除房间 / 动作、衰减节奏。起始边在 `settings/relations.json`，不在 `house.json` 里改已有存档。设置页见「关系加减与衰减」。不要逐字段抄默认值。

`reloadSettings` 不会重跑播种去覆盖运行中的边。缺的边仍会在下一次 `migrateRelations` 或 `tickRelations` 时按当前种子或默认角色间边补上。

同处累计会排除浴室，以及正在睡觉或洗漱的人；这些排除列表可在配置里改。衰减按游戏日进行，同一天内的多次 `tickRelations` 不会把日衰减结算两遍。

`presentRelations` 只给出角色对你的看法，没有你对她们或她们彼此的边；需要完整图时用 `snapshotEdges` 或直接读存档，不要把完整图塞进 SSE。

## 调用关系

`createWorld` 启动时 `ensureRelations`。`runTick` 在生活 catch-up 中经 `afterStep` 调用 `observeLifeStep`，生活结束后调用 `tickRelations`，然后才是思考。思考和对话在开口或回复成功后 `applyEvent`。查询发生在组装提示词时。心情模块是平行结算，互不写对方的字段。

一类典型路径：玩家对话成功 → `playerChat`（角色→观众，通常也更新观众→角色）→ 旁听者可能收到较小的 `overhear`。同伴开口则是双向的 `npcTalk`，同房旁观者走 `npcOverhear`。空闲思考默认可以是零增量，仍然走事件入口，是为了让规则集中在本模块。每日上限和冷却在 `apply.js`，调用方不必自己算。

## 扩展点

新增数值维度时，在 `config.dimensions` 登记并决定是否计入合成；边的身份（`from`、`to`、`stance`、`updatedAt`）应保持稳定。新事件类型加到 `EVENT_TYPES`、`deltasFor` 和 `apply.js` 的过滤逻辑，再让业务模块发事件。信任若要做，应作为新维度启用，而不是重用熟悉或亲近。

## 不变量与禁区

- 图是有向的；`qingqing → linxia` 与反向是两条边
- 玩家节点是 `viewer`，不是某个角色 id
- 已有边不被种子或 `reloadSettings` 覆盖
- 其它模块不得直接写分数或 `stats.bond`
- 密钥与人设文件与本模块无关，也不许写进去
- 不要清掉现有存档来「重建关系」

## 测试

- [`../server/relations/index.test.js`](../server/relations/index.test.js)
- [`../server/relations/apply.test.js`](../server/relations/apply.test.js)
- [`../server/relations/decay.test.js`](../server/relations/decay.test.js)
- [`../server/relations/query.test.js`](../server/relations/query.test.js)

关系测试是纯本地数值，不触网。

## 尚未实现

信任维度（配置注释里预留，v1 未启用）。没有把信任做成事件或 HUD 字段。
