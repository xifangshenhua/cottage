# 房子

本地常驻的养成小屋。同一个 Node 进程既提供页面，也推进世界状态。关掉浏览器后，服务和存档还在。

最多三个角色，各有独立卧室；客厅、餐厅、浴室共用。内置三人是青青（`qingqing`）、林夏（`linxia`）、小南（`xiaonan`）。她们会自己睡觉、坐下、吃饭、洗漱，也可以思考、主动开口、和你说话。培养会改状态和记忆，不会改写人格设定文件。

界面和角色回复都是简体中文。

## 运行要求

- Node.js **22.13 或更高**（记忆库用内置 `node:sqlite`，不需要额外原生模块）
- 一台能长期跑进程的电脑；默认只监听本机 `127.0.0.1:8787`
- 若要使用思考、对话、日记压缩或语音，需要 [MiniMax 中国站](https://platform.minimax.cn)（或 DeepSeek）的 API 密钥

```bash
node -v   # 应显示 v22.13+ 
```

## 部署步骤

在项目根目录：

```bash
npm install
npm test
npm run build
npm run start:house
```

浏览器打开 [http://127.0.0.1:8787/](http://127.0.0.1:8787/)。

`start:house` 若发现服务已在跑，会直接退出且不重启。若 `dist/index.html` 不存在，或 `src/`、`index.html`、`package.json`、`vite.config.*` 比它新，会先执行 `npm run build`。改过前端后，请先停再启：

```bash
npm run stop:house
npm run start:house
```

日志在 `logs/house.log`，进程号在 `data/house.pid`。停服务：

```bash
npm run stop:house
```

`start:house` / `stop:house` 是 bash 脚本，在 macOS 和 Linux 上直接使用。Windows 可用 Git Bash 或 WSL；也可以先 `npm run build`，再 `npm start` 在前台启动。

开发时也可用 `npm start`（前台跑 `node server/index.js`，不会自动编译前端，需已有 `dist/`）或 `npm run dev`（Vite 开发服务器，默认 `0.0.0.0:5173`，只用于改页面，不替代房子服务）。

重启电脑后重新执行 `npm run start:house`。世界状态从 `data/world.json` 恢复，记忆从 `data/memory.sqlite` 恢复。不要删除这两个文件，除非你有意清空存档。

服务大约每 30 秒推进一次生活状态；默认大约每 10 分钟做一轮思考（可在设置里改）。

## 页面上怎么用

打开页面后即可走动查看房间、和在场的人说话。顶部可切换你是否在家：离开后她们仍继续生活，但不会为无人收听的句子合成语音。

右上角进入「房子设置」。日常分组包括服务、模型、作息、思考与开口、记忆、对话、语音和人物；超时、容量、心情、插话、关系等在「进阶」里。保存后除监听地址外立即生效，也不会重置存档。地址栏加上 `#settings` 会直接打开设置页。

对话可指定对象和音量（如悄悄话）。若已开启全屋语音和麦克风，可按住说话，松手后识别成文字再发送。日记可在页面里浏览，也可经接口导出。

## 监听地址

默认绑定 `127.0.0.1`（只有本机浏览器能打开）。可在设置页「服务」里改监听地址，或写环境变量 `HOST` / `PORT`。

解析顺序：

1. 设置页保存的 `server.host`（写入 `settings/house.json`）
2. 环境变量 `HOST`（常见写法是放在项目根目录的 `.env`）
3. 默认 `127.0.0.1`

端口只看环境变量 `PORT`，默认 `8787`。

只允许填写字面 IP（含 `127.0.0.1`、`0.0.0.0`、`::1`、`::`）或 `localhost`（会归一成 `127.0.0.1`）。不接受其他域名，以免写错后绑到意外地址。

**改监听地址后必须重启服务才会生效。** 设置页保存后会提示需要重启；进程不会自动重启，以免打断正在进行的对话或思考。

若要让局域网其他设备访问，把监听地址改成 `0.0.0.0`，重启后再用这台机器的局域网 IP 加端口打开。所有客户端共用同一套服务端密钥和同一份存档，不需要在浏览器里再配一份密钥。把服务暴露到局域网或公网等于把密钥和存档暴露给能访问该端口的人，请自行评估风险。

## 密钥

密钥不要写进 `settings/`、`data/world.json`、记忆库、日志或接口回显。设置页的密码框不会回显已保存的明文；留空表示不修改，只有点「清除」才会删掉已保存的项。

优先级（同一项）：

1. `data/secrets.json`（设置页写入，权限 `0600`，已被 `.gitignore` 忽略）
2. 项目根目录 `.env` 里的对应变量（设置页不会改写 `.env`）

### 设置页

- 全屋「模型」：MiniMax 密钥、DeepSeek 密钥，以及接口根地址（`model.baseUrl`，这不是密钥，写在 `settings/house.json`）
- 全屋「语音」：语音密钥、默认音色、自定义音色编号
- 人物页：可选的服务商 / 模型名、该角色的模型密钥和语音密钥、该角色的音色

文本模型密钥链：角色密钥 → 全屋对应服务商密钥 → `.env`。  
语音朗读：角色语音密钥 → 角色 MiniMax 文本密钥 → 全屋语音密钥 → 全屋 MiniMax 文本密钥 → `.env` 的 `MINIMAX_API_KEY`。  
麦克风识别只用全屋语音链，不用角色密钥。

人物「与全屋相同」时，沿用全屋服务商，人物密钥按该服务商存储。恢复某一分组为默认，不会清除密钥。

### `.env` 回退

可从 `.env.example` 复制为 `.env`。进程启动时会读取项目根目录的 `.env`，已存在的环境变量不会被文件覆盖。常用项：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `PORT` | 监听端口 | `8787` |
| `HOST` | 监听地址（设置页未保存时使用） | `127.0.0.1` |
| `MINIMAX_API_KEY` | MiniMax 密钥回退 | 空 |
| `MINIMAX_BASE_URL` | 接口根地址回退 | `https://api.minimax.cn/v1` |
| `MINIMAX_MODEL` | 模型名回退 | 设置里的全屋模型 |
| `THINK_PROVIDER` | 服务商回退 | 设置里的全屋服务商，再否则 `dummy` |
| `DEEPSEEK_API_KEY` | DeepSeek 密钥回退 | 空 |

`.env` 已被忽略，不要提交，也不要打进压缩包。

没有可用密钥且服务商是 MiniMax / DeepSeek 时，思考和对话无法真正请求模型。服务商为 `dummy` 时走本地占位，只适合测试。

## 其他设定

全局默认和人物设定在 `settings/`：

- `settings/house.json`：全屋覆盖（模型、生活、思考、对话、关系数值、监听地址等）
- `settings/characters/<id>.json`：人设和可选覆盖（称呼、语气、模型、音色等）
- `settings/relations.json`：关系图起始边（只在缺边时写入，不覆盖运行中已有的边）

解析顺序：代码默认 ← `settings/house.json` ← `settings/characters/<id>.json`。日常修改请走设置页；保存后除监听地址外立即生效，不会重置房间或记忆。培养过程不会改写这些设定文件；你在设置页改的是配置，不是养成结算。

模型解析顺序：人物 `model` → 全屋 `model` → `.env` 的 `THINK_PROVIDER` / `MINIMAX_MODEL` → `dummy`。

人物若要单独指定对话默认语气，可在自己的设定里写（设置页也可以改）：

```json
"chat": { "defaultTone": "gentle", "allowedTones": ["natural", "gentle", "concise"], "defaultLength": "short" }
```

人物若要单独指定模型：

```json
"model": { "provider": "minimax", "model": "MiniMax-M3.1-Flash" }
```

## 数据与目录

| 路径 | 用途 | 可否删除 |
| --- | --- | --- |
| `data/world.json` | 世界存档（位置、状态、关系等） | 删除等于开新档 |
| `data/memory.sqlite` | 记忆、日记 | 删除等于忘记过去 |
| `data/secrets.json` | 设置页保存的密钥 | 删除后回退到 `.env` |
| `data/voice-cache/` | 语音缓存 | 可删，会重新合成 |
| `data/house.pid` | 运行中的进程号 | 停服务时使用 |
| `logs/house.log` | 服务日志（不应出现密钥明文） | 可删 |
| `dist/` | 前端构建结果 | 可删，启动时会按需重建 |
| `settings/` | 房屋和人物配置 | 删除后回到代码默认 |
| `.env` | 环境变量和密钥回退 | 不要提交 |
| `public/assets/` | 运行时用的立绘等资源 | 需要保留 |
| `assets/` | 立绘的源文件和参考图 | 不必复制到运行环境，页面用的是 `public/assets/` |
| `previews/` | 开发预览图 | 已忽略，不必部署 |

## HTTP 接口

服务默认在 `http://127.0.0.1:8787`：

- `GET /api/health`：进程、监听地址、启动时间
- `GET /api/state`：当前世界公开状态
- `GET /api/events`：世界更新和语音就绪的 SSE
- `POST /api/view`：你所在的房间 / 是否在场
- `GET /api/settings`、`PUT /api/settings`：设置页目录与保存（密钥只以是否已配置的形式出现，不回显明文）
- `GET /api/presentation`：立绘与房间展示目录
- `GET /api/memory/browse?character=qingqing`：日记浏览
- `GET /api/memory/export?character=qingqing&format=md`：日记导出（`format` 为 `md` 或 `json`；`character=all` 可导出全部）
- `GET /api/chat/styles?character=qingqing`：对话语气和篇幅
- `POST /api/chat`：`{ characterId, text, volume?, style?: { tone, length } }`
- `GET /api/voice/clips/:id`：已合成的朗读音频
- `POST /api/voice/transcribe`：麦克风识别（上传音频，返回文本）

## 常用脚本

| 命令 | 作用 |
| --- | --- |
| `npm install` | 安装依赖（目前主要是 Vite） |
| `npm run build` | 构建 `dist/` |
| `npm test` | 跑官方测试：`node --test 'server/**/*.test.js' 'src/**/*.test.js'` |
| `npm run start:house` | 后台启动（必要时先构建） |
| `npm run stop:house` | 停止后台服务 |
| `npm start` | 前台启动，不自动构建 |
| `npm run dev` | 仅前端开发服务器 |

测试不会请求真实的 MiniMax / DeepSeek。不要在测试环境写入真实密钥。

## 故障排除

- **页面打不开：** 看 `logs/house.log`，确认进程还在，并访问 `GET /api/health`。默认只绑 `127.0.0.1`，别的电脑要用时须改监听地址并重启。
- **改了前端没变化：** 先 `stop:house` 再 `start:house`，让脚本重建 `dist/`。
- **能打开页面但不能思考 / 对话：** 当前全屋或该角色的服务商若是 MiniMax / DeepSeek，需要在设置页或 `.env` 里提供对应密钥。设置页已配置的项优先于 `.env`。
- **语音没有声音：** 先开全屋语音，再确认该角色的「朗读」是开的；无人收听或你不在场时不会合成。语音密钥可单独填，不填则回退到 MiniMax 文本密钥。
- **改了监听地址仍是旧地址：** 保存只写配置，不会自动重启。执行 `npm run stop:house && npm run start:house`。
- **想换电脑部署：** 复制源码后按上面的步骤安装。密钥只应放在 `.env` 或 `data/secrets.json` 里，不要再另存明文副本，也不要把这两份文件拷到不安全的位置。若要迁移存档，请一并复制 `data/world.json` 和 `data/memory.sqlite`。
- **日记是空的：** 正式日记在游戏日切到下一天、过了日记时间（默认早上 07:00）后才会写入。刚启动或还在同一天里，页面里可能暂时没有条目。
- **误删存档：** 服务启动不会自动重建剧情进度。没有备份就无法恢复。

## 模块分工（给改代码的人）

二次开发请先看 [`docs/README.md`](docs/README.md)。各模块的职责、接口、调用关系和尚未实现的项写在 `docs/` 里，不要把详细说明再堆回本文件。

- `server/index.js`：HTTP、SSE、静态页面和定时 tick
- `server/store.js`：读盘、写盘、迁移
- `server/settings/`：设定目录、合并、校验、监听地址
- `server/secrets/`：`data/secrets.json` 的读写与密钥解析（设置模块不要反向引用，以免循环依赖）
- `server/world.js`：对外状态、tick、观众位置和对话
- `server/rooms.js`：房间目录与占用
- `server/life/`：生活循环
- `server/think/`：思考与主动开口
- `server/memory/`：记忆库与日记压缩
- `server/chat/`：与你对话；插话是其中一环
- `server/relations/`：熟悉 / 亲近
- `server/mood/`：对话落地后的心情离散结算
- `server/presentation/`：立绘与房间展示目录
- `server/voice/`：朗读与麦克风识别
- `src/`：浏览器页面和设置页
