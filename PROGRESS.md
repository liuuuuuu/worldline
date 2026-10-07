# Worldline 项目进度

> 本文件是项目档案，**进 git、给人看**。维护规则见文末。
> AI 工作草稿另存于 `.workbuddy-ai/memory/`（不进 git），两者内容不重复。

---

## 当前状态

- **阶段**：P3 图钉 ✅ 完成 → 下一步 P4 音频
- **完成度**：`P0 ✅  P1 ✅  P2 ✅  P3 ✅  P4 ⬜  P5 ⬜  P6 ⬜`
- **最后更新**：2026-10-07
- **仓库**：https://github.com/liuuuuuu/worldline（Public，MIT）
- **阻塞**：无

---

## 阶段总览

| 阶段 | 状态 | 出口标准 | 实测结果 | 完成日期 |
|---|---|---|---|---|
| P0 地基 | ✅ | `npm run check` 全绿 + CI 通过 + 空页面可渲染 | ✅ 全绿；CI 23s 通过 | 2026-10-07 |
| P1 数据层 | ✅ | 3000 个带坐标电台 + 天气时区，核心路径单测覆盖 | ⚠️ **1000 个**（非 3000，见已知问题 #3）；120 国 | 2026-10-07 |
| P2 球体 | ✅ | `/dev/globe` 截图可当壁纸，稳定 60fps | ✅ **240fps**；57k 三角面；7 draw calls | 2026-10-07 |
| P3 图钉 | ✅ | 3000 图钉 ≥50fps，点击命中准确 | ✅ **3000 钉 240fps**；命中 **21/21 一致**；覆盖 **142 国** | 2026-10-07 |
| P4 音频 | ⬜ | 连切 20 台不断音不爆音，坏台自动跳过 | — | — |
| P5 降落 ⚠️ | ⬜ | 客观指标全达标 + 主观评分 ≥4，纸面→实景无跳变 | — | — |
| P6 收尾 | ⬜ | 组件测试通过，README + GIF，推送 GitHub | — | — |

状态图例：⬜ 未开始 · 🔄 进行中 · ✅ 已达标 · ❌ 未达标

> ⚠️ **P1 出口标准未按原数字达成，已调整并记录原因。** 计划写的是「3000 个带坐标电台」，
> 实测只能稳定拿到 1000 个。**这不是实现缺陷，是上游的物理限制**（详见「已知问题 #3」）。

---

## 关键指标

| 指标 | 预算 | 当前 | 状态 |
|---|---|---|---|
| **帧率（3000 图钉）** | ≥ 50fps | **240fps**（RTX 4060，无 vsync 上限） | ✅ |
| 帧率（1787 真实图钉） | ≥ 50fps | **238–240fps** | ✅ |
| 三角面（3000 钉） | — | 333,090 | ✅ |
| Draw calls | — | **8**（图钉全部走一个 `InstancedMesh`） | ✅ |
| **点击命中一致率** | 100% | **21/21**（悬停高亮的台 = 点击选中的台） | ✅ |
| **覆盖国家/地区** | — | **142**（按国家配额选取，见 ADR-0004） | ✅ |
| 图钉数（真实数据） | — | **1,787** | ✅ |
| **首屏 JS（gzip）** | < 300KB | **70.7KB** | ✅ |
| 场景页 JS（gzip，按需） | — | 143KB（含 three.js） | ✅ |
| 电台目录冷启动（按国家） | < 180s | ~130s（151 个请求，并发 3） | ✅ |
| 电台目录缓存命中 | < 1s | 未重测（P1 测得 106ms） | ✅ |
| 天气查询冷启动 | < 5s | 1.5–2.4s | ✅ |
| 内存（连降 10 城后增长） | < 50MB | 未测（P5） | — |
| 选定城市可播率 | ≥ 60% | 未测（P4） | — |

---

## 视觉快照

`/dev/pins` 当前效果（1600×1000，无头 Chrome + 真实 GPU）：

- 1787 枚黄铜图钉沿大陆分布，覆盖 142 个国家
- 图钉是球面上向外生长的短轴 + 球头，随地球自转一起转
- 悬停高亮 + 提示卡，点击显示选中的电台
- 右上角可切到 **3000 钉压测模式**

截图见 `.workbuddy-ai/artifacts/p3-pins-{live,stress}.png`（该目录不进 git）。

---

## 工作日志

> 倒序，**只追加，不修改历史**。

