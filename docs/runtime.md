# 进程入口与世界门面

## 职责

把 HTTP、SSE、静态页面、定时 tick 和存档收拢成一个进程，对外只露出 [`../server/world.js`](../server/world.js) 的世界门面。负责加载环境变量、绑定监听地址、把请求转给设置 / 记忆 / 语音 / 对话，并在适当时机存盘。

不负责生活规则、模型提示词、记忆表结构或立绘锚点。那些分别见 [life.md](life.md)、[think.md](think.md)、[memory.md](memory.md)、[presentation.md](presentation.md)。部署和启停步骤见 [`../README.md`](../README.md)。

## 目录与入口

| 路径 | 作用 |
| --- | --- |
| [`../server/index.js`](../server/index.js) | 进程入口：`loadEnv`、建服务、挂路由、定时 tick |
| [`../server/world.js`](../server/world.js) | `createWorld`、`runTick`、`resolveDiaryProvider` |
| [`../server/store.js`](../server/store.js) | `createStore`：读 / 迁移 / 原子写 `world.json` |
| [`../server/seed.js`](../server/seed.js) | `createSeed`：缺档或坏档时的初始世界 |
| [`../server/clock.js`](../server/clock.js) | `nowClock`、`hhmmToMinutes`、`isWrappedWindow`（时区 `Asia/Shanghai`） |
| [`../server/rooms.js`](../server/rooms.js) | 房间目录、卧室约定、占用查询 |
| [`../server/viewer.js`](../server/viewer.js) | `expireViewerIfAway`、`viewerPatchAfterSseClose` |
| [`../scripts/start-house.sh`](../scripts/start-house.sh) / [`../scripts/stop-house.sh`](../scripts/stop-house.sh) | 后台启停、写 `data/house.pid` |

主入口：`node server/index.js`（`npm start`）。后台脚本在需要时先构建 `dist/`。

## 对外接口

`createWorld(dataDir, opts?)` 返回：

- `publicState()`：给页面和 SSE 的公开状态（角色数值取整，关系只给观众视角，语音是精简配置）
- `tick(now?, runOpts?)`：串行执行 `runTick`；`sseClientCount <= 0` 时返回 `null`，否则返回 `publicState()`
- `setViewer({ room, present })`：更新观众房间 / 在场，立即存盘
- `chat(input)`：与 tick 同一条链；全屋锁或按角色锁；忙时返回 `reasonCode: "busy"`
- `chatStyles(characterId)`：语气、篇幅、音量目录
- `reloadSettings(next?)`：更换活设定引用，不重播种
- 只读：`settings`、`world`、`savedAt`、`ready`、`memory`

HTTP / SSE（由 [`../server/index.js`](../server/index.js) 挂到门面，细节路由见各模块）：

- `GET /api/health`：`pid`、`host`、`port`、`startedAt`、`uptimeSec`、`savedAt`、`clients`
- `GET /api/state`：`publicState()`
- `GET /api/events`：SSE；先推一帧 `world.updated`，之后广播世界更新和语音事件
- `POST /api/view`：`{ room?, present? }`，`present` 缺省为 `true`
- `GET` / `PUT /api/settings`、`GET /api/presentation`、记忆浏览 / 导出、`GET /api/chat/styles`、`POST /api/chat`、语音路由：分别转给对应模块
- 其它 `GET`：从 `dist/` 提供静态文件；路径不得逃出 `dist`

`publicState` 字段包括 `version`、`startedAt`、`savedAt`、`clock`、`viewer`、`characters`、`relations`、`lastChat`、`voice`。角色公开字段有位置、动作、台词（含 `lineTo` / `lineKind`）、取整后的数值，以及思考 / 主动开口计数。不含密钥，也不含完整关系边数组。

成功对话的返回是公开状态再加上 `ok`、`reason`、`reasonCode`、`volume`、`targetId`、`responderId`、`hearerIds`、`interjectorIds`。

## 数据与状态

- `data/world.json`：世界存档。当前版本为 `3`。主要字段：`startedAt`、`savedAt`、`lastTickAt`、`clock`、`viewer`（`present`、`room`、`lastSeenAt`）、`characters`、`relations`、`relationsMeta`、`lastChat`，以及 npc 开口 / 插话用的元数据。角色上还有动作起止、进房时间、`lastThinkAt`、主动开口计数、台词等。不要把真实存档内容写进文档或日志。
- 缺文件或解析失败时，`createStore` 用 `createSeed` 新建，不覆盖已有合法存档。
- 写入用临时文件再 `rename`，保证原子替换。`save()` 会刷新 `savedAt` 和 `clock`。
- `data/memory.sqlite`、`data/secrets.json`、`data/voice-cache/`、`data/house.pid`、`logs/house.log` 分别由记忆、密钥、语音和启动脚本管理。
- 进程内：SSE 客户端集合、`ticking` 标志、`createWorld` 的 tick/chat 链、对话锁。

存盘时机：每次 `runTick` 结束存一次；`setViewer` 立即存；`chat` 仅在 `ok` 时存。生活循环本身不写盘。

## 可配置项

监听地址由设定和 `HOST` / `PORT` 决定，见 [settings.md](settings.md) 与 [`../README.md`](../README.md)。tick 间隔在 `server/index.js` 里写死为 30 秒，不是设置页字段。观众离开超时来自思考开口设定里的 `viewerAwayTimeoutMin`。时钟时区固定为 `Asia/Shanghai`。

房间目录在 [`../server/rooms.js`](../server/rooms.js)：`living`、`dining`、`bathroom`（容量 1），以及与角色 id 相同的三间卧室。

## 调用关系

`index.js` 创建 voice 与 world，定时调用 `world.tick({ sseClientCount })`，并把路由接到 `world`、设置 HTTP、记忆 HTTP、语音 HTTP。`runTick` 依次调用观众过期、生活、关系、思考、日记，最后存盘；思考和对话经 `bindScheduleVoice` 排队 TTS。不要从 HTTP 处理函数直接调用 `tickWorld` 或 `handleChat`。

## 扩展点

新增只读或写入 API 时，在 `server/index.js` 挂路由，状态变更仍走 world 门面，成功后自行决定是否 `broadcast("world.updated", ...)`。新的公开字段应经 `present` / `presentCharacter` 过滤，不要把内部计数或密钥漏出去。房间目录若要增加房间，需同时考虑生活占用和立绘锚点。

## 不变量与禁区

- tick 与 chat 必须串行；不要并行跑两轮 `runTick`
- 思考只针对真实 now，且每轮至多一个角色；不要把思考折进每 30 秒的生活步进
- `reloadSettings` 不得重置存档
- 密钥不得进入 `world.json`、日志、SSE 或 `publicState`
- 静态文件路径必须限制在 `dist/` 内
- 改监听地址不在本进程内 rebind，见 [settings.md](settings.md)

## 测试

- [`../server/world.test.js`](../server/world.test.js)
- [`../server/viewer.test.js`](../server/viewer.test.js)

跑法见 [README.md](README.md#测试约定)。测试应注入 memory / provider / voice，不打真实外网 API。

## 尚未实现

与本层相关、目前没有的能力：改 host 后自动 rebind；把生活 tick 间隔做成设置项。走路动画、唤醒睡着的角色等不在本层实现，见 [life.md](life.md) 与 [frontend.md](frontend.md)。
