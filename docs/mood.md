# 心情（离散事件）

## 职责

在对话和开口落地后，对 `character.stats.mood` 做一次离散加减，并加上每日上限和高心情时的收益递减。这是事件结算，不是生活循环里按小时慢慢变的那部分。

生活层的每小时心情速率和低需求惩罚仍由 [life.md](life.md) 负责，本模块不调用 `progress`。关系分由 [relations.md](relations.md) 负责。v1 不为旁听或空闲思考发心情事件。

## 目录与入口

| 路径 | 作用 |
| --- | --- |
| [`../server/mood/index.js`](../server/mood/index.js) | `applyEvent`、`resolveConfig` |
| [`../server/mood/config.js`](../server/mood/config.js) | 事件增量、日上限、高心情阈值 |
| [`../server/mood/events.js`](../server/mood/events.js) | `EVENT_TYPES`、`deltasFor` |
| [`../server/mood/apply.js`](../server/mood/apply.js) | 冷却、日封顶、递减、写回 mood |

主入口：`applyEvent(world, event, { settings, now, clock })`。内部异常时返回 `{ applied: false, reason: "error", delta: 0 }`，不抛到调用方。

## 对外接口

已实现的事件类型：

- `playerChat`：主回复者，需满足最小字数和冷却
- `npcTalk`：用 `role: "speaker"` 或 `"listener"` 区分增量
- `proactiveSpeech`：对观众的主动开口
- `interject`：插话落地

`deltasFor` 只给出建议增量；是否落地、落到多少，由 `apply.js` 按日上限、当前心情和递减系数裁剪。心情夹在配置的上下限内。门面返回是否应用、原因和实际 delta。

思考和对话模块在各自成功路径上调用本函数，调用时机见 [think.md](think.md) 与 [chat.md](chat.md)。

裁剪顺序在 `apply.js`：先看这类事件今天还能加多少，再按当前心情是否已进入「高」或「很高」区间缩小收益，最后夹紧到上下限。玩家对话若太短或仍在冷却中，这次事件会被跳过。`npcTalk` 的说话人和听活人是两次独立调用，各记各的日上限。

游戏日起点应与日记、开口尽量一致；若心情配置自己写了 `dayStartHhmm`，则以它为准，不再继承。

## 数据与状态

改的是 `world.characters[id].stats.mood`。按日封顶和冷却需要的簿记写在角色或世界的心情元数据上（由 `ensureMoodMeta` 维护），不进 `publicState` 的单独字段。不建 SQLite 表，不写密钥或人设。

## 可配置项

`house.mood` 覆盖 [`../server/mood/config.js`](../server/mood/config.js)。可调组：游戏日起点（若省略会依次继承生活 / 开口 / 关系的日起点）、高心情与很高心情的起点和衰减系数、以及 `playerChat` / `npcTalk` / `proactiveSpeech` / `interject` 的增量与每日上限。玩家对话还支持最小字数和冷却（可用 `cooldownSec` 覆盖毫秒值）。设置页见「心情结算」。具体默认值看 `config.js`。

## 调用关系

chat / think / interject 在关系和记忆写入的同时调用本模块，但彼此不共享计数器。生活 tick 不调用本模块。不要从 HTTP 或前端直接改 `stats.mood`。

公开状态里的心情是取整后的值，内部仍可以是小数。调试时请看存档里的原始数和元数据，不要只根据 HUD 反推日上限是否打满。

和生活层同时改 `stats.mood` 时，本模块只在事件发生的那一刻动手，生活层只在 catch-up 步进里按小时积分。两者写同一个字段，但不要把事件增量折算进 `life/config.js` 的速率表，也不要把小时速率抄到本模块的事件配置里。

没有单独的心情 HTTP 接口。要调数字，走设置页的心情分组或 `house.mood`。要观察效果，看 `publicState` 里取整后的 `stats.mood`，以及思考 / 对话测试里对 `applyEvent` 的断言。

## 扩展点

新事件：在 `EVENT_TYPES` 和 `deltasFor` 登记，在 `config.js` 增加对应数字组，再让业务模块发事件。表情或立绘不要从这里直连；目前也没有「心情驱动表情」的接口。

## 不变量与禁区

- 只结算已登记的离散事件，不重做生活小时速率
- 不改关系边，不改记忆，不写人设
- 调用失败必须吞掉，不能中断已经成功的对话或思考
- 旁听和空闲思考在 v1 不发心情事件，不要误加

## 测试

- [`../server/mood/apply.test.js`](../server/mood/apply.test.js)

覆盖增量、日上限、冷却和高心情递减。不触网。

构造事件时必须带 `type` 和目标 `characterId`（同伴对话再加上 `role`）。缺少角色或未知类型时不会改数值。测试里请注入 `settings` 或 `cfg`，避免依赖磁盘上的真实 `settings/house.json`。

本模块与关系模块常常在同一次对话里先后被调用，但计数器和日上限是分开的：关系加满了熟悉度，并不自动阻止这次心情结算，反之亦然。

插话的心情增量是独立的一组数字，不会去占用 `playerChat` 的日额度。

## 尚未实现

心情驱动表情。本模块只改数值，不会挑选立绘姿势或表情层。