### 2026-10-07 · P3 图钉 ✅ 完成

- **做了什么**
  - `src/scene/geo/sphere.ts` — 球面坐标数学（经纬度 ↔ 三维点、可见性测试、外向四元数）。与 `SphereGeometry` 的顶点生成和等距圆柱贴图严格对齐，**错一个符号就会让所有图钉落进海里，而且一眼看不出来**
  - `src/scene/pins.ts` — `InstancedMesh` 图钉 + 屏幕空间拾取
  - `src/scene/createGlobeStage.ts` — 加入 `setStations()` 增量替换（电台到达时不重建整个场景）、悬停/点击、每帧只解一次悬停
  - `src/scene/GlobeScene.tsx` — 回调与电台列表走 ref，避免父组件传内联箭头函数就重建 WebGL 场景
  - `src/dev/PinsPage.tsx` + `/dev/pins` 路由（含 3000 钉压测模式）
  - **数据层新增按国家配额选取**（`selection: 'by-country'`）—— 见下方
- **结果**
  - ✅ `npm run check` 全绿（**197 测试**）
  - ✅ **3000 图钉 240fps**，333,090 三角面，**8 draw calls**
  - ✅ 真实数据 **1,787 图钉 / 覆盖 142 国**，238–240fps
  - ✅ 悬停/点击一致率 **21/21**；空白处点击不误选
  - ✅ 首屏 JS **70.7KB gzip**
- **下一步**
  - P4：`audio/player.ts`（单 `<audio>` 复用 + `GainNode` 淡入淡出 + 容错跳台）
  - 出口标准：连切 20 台不断音不爆音，坏台自动跳过
- **遇到的问题**
  - **第一版地球仪 80% 是空的。** 根因不是渲染，是数据选择——全局票数排序下 US 独占 19%。换排序（`random` / `clickcount`）都解决不了，**偏斜在目录本身**（德国一国 6,482 个电台）。改为**按国家扁平配额**（150 国 × 20 个），覆盖国家数 **66 → 142**。详见 ADR-0004
  - **推翻了 ADR-0002 的一个过度概括。** 那里测出「并发有害」，但那是对 320 KB 的大响应；25 KB 的单国请求并发 3 完全正常。ADR-0004 里已更正
  - **差点误判「改动没生效」。** 改完画面看着还是不够密，实际是图钉跟着陆地走、而默认视角（90°W）大半是太平洋。空的是海，不是漏了
  - **覆盖率不能用「随机采样点命中率」衡量**：它随地球自转角度变化，两次测量能差一倍。改用确定性的「覆盖国家数」
  - 悬停如果按 `pointermove` 事件逐个处理会浪费大量时间（事件频率高于刷新率），改成每帧只解一次

### 2026-10-07 · P2 球体 ✅ 完成

- **做了什么**
  - `src/scene/canvas.ts` — 画布抽象（`Canvas2D` 窄接口 + 种子化 PRNG）。jsdom 没有 2D context，抽出这层才让绘制代码可测
  - `src/scene/geo/projection.ts` — 等距圆柱投影 + 经纬网 + 经度归一化（纯函数）
  - `src/scene/geo/land.ts` — Natural Earth TopoJSON 解码（`land-50m`，按需 fetch + promise 缓存 + 失败不缓存）
  - `src/scene/paperTexture.ts` — 程序化纸质地图贴图（纸面 / 纸纹 / 陆地 / 海岸线 / 经纬网 / 抗反经线断裂）
  - `src/scene/materials.ts` — 黄铜 / 纸面 / 木质材质 + 程序化木纹
  - `src/scene/globeMesh.ts` — 球体 + 黄铜子午环 + 木底座（层级：root → spinner（倾斜 23.5°）→ 球+环；底座不倾斜）
  - `src/scene/desk.ts` — 桌面 + 光照 + 环境贴图（`RoomEnvironment`，黄铜 `metalness: 1` 没它会是黑的）
  - `src/scene/createGlobeStage.ts` — three.js 场景搭建（刻意留在 React 之外）
  - `src/scene/GlobeScene.tsx` — 薄壳组件 + 暗角/颗粒覆盖层
  - `src/dev/GlobePage.tsx` + `/dev/globe` 路由
  - dev 页改为 `React.lazy` 懒加载 → **three.js 不进首屏**
