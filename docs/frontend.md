# 前端页面

## 职责

在浏览器里画出当前房间、状态条和对话，让你走动、说话、看日记和改设置，并播放已经合成的语音。前端不保存世界，不直接请求模型，也不读 `data/` 或密钥文件。所有状态以房子进程的 API 为准。

开发时可用 Vite 单独改页面，但不能替代房子服务。

## 目录与入口

| 路径 | 作用 |
| --- | --- |
| [`../index.html`](../index.html) | 页面骨架：房间层、HUD、对话框、设置和日记容器 |
| [`../src/main.js`](../src/main.js) | 启动、拉状态、订阅 SSE、房间切换、发送对话 |
| [`../src/world.js`](../src/world.js) | 房间目录、离线占位、关系芯片、`applyPresentation` |
| [`../src/hud.js`](../src/hud.js) | 渲染签名，避免无变化时重绘 |
| [`../src/dialog.js`](../src/dialog.js) | 选择当前房间该显示的台词 |
| [`../src/diary.js`](../src/diary.js) | 日记面板 |
| [`../src/settings.js`](../src/settings.js) | 设置面板 |
| [`../src/voice.js`](../src/voice.js) | 播放队列、按住说话、本地静音 |
| [`../src/sprites/index.js`](../src/sprites/index.js)、[`html.js`](../src/sprites/html.js) | 立绘呈现器 |
| [`../src/icons.js`](../src/icons.js)、[`../src/style.css`](../src/style.css) | 图标与样式 |
| [`../vite.config.js`](../vite.config.js) | 开发服务器与 `/api` 代理 |

`index.html` 以模块方式加载 `/src/main.js`。生产环境下由房子进程提供 `dist/`。

## 对外接口

前端消费的 HTTP / SSE（实现在服务端，见 [runtime.md](runtime.md) 和各模块）：

- 启动：`GET /api/state`、`GET /api/presentation`，然后 `EventSource("/api/events")` 听 `world.updated` 与 `voice.ready` / `voice.failed`
- 在场：`POST /api/view` `{ room, present }`。切房、可见性变化会调用；前台约每 60 秒心跳一次；页面隐藏或卸载时把 `present` 设为 `false`（卸载优先 `sendBeacon`）
- 对话：`GET /api/chat/styles?character=`，`POST /api/chat` `{ characterId?, text, volume, style }`
- 设置：`GET` / `PUT /api/settings`。哈希 `#settings` 会直接打开设置页。密钥用密码框编辑，留空表示不改，点清除才删除；请求里的密钥放在顶层 `secrets`，不会把明文写进设定字段
- 日记：`GET /api/memory/browse?character=`，导出走 `GET /api/memory/export?character=&format=md`（页面默认导出 Markdown；接口还支持 `json`）
- 语音：播放 `GET /api/voice/clips/:id`；按住说话后 `POST /api/voice/transcribe`

URL 查询参数 `room` 记录当前房间。日记也可用哈希打开指定角色。

`selectVisibleDialog` 会在当前房间的可见台词、插话和尚未过期的 `lastChat` 里选最新的一条；过期窗口与生活层 `talkExpireMin` 对齐。没有台词时显示动作说明（睡觉、吃饭、洗漱、坐下）。状态条在有观众关系时展示「熟悉」「亲密」，否则回退到单一的「关系」芯片（合成 `bond`）。点击立绘只改变聚焦和状态条，不会改发送对象。

## 数据与状态

全部是页面内存：当前房间、焦点人物、世界快照、展示目录、呈现器实例、风格缓存、语音播放队列和本地静音。刷新后从 API 重新拉取。`src/world.js` 里有一份离线占位的房间和角色表，仅在状态还没拉到或展示目录失败时作背景路径回退，不能当成存档。

浏览器不读写 `world.json`、记忆库或 `secrets.json`。

## 可配置项

页面本身几乎没有独立配置文件。开发服务器在 `package.json` 的 `dev` 脚本和 [`../vite.config.js`](../vite.config.js)：默认监听 `0.0.0.0:5173`，把 `/api` 代理到 `http://127.0.0.1:8787`。房子进程是否对本机以外开放，仍由服务端监听地址决定，见 [`../README.md`](../README.md)。展示相关数字来自展示目录。语音的开关、自动发送、最长录音来自 `publicState.voice`。

## 调用关系

`main.js` 组装一切：先状态和目录，再 `createPresenter`、`mountSettings`、`mountDiary`、`mountVoice`，然后进房并打开 SSE。呈现器使用服务端的 [`../server/presentation/layout.js`](../server/presentation/layout.js) 做占座和坐标映射，避免前后端各写一套。语音模块复用与服务端相近的听见规则：不在场、静音、正在录音、悄悄话且不是对你说、普通音量但不同房，都不会播放。识别结果按全屋 `autoSend` 决定是直接发送还是只填入输入框。

不要从页面直接 import 生活、思考或对话的服务端协调器。

## 扩展点

新的 HUD 区块放在 `index.html` 并在对应模块挂载。新增 API 时只通过 `fetch` 或 SSE 消费，保持密钥不进页面存储。若要换呈现器，应走 `createPresenter`；当前传入 `pixi` 或 `live2d` 仍会退回 HTML。走路动画、口型或表情层需要先有对应资产和目录字段，前端现在没有这些通道。

## 不变量与禁区

- 不以页面本地数据覆盖服务端存档
- 密钥只出现在设置页的密码框和提交时的 `secrets` 补丁，不进日志、localStorage 或世界快照
- 点击立绘不得偷偷改对话对象
- Vite 开发服务器不是房子进程，没有它自己的 tick
- 静态资源 URL 指向 `public/assets/` 那一套，而不是仓库里的 `assets/` 源目录

## 测试

- [`../src/world.test.js`](../src/world.test.js)
- [`../src/hud.test.js`](../src/hud.test.js)
- [`../src/dialog.test.js`](../src/dialog.test.js)
- [`../src/voice.test.js`](../src/voice.test.js)

这些是 Node 里的纯逻辑测试，不打开浏览器，也不打真实 MiniMax。设置和日记面板目前没有同样形式的前端测试文件。

## 尚未实现

走路动画、客厅第三个坐位、林夏被子裹紧的立绘、心情驱动表情、嘴型同步、空间音频、唤醒词、朗读历史或日记、barge-in、流式 TTS。Pixi / Live2D 呈现器未实现。前端也不会唤醒睡着的角色。
