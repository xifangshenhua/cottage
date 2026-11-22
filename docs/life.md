# 生活循环

## 职责

按真实时间推进角色的生理需求、动作和房间占用。停机后可以在上限内补演漏掉的时间。只改位置、动作和 `energy` / `hunger` / `clean` / `mood` 的连续变化。

不做思考或开口决策，不写记忆，不改关系分或 `stats.bond`，不写盘。台词的清除会委托给思考模块的 `clearLineIfNeeded`，生活层自己不负责撰写台词。`talk` 动作只用于消化已有台词的过期，生活循环不会新开一轮「说话」。

## 目录与入口

| 路径 | 作用 |
| --- | --- |
| [`../server/life/index.js`](../server/life/index.js) | `tickWorld`、`nextCatchUpDt`、`lifeCfg` |
| [`../server/life/config.js`](../server/life/config.js) | 步长、作息、速率、阈值、时长 |
| [`../server/life/needs.js`](../server/life/needs.js) | `progress`：按动作做需求结算 |
| [`../server/life/actions.js`](../server/life/actions.js) | 动作登记与 `advance` |
| [`../server/life/occupancy.js`](../server/life/occupancy.js) | `canEnter` |
| [`../server/life/rules.js`](../server/life/rules.js) | `propose`：提出合法选项 |
| [`../server/life/decide.js`](../server/life/decide.js) | `pick`：按优先级选一个 |
| [`../server/life/apply.js`](../server/life/apply.js) | `intent`：校验并写入房间 / 动作 |

主入口是 `tickWorld(world, { now, settings, capMs, stepMs, afterStep })`。由 [`../server/world.js`](../server/world.js) 的 `runTick` 在关系 tick 之前同步调用。

## 对外接口

`tickWorld` 从 `world.lastTickAt`（否则 `savedAt` / `clock.iso`）补到 `now`。超过 `catchUpCapMs` 的更早缺口会被丢掉，只模拟最近一段时间。远离「现在」的段落用较粗的 `catchUpStepMs`，靠近现在再回到细步长 `stepMs`。每一步 `stepWorld`：

1. 全员 `progress`（按当前动作结算需求）
2. `advance` 结束已到点的动作；`talk` 结束时清台词；进行中的非 `sit` 动作结束后角色暂时空闲
3. 对空闲或刚结束的角色 `propose` → `pick` → `intent`
4. 调用可选的 `afterStep(world, dtMs, at)`（关系模块用来累计同处时间）

写完后更新 `lastTickAt` 和 `clock`，不调用 `store.save`。

动作登记：`sleep`（必须在自己卧室，夜里不自然醒，白天精力足够才醒）、`eat`（餐厅）、`wash`（浴室独占）、`sit`（客厅，不自动结束）、`talk`（不可新开，到时结束）。`intent` 在房间不符、浴室已有人或条件不满足时丢弃意图，不改世界。

`propose` 的优先级（数字越小越先）：正在进行的短动作（吃 / 洗）优先收尾；白天吃饭先于午睡，夜里睡觉先于开饭；然后洗漱，最后坐下。`pick` 只按 `priority` 取值，可被思考层的模型选择替换，但生活 tick 自己走这套规则。

## 数据与状态

读写的是 `world.characters[id]` 上的 `room`、`action`、`actionStartedAt`、`enteredRoomAt`、`lastRoomChangeAt`、`stats`（`energy`、`hunger`、`clean`、`mood`；`bond` 原样保留）。`hunger` 表示饱食，高分是饱。数值夹在配置的上下限内。本模块不建表，不写临时文件。

## 可配置项

代码默认在 [`../server/life/config.js`](../server/life/config.js)，经 `resolveLife` 与 `house.life`、人物 `life` 合并。可调组包括：游戏日 / 夜里起点、各动作每小时速率、低需求时的心情惩罚、开吃 / 停吃、开洗 / 停洗、睡觉和醒来的精力阈值、吃饭和洗漱时长、`talk` 过期时间。设置页的作息与「吃饭、睡觉、洗漱」进阶分组对应这些键。具体默认值和校验看 `config.js` 或设置页目录。

catch-up 步长和上限目前在代码配置里，不是设置页字段。

补演是为了停机回来后作息仍然连贯：动作时长以分钟计，粗步长仍能跨过白天和夜里的分界。`tickWorld` 不会为了追赶时间去调用思考。生活层改心情只来自每小时速率和低需求惩罚；对话落地造成的心情跳动由 [mood.md](mood.md) 另算。

## 调用关系

只应由 `runTick` 调用 `tickWorld`。思考在同一轮稍后也会 `propose` + `intent`，那是思考层选用法选项，不是生活步进的一部分。占用查询依赖 [`../server/rooms.js`](../server/rooms.js)。关系模块经 `afterStep` 观察，不反向改生活规则。不要从路由或前端直接调用 `intent`。

## 扩展点

新增动作：在 `actions.js` 登记房间、占用类型、开始 / 结束条件，再让 `propose` 在合适时机给出选项。替换选择策略时只换 `pick`，尽量别改 needs / rules / apply。阈值和时长只改 `config.js` 或设定覆盖。浴室独占已经由房间 `capacity: 1` 表达。

## 不变量与禁区

- 生活层不写盘、不请求模型、不改 `bond` 和关系边
- 非法意图必须丢弃，不得悄悄改房间来「纠正」
- 只能在自己卧室睡觉；吃饭必须在餐厅；洗漱必须在浴室且浴室空闲
- 不要把思考折进每一步 `stepWorld`
- 不要清掉现有存档或在 tick 里重播种
- 最多三人、三间卧室、浴室同时一人，是房间目录给出的硬布局

## 测试

- [`../server/life/apply.test.js`](../server/life/apply.test.js)
- [`../server/life/catchup.test.js`](../server/life/catchup.test.js)
- [`../server/life/needs.test.js`](../server/life/needs.test.js)
- [`../server/life/rules.test.js`](../server/life/rules.test.js)
- 共用 [`../server/life/test-helpers.js`](../server/life/test-helpers.js)

生活测试不触网。

## 尚未实现

走路动画（没有 `walk` 动作或走姿）。生活循环不会唤醒睡着的角色去接对话，睡觉中的角色也不会被本层叫醒。`talk` 仍是保留动作，不会由规则新开。
