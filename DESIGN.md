# 轻量布局度量与生成式修复引擎 · 设计文档

> 版本：v1.1（2026-08-27）
> 场景：端侧大模型生成式 UI 的 H5 页面布局/配色质量度量与自修复闭环验证
> 状态标注：【已实现】= 当前代码可用（v1.1 全部设计已落地，执行结果见 PLAN.md 摘要）

---

## 1. 背景与目标

端侧 LLM 生成 H5 页面后，首次产出的布局与配色常不及预期（溢出、重叠、字号不一、对比度不足等）。本项目构建一套**轻量化、纯文本输出**的度量与反馈体系：

1. 用 Playwright 无头浏览器对静态 H5 做**事实采集**（几何 + 排版 + 颜色 + 效果属性）
2. 用五层美学体系下的规则做**判定**，产出紧凑文本报告 `report.txt`（可直接回流给 LLM）
3. 用本地 Ollama 模型（qwen3:8b）验证三类反馈形态的修复效果：盲修 / 完整报告引导 / 纯事实+规则
4. 扩展验证**颜色风格转换**（生成式改色）任务的安全性与评估方法

约束：Windows 开发机/CI、纯静态 HTML/CSS、度量结果全部为文本（token 友好）、报告体积控制在 KB 级。

---

## 2. 总体架构

### 2.1 当前实现【已实现】

```
fixtures/*.html ──▶ run.mjs（启动器）/ collect.mjs (Playwright chromium 375×812@3x, file://)
                     │  page.evaluate(COLLECT)：遍历 DOM 树
                     │  采集 rect / fontSize / lineHeight / radius / fg / bg(有效背景) …
                     ▼
                geometry.json（事实层，含 alpha 合成的有效颜色）
                     │
        ┌────────────┼────────────────┐
        ▼            ▼                ▼
   metrics.mjs    format.mjs      color.mjs（颜色核心库）
   22 类规则判定   树+Palette+     WCAG/HSL/面积归因/和声
        │          ISSUES 渲染         │
        ▼            ▼                ▼
   issues[] ──▶ report.txt（≈3-5KB，LLM 回流通路）
```

**事实与判定分离**：采集层只记录测量事实，判定全部在 Node 侧规则完成——同一份事实可支撑不同判定标准，也支撑"只回流事实"的实验臂。

**有效背景链**：以「白 → html 底色 → body 底色」为页面基底（`walk` 初始 parentBg，`pageInfo.bodyBg` 同源，供面积归因）逐层 alpha 合成向下传递；容器内「定位 + 有背景」的兄弟（背景层模式：`.card > .bg(abs, inset:0) + .body(rel, z-index)`）会作为后续定位兄弟（及其子树）的可见底色/渐变——修正祖先链看不到兄弟背景层导致的底色错误（如卡片文字被算到 body 底色上）。

### 2.2 目标架构【已实现】

```
判据侧（可外置）                        执行侧（程序固有）
┌───────────────────────┐            ┌─────────────────────────────┐
│ metrics.config.json   │──合并──▶   │ config.mjs                  │
│ （用户要求，JSON）      │            │  全量默认值(带出处注释)        │
│ 环境变量 METRICS_*     │──────────▶ │  loader + 零依赖校验器        │
└───────────────────────┘            │  frozen cfg                 │
                                     └──────────────┬──────────────┘
                                                    ▼
┌───────────────────────────────────────────────────────────────┐
│ rules/（声明层：纯数据+谓词，无遍历逻辑，无魔法数字）                  │
│  layer-basic/order/rhythm/harmony/refine.mjs + index 注册表      │
│  每条：{ id, layer, severity, runner, when, detect(n,T), msg }   │
├───────────────────────────────────────────────────────────────┤
│ engine/（执行层：只懂遍历与分组，不认识具体规则）                     │
│  facts.mjs 事实索引（排版/列表分组、palette、voidBands、sibling 对）  │
│  runners.mjs 四类执行器（node / pair / group / page）              │
├───────────────────────────────────────────────────────────────┤
│ metrics.mjs（门面）→ engine.runAll(facts, cfg) → issues[]         │
│ format.mjs 分层渲染（L1→L5 分组 + severity 排序 + 健康度行）          │
└───────────────────────────────────────────────────────────────┘
```

核心原则：**规则声明 / 执行引擎 / 判据数值**三者分离；代码零魔法数字，所有阈值默认值收敛到 config 默认表，可被外部 JSON 覆盖。

