# 设定、密钥与监听地址

## 职责

加载、合并、校验并保存房屋和人物设定；提供设置页目录；在调用时解析文本 / 语音凭证；解析 HTTP 监听地址。本模块不推进世界、不请求模型、不改记忆库。

[`../server/settings/index.js`](../server/settings/index.js) 永不读取、存储或记录 API 密钥。密钥由 [`../server/secrets`](../server/secrets) 管理。操作步骤见 [`../README.md`](../README.md) 的「密钥」和「监听地址」。

## 目录与入口

| 路径 | 作用 |
| --- | --- |
| [`../server/settings/index.js`](../server/settings/index.js) | `loadSettings`、各 `resolve*`、`identityCard`、`syncWorldFromSettings`、`sanitize` |
| [`../server/settings/catalog.js`](../server/settings/catalog.js) | 设置页分组与字段目录 |
| [`../server/settings/update.js`](../server/settings/update.js) | `applySettingsUpdate`、`buildSettingsResponse` |
| [`../server/settings/http.js`](../server/settings/http.js) | `getSettingsPayload`、`putSettingsPayload`（剥密钥、组装回显） |
| [`../server/settings/listen.js`](../server/settings/listen.js) | 监听地址解析与 `listenStatus` |
| [`../server/settings/schema.js`](../server/settings/schema.js) | 形状说明（校验在 index / update 中执行） |
| [`../server/secrets/index.js`](../server/secrets/index.js) | `loadSecrets`、`saveSecrets`、`secretStatus` |
| [`../server/secrets/resolve.js`](../server/secrets/resolve.js) | `resolveTextCredentials`、`resolveVoiceCredentials` |
| `settings/house.json`、`settings/characters/<id>.json`、`settings/relations.json`、`settings/presentation.json` | 磁盘上的设定文件 |

## 对外接口

**加载与解析。** `loadSettings({ root, reload })` 读 `<root>/settings/`，结果会按根目录缓存。合并顺序：各模块 `config.js` 的代码默认 ← `settings/house.json`（展示层还要叠 `settings/presentation.json`）← `settings/characters/<id>.json`。`resolveThink` / `resolveSpeech` / `resolveLife` / `resolveChat` / `resolveVoice` 等按角色再叠一层；`resolveChatAddressing`、`resolveInterject`、`resolveMemory`、`resolveRelations`、`resolveMood` 为全屋级。`resolveModel(characterId, settings, env)` 只返回 `{ provider, model }`，不读密钥：人物 `model` → 全屋 `model` → 环境变量 `THINK_PROVIDER` / `MINIMAX_MODEL` → `dummy`。

`syncWorldFromSettings` 只刷新已有角色的显示名和卧室；设定里新出现、存档里还没有的角色会补一条，已有存档不重置数值或位置。

**HTTP。** `GET /api/settings` 返回分组、字段、默认 / 生效 / 覆盖值、`secretStatus`（只说是否已配置及来源 `file` / `env`，不回显明文）和 `listen`（含 `restartRequired`）。`PUT /api/settings` 的体为 `{ house, characters, restore, secrets? }`：先剥掉顶层 `secrets`，校验并写入设定，再按需 `saveSecrets`，最后 `world.reloadSettings`。恢复某一分组为默认不会清除密钥。

PUT 的 `house` 和 `characters` 只用目录里登记过的字段 id 作键，不是把整份 JSON 树原样覆盖。校验失败（含发现密钥样键名）时不写任何设定文件，也不写密钥库。`secretStatus` 对全屋三项密钥和每个人的 `modelApiKey` / `voiceApiKey` 只给 `{ configured, source }`，未配置时可能带 `fallsBackTo`，用来告诉界面「现在是在用回退」而不是回显明文。

`identityCard(characterId)` 把称呼、性格、说话方式、背景和喜好拼成短文，供思考和对话提示词使用，长度受 `identityCardChars` 限制。