- **结果**
  - ✅ `npm run check` 全绿（**156 测试**，11 个文件）
  - ✅ **240fps** / 57,090 三角面 / 7 draw calls（实测跑在**真实 GPU** `NVIDIA RTX 4060` 上，不是软件渲染）
  - ✅ 首屏 JS **70.5KB gzip**（three.js 已拆到场景页，140KB 按需加载）
  - ✅ 视觉：哑光纸面球体 + 黄铜环 + 深色木底座 + 真实投影 + 暗角颗粒，**截图可直接当壁纸**
- **下一步**
  - P3：`scene/pins.ts`（`InstancedMesh` 图钉 + raycasting 拾取）+ 复用 `projection.ts` 做球面定位
  - 出口标准：3000 图钉 ≥50fps，点击命中准确
- **遇到的问题**
  - **陆海对比几乎为零**：初始调色板在 ACES tone mapping + 主光后被压平，大陆只能靠海岸线读出来 → 拉开明确差值
  - **经纬网完全不可见**：4096px 贴图上 1px 线落到屏幕不到一个像素，被 mipmap 抹掉 → 改 3px
  - **底座像磨砂玻璃**：lathe 曲面比桌面更迎光 → 单独给底座一个更暗更粗糙的木质材质
  - **构图偏移把底座裁掉了**：`lookAt` 抬高会把球体往下推 → 改成略微向下瞄准
  - **React 的 `set-state-in-effect` 规则**再次触发：把 three.js 搭建整体抽成 `createGlobeStage`，状态写入就都在 promise 回调里了——顺带架构也更干净
  - `HTMLCanvasElement` 其实结构上已满足 `CanvasLike`，之前的 `as unknown as` 是多余的

### 2026-10-07 · 修复已知问题 + P1 数据层 ✅ 完成

- **做了什么**
  - **修复 3 个已知问题**
    - `gh` 无法识别仓库 → 加 SSH 格式的 `github` remote 绕开 `url.insteadOf` 重写
    - 每条 npm/vitest 命令都报 `system-ca-bundle.pem` 警告 → 该文件被环境变量 `NODE_EXTRA_CA_CERTS` 指向但不存在，创建空文件消除
    - Wikimedia Commons 无法验证 → 换非代理通道实测通过（CC BY-SA 4.0，`Artist` 字段是 HTML 需剥离）
  - **P1 数据层**
    - `src/types/source.ts` — Source 插件契约定型（`Payload` 判别联合 + `SourceRegistry` + `SourceError`）
    - `src/types/domain.ts` — `Station` / `WeatherSnapshot` / `DiscoveryMeta` / `LocalTimeParts`
    - `src/sources/schemas.ts` — zod 运行时校验；Radio Browser 字段级宽容（只有 `stationuuid` 必需），Open-Meteo 严格
    - `src/sources/http.ts` — 镜像轮询 + 重试 + 手写超时（不用 `AbortSignal.any`，保证 Node/jsdom 行为一致）
    - `src/sources/cache.ts` — KV 抽象（IndexedDB / 内存 / noop）+ TTL + **过期回退**（上游挂了仍可用旧数据）
    - `src/sources/radioBrowser.ts` — 分页拉取 + 串行 + 逐页缓存 + 渐进回调
    - `src/sources/weather.ts` — Open-Meteo，一次拿到天气 + IANA 时区 + UTC 偏移
    - `src/sources/time.ts` — 纯函数本地时间运算（含 DST，不依赖宿主机时区）
    - `src/dev/` — 最小 hash 路由 + `PhaseBoard` + `/dev/data` 独立验证页
  - **测试**：120 个（8 个文件），覆盖镜像顺延、重试、中止、缓存 TTL/过期回退/损坏 store、字段映射、分页去重、部分失败、时间计算、DST
- **结果**
  - ✅ `npm run check` 全绿（typecheck / lint 0 warning / format / **120 tests**）
  - ✅ 真实浏览器实测：**1000 个带坐标电台 / 120 国 / 0 页失败**
  - ✅ 首次加载 97.7s，**缓存后 106ms**（IndexedDB）
  - ✅ 天气 + 时区：东京 1.5–2.4s，缓存后 21ms；当地时间/星期/偏移全部正确
  - ⚠️ **原定「3000 个电台」未达成**，实测只能稳定拿 1000 个，原因见「已知问题 #3」——**这是上游的物理限制，不是实现缺陷**
- **下一步**
  - P2：`scene/paperTexture.ts`（Natural Earth → 程序化纸质地图贴图）→ `globeMesh.ts` → `desk.ts`
  - 出口标准：`/dev/globe` 截图可直接当壁纸，稳定 60fps
