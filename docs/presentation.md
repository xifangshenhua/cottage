# 展示与立绘

## 职责

提供房间背景、锚点和角色姿势的展示目录，并把角色按动作放到正确的座位上。这是表现层：不决定谁能听见、谁在生活循环里做什么，也不修改存档。

目录通过 `GET /api/presentation` 一次性发给前端，不进入 SSE 的 `world.updated`。本模块不读密钥，也不把密钥写进目录。

## 目录与入口

| 路径 | 作用 |
| --- | --- |
| [`../server/presentation/config.js`](../server/presentation/config.js) | 默认包名、画幅、锚点、资源路径模板 |
| [`../server/presentation/catalog.js`](../server/presentation/catalog.js) | `getPresentationCatalog`、`buildCatalog`、`invalidatePresentationCatalog` |
| [`../server/presentation/layout.js`](../server/presentation/layout.js) | `assignSlots`、`resolvePose`、`mapAnchorToScreen`、`formatAssetPath` |
| [`../settings/presentation.json`](../settings/presentation.json) | 房屋级覆盖 |
| `public/assets/` | 运行时被页面请求的图片 |
| `assets/` | 源文件和参考图，不直接给页面用 |
| [`../src/sprites/`](../src/sprites/) | 浏览器里的 HTML 呈现器，见 [frontend.md](frontend.md) |

人物可选的 `appearance` 写在 `settings/characters/<id>.json`，不并入房屋展示配置。

## 对外接口

`resolvePresentation(settings)` 的合并顺序：代码默认 ← `settings/presentation.json` ← `house.presentation`。人物不能改房屋锚点、包名或「谁被画出来」。

`getPresentationCatalog({ settings, config, root })` 返回缓存的目录，设定热更新时由 `reloadSettings` 调用 `invalidatePresentationCatalog`。目录大致包括：`pack`、`presenter`、画幅、`fit`、每房最多可见人数、默认姿势、姿势别名、过渡毫秒、是否可点击聚焦、是否显示名牌、资源路径模板、各房间的背景图 / 锚点 / 前景道具，以及每人的资源目录、画框、轴点、可用姿势和偏好锚点。缺失的角色图会落到 `fallback` 剪影，并标明该姿势文件是否存在。

`GET /api/presentation` 在进程里现读设定、解析展示配置后返回上述目录。

布局函数供前端呈现器使用（[`../src/sprites/html.js`](../src/sprites/html.js) 直接引用）：

- `resolvePose(action, appearance, config)`：把动作映射到姿势。默认 `talk` / `idle` 别名为 `sit`。可用姿势是 `sit`、`eat`、`wash`、`sleep`
- `assignSlots(occupants, roomAnchors, prefs, config)`：按偏好锚点、姿势是否匹配来占座；超出 `maxVisiblePerRoom` 的人不画
- `mapAnchorToScreen`：把 1280×720 画布上的锚点映射到当前视口（默认 `cover`）

点击立绘只通知前端聚焦，不会改对话框的发送对象，见 [frontend.md](frontend.md)。

## 数据与状态

不写 `world.json`，不建表。唯一的进程内状态是目录缓存。运行时资源在 `public/assets/`（构建后会出现在 `dist/assets/`）：

- `public/assets/rooms/v1/`：房间静帧和前景（如桌子、被子）
- `public/assets/characters/v1/<id>/`：角色各姿势 PNG 与 `meta.json`（画框、轴点）
- `public/assets/characters/v1/fallback/`：缺图时的剪影
- `public/assets/props/`、`public/assets/ui/`：道具与界面素材

`assets/reference` 与 `assets/source` 是创作源文件，部署时不必复制到运行环境，页面也不会去读它们。

## 可配置项

房屋级：包名、呈现器类型、画幅、适配方式、每房可见人数、默认姿势和别名、过渡、点击与名牌、资源路径模板、每个房间的 `anchors`（`id`、`x`、`y`、`poses`、`scale`、可选 `z`）和 `props`。人物级 `appearance`：资源目录、缩放、`preferredAnchors`（按房间指定锚点 id）。设置页目前不逐项编辑锚点坐标，改这些文件或人物设定即可。默认值和坐标以 `config.js` / `presentation.json` 为准。

客厅当前只有两个坐位锚点（`sofa-left`、`sofa-right`）。餐厅有四个座位，浴室一个洗漱位，三间卧室各有床位。

## 调用关系

HTTP 入口直接组目录，不经过 `world.publicState`。前端启动时拉一次，房间切换只改用已缓存的目录做布局。生活和对话改变的是 `action` / `room`，展示层只读取这些字段来选姿势和占座。寻址（谁听得见）仍在 `house.chat`，与谁被画出来无关。

## 扩展点

加角色资产：把姿势图和 `meta.json` 放到 `public/assets/characters/v1/<id>/`，在人物设定里写 `appearance`。加房间或座位：在 `presentation` 配置的 `rooms` 里增加锚点，并保证 [`../server/rooms.js`](../server/rooms.js) 已有该房间。路径模板用 `{pack}` `{roomId}` `{characterId}` `{pose}`。呈现器名称里虽有 `pixi` / `live2d`，当前实现仍会落到 HTML，见下方「尚未实现」。

## 不变量与禁区

- 人物设定不能改房屋锚点或可见性规则
- 目录和资源路径不得包含密钥
- 不要把 `assets/` 源目录当成运行时 URL
- 培养不得改展示配置文件
- `talk` 没有独立立绘时必须经别名落到已有姿势，不要假定有走路或口型图层

## 测试

- [`../server/presentation/catalog.test.js`](../server/presentation/catalog.test.js)
- [`../server/presentation/layout.test.js`](../server/presentation/layout.test.js)

布局测试不依赖浏览器，也不触网。

## 尚未实现

走路动画；客厅第三个坐位；林夏被子裹紧的立绘；心情驱动表情；嘴型同步。`pixi` / `live2d` 呈现器只有保留名，实际不会构造，一律走 HTML。房屋级 `config.props` 预留作家具遮挡，v1 里是空数组（房间内的桌子、被子写在各房间的 `props` 上）。
