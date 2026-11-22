# 二次开发总览

这份手册面向要改代码的人。部署、密钥填写、监听地址和日常排错见根目录 [`../README.md`](../README.md)。这里只写已经实现的约定，不虚构尚未落地的接口。

产品边界：最多三个角色，各有卧室；客厅、餐厅、浴室共用，浴室同时只能一人。内置角色是 `qingqing` 青青、`linxia` 林夏、`xiaonan` 小南。界面和角色回复都是简体中文。

## 架构

同一个 Node 进程既提供静态页面，也推进世界状态。浏览器关掉后，服务和存档还在。

核心门面是 [`../server/world.js`](../server/world.js) 的 `createWorld`。HTTP 层、前端和启动脚本应只依赖它对外暴露的能力（`publicState`、`tick`、`setViewer`、`chat`、`chatStyles`、`reloadSettings`），不要直接去改生活、思考或对话的内部状态。

模块按职责拆分，彼此是对等层，不是层层包裹：

- 进程壳与门面：[`runtime.md`](runtime.md)
- 设定与密钥：[`settings.md`](settings.md)
- 生活、思考、记忆、对话：[`life.md`](life.md)、[`think.md`](think.md)、[`memory.md`](memory.md)、[`chat.md`](chat.md)
- 关系与心情：[`relations.md`](relations.md)、[`mood.md`](mood.md)
- 语音与立绘：[`voice.md`](voice.md)、[`presentation.md`](presentation.md)
- 浏览器页面：[`frontend.md`](frontend.md)

养成改的是状态、记忆和话题，不改人设文件。用户可以在设置页改人设，那是配置，不是养成写回。

## 进程与前端怎么配合

入口是 [`../server/index.js`](../server/index.js)。启动时先 `loadEnv()` 读项目根 `.env`（不覆盖已有环境变量），再 `loadSettings()`，按 [`../server/settings/listen.js`](../server/settings/listen.js) 解析监听地址，创建语音服务和 `createWorld(dataDir, { voice })`，然后用 `node:http` 同时挂 API 和 `dist/` 静态页。

前端构建结果在 `dist/`。生产路径是浏览器请求房子进程；`npm run dev` 只启动 Vite（默认 `0.0.0.0:5173`），并把 `/api` 代理到 `http://127.0.0.1:8787`，不能替代房子服务。页面启动后拉 `GET /api/state` 和 `GET /api/presentation`，再订阅 `GET /api/events`。走动或显隐变化走 `POST /api/view`（约每 60 秒心跳一次）。对话、设置、日记、语音识别各自打对应接口，见各模块文档。

HTTP 定时 tick 约 30 秒（`TICK_MS`）。上一轮未结束则跳过这一拍。`world.tick` 与 `world.chat` 挂在同一条 Promise 链上，串行执行。

## tick 与对话数据流

`runTick` 的顺序（以 [`../server/world.js`](../server/world.js) 为准，不要改顺序）：

1. `expireViewerIfAway`：按 `lastSeenAt` 判断观众是否已离开，过期则把 `viewer.present` 置为 `false`。仍打开的 SSE 不会阻止过期。
2. 生活 catch-up（同步）：`tickWorld`。停机期间按步长补演，有上限；每一步可通过 `afterStep` 让关系模块累计同处时间。
3. 关系 tick：`tickRelations`（结算同处 / 一起吃饭等，并做衰减）。
4. 思考（异步）：`tickThink`。只针对真实 `now`，至多一轮（至多一个角色）。不重放停机漏掉的思考槽。
5. 日记 tick：`memory.tickDiary`（若记忆门面存在）。跨过游戏日分界时落定正式日记，再视情况跑压缩任务。
6. `store.save()` 一次写入 `data/world.json`。

默认思考间隔约 10 分钟，见思考模块的 `intervalMs`，可在设置里覆盖。

对话走 `world.chat` → `handleChat`，不进入生活 catch-up。成功时存盘并广播 `world.updated`。主回复之后，符合条件的旁听者可能再走一轮插话（房屋模型与凭证，与 `resolveModel(null)` 一致）。插话失败不得撤销已经写入的主回复或记忆。

无 SSE 客户端时（`sseClientCount <= 0`）：生活、思考、日记和存盘仍会跑，但 `tick` 不组装完整 `publicState`（返回 `null`），也不会排队 TTS。观众 `present === false` 时同样跳过 TTS。

SSE 事件：`world.updated`（公开世界状态）、`voice.ready` / `voice.failed`（语音侧路）。首次连接会先推一帧当前状态。

## 硬约束

这些规则在各模块里都会碰到，这里写一次，模块篇只补充与本模块相关的细节。