**密钥。** `saveSecrets(root, patch)` 允许全屋 `minimaxApiKey` / `deepseekApiKey` / `voiceApiKey`，以及人物同样字段；人物还可先交 `modelApiKey`，按已解析服务商改写成 `minimaxApiKey` 或 `deepseekApiKey`。空字符串表示不改；`*Clear: true` 表示删除已保存项。`resolveTextCredentials(characterId, { purpose })`：`purpose === "compress"` 时优先 `memory.config.model`，否则用 `resolveModel`；密钥链是角色 → 全屋 → `.env`。`resolveVoiceCredentials(characterId)`：有角色 id 时走 TTS 链（角色 voice → 角色 MiniMax 文本 → 房屋 voice → 房屋 MiniMax 文本 → `.env`）；`characterId` 为 `null` 时只走房屋向下，供 ASR 使用。

**监听。** `resolveListenHost`：`house.server.host` → 环境变量 `HOST` → `127.0.0.1`。`resolveListenPort` 只看 `PORT`，默认 `8787`。允许字面 IP 和 `localhost`（归一为 `127.0.0.1`），拒绝其它主机名。无效的已存值会被忽略，避免进程起不来。

## 数据与状态

- 设定文件在 `settings/`，原子写入。加载时 `sanitize` 会丢掉密钥样键名，不会记录被丢弃的值。
- `data/secrets.json`：`{ version, house, characters }`，权限 `0600`，进程内按 root 缓存。损坏时当作空库，不把文件内容打进日志。
- `.env` 只作回退，设置页不改写它。`loadEnv()` 在进程启动时读取，不覆盖已有环境变量。
- 本模块不写 `world.json` 或 `memory.sqlite`。

## 可配置项

设置页分组见 `catalog.js` 的 `GROUPS`：日常有服务、模型、作息、思考与开口、记忆、对话、语音、人物；进阶有超时与字数、记忆容量、生活阈值、心情、插话、关系、语音合成。各字段的默认值和校验以目录和对应模块 `config.js` 为准，这里不逐项抄默认值。

磁盘侧还可用：`house.model.baseUrl`（不是密钥）、人物 `identity` / `persona` / `startingStats` / `appearance`、`settings/relations.json` 的起始边（只在缺边时写入）。`startingStats` 只用于新档播种，不重置已有存档。

## 调用关系

进程启动和 `createWorld` 调用 `loadSettings`。思考、对话、生活、记忆、关系、心情、语音经 `resolve*` 取数。凭证在请求模型或 TTS / ASR 时由 `getProviderWithCredentials` 或语音服务调用 `secrets/resolve.js`。HTTP 层是唯一把设定和密钥拼在一起的地方；`settings/index.js` 不得反向引用 `secrets`。

## 扩展点

新增可调项：在模块 `config.js` 增加键，于 `catalog.js` 登记字段和分组，必要时在对应 `resolve*` / `merge*` 里识别。新增服务商：扩展 `resolveModel` 的允许名单、密钥字段映射，以及 think / voice 的 provider 工厂。不要在设定 JSON 里增加密钥字段。

## 不变量与禁区

- 密钥不得出现在 settings JSON、日志、chat、`world.json`、memory、SSE、API 回显中
- PUT 体先剔顶层 `secrets`，再走 `applySettingsUpdate`；`house` / `characters` 补丁若含密钥样字段必须拒绝，且校验失败不写任何文件
- 角色 `modelApiKey` 必须按已解析 provider 存成 `minimaxApiKey` 或 `deepseekApiKey`；当前不是这两种服务商时不能保存该角色的模型密钥
- 空 `apiKey` 不要填进 provider 对象
- `reloadSettings` 只换活引用，不重播种
- 改 host 必须重启进程，不自动 rebind；局域网 `0.0.0.0` 仍共用一份服务端密钥库
- 培养不得写回人设文件；设置页改人设是配置，不是养成结算

## 测试

- [`../server/settings/index.test.js`](../server/settings/index.test.js)
- [`../server/settings/api.test.js`](../server/settings/api.test.js)
- [`../server/settings/listen.test.js`](../server/settings/listen.test.js)
- [`../server/secrets/index.test.js`](../server/secrets/index.test.js)

断言回显和日志里不得出现明文密钥，也不要在测试里写入真实密钥。

## 尚未实现

DeepSeek 可在设定里选，凭证也能解析，但文本 provider 尚未真正发请求，见 [think.md](think.md)。监听地址保存后不会自动重启进程。
