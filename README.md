# Worldline

> **别人做播放器，我们做「在场的幻觉」。**

一个常驻 Windows 桌面的「世界感知器」。随时**降落**到地球上某个城市 —— 听觉（当地电台）与视觉（桌面壁纸）同时到位。

你的屏幕是一扇窗。声音是你所在的位置。

---

## 这是什么

桌面上摆着一颗**实体地球仪**：黄铜子午环、木质底座、哑光纸质地图贴面，插满了世界各地的图钉。

点一枚图钉，镜头俯冲下去 —— 球面的纸质地图逐渐溶解成那座城市的真实影像，同时当地电台的声音淡入。2 秒之内，你的桌面移动到了里约。

> **世界从我的桌上展开成了我的屏幕。**

## 为什么做这个

| 产品 | 做了什么 | 缺了什么 |
|---|---|---|
| Wallpaper Engine | 视觉（壁纸引擎） | 没有内容源，只是播放器 |
| Radio Garden | 声音（全球电台地图） | 停在浏览器标签页里，没有"落地" |
| Spotify | 音乐 | 推荐的是你熟悉的，不是陌生的世界 |
| Google Earth | 视觉探索 | 是工具，不是陪伴 |

**没人把它们合成一个「桌面上的世界」。**

## 状态

🚧 **早期开发中** —— 当前处于 **P0 地基**阶段，尚无可用功能。

进度、实测指标与已知问题见 **[`PROGRESS.md`](./PROGRESS.md)**。

## 技术栈

| | |
|---|---|
| 前端 | React 19 + TypeScript（strict） |
| 3D | three.js（自建场景，非 globe.gl） |
| 构建 | Vite |
| 校验 | zod（所有外部 API 响应） |
| 测试 | Vitest + Testing Library |
| 桌面（P7+） | Tauri 2 |
| 数据 | Radio Browser / Open-Meteo / NASA GIBS / Wikimedia Commons |

## 快速开始

```bash
git clone https://github.com/liuuuuuu/worldline.git
cd worldline
npm install
npm run dev
```

### 脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 类型检查 + 构建 |
| `npm run build:single` | 构建为单文件 `dist/index.html`（双击即用） |
| `npm run check` | 类型检查 + lint + 格式检查 + 测试（**提交前必须全绿**） |
| `npm run test` | 跑测试 |
| `npm run test:coverage` | 带覆盖率 |

## 文档

| 文件 | 内容 |
|---|---|
| [`docs/PRODUCT.md`](./docs/PRODUCT.md) | 产品定义、竞品空位、六个核心机制 |
| [`docs/VISUAL.md`](./docs/VISUAL.md) | 实体地球仪的材质 / 光照 / 构图规范 |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | 三层结构、Source 插件接口、分层拆解 |
| [`docs/ROADMAP.md`](./docs/ROADMAP.md) | 分阶段路线图、质量门禁、风险清单 |
| [`docs/decisions/`](./docs/decisions/) | ADR：关键技术决策记录 |
| [`PROGRESS.md`](./PROGRESS.md) | 项目进度档案 |

## 数据来源与致谢

- [Radio Browser](https://www.radio-browser.info/) —— 全球电台目录（社区维护，免费无 key）
- [Open-Meteo](https://open-meteo.com/) —— 天气与时区
- [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs) —— 卫星影像（公有领域）
- [Natural Earth](https://www.naturalearthdata.com/) —— 地图矢量数据（公有领域）
- [Wikimedia Commons](https://commons.wikimedia.org/) —— 城市照片（逐图 CC 许可，使用时标注）

## 许可证

[MIT](./LICENSE)