---

## 3. 五层美学度量体系【已实现，22 现有 + 41 新增 = 63 维度】

体系按"基础规范 → 质感精致"五层递进，`severity`（error/warn/info）与 `layer`（L1-L5）正交：

### L1 基础规范（页面可用底线；违反即"坏页面"）
| 规则 | 判据 | 状态 |
|---|---|---|
| OVERFLOW / ELEMENT_OVERFLOW / TEXT_CLIP | 滚动宽超视口 / 元素右缘超视口（只报最外层；**横向滚动容器自身及 overflow-x ∈ auto/scroll 祖先链内元素豁免**——轮播/横滑行越界属有意设计、可由滚动抵达）/ 文本裁切（只报最内层；**自身 overflow-x ∈ auto/scroll 的溢出豁免**，横滑区不算裁切） | 已实现 |
| OVERLAP | 同父兄弟矩形相交且交叠面积占较小元素 ≥10% 方报（浮点防亚像素误报；absolute/fixed 定位分层豁免，负 margin 微堆叠 ≤10% 视为视觉紧贴设计） | 已实现（v1.2 语义增强） |
| TAP_TARGET | 可交互元素最小边 < 44px | 已实现 |
| CONTRAST_LOW | 有效前景/背景对比度 < 4.5:1（≥24px 大字 3:1），消息含建议色；渐变背景让位 GRADIENT_CONTRAST | 已实现 |
| GRADIENT_CONTRAST | 渐变背景上文字对比度——**位置感知**：渐变几何（角度+stop 位置+元素盒）沿继承链向下传递，取文字盒沿渐变轴两个边界点的实际底色（插值），对比取更差者；无几何（radial/解析失败）回退最差 stop。不透明纯底截断 | 新增（位置感知） |
| IMG_BROKEN | 图像加载失败（complete && naturalWidth===0），建议修 URL 或改 alt 占位（懒加载天然排除） | 新增 |
| SVG_ICON_HINT | **提示（info）**：`<img>` 引入的 SVG 图标（尺寸小 ≤48px + 上下文启发：交互元素内 / alt 空 / 页头页脚）——颜色固定在资源内、无法随主题/背景调整（currentColor 在 `<img>` 中解析为黑色）→ 建议改用 mask-image + background-color 控制颜色；建议色按「页面文字主色 → 强调色 → 黑白」取首个 ≥3:1 | 新增 |
| MEDIA_COVERED | 富媒体（img/video/canvas/svg/iframe/object/echarts 容器 + url 背景图容器）被不透明元素遮挡 ≥30% 面积（共享 coverScan：绘制模型=定位元素盖过 static 内容，受害者锚点=最近定位祖先；祖先排除；渐变 scrim 与半透明豁免） | 新增 |
| TEXT_COVERED | 文本被不透明元素/富媒体/**渐变遮罩**遮挡 ≥30% 面积（同 coverScan，受害者=直接文本元素；渐变遮罩按受害者在渐变轴上的 stop 透明度插值判定——非轴对齐/无位置信息跳过；MEDIA_COVERED 不启用渐变，避免「图上叠渐隐」误报；L1 warn） | 新增（渐变遮罩） |
| CHART_TEXT_CONTRAST | data-echarts 内图表文字（axisLabel/textStyle）对图表容器有效背景对比 < 4.5:1（此前图表配色不入规则） | 新增 |
| CHART_DEGENERATE | 图表容器高度塌陷（宽≥150px 时高<40px，%高度链断） | 新增 |
| FOCUS_INVISIBLE | interactive 元素显式 `outline:none` 且无 `:focus-visible` 替代（WCAG 2.4.7/F78，需 CSSOM 扫描） | 新增 |
| MIN_FONT_SIZE | 字号 < 10px | 新增 |
| GREY_ON_COLOR | 彩色背景上的纯灰字（Refactoring UI） | 新增 |
| LINK_INDISTINCT | 正文段落内链接与正文同色且无下划线（仅限 p 内，导航链接豁免） | 新增 |

### L2 结构秩序（一致性与对齐；不齐=业余感）
| 规则 | 判据 | 状态 |
|---|---|---|
| ALIGN / SIZE / RADIUS_INCONSISTENT | 列表组左缘极差 >4px / 尺寸极差 >6px / 圆角 >2px。SIZE 含**可见卡片盒**：解析每项「绘制表面（自身底色/渐变/背景图/阴影/媒体，圆角边框不计）最大子盒」，严格同 tag 方可比——捕捉被透明包裹层拉伸掩盖的内部卡片尺寸不一致 | 已实现（卡片盒增强） |
| **listGroup 结构分区**（建组层，影响全部 item 级 listGroup 规则） | 同 tag+首cls、宽 ≥100 的兄弟桶内再按**结构签名**（逐层 tag+首类的子树骨架串，文本/几何不参与）分区，仅同构分区 ≥3 成组——页面级不同角色兄弟（hero/列表/徽标区）骨架各异，不再跨角色比较（如阅读首页 5 个 section 的媒体/比例混比误报） | 新增 |
| **pathGroup 原始桶**（供自带结构路径匹配的规则） | 结构分区会把「同组件 + 可选子元素」的成员排除（如 decor budget-board 多一条价格行 → 与另 3 个 board 签名不同 → 分区后各自成组），导致 GROUP_CHILD_ALIGN/IMG_SIZE 漏报其对应子元素错位。故另建**不分区**的原始桶 `pathGroups`（同 tag+首cls、宽 ≥100、≥3），由 `pathGroup` runner 供给 GROUP_CHILD_ALIGN / IMG_SIZE_INCONSISTENT——两规则本就逐结构路径比对、天然容忍条件性/可选子元素 | 新增（修复分区回归） |
| GROUP_CHILD_ALIGN | **重复项内对应子元素几何一致性**：全子树按结构路径（逐层 tag+首类签名+出现序）跨项匹配（含结构性孙元素，如图标），各维 dx/dy/w/h 相对自身项取值，偏离组内中位 >TOL 的项为错位。文本驱动豁免：子树含文本（≥TEXT_MIN_LEN）→ 其几何随内容长度自然变化（换行/行内宽度/级联），按方向豁免——图标/图片等结构性子元素仍严格比对。每偏离路径组建报 | 新增（全子树+文本豁免） |
| FONT_INCONSISTENT / COLOR_INCONSISTENT | 排版分组字号极差 >1px / 颜色不一致 | 已实现 |
| SPACING / LINE_HEIGHT_TIGHT | 间距极差 >24px / 行高 <1.2 | 已实现 |
| RADIUS_SCALE_OFF | 全页圆角值不落在设计刻度 {4,8,12,16,20,24}（圆角系统化，不止组内一致） | 新增 |
| BORDER_INCONSISTENT / BORDER_OVERUSE | 同组边框不一 / 带边框元素密度过高（应以阴影留白替代） | 新增 |
| WEIGHT_INCONSISTENT | 同组字重不一致 | 新增 |
| HSCROLL_EDGE_SPACING | 水平滑动容器（overflow-x auto/scroll）首项距容器左缘 <12px（无左内边距）——初始加载几何判定，与 ELEMENT_OVERFLOW 的 hscroll 豁免互补（溢出属设计使然，但首项贴边缺呼吸空间仍是不美观） | 新增 |
| FONT_FAMILY_BLOAT | 字族数 > 2 | 新增 |
| GRAY_SHADE_BLOAT | 文字灰阶档数 > 5 | 新增 |
| CONTROL_TEXT_CENTER | 交互控件内文字相对盒子中心垂直偏移 >4px（如加大高度后文字贴顶） | 新增 |
| CHART_TOP_CLIP | 图表未显式 grid.containLabel:true（仅加大 grid.top 仍可能裁切），y 轴顶部刻度/轴名有裁切风险 | 新增 |
| CHART_OVER_PARENT | 图表容器底部超出其外层卡片（容器含内边距/边框时子级同高会溢出） | 新增 |

### L3 空间节奏（留白与比例；不违规但"不舒服"）
| 规则 | 判据 | 状态 |
|---|---|---|
| VOID_BAND / CARD_VOID | 文本叶子 y 投影断档 ≥96px / 卡片内容包络 <60% 或底部空洞（VOID_BAND 投影计入图表/媒体占位，避免把无文本区块当空白带） | 已实现 |
| ASPECT_INCONSISTENT / EXTREME | 列表卡片 h/w 极差 >0.3 / 单卡 >3 或 <0.15 | 已实现 |
| IMG_SIZE_INCONSISTENT | 组内各项「对应媒体」（叶子无文本，任何尺寸/比例）按结构路径跨项匹配（同 GROUP_CHILD_ALIGN 路径方案），宽或高偏离中位 >2px 即报；每建报各偏离路径组。不再依赖方形/尺寸带启发式，只比同类媒体（图标对图标、封面对封面） | 已实现 |
| LINE_LENGTH | 文本块行长越界（中文 20-45 字 / 45-75ch，限定 p 且文本 ≥20 字） | 新增 |
| DENSITY_EXTREME | 单屏元素密度 <3 或 >60 | 新增 |
| BALANCE_OFF | 左右视觉重量（面积×暗度）失衡 >25%（Ngo balance 因子） | 新增 |
| MEDIA_GUTTER | 图表/媒体窄于同行内容包络（两侧共 ≥96px 空白） | 新增 |
| RELATED_SPLIT | 数值与其带符号变化量（+x%/-x(y%)）同行却相距过远/纵向错位（通用模式，无领域假设） | 新增 |
| CHART_OVER_TALL | 图表容器过高（≥220px 且 >~30% 视口高），绘图只占上部、内部留白大（canvas 内空白 DOM 不可见） | 新增 |
| CHART_Y_RANGE | 数值纵轴从 0 起或范围过宽（数据只占轴高小部分），画布下方大量空白——建议设置 yAxis.min/max 紧贴数据 | 新增 |

### L4 色彩和谐（配色章法；从不出错到有修养）
| 规则 | 判据 | 状态 |
|---|---|---|
| COLOR_DOMINANCE | 主导背景 <40% 或强调色面积 >15%（60-30-10 法则） | 已实现 |
| HARMONY_OFF | 强调色相 ≥3 簇且不成类似/互补/三角 | 已实现 |
| GARISH_SATURATION / ACCENT_BLOAT | 高饱和面积 >20% / 强调色 >6 种 | 已实现 |
| GRAY_UNTINTED | 纯中性灰（无色调）出现在有色调 UI（"Greys don't have to be grey"） | 新增 |
| SHADE_UNSYSTEMATIC | 同色相明暗档离散不成系统 | 新增 |
| CHART_DATA_COLOR | 图表系列/线条色或阈值标记（markLine/markPoint）未显式设置或与页面强调色偏差过大（ECharts 默认色板=随机色） | 新增 |
| GRADIENT_BG | 图表/媒体容器使用渐变背景（纯色表面页面不一致；渐变不可可靠度量文字对比） | 新增 |

### L5 质感精致（高端效果系统化；锦上添花）
| 规则 | 判据 | 状态 |
|---|---|---|
| SHADOW_INCONSISTENT | 阴影值不聚类到 elevation 刻度（对照 Tailwind 6 级：sm/DEFAULT/md/lg/xl/2xl，blur 2→50px、alpha 0.05→0.25） | 新增 |
| SHADOW_DIR_CONFLICT | 阴影 y 偏移符号混乱（光源不统一） | 新增 |
| SHADOW_OVERKILL | 阴影 alpha >0.35 或单元素 >2 层非系统阴影 | 新增 |
| GLASS_NO_BLUR | 半透明背景却无 backdrop-blur（该糊不糊） | 新增 |
| GLASS_BAD_RANGE | 毛玻璃 blur 越界（合理 4-24px，Tailwind 刻度 4/8/12/16/24/40/64） | 新增 |
| MOTION_DURATION_OFF | UI 过渡时长在 100-500ms 之外（排除 UA 默认 0s） | 新增 |
| MOTION_ALL_PROPERTY | `transition: all` 反模式 | 新增 |
| MOTION_MISSING | 部分可交互元素缺 hover 反馈（仅在页面已有 hover 样式时检测） | 新增 |
| TYPE_SCALE / SPACING_8PT / CONTRAST_AAA | 字阶不成 ~1.2 倍率 / 间距不成 4-8pt 网格 / 对比度未达 AAA 7:1（aspirational，默认禁用，`METRICS_ON` 开启） | 新增 |

**消息工程**（贯穿五层）：消息一律带 CSS 级修复线索 + 理论依据（含建议色/建议值），如 `p.desc 文字 #ccc 对背景 #fff 对比度 1.61:1 (<4.5:1 WCAG AA)，建议改为 #5f5f5f`。

**定位锚**（贯穿五层；源码可对应——生成模型只见源码不见渲染，**像素不进消息**，
几何坐标仅保留在事实树中）：元素标签格式 `tag#id.cls[tid]#ord`（tid = 首个
`data-test*` 属性值，跨框架约定；ord = 同标签渲染兄弟序号，对应 `.map()` 迭代序）。
消息定位串 = label + `“文本≤10”`；需要容器上下文的规则追加 `(容器 <父定位串>)`
——同名卡片/同文案元素靠父容器 ord 区分。分组一致性规则列出**异常元素**（偏离
多数派者，≤3 个）而非只给取值分布。示例（真实输出，两张同名卡片的同文案元素
靠 `button[hot-card]#1/#5` 区分）：

```
[CONTRAST_LOW] p#2“3 分钟” 文字 #7e908c 对背景 #ffffff 对比度 3.36:1 (<4.5:1 WCAG AA) (容器 button[hot-card]#1)
[CONTRAST_LOW] p#2“3 分钟” 文字 #7e908c 对背景 #ffffff 对比度 3.36:1 (<4.5:1 WCAG AA) (容器 button[hot-card]#5)
```

`[TYPE]` 行前缀解析不受影响 → compare.mjs / style_eval.mjs / 实验脚本零改动。

### 3.x 颜色核心库（src/color.mjs）【已实现】
alpha 合成链、WCAG 亮度/对比度、建议色二分搜索、HSL、鲜艳度、面积归因（背景/文本/强调三角色制）、和声判定（30° 聚簇 + 三角最小环间距 ≥60°）。

---

## 4. 配置层设计【已实现】

### 4.1 配置文件（`metrics.config.example.json` 为样例，复制为 `metrics.config.json` 自动生效）
```json
{
  "rules": {
    "TAP_TARGET":    { "thresholds": { "TAP_MIN": 48 } },
    "CONTRAST_LOW":  { "thresholds": { "RATIO_NORMAL": 7.0 } },
    "GRAY_UNTINTED": { "enabled": false }
  },
  "layers": { "L5": { "enabled": false } }
}
```
- **能力范围**：阈值覆盖 / 单规则开关 / 整层开关 / severity 覆盖（仅数据化，不支持 JS 规则注入）
- **优先级**：内置默认 < 配置文件（`METRICS_CONFIG=path` 指定）< 环境变量（`METRICS_OFF=L5`、`METRICS_ON=TYPE_SCALE`）
- **校验**：零依赖手写校验器——未知规则 ID 报错并列合法清单、阈值类型检查、深度合并
- **实验联动**：各实验臂可携带独立配置（如 `METRICS_CONFIG=l5.config.json` 单独开启质感层）

### 4.2 报告格式（v2，含配置回显与分层健康度）
```
=== Layout Report: good.html ===
Page 375×812 contentH=917 scrollW=375
URL: https://…/model-detail?model_id=fassier-f750
Config: metrics.config.json (3 处覆盖)
Palette bg:#ffffff 86%|#f5f6fa 8% | accent:#2563eb 5% | accentArea:5% | accentHues:0°/210° 和声OK
├─ header.header (0,0 375×79)
│  ├─ h1 (16,16 343×26) <fs20,#222222/#ffffff> "今日推荐"
ISSUES (2):
  ── L1 基础规范 ──
  [TAP_TARGET] ...
  ── L2 结构秩序 ──
  [RADIUS_INCONSISTENT] ...
Layers: L1=1 L2=1 L3=0 L4=0 L5=0
```
`[TYPE]` 行格式不变 → compare.mjs / style_eval.mjs / 实验脚本解析零改动。

其余产物（**实验模式 `--full` 可选**，工具默认不产出）：`*.aria.yml`（无障碍树，纯结构）、`*.geometry.json`（全量事实，style_eval 消费）、`*.cdp.json`（DOMSnapshot 原始）。工具/实验逻辑解耦：工具模式仅产 report.txt（并跳过 aria/CDP 采集以提速），`--full` 供格式对比实验与风格转换评估使用。

---

## 5. 测试夹具（15 个）设计方法论【已实现】

**同骨架 + 单一缺陷植入**：所有夹具共享 `header + 4 卡片 + tabbar`、375×812 骨架；每个坏夹具 = good + 一类 CSS 缺陷注入（nth-child 逐项尺寸、固定宽、负 margin、min-height 等生成式 UI 真实失败形态）。

| 夹具 | 植入 | 基线 issue |
|---|---|---|
| good | 无（对照） | 0 |
| overflow / overlap / mixed | 容器 500px+nowrap / 负 margin 重叠 / 混合 7 类 | 4 / 2 / 7 |
| font / align / card / cramped / img-chaos | 字号、左缘、宽/圆角/padding、行高、缩略图 + 故意破图（`assets/missing.png`，触发 IMG_BROKEN + ASPECT_INCONSISTENT） | 3 / 2 / 2 / 4 / 3 |
| fp-*（7 个挑战夹具，源自 OVERLAP_challenge 集） | **合法叠层设计**：absolute 分层 / 角标 / 负 margin 堆叠 / hero scrim / 装饰层 / FAB / 渐变蒙版卡——OVERLAP 已知误报，A1 精化验收材料（见 BACKLOG.md） | 8 / 12 / 3 / 3 / 7 / 3 / 33 |
| ratio-chaos / void-band / sparse-card | 固定高混乱 / 150px 空白带 / min-height 空洞 | 5 / 3 / 5 |
| contrast / color / palette-chaos | 低对比 / 异色+色板膨胀 / 60-30-10+和声+高饱和 | 9 / 9 / 7 |

**双向校验**：新度量必须命中对应夹具（正向），且不改变老夹具计数、good 恒为 0（反向回归门槛）。夹具自身疏漏也会被度量揪出（overlap.html 的 h3 19/15px、color-chaos 白字白底 badge 均为实例）。

> 注：五层体系落地时已**重建基线**（2026-08-28 完成）：夹具灰调校准（纯中性灰 → 带蓝调灰 #5f6368/#6b7280）保住 good=0 语义；唯一计数变化 overflow 3→4（BALANCE_OFF 命中 500px 内容的真实左右失衡）。新基线 `0/4/2/7/3/2/2/4/1/5/3/5/9/9/7` 固化于 tests/golden.snapshot.json。

---

## 6. 实验框架【已实现】

### 6.1 三臂修复实验（experiments/{blind,guided,layout_only}_repair）
| 臂 | 输入 | 变量 |
|---|---|---|
| blind | HTML + 问题类型清单 | 无反馈基线 |
| guided | HTML + 清单 + **完整 report.txt** | 结论回流 |
| layout-only | HTML + 规则内嵌 prompt + **剥离 ISSUES 的报告**（保留 Palette/树事实） | 事实回流 |

统一控制：qwen3:8b（Q4_K_M）、temperature=0、think:false、流式读取、剥 think/围栏、无 `</html>` 判截断。

### 6.2 风格转换实验（experiments/style_transfer）
干净页 + 风格指令（dark/warm/cool/mono）+ 硬约束"仅改颜色"。三臂：`cmd`（纯指令）/ `palette`（+Palette 行）/ `spec`（+量化验收标准）。

**三重评估**（style_eval.mjs）：风格达成谓词（dark→bgLum<0.25 等）/ 零回归（22 类度量重跑）/ 零位移（前后 geometry.json 的 tag+rect 序列严格全等）。

---

## 7. 实验结果与核心结论【已实现】

### 7.1 四轮修复实验汇总
| 轮 | 夹具 | before | blind | guided | layout-only |
|---|---|---|---|---|---|
| v2（几何+美观） | 8 | 24 | 7 | **6** | 11（card-chaos 2→6 改坏） |
| v3（比例+空白） | 3 | 13 | **5** | **5** | 10（ratio-chaos 原样返回） |
| v4（颜色） | 3 | 25 | 16 | **5** | 15 |
| 合计 | 14 | 62 | 28 | **16** | 36 |

**guided（结论回流）全程最优且零改坏**。

### 7.2 风格转换（12 次）
零位移 12/12；风格达成 11/12（warm.cmd 因不知当前 accent 而残留）；回归几乎 100% 是 CONTRAST_LOW；仅 cool.spec 全绿；总回归 cmd 86 → palette 68 → spec 50。

### 7.3 洞察清单
1. **源码显性类**（字号/间距/圆角/异色）盲修可修——prompt 点名清单后静态可查
2. **几何结果类**（重叠/溢出/空白）必须度量回流——源码"看似故意"无几何后果信息
3. **8B 模型不会算 hex**：对比度/亮度/面积占比必须给"数值+建议色"
4. **消息工程有效但非万能**：可定位文案提升修复率；`min-height` 空洞点名也无人执行（策略缺失）
5. **多规则交互会打架**：统一 badge 色时选了不达标 teal（消一致性引入对比度回归）
6. **两段式闭环**是推荐管线：第一轮生成/改风格（palette+spec），第二轮 guided 修复消回归，改后必再度量

---

## 8. 目录结构

### 8.1 重构前（历史结构，已由 8.2 取代）
```
lightweight_layout_eng/
├─ DESIGN.md / PLAN.md          # 本文档 / 执行计划
├─ package.json                 # type:module；npm run collect
├─ fixtures/                    # 15 个夹具
├─ src/
│  ├─ collect.mjs               # 采集（INPUT_DIR/OUTPUT_DIR 参数化）
│  ├─ metrics.mjs               # 22 类判定（待重构为门面）
│  ├─ format.mjs                # report.txt 渲染
│  └─ color.mjs                 # 颜色核心库
├─ reports/                     # 主管线产物
└─ experiments/
   ├─ blind_repair/  guided_repair/  layout_only_repair/
   └─ style_transfer/
```

### 8.2 重构后（完整版）【已实现】
```
lightweight_layout_eng/
├─ DESIGN.md / PLAN.md                  # 设计文档 / 执行计划
├─ metrics.config.example.json          # ★ 用户配置样例（复制为 metrics.config.json 后自动生效）
├─ package.json                         # type:module；npm run collect
│
├─ fixtures/                            # 15 个夹具（不动）
├─ reports/                             # 主管线产物（不动）
│
├─ src/
│  ├── run.mjs                          # ★ 实验启动器：夹具清单 ALL / CLI 与 INPUT_DIR·OUTPUT_DIR 解析
│  │                                    #   / 浏览器生命周期 / 双模式输出（工具摘要+报告原文；--full 体积表）
│  ├── collect.mjs                      # 采集管线核心（纯模块，带注释）：COLLECT 页内采集函数
│  │                                    #   （几何/排版/颜色/效果属性 + CSSOM 伪类扫描）+ collectPage()
│  │                                    #   双模式：默认仅产 report.txt；fullArtifacts=true 四产物
│  ├── color.mjs                        # 颜色核心库（不动）：合成/WCAG/HSL/面积归因/和声/建议色
│  │
│  ├── schema.mjs                       # ★ issue 构造：makeIssue() + LAYERS/SEVERITIES 元数据
│  ├── config.mjs                       # ★ DEFAULTS 全量默认表（带出处注释）+ loader
│  │                                    #   （默认 < config.json < METRICS_CONFIG < env）+ 零依赖校验器
│  │
│  ├── rules/                           # ★ 声明层："检查什么"——纯数据+谓词，无遍历无魔法数字
│  │   ├── layer-basic.mjs              #   L1 基础规范 ×16
│  │   ├── layer-order.mjs              #   L2 结构秩序 ×16
│  │   ├── layer-rhythm.mjs             #   L3 空间节奏 ×12
│  │   ├── layer-harmony.mjs            #   L4 色彩和谐 ×8
│  │   ├── layer-refine.mjs             #   L5 质感精致 ×11（阴影/毛玻璃/动效/字阶…）
│  │   └── index.mjs                    #   注册表：聚合导出 RULES（61 条）
│  │
│  │
│   ├── engine/                         # ★ 执行层："怎么检查"——通用机器，不认识具体规则
│   │   ├── facts.mjs                   #   事实索引一次构建：allNodes+父链/textGroups/listGroups/pathGroups/
│   │   │                               #     siblingPairs/palette/voidBands（消除 _pt hack）
│   │   ├── runners.mjs                 #   执行器 node/pair/group/page/listGroup/pathGroup + 通用抑制机制
│   │   │                               #     （最内层/最外层去重）+ makeIssue 产出
│   │   └── index.mjs                   #   runAll(geometry, cfg)→issues[]：建facts→筛规则→分发→汇总
│   │
│   ├── metrics.mjs                     # 门面（降级）：runMetrics(data, cfg?) 一行委托 engine
│   └── format.mjs                      # 渲染：Config 回显行 + Palette 行 + 树标记扩展
│                                       #   + ISSUES 按 L1→L5 分组 + Layers 健康度行
│
├── tests/
│   ├── config.test.mjs                 # ★ 配置测试 4 组：文件覆盖/层开关/env 覆盖/非法配置报错
│   └── golden.mjs                      # ★ Golden 基线对比（15 夹具计数与 type 序列；snapshot/verify 两模式）
│
└── experiments/                        # 实验目录（不动，compare.mjs 类型清单 +22）
    ├── blind_repair/ guided_repair/ layout_only_repair/
    └── style_transfer/
```

### 8.3 旧→新迁移映射
| 旧（metrics.mjs 344 行上帝文件） | 去向 |
|---|---|
| 18 个阈值常量 | config.mjs DEFAULTS（带出处注释） |
| flat()/checkTypography 的分组逻辑 | engine/facts.mjs（textGroups） |
| collectListGroups/isStacked | engine/facts.mjs（listGroups） |
| checkNodes/checkSiblings/checkVoidBands 等 12 个检测函数的遍历骨架 | engine/runners.mjs 四类执行器 |
| 各规则的内联判据与 msg 模板 | rules/ 各层声明文件 |
| runMetrics 入口 | metrics.mjs 门面保留（调用点零改动） |

### 8.4 变更影响面
- **零改动**：compare.mjs / style_eval.mjs 解析（`[TYPE]` 行不变）、experiments/ 全部脚本；metrics.mjs 门面签名不变
- **启动入口迁移**：夹具清单与启动逻辑已从 collect.mjs 剥离至 run.mjs（collect.mjs 纯模块化 + 全注释），原 `node src/collect.mjs …` 调用需改为 `node src/run.mjs …`
- **新增**：rules/ 6 文件、engine/ 4 文件（含 util）、schema/config、metrics.config.example.json、tests/×2
- **历史数据**：Golden 验收以新基线 `0/4/2/7/3/2/2/4/1/5/3/5/9/9/7` 为准（相对旧基线唯一变化：overflow 3→4，新增 BALANCE_OFF 命中 500px 内容造成的真实左右失衡）
- **experiments/*/fixtures 为历史快照**：未同步灰调校准（仍含老灰 #5f5f5f/#666666）；重跑实验臂前需从主 `fixtures/` 重新复制，否则新规则（GRAY_UNTINTED 等）会在旧快照上额外命中，破坏与历史实验数据的可比性