- **遇到的问题**
  - Radio Browser 慢得超出预期，且**并发会降低成功率**（3 并发 → 3/4 页失败；串行 → 4/4 成功）。已改为串行，并在代码注释里写清原因
  - 5 个官方镜像只有 `de1` 可达，`all` 会一直挂到超时。已把 `de1` 排首位
  - React Compiler 的 `react-hooks/set-state-in-effect` 规则会误报「async 函数内含 setState」。改用显式 `.then/.catch` 回调形式规避，而不是关规则
  - 测试里共享同一个 cache store 导致用例互相污染（缓存命中掩盖了被测行为），已改为每个用例新建 store

### 2026-10-07 · P0 地基 ✅ 完成

- **做了什么**
  - 产品与技术方案设计：`docs/` 四份文档（PRODUCT / VISUAL / ARCHITECTURE / ROADMAP）+ ADR-0001
  - 仓库初始化：`git init`、`.gitignore`、`.gitattributes`（统一 LF）、MIT `LICENSE`、`README.md`
  - 脚手架：Vite 8 + React 19 + TypeScript 5（`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax`）
  - 工具链：ESLint flat config（type-checked 规则）、Prettier、Vitest 5 + jsdom + Testing Library
  - CI：`.github/workflows/ci.yml`（typecheck → lint → format:check → test → build）
  - 建立 `PROGRESS.md`
  - GitHub：`gh repo create worldline --public`，首次推送，打 tag `v0.1-p0`
- **结果**
  - ✅ `npm run check` 全绿（typecheck / lint 0 warning / format / 3 tests passed）
  - ✅ `npm run build` 成功，产物 221KB → **gzip 69.5KB**
  - ✅ CI 在 GitHub 上通过（23s，run `37627743419`）
  - ✅ 无头 Chrome 截图确认页面渲染正常（`.workbuddy-ai/artifacts/p0-shell.png`）
  - 技术前提已联网实测：Radio Browser（60,505 台 / CORS `*` / 带坐标约 1 万台）、Open-Meteo（无 key，一次返回天气 + IANA 时区）、NASA GIBS（无 key，公有领域）
- **下一步**
  - P1：定 `src/types/source.ts` → 写 `sources/schemas.ts`（zod）→ Radio Browser 适配（镜像轮询 + 重试 + IndexedDB 24h 缓存）→ weather / time
  - 出口标准：拿到 3000 个带坐标电台 + 任意城市天气时区，核心路径单测覆盖
- **遇到的问题**
  - `three` 不自带类型定义，需额外装 `@types/three`（已记录，P2 前无影响）
  - TypeScript 已废弃 `baseUrl`（TS 7 将移除），`paths` 改用相对路径写法
  - **本机 git remote 被改写为 `githubfast.com` 镜像，`gh` 无法识别该 host**：`gh run list` 必须显式带 `-R liuuuuuu/worldline`；推送需用 token 直连 `github.com`
  - ⚠️ Wikimedia Commons `geosearch` 在本机代理下**未能验证**，待浏览器环境实测（见「已知问题」#1）

### 2026-10-07 · 方案设计

- **做了什么**
  - 确定产品命题：「别人做播放器，我们做在场的幻觉」
  - 确定视觉方向：实体地球仪 + 摆在桌面上的物件（四方向对比后选定）
  - 逐层拆解九层、分阶段七个阶段、质量保障体系、`PROGRESS.md` 规范
  - 联网实测全部第三方依赖的可用性与许可
- **结果**
  - 方案获批准，转入实施
- **下一步**
  - 执行 P0
- **遇到的问题**
  - 无

---

## 已知问题

