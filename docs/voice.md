# 语音

## 职责

在台词已经写入世界之后，把朗读当成侧路来做：排队合成、缓存、通过 SSE 通知前端播放；并提供麦克风识别，把音频转成文字交回对话框。文字对话和记忆是真源。

合成或识别失败时，不得回滚已写入的对话、记忆、关系或心情。本模块不直接请求文本模型，也不修改 `world.json` 里的台词。

## 目录与入口

| 路径 | 作用 |
| --- | --- |
| [`../server/voice/index.js`](../server/voice/index.js) | `createVoiceService`、`presentVoice` |
| [`../server/voice/config.js`](../server/voice/config.js) | TTS / ASR 默认、音色短名单 |
| [`../server/voice/http.js`](../server/voice/http.js) | `GET /api/voice/clips/:id`、`POST /api/voice/transcribe` |
| [`../server/voice/hear.js`](../server/voice/hear.js) | 服务端「此刻能否听见」 |
| [`../server/voice/cache.js`](../server/voice/cache.js)、[`queue.js`](../server/voice/queue.js) | 磁盘缓存与并发队列 |
| [`../server/voice/provider/minimax.js`](../server/voice/provider/minimax.js)、[`dummy.js`](../server/voice/provider/dummy.js) | 合成与识别实现 |

进程入口里 `createVoiceService({ dataDir, getSettings, getSseClientCount, getViewer, onReady, onFailed })`，再交给 `createWorld`。

## 对外接口

`scheduleVoice({ characterId, text, lineAt, lineTo, lineKind, volume, room })`：全屋和该角色都开启朗读、文本非空且非纯标点、未超字数，并且当前有人能收听（有 SSE 客户端且 `viewer.present` 不为 `false`）才入队。相同合成参数会命中缓存并立即 `onReady`。返回的 clip 含 `id`、`status`（`queued` / `ready` / `failed` / `skipped`）、`url` 等。`world` 门面的 `bindScheduleVoice` 会在无客户端或不在场时直接丢掉任务。

`getClip(id)` 提供已合成的 mp3 缓冲。`transcribe({ buffer, mime, filename })` 使用房屋语音凭证（不用角色密钥）；麦克风总开关关闭或没有可用凭证时返回错误。识别文本会按对话的 `maxInputChars` 截断。

`publicConfig()` 给 `publicState.voice` 用：全屋开关、麦克风、自动发送、主音量、最长录音秒数、每人朗读是否开启，以及房屋级 `available`。不含密钥和 voice id。

HTTP：`GET /api/voice/clips/:id` 只接受十六进制 id，成功时返回 `audio/mpeg`。`POST /api/voice/transcribe` 接收 multipart 音频（大小有上限），JSON 返回 `{ ok, text }` 或 `{ ok: false, error }`。SSE：`voice.ready` 带 `id`、`characterId`、`lineAt`、`url`、`durationMs`、`room`、`volume`、`lineTo`、`lineKind`；失败则 `voice.failed`。

TTS 凭证链与 ASR 凭证链见 [settings.md](settings.md) 与总览。调用时解析，不在启动时锁死。测试运行器默认用 dummy，且 `available: false`，除非注入 `fetch` 或 `allowLive`。

听见规则（`canHearVoice`）看的是合成时记下的 `room` / `volume` / `lineTo`，而不是观众后来走到的位置：悄悄话只有对你说才能听；大声在场即可听；普通音量和仅同房可见的同伴台词必须同房。前端 [`../src/voice.js`](../src/voice.js) 使用相近规则，并在同一角色有更新的 `lineAt` 时丢掉尚未播放的旧片段。

缓存键包含模型、音色、语速、音量、音高、格式和文本。改了音色或语速会视为新的合成，不会误用旧文件。

## 数据与状态

- `data/voice-cache/`：按合成参数散列存放的音频文件，有数量和体积上限，可删（会重新合成）
- 进程内 `clips` Map 保存近期元数据和有限个音频缓冲（有 TTL 和数量上限）
- 合成队列默认并发 1
- 识别时在系统临时目录写短暂文件，结束后删除
- 不写 `secrets.json` 以外的密钥，不写记忆库

## 可配置项

`house.voice` 与人物 `voice`：全屋 / 角色开关、麦克风、自动发送、主音量、音色或自定义音色编号、语速、模型名、超时、重试、最长录音、缓存上限等。角色最终是否朗读 = 全屋开关 AND 角色开关。麦克风、自动发送、主音量只在全屋级生效。官方音色短名单在 `VOICE_OPTIONS`，内置三人各有默认音色。设置页见「语音」和「语音合成」。不要在配置里放密钥。

## 调用关系

思考和对话在台词落地后调用 `scheduleVoice`。进程把 `onReady` / `onFailed` 广播给 SSE。前端 [`../src/voice.js`](../src/voice.js) 按同样的听见规则播放，并负责按住说话后调用转写接口，再把文本交给对话框。本模块不回调 `world.chat`。

转写成功只返回文本，由前端决定填入或发送；服务端不会自动当作一句 `POST /api/chat`。因此识别出错时，世界里不会出现半句被写进记忆的话。

`presentVoice` 在没有 voice 服务实例时仍能从设定算出精简配置，供测试或未挂语音的门面使用。`characterVoiceFlags` 只暴露每人是否开启朗读，不暴露音色编号。

## 扩展点

新增 TTS / ASR 供应商：实现 `synthesize` / `transcribe`，在 `createVoiceService` 的 `provider()` 里按设定选择，并保证测试可走 dummy。音色只能从短名单或自定义编号选择，没有克隆接口可接。

## 不变量与禁区

- 语音失败不得回滚已写入的对话或记忆
- 无人收听或观众不在场时不合成
- 密钥不得出现在日志、SSE、clip 元数据或转写回显中
- ASR 不用角色密钥
- 空密钥不要填进 provider 对象
- 测试不打真实 MiniMax

## 测试

- [`../server/voice/index.test.js`](../server/voice/index.test.js)、[`http.test.js`](../server/voice/http.test.js)
- [`../server/voice/cache.test.js`](../server/voice/cache.test.js)、[`queue.test.js`](../server/voice/queue.test.js)、[`hear.test.js`](../server/voice/hear.test.js)
- [`../server/voice/provider/minimax.test.js`](../server/voice/provider/minimax.test.js)

用 dummy 或假 `fetch`。

## 尚未实现

语音克隆、流式 TTS、barge-in、空间音频、唤醒词、朗读历史或日记。这些都没有接口可调用。
