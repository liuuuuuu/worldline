# Worldline 项目进度

> 本文件是项目档案，**进 git、给人看**。维护规则见文末。
> AI 工作草稿另存于 `.workbuddy-ai/memory/`（不进 git），两者内容不重复。

---

## 当前状态

- **阶段**：P0 地基（进行中）
- **完成度**：`P0 🔄  P1 ⬜  P2 ⬜  P3 ⬜  P4 ⬜  P5 ⬜  P6 ⬜`
- **最后更新**：2026-10-07
- **阻塞**：无

---

## 阶段总览

| 阶段 | 状态 | 出口标准 | 实测结果 | 完成日期 |
|---|---|---|---|---|
| P0 地基 | 🔄 | `npm run check` 全绿 + CI 通过 + 空页面可渲染 | — | — |
| P1 数据层 | ⬜ | 3000 个带坐标电台 + 天气时区，核心路径单测覆盖 | — | — |
| P2 球体 | ⬜ | `/dev/globe` 截图可当壁纸，稳定 60fps | — | — |
| P3 图钉 | ⬜ | 3000 图钉 ≥50fps，点击命中准确 | — | — |
| P4 音频 | ⬜ | 连切 20 台不断音不爆音，坏台自动跳过 | — | — |
| P5 降落 ⚠️ | ⬜ | 客观指标全达标 + 主观评分 ≥4，纸面→实景无跳变 | — | — |
| P6 收尾 | ⬜ | 组件测试通过，README + GIF，推送 GitHub | — | — |

状态图例：⬜ 未开始 · 🔄 进行中 · ✅ 已达标 · ❌ 未达标

---

## 关键指标

| 指标 | 预算 | 当前 | 状态 |
|---|---|---|---|
| 帧率（3000 图钉，中端核显） | ≥ 50fps | 未测 | — |
| 冷启到首帧 | < 2s | 未测 | — |
| 降落动画帧率 | ≥ 50fps 稳定 | 未测 | — |
| 首屏 JS（gzip，不含 three） | < 300KB | 未测 | — |
| 内存（连降 10 城后增长） | < 50MB | 未测 | — |
| 选定城市可播率 | ≥ 60% | 未测 | — |

---

## 工作日志

> 倒序，**只追加，不修改历史**。

### 2026-10-07

- **做了什么**
  - 完成产品与技术方案设计（`docs/` 四份文档 + ADR-0001）
  - P0 地基：`git init`、`.gitignore`、MIT `LICENSE`、`README.md`
  - 脚手架：Vite + React + TypeScript（`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`）
  - 工具链：ESLint（flat config + type-checked 规则）、Prettier、Vitest（jsdom）
  - CI：`.github/workflows/ci.yml`（typecheck → lint → format:check → test → build）
  - 建立本文件
- **结果**
  - 依赖安装中，`npm run check` 待验证
  - 技术前提已联网实测：Radio Browser（60,505 台 / CORS `*` / 带坐标约 1 万台）、Open-Meteo（无 key，一次返回天气+IANA 时区）、NASA GIBS（无 key，公有领域）
  - ⚠️ Wikimedia Commons `geosearch` 在本机代理下**未能验证**，待浏览器实测
- **下一步**
  - 跑通 `npm run check`，`gh repo create worldline --public` 首次推送，打 tag `v0.1-p0`
  - 进入 P1：定 `src/types/source.ts` + zod schema + Radio Browser 适配
- **遇到的问题**
  - 无

---

## 已知问题

| # | 问题 | 影响 | 状态 | 计划 |
|---|---|---|---|---|
| 1 | Wikimedia Commons `geosearch` 本机代理下无法验证 | P5 落地壁纸可能需降级 | 待验证 | 浏览器环境实测；失败则退化为纯 GIBS 瓦片 |
| 2 | 电台坐标覆盖率仅约 17%，且地理分布极不均 | 「地球仪密布图钉」的视觉与真实不符 | 已知 | 接受为特性；P6 补「无坐标电台」第二入口 |

---

## 决策记录

| ADR | 决策 | 文件 |
|---|---|---|
| 0001 | 用 three.js 直接搭场景，而非 globe.gl | `docs/decisions/0001-why-threejs-over-globegl.md` |
| 0002 | 地图贴图程序化生成，不用现成图片素材 | 待写 |
| 0003 | 单个 `<audio>` 复用 + GainNode，而非每次新建 | 待写 |
| 0004 | 视觉方向选实体地球仪，而非写实地球 | 待写 |

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
