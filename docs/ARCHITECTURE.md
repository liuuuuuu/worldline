# Worldline · 架构

## 三层结构

内核只认「载荷类型」，不认具体数据源。

| 层 | 职责 | 内容 |
|---|---|---|
| **感官层 · 输入** | 从世界取回信号 | 全球电台 / 环境声景 / 实时画面 |
| **表达层 · 输出** | 把信号变成可感知的东西 | 实时壁纸 / 多屏独立 / 悬浮组件 |
| **时空层 · 调度** | 决定"此刻该是什么" | 当地时刻 / 日出日落 / 天气与作息 |

## 核心约束

> 电台、声景、摄像头、壁纸源，全部抽象为同一种 **Source 插件**；
> 壁纸只是「输出渲染器」之一。
> **新增内容源 = 加一个 Source，内核零改动。**

这是长期可维护性的根本。任何"为了赶进度直接写死一个数据源"的做法都会在第三个源出现时崩掉。

## Source 插件接口

```ts
type Channel = 'audio' | 'visual' | 'meta';

type Payload =
  | { type: 'audio-stream'; url: string; codec: string; bitrate: number; title: string }
  | { type: 'image';        url: string; attribution: string }
  | { type: 'tile-layer';   template: string; attribution: string }
  | { type: 'live-camera';  url: string; format: 'hls' | 'mjpeg' };

interface Source<P extends Payload = Payload> {
  manifest: {
    id: string;
    channels: Channel[];
    requiresGeo: boolean;
    attribution: string;
  };
  discover(ctx: { geo: GeoPoint; locale: string; signal: AbortSignal }): Promise<P[]>;
  connect?(payload: P, ctx: SourceContext): Promise<Handle>;   // 仅流类源需要
}
```

### 设计难点与解法

**难点**：电台（音频流）和壁纸源（图片/瓦片）是截然不同的东西，怎么塞进同一个抽象？

**解法**：**「发现 / 载荷」分离 + 载荷判别联合**。

- `discover()` 是统一入口——所有源都能"给定位置，返回一批载荷"
- 返回的 `Payload` 是**判别联合**，靠 `type` 字段区分
- 渲染层按 `Payload['type']` 注册对应 Renderer
- 只有流类源（音频、摄像头）才需要实现可选的 `connect()`

电台源 `discover` 返回 `audio-stream[]`；壁纸源返回 `image[] | tile-layer[]`。两者共用同一条生命周期，内核不需要 `if (sourceType === 'radio')`。

## 分层拆解

九层，自底向上。**每一层都能独立验证**——这是质量保障的地基。

| 层 | 职责 | 关键文件 | 依赖 | 独立验证 |
|---|---|---|---|---|
| L0 工具链 | 构建 / 类型 / lint / 测试 / CI | `vite.config.ts` `tsconfig.json` `.github/workflows/ci.yml` | — | `npm run check` |
| L1 数据 | Source 抽象 + API 适配 + 缓存 + schema 校验 | `types/source.ts` `sources/*.ts` | L0 | 单测 + MSW 集成测 |
| L2 场景 | three.js 世界：几何 / 材质 / 光照 / 桌面 | `scene/globeMesh.ts` `scene/paperTexture.ts` `scene/desk.ts` | L0 | `/dev/globe` |
| L3 交互 | 图钉渲染与拾取、相机控制、手势 | `scene/pins.ts` `scene/camera.ts` | L2 | `/dev/pins` |
| L4 音频 | 播放、淡入淡出、容错跳台、频谱 | `audio/player.ts` `audio/spectrum.ts` | L1 | `/dev/audio` |
| L5 编排 | 降落时间轴、状态机、跨层协调 | `landing/landingSequence.ts` `state/store.ts` | L2 L3 L4 | `/dev/landing` |
| L6 表现 | 实景合成、shader 混合、信息卡 | `scene/landingShader.ts` `sources/cityImagery.ts` | L5 | 关键帧视觉回归 |
| L7 界面 | 侧栏、搜索、收藏、壁纸预览 | `ui/*.tsx` | L1 L5 | 组件测试 |
| L8 桌面集成 | Tauri 壳、静态壁纸、托盘、快捷键 | `apps/desktop/**` | 全部 | 手动清单 |

> **`/dev/*` 独立路由是最实用的设计**：每层都能单独打开看，改坏了立刻知道是哪一层。

## 数据源

| 源 | 用途 | 接口 | 认证 | 实测状态 |
|---|---|---|---|---|
| **Radio Browser** | 全球电台 | `all.api.radio-browser.info`（DNS 轮询入口） | 无 key，需带 UA | ✅ 60,505 台 / CORS `*` / 带坐标约 1 万台 |
| **Open-Meteo** | 天气 + 时区 | `api.open-meteo.com/v1/forecast` | 无 key | ✅ 一次返回天气 + IANA 时区 + `utc_offset_seconds` |
| **NASA GIBS** | 降落段卫星瓦片 | WMTS | 无 key | ✅ 公有领域 |
| **Wikimedia Commons** | 落地城市照片 | `commons.wikimedia.org/w/api.php` `geosearch` | 无 key（需 `origin=*`） | ⚠️ 本机代理下未能验证 |

**要点**
- Radio Browser 用 `stationuuid`（跨镜像稳定）作主键，**不用** `id`
- 镜像顺序：`all` → `de1` → `nl1` → `at1` → `fi1`，失败顺延
- 所有外部响应过 **zod schema**（`sources/schemas.ts`）。第三方字段随时可能变，没有校验就会静默返回 `undefined`

## 长期仓库结构

```
worldline/
├── apps/
│   ├── desktop/          # Tauri 2 + React（正式产品）
│   ├── web/              # 概念原型
│   └── relay/            # http 音频中转（发布用，可选）
├── packages/
│   ├── core/             # Source 内核：注册表 / 生命周期 / 调度
│   ├── scene/            # 地球仪场景（桌面与 web 共用）
│   ├── sources-radio/    # Radio Browser
│   ├── sources-visual/   # GIBS / Commons / 摄像头
│   ├── renderers/        # 壁纸渲染器 / 悬浮组件渲染器
│   └── shared/           # 类型、工具
└── docs/
```

## Tauri 侧能力（P7+）

| 能力 | 方案 | 风险 |
|---|---|---|
| 静态壁纸 | `SystemParametersInfo` / `IDesktopWallpaper` COM（支持按显示器独立设置） | 低 |
| 动态 WebGL 壁纸 | 需把窗口挂到 `WorkerW` 置底 | **高，无官方 API** |
| 音频频谱 | 优先 webview 内 Web Audio `AnalyserNode`（省 Rust 解码） | 低 |
| 托盘 / 全局快捷键 / 多屏枚举 | `tauri-plugin-tray` + `global-shortcut` + Win32 | 低 |

## 音频的关键约束

- `file://` 下播放 `http://` 流：预期不触发混合内容拦截（file:// 非安全上下文），**需实测确认**
- 本地原型不受此限制。**若将来发布 https 链接**，热门台约 71% 仅 http，必被拦截 → 需要服务端中转（`apps/relay`）：按 `stationuuid` 反查地址、不做通用代理、SSRF 守卫、HLS 重写 m3u8 内所有 URL、仅 http 走代理
- 单 `<audio>` 复用 + Web Audio `GainNode` 淡入淡出。无限直播流不能靠切 `src` 硬切