**密钥。** 不得出现在 settings JSON、日志、chat、`world.json`、memory、SSE、API 回显中。`data/secrets.json` 是主存储（`.gitignore`，权限 `0600`，原子写入）。`.env` 是回退，UI 不改写 `.env`。同一项目里，`secrets.json` 优于 `.env`。`loadEnv()` 只在启动时读项目根 `.env`，不覆盖已有环境变量。

[`../server/settings`](../server/settings) 的核心加载模块不要反向引用 [`../server/secrets`](../server/secrets)，以免循环依赖。HTTP 层会先剥掉 PUT 体顶层的 `secrets`，再走 `applySettingsUpdate`；`house` / `characters` 补丁里不允许密钥样字段。

文本和语音凭证在调用时解析，不在启动时锁死。空 `apiKey` 不要填进 provider 对象（测试与日志不要出现该字段名）。角色 `modelApiKey` 按已解析的服务商存成 `minimaxApiKey` 或 `deepseekApiKey`。

TTS 链：角色 voice → 角色 MiniMax 文本 → 房屋 voice → 房屋 MiniMax 文本 → `.env`。ASR 用房屋 voice 向下，不用角色密钥。日记压缩优先 `memory.config.model` 再解析密钥；不要把 tick 的 think `getProvider` 传成日记工厂名。

**存档与设定。** 不要清掉现有 `world` / character 存档。`reloadSettings` 只换活引用，并刷新显示名和卧室，不重播种、不重置房间或记忆。培养不写回人设文件。

**监听地址。** `house.server.host`，默认 `127.0.0.1`。端口只来自环境变量 `PORT`（默认 `8787`）。改 host 需要进程重启，不自动 rebind。允许字面 IP 和 `localhost`（归一为 `127.0.0.1`），拒绝其它主机名。局域网 `0.0.0.0` 仍共用一份服务端密钥库。操作步骤见 [`../README.md`](../README.md)。

**语音。** 语音是文字对话的侧路：不得回滚已写入的对话或记忆。

**关系。** 有向图，维度是熟悉 / 亲近；玩家节点是 `viewer`；信任尚未设计。`stats.bond` 只是给 HUD 用的合成值，不是关系的真源。

**日记。** 正式日记在游戏日分界（默认 07:00）落定，启动当天可能仍是空。

**插话。** 用户发言后，按门禁和内容策略判断是否再请求模型。NPC 对 NPC 的第三方插话尚未做。

## 测试约定

- 命令：`npm test`，或 `node --test 'server/**/*.test.js' 'src/**/*.test.js'`
- 需要 Node.js 22.13 或更高（记忆库用内置 `node:sqlite`）
- 测试中不打真实 MiniMax / DeepSeek。测试运行器里，除非注入假的 `fetch` 或 `{ allowLive: true }`，否则会落到 dummy，不会出网
- 不要在测试环境写入真实密钥；构造 provider 时，空密钥不要带上 `apiKey` 字段

## 如何扩展一个模块

1. 先读本总览和对应模块文档，确认边界：不要穿越 `world` 门面去改生活 / 思考 / 对话内部。
2. 可调数字放在该模块的 `config.js`，经 `settings` 的 `resolve*` 合并；设置页要暴露的项再登记到 [`../server/settings/catalog.js`](../server/settings/catalog.js)。不要把密钥写进设定文件。
3. 文本模型或语音供应商：在已有的 provider 目录按现有 `complete` / `synthesize` / `transcribe` 合约增加实现，并挂到工厂函数。测试必须可注入 `fetch` 或 dummy。
4. 新的关系或心情事件：在对应 `events.js` 登记类型，由 chat / think 等调用 `applyEvent`，不要直接改分数。
5. 新角色资产：运行时文件放 `public/assets/`，在 `settings/presentation.json` 或人物 `appearance` 里声明；源文件可留在 `assets/`，页面不直接读那里。
6. 为新路径补测试，并保证不打真实外网 API。
7. 尚未实现的项见各篇「尚未实现」，不要把它们当成已有功能来调用。

## 文档索引

| 文档 | 范围 |
| --- | --- |
| [runtime.md](runtime.md) | 进程入口、world 门面、存档、时钟、房间、观众 |
| [settings.md](settings.md) | 设定目录、校验保存、密钥、监听地址 |
| [life.md](life.md) | 生活循环：需求、动作、占用、catch-up |
| [think.md](think.md) | 思考、主动开口、文本模型 provider |
| [memory.md](memory.md) | 记忆库、检索包、日记压缩与导出 |
| [chat.md](chat.md) | 玩家对话与插话 |
| [relations.md](relations.md) | 有向关系图、事件与衰减 |
| [mood.md](mood.md) | 对话类心情离散结算 |
| [voice.md](voice.md) | 朗读、识别、缓存与队列 |
| [presentation.md](presentation.md) | 立绘目录、锚点、资源布局 |
| [frontend.md](frontend.md) | 浏览器页面、Vite、各 UI 模块 |