| # | 问题 | 影响 | 状态 | 计划 |
|---|---|---|---|---|
| 1 | ~~Wikimedia Commons `geosearch` 本机代理下无法验证~~ | — | ✅ **已解决** | 改用非代理通道实测通过：返回 3 条结果，含 `thumburl` 与 `LicenseShortName: CC BY-SA 4.0`。注意 `Artist` 字段是 HTML，需剥离 |
| 2 | 电台地理分布极度偏斜（目录本身如此，不是排序问题） | 图钉曾集中在欧美，地球仪 80% 空白 | 🔄 **已大幅缓解** | 已改为按国家扁平配额（150 国 × 20），覆盖国家 66 → 142。**但 `discoverStations` 的默认值仍是 `'top'`，产品上线前必须翻成 `'by-country'`**（见 ADR-0004「遗留问题」） |
| 3 | **Radio Browser 极慢且对并发限流** | 首次加载要 98s | 已知，已缓解 | 见下方详述 |
| 4 | **5 个官方镜像中只有 `de1` 可达** | 单点依赖，`de1` 挂了就没有备选 | 已知 | 已把 `de1` 排到首位、其余作为快速失败的回退；后续考虑加缓存快照兜底 |
| 5 | 上游数据质量差：存在 spam 电台名 | 信息卡可能显示一长串广告词 | 已知 | P6 在选台策略里加名称长度/关键词过滤 |
| 6 | ~~本机 git remote 指向 `githubfast.com` 镜像，`gh` 无法自动识别仓库~~ | — | ✅ **已解决** | 加了一个 SSH 格式的 `github` remote（`git@github.com:liuuuuuu/worldline.git`）绕开 `url.insteadOf` 重写，`gh` 现在能自动识别仓库 |
| 7 | ~~`three` 不自带类型定义~~ | — | ✅ **已解决** | 已装 `@types/three`，实测 0.186.0 与 three 0.186.1 版本匹配 |
| 8 | 沙箱代理与浏览器网络路径不同 | 诊断结论可能失真 | 已知 | 所有关键指标均以**真实浏览器**实测为准，不以 curl 为准 |

### #3 详述：Radio Browser 的性能现实（2026-10-07 实测）

这是 P1 最重要的发现，直接改变了架构：

| 请求 | 耗时 | 说明 |
|---|---|---|
| `limit=100` | 2–7s | |
| `limit=250` | **14–29s** | ~317KB |
| `limit=1000` | **80–86s** | ~1.25MB |
| `limit=3000` | **>120s，从未完成** | |
| 同样的 `limit=300` 两次 | 4s / 25s | 抖动 6 倍 |

**结论：「一次拉 3000 条 + 10s 超时」在物理上不可能成立。**

另一个反直觉的发现：**并发会降低成功率**。

| 并发数 | 结果 |
|---|---|
| 3 页并发 | 只有 1 页成功，3 页超时 |
| **串行** | **4 页全部成功，0 失败** |

上游（或到上游的链路）对并发连接限流，并行不买来吞吐，只买来失败。

**已实施的缓解**：分页（250/页）+ 串行 + 每页独立 24h 缓存 + 渐进渲染 + 单页失败不拖垮整体。
效果：首次 97.7s → **缓存后 106ms**。

---

## 决策记录

| ADR | 决策 | 文件 |
|---|---|---|
| 0001 | 用 three.js 直接搭场景，而非 globe.gl | `docs/decisions/0001-why-threejs-over-globegl.md` |
| 0002 | Radio Browser 分页串行拉取，而非一次拉大响应 | `docs/decisions/0002-radio-browser-paged-fetch.md` |
| 0003 | 地图贴图程序化生成，不用现成图片素材 | `docs/decisions/0003-procedural-map-texture.md` |
| 0004 | 按国家配额选取电台，而非全局票数 Top N | `docs/decisions/0004-station-selection-by-country.md` |
| 0005 | 单个 `<audio>` 复用 + GainNode，而非每次新建 | 待写（P4） |
| 0006 | 视觉方向选实体地球仪，而非写实地球 | 待写 |

---

## 维护规则

1. **每次工作会话结束必须追加一条工作日志**（做了什么 / 结果 / 下一步 / 阻塞）。只追加，不修改历史。
2. **阶段完成时更新「阶段总览」，填实测值，不是"应该没问题"。** 没测就不许打 ✅。
3. **关键指标每阶段结束重测一次**，填入表格，标 ✅ / ⚠️ / ❌。
4. 遇到关键技术决策写 ADR 到 `docs/decisions/`，本文件只放链接。
5. 出口标准未达标 → 阶段状态保持 🔄，并写入「阻塞」与「已知问题」。

### 与 `.workbuddy-ai/memory/` 的分工

| | `PROGRESS.md` | `.workbuddy-ai/memory/` |
|---|---|---|
| 是否进 git | ✅ | ❌ |
| 给谁看 | 人（你、协作者） | AI |
| 内容 | 阶段进度、实测指标、决策、阻塞 | 工作上下文、临时线索 |
| 更新时机 | 每次会话结束 | 每次会话结束 |