---

## 9. 运行方式【已实现】

```powershell
npm run collect                                  # 工具模式：全量 15 夹具 → reports/（仅 report.txt）
node src/run.mjs good overflow                   # 指定夹具
node src/run.mjs --full good                     # 实验模式：四产物全量（style_eval/格式对比需此模式）
$env:INPUT_DIR='repaired'; $env:OUTPUT_DIR='reports_repaired'
node src/run.mjs overflow …                      # 实验目录参数化

# 实验臂（各目录内）
node src/repair.mjs / guided_repair.mjs / layout_only_repair.mjs [fixtures…]
node src/compare.mjs [fixtures…]                 # 四臂对比

# 风格转换（注意：style_eval 依赖 geometry.json，重跑需用实验模式）
node src/restyle.mjs && node src/style_eval.mjs

# 配置
$env:METRICS_CONFIG='my.config.json'; node src/run.mjs good
$env:METRICS_OFF='L5'; …                         # 关闭整层
$env:METRICS_ON='TYPE_SCALE'; …                  # 启用 aspirational 规则

# 测试
npm test                                            # 配置 4 组用例（node tests/config.test.mjs）
npm run golden                                      # Golden 基线对比（先跑 collect 再 verify）
```

环境：Node ≥20；Playwright chromium（国内镜像 `PLAYWRIGHT_DOWNLOAD_HOST=https://registry.npmmirror.com/-/binary/playwright`）；Ollama `localhost:11434`，默认 `qwen3:8b`（`MODEL` 可换）。

---

## 10. 已知限制与后续方向

- **单样本结论**：每类缺陷仅 1 个夹具、temperature=0 单次运行，无重复稳健性
- **阈值经验值**：60-30-10/96px/0.3 等为工程估值，未做敏感度标定（配置层落地后可低成本标定）
- **HSL 色彩空间**：感知均匀性弱于 OKLCH；图片内文字不可测（需截图像素分析）。渐变上文字已可测（GRADIENT_CONTRAST：linear-gradient stop 解析 + 沿继承链向下传递，不透明纯底截断；radial/多重背景仍不可测）。延后项与检测技法（滚动状态/裁切/交互可供性）见 [BACKLOG.md](BACKLOG.md)
- **模型瓶颈**：负 margin 重叠、44px 点击区、min-height 空洞在 8B 上残留
- **多轮闭环**：当前均单轮；"修复→再度量→再修复"迭代器与终止条件是下一步
- **维度信源**：新增 22 条的判据来源为 Refactoring UI 战术目录、Tailwind 阴影/毛玻璃刻度、WCAG 2.2（Focus Visible/F78）、Ngo et al. 2000 美学因子
