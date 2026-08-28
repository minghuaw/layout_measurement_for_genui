# 执行计划：五层美学体系重构 + 维度扩充 + 配置外置

> 定稿：2026-08-27 · 状态：✅ 全部执行完毕
> 前置文档：DESIGN.md（v1.1，目标架构与 48 维度设计）

## 执行结果摘要

| 阶段 | 内容 | 结果 |
|---|---|---|
| 0 | Golden 快照固化 | ✅ `0/3/2/7/…` 旧基线入库 |
| 1 | 架构重构（rules/engine/schema/config/门面/分层渲染） | ✅ Golden 全等 15/15 |
| 2 | 配置层（DEFAULTS+loader+校验+回显+样例） | ✅ 14 项测试通过 |
| 3 | 采集扩展 + 26 条新规则（分五层注册） | ✅ 命中与防误伤核查通过 |
| 4 | 夹具校准（灰调 #5f5f5f→#5f6368、#666666→#6b7280）+ 新基线 | ✅ 新基线 `0/4/2/7/3/2/2/4/1/5/3/5/9/9/7` |
| 5 | 配置测试 4 组 + METRICS_OFF/ON 回归 + 文档 | ✅ 14/14 通过 |

**关键校准结论（阶段四）**：注册表实际 48 条规则（22 现有 + 26 新增）；3 条 aspirational（TYPE_SCALE/SPACING_8PT/CONTRAST_AAA）按“启用重建基线”决策下的**校准结论**设为默认禁用（会破坏 good 语义，经 `METRICS_ON` 按需开启）；BALANCE_OFF 由亮度加权改为纯面积切分（修复白卡零权重误报）。

---

## 0. 已锁定的决策

| 决策点 | 结论 |
|---|---|
| 架构 | 规则声明（rules/）与执行引擎（engine/）分离；metrics.mjs 降为门面 |
| 美学体系 | 五层：L1 基础规范 → L2 结构秩序 → L3 空间节奏 → L4 色彩和谐 → L5 质感精致 |
| severity | 三级 error/warn/info，与 layer 正交 |
| 旧 22 条规则 | 逐条平移（判据/阈值/type 不改语义），Golden 对比验证 |
| 新增 22 条 | **直接启用并重建基线**（含 P1 CSSOM 类）；L5 中 TYPE_SCALE/SPACING_8PT/CONTRAST_AAA 等以禁用态注册的原则不再适用——统一按启用策略执行，个别规则的启用态以阶段四校准结论为准 |
| 配置层 | JSON 数据化配置（阈值/开关/severity/整层），程序内置默认值，**不支持 JS 规则注入** |
| 配置回显 | 报告 Page 行后输出 `Config: <file|defaults> (N 处覆盖)` 元信息行 |
| 夹具 | 暂不新增；现有 15 夹具做防误伤校验 + 可修夹具先修（good 语义保持） |
| prompt 同步 | 暂不打通规则↔prompt 单一事实源 |

## 1. 阶段一：架构重构（前置）

**产出**
- `src/schema.mjs`：LAYERS/SEVERITIES 元数据 + `makeIssue({type, layer, severity, theory, msg})`
- `src/engine/facts.mjs`：一次构建事实索引——allNodes+父链、排版分组（tag+父 tag+cls）、列表分组（同 tag+cls ≥3 且宽 ≥100）、sibling 对、palette（复用 color.mjs computePalette）、voidBands；消除 `flat+_pt` hack
- `src/engine/runners.mjs` + `engine/index.mjs`：四类执行器 node/pair/group/page，按规则 `runner` 字段分发；`runAll(geometry, cfg) → issues[]`
- `src/rules/`：`layer-basic.mjs`(L1×6) `layer-order.mjs`(L2×7) `layer-rhythm.mjs`(L3×5) `layer-harmony.mjs`(L4×4) `index.mjs` 注册表；22 条旧规则平移，type 字符串不变
- `src/metrics.mjs` 改门面：`export runMetrics(data, cfg?)`（collect.mjs 调用点零改动）
- `src/format.mjs`：ISSUES 按 L1→L5 分组、组内 severity 排序；尾部 `Layers: L1=n …` 健康度行

**验收（Golden）**：全量 15 夹具 issue 计数与 type 序列逐夹具全等：`0/3/2/7/3/2/2/4/1/5/3/5/9/9/7`；`[TYPE]` 行格式不变（compare.mjs / style_eval.mjs 零改动）。

## 2. 阶段二：配置层

**产出**
- `src/config.mjs`：
  - DEFAULTS：全量默认值表，每数字带出处注释（WCAG 4.5:1 / HIG 44pt / Tailwind 阴影 sm~2xl 与 backdrop-blur 4~64 刻度 / 60-30-10 / Ngo 因子阈值）
  - loader 优先级：内置默认 < `metrics.config.json`（根目录自动发现）< `METRICS_CONFIG=path` < 环境变量 `METRICS_OFF` / `METRICS_ON`
  - 零依赖校验器：未知规则 ID 报错并列合法清单、阈值类型检查、enabled/severity 字段校验、深度合并
- 全部规则 detect 改为引用 cfg 键（如 `T.TAP_MIN`），代码零魔法数字
- `metrics.config.json`：用户配置样例（含各能力示例段）
- `format.mjs`：Config 回显行（不以 `[` 开头，解析安全）

## 3. 阶段三：采集扩展 + 22 条新规则注册

**采集扩展（collect.mjs COLLECT）**
- computed style 增采：`boxShadow`（解析 y 偏移/blur/alpha）、`backdropFilter`（blur px）、`transition`（property/duration，排除 UA 默认 0s）、`letterSpacing`、`fontWeight`、`fontFamily`、`borderWidth/Style`、`outlineWidth`
- CSSOM 扫描：遍历 `document.styleSheets` cssRules，收集 `:hover` / `:focus-visible` / `:focus` 规则命中的选择器集合（file:// 同源可读，跨域容错跳过）
- 报告树追加紧凑标记：`sh12/0.12`（阴影 blur/alpha）、`blur12`、`tr200`（过渡时长）、`w600`（字重）

**规则分批注册（每批后跑 15 夹具防误伤核查）**
| 批次 | 规则 | 防误伤要点 |
|---|---|---|
| P0-a 质感 8 条 | SHADOW_INCONSISTENT / SHADOW_DIR_CONFLICT / SHADOW_OVERKILL / GLASS_NO_BLUR / GLASS_BAD_RANGE / MOTION_DURATION_OFF / MOTION_ALL_PROPERTY / RADIUS_SCALE_OFF | 单元素阴影不触发组内一致；UA transition 0s 排除；现有圆角 4/8/12/20 应落刻度 |
| P0-b 秩序 5 条 | BORDER_INCONSISTENT / BORDER_OVERUSE / WEIGHT_INCONSISTENT / FONT_FAMILY_BLOAT / GRAY_SHADE_BLOAT | 复用排版/列表分组；h3 默认 bold 700 组内一致 |
| P0-c 节奏 3 条 | LINE_LENGTH / DENSITY_EXTREME / BALANCE_OFF | 限定 `p` 且文本 ≥20 字；密度阈值宽松（<3 或 >60/屏）；卡片流全宽天然均衡 |
| P1 反馈 3 条 | FOCUS_INVISIBLE / MOTION_MISSING（interactive 无 hover 反馈）/ LINK_INDISTINCT | 需 CSSOM；导航 tabbar 链接豁免；无 outline:none 不触发 |
| P0-d 色彩 3 条 | GRAY_UNTINTED / SHADE_UNSYSTEMATIC / GREY_ON_COLOR | 见阶段四夹具校准 |

## 4. 阶段四：夹具校准与基线重建

- 逐夹具按 22 条新判据核验：**可修夹具先修**（预计：`#5f5f5f/#666666` 纯中性灰 → 带蓝调灰 `#5f6368/#6b7280`，使 GRAY_UNTINTED 不破 good=0 语义；延续 v4 轮"老夹具颜色修正"先例）
- 输出**新基线表**（允许计数变化，但每处新增命中须可解释）
- `experiments/layout_only_repair/src/compare.mjs` 类型清单 +22

## 5. 阶段五：验证与交付

- **配置测试 4 组**：文件覆盖 / 整层开关 / `METRICS_OFF` env 覆盖 / 非法配置报错（未知 ID、类型错误）
- **配置能力回归**：`METRICS_OFF=<新22条ID>` 应精确回到旧基线（证明配置层完整性）
- DESIGN.md 同步：44 维度五层表标注状态翻转（待实施→已实现）、目录结构更新、基线表更新
- 交付物清单核验（完整文件结构，详见 DESIGN.md §8.2/8.3/8.4）：
```
metrics.config.json                                  # ★ 用户配置入口
src/schema.mjs                                       # ★ makeIssue + LAYERS/SEVERITIES
src/config.mjs                                       # ★ DEFAULTS + loader + 校验器
src/rules/{index,layer-basic,layer-order,layer-rhythm,layer-harmony,layer-refine}.mjs
                                                     # ★ 声明层 44 条（五层分文件）
src/engine/{facts,runners,index}.mjs                 # ★ 事实索引 + 四类执行器 + 编排
tests/config.test.mjs                                # ★ 配置 4 组测试 + Golden 基线对比
src/{metrics,format,collect,color}.mjs（更新）        # 门面化 / 分层渲染+Config 回显 / 采集扩展 / 不动
```

## 6. 风险与预案

| 风险 | 预案 |
|---|---|
| BALANCE_OFF / DENSITY 阈值误伤 | 首版从宽，15 夹具实测后收紧；均可被外部配置即时调整 |
| CSSOM 扫描对禁用样式表抛错 | try/catch 容错跳过，记 warning |
| 新规则与历史实验基线不可比 | 已按决策接受；PLAN 执行完毕后以新基线为准，DESIGN.md 记录切换点 |
| GRAY_UNTINTED 破坏 good 语义 | 夹具灰调修正（阶段四）；或经配置临时关闭该规则验证其余规则 |
| 规则平移引入行为漂移 | 每层平移后立即 Golden 增量对比，不合即修 |

## 7. 规模预估

新增代码约 600-800 行：规则声明 ~350（44 条）、config 默认表+loader+校验 ~150、采集扩展+CSSOM ~120、校准与测试脚本 ~100。纯本地执行，无新增外部依赖（JSON 原生解析）。
