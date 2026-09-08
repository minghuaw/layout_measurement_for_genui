# HarmonyOS 桌面服务卡片 UX 设计规范（浓缩版）

> 来源：`DESIGN.md`（alpha）。本文是对原规范的浓缩整理，保留关键规则与参考数值，省略 YAML 元数据与冗余说明。

---

## 1. 概述

- **对象**：HarmonyOS 桌面 widget 服务卡片，仅两种尺寸 `2×2` / `2×4`。
- **定位**：一眼扫读、单一主信息、默认单一主操作（次操作仅在具独立即时目标时附带）。
- **基调**：冷静、技术感、确定；层级靠字号 + 唯一强调色建立，不靠装饰效果。
- **读者**：任务驱动的扫读者，看卡时间 1–2 秒；清晰优于装饰。
- **三个渲染目标等价**：A2UI 结构、ArkTS/ArkUI 原生、浏览器预览壳（`design-card-html-v1` 契约）。

---

## 2. 画布与尺寸

| 卡片 | 画布 | 安全区（扣 12vp 边距） |
|---|---|---|
| `2×2` | 160×160 vp | 126×126 vp |
| `2×4` | 320×160 vp | — |

- **12vp 安全边距**统一内缩所有内容；卡片不硬编码自身外部尺寸，由宿主运行时提供画布。
- 卡片内部**不得**假设可滚动、分页、扩展高度；不得为内容拉大画布，按画布裁剪内容。
- 浏览器预览壳：`preview-app` 1440×1100px；`toolbar` (0,0) 1440×56px；`preview-stage` (0,56) 1440×1044px；`2×2` slot (48,48) 160×160px，`2×4` slot (256,48) 320×160px。**不得**用 `transform:scale` / `zoom` / 响应式重排移动卡片。**禁止**任何 shell-level `.caption` 节点（尺寸/点击说明只能放 toolbar）。
- **层级上限**：maxHierarchyLevels = 3。

### 尺寸密度

| 维度 | `2×2` | `2×4` |
|---|---|---|
| 主信息对象 | 1 | 1 主组 + 1 辅助组 |
| 辅助信息行 | ≤ 2 | — |
| 显式按钮 | ≤ 1 | ≤ 2（次操作须独立即时目标） |
| 列表行 | ≤ 2 | ≤ 3；带图表 ≤ 2 |
| 数字 | ≤ 1（双数据并列圆环除外，可 2） | ≤ 1 |

### `2×2` 推荐栅格

| 组合 | 栅格（title / gap / content / gap / button） |
|---|---|
| title + 文字按钮 | 16 / 8 / 58 / 8 / 36 vp |
| title + 图标按钮 | 16 / 8 / 64 / 8 / 30 vp |
| 仅 title | 16 / 8 / 102 vp |

### 尺寸互转

- **2×4 → 2×2**（保留顺序）：主状态/主数值 → 必需标签 → 主操作（若属主意图）→ ≤2 辅助行；删除：长说明、重复服务名、第三层元数据、额外操作、密集列表、装饰。
- **2×2 → 2×4**：不放大原布局；保持主信息视觉主导；只增相关时间/趋势/预览/更清晰操作；无有价值辅助时保留留白。

---

## 3. 色彩系统

### 3.1 基础规则

- 默认组件颜色**按 token 名引用，不得直接写 hex**（仅 `card-root` 场景化渐变背景可直接指定渐变色）。
- `colors` 槽 = light 默认值；`themes.dark` 槽覆盖同名 token，未列出者沿用 light。
- hex 统一 8 位 `#RRGGBBAA`，**仅 13 档 alpha**：`FF`/`E5`/`CC`/`B2`/`99`/`7F`/`66`/`4D`/`33`/`26`/`19`/`0C`/`00`。禁止其他档位。
- 禁止用 CSS `opacity` 降低整张卡片或整个按钮（含文字）的透明度。

### 3.2 关键 token（light）

| 角色 | light | dark | 用途 |
|---|---|---|---|
| brand | `#0A59F7FF` | `#317AF7FF` | 主操作与品牌强调的**唯一驱动色** |
| warning | `#E84026FF` | `#D94838FF` | 风险/危险状态（**不得**作品牌/装饰） |
| alert | `#ED6F21FF` | `#DB6B42FF` | 一般提醒 |
| confirm | `#64BB5CFF` | `#5BA854FF` | 完成/确认 |
| font_primary | `#000000E5` | `#FFFFFFE5` | 一级文本 |
| font_secondary | `#00000099` | `#FFFFFF99` | 二级文本 |
| font_tertiary / fourth | `#00000066` / `#33` | `#FFFFFF66` / `#33` | 三/四级 |
| font_emphasize | = brand | = brand | 强调文字 |
| font_on_* | `#FFFFFFFF` 系 | `#FFFFFFFF` 系 | 反色文本（品牌面/反相表面/图片背景上反白） |
| icon_* | 同 font 阶 | 同 font 阶（dark 翻白） | 图标阶；`icon_sub_emphasize` = 40% 强调辅助 |
| background_primary | `#FFFFFFFF` | `#E5E5E5FF` | 宿主背景 |
| background_secondary/tertiary/fourth | `#F1F3F5` / `#E5E5EA` / `#D1D1D6` | `#191A1C` / `#202224` / `#2E3033` | 背景阶 |
| comp_background_primary | `#FFFFFFFF` | `#202224FF` | **卡片根背景基底 + 卡片内部组件表面**，随主题切换 |
| comp_background_tertiary | `#0000000C` | `#FFFFFF19` | 辅助信息底板、次要表面 |
| comp_divider | `#00000033` | `#FFFFFF33` | 分割线（20% 前景色） |
| progress_ring_track | `#00000019` | `#FFFFFF19` | 进度轨道（中性，随主题翻转） |
| interactive_hover/pressed/focus/select | `#0C`/`#19`/`#0A59F7`/`#0A59F733` | 同（dark 翻白系） | 交互态 |

### 3.3 卡片背景（card-root 两层结构）

1. **第一层**：`comp_background_primary`（light 白 / dark `#202224`）。
2. **第二层**：`background_gradients` 注册表预设，按场景精确命中；**未命中必须叠加 `general-fallback`，不得只呈裸基底，不得自造渐变**。

| 预设 | 场景 | 类型 | stops |
|---|---|---|---|
| `office-focus` | 办公-专注 | linear 180° | `#0A59F719` → `#FFFFFF00` |
| `office-schedule` | 办公-日程 | linear 180° | `#E8402619` → `#FFFFFF00` |
| `device-anti-addiction` | 设备-防沉迷 | linear 180° | `#00000019` → `#FFFFFF00` |
| `device-headphone-control` | 设备-耳机操控 | linear 180° | `#64BB5C19` → `#FFFFFF00` |
| `low-power-mode` | 低电量 | linear 180° | `#F9A01E19` → `#FFFFFF00` |
| `worry-free-cleanup` | 清理无忧 | linear 180° | `#0A59F719` → `#FFFFFF00` |
| `weather` | 天气 | radial 顶中 | `#317AF7FF` → `#46B1E3FF` |
| `rainy-weather` | 雨天 | linear 180° | `#46484DFF` → `#467794FF` |
| `sports-health` | 运动健康 | linear 180° | `#ED6F21FF` → `#F9A01EFF` |
| `sleep` | 睡眠 | linear 180° | `#AC49F5FF` → `#C386F0FF` |
| `general-fallback` | 兜底 | linear 180° | `#0A59F719` → `#FFFFFF00` |

- 浅色遮罩类预设含 `opaqueEquivalent`（纯白宿主上烘焙为不透明等效 stops，**仅 light 白宿主成立**）。
- 浏览器壳须把每个预设序列化为 `--bg-gradient-<name>` CSS 变量；渲染时分别设 `background-color` 与 `background-image`，引用未定义变量 = 产物完整性错误。

### 3.4 渐变卡片按钮配色（强制覆盖组件默认色）

按所选预设的 `buttonColorContext` 成组解析，不可只应用一项：

| backgroundClass | 按钮背景 | 按钮文字/图标 |
|---|---|---|
| `light-overlay-gradient` | 主色 10% (`…19`) | 主色 100% (`…FF`) |
| `colored-gradient` | `#FFFFFFFF` | 主色 100% |

### 3.5 卡片元素点缀色

- 仅用于装饰图形/状态点/数据可视化前景/操作元素，**不替代正文一、二级文本色**。
- 浅色遮罩卡：装饰表面用主色 10%，主点缀/操作前景用主色 100%。
- 不透明渐变卡：装饰元素主色一律反色 `#FFFFFFFF` / `#FFFFFF99`。
- **数据可视化前景**：浅色遮罩卡必须用卡片主色（不得用白/反色 token）；不透明卡用反色 `#FFFFFFFF`。轨道统一中性 `progress_ring_track`。
- 同卡最多 2 个登记点缀色。

### 3.6 对比度

- 普通文本 vs 背景 **≥ 3:1**（强制）；正文长文本 **建议 ≥ 4.5:1**（WCAG AA，非强制）。
- 判定按「前景 × 有效背景栈」逐层 alpha 合成（基底 → 渐变位置色 → 祖先底板），不得只估单点。

---

## 4. 字体排版

- **字体族**：HarmonyOS Sans SC（单一字体族，不混用）。
- **字重 3 档**：Regular 400（默认阅读）/ Medium 500（行标题/按钮/强调）/ Bold 700（标题/关键数字/视觉锚点）。禁止第四种字重。
- **最小字号 8 vp**，不得更小。字号缩放支持 0.8x–1.3x；≥20vp 不放大。

### 5 类语义角色 × 3 档尺寸

| 类别 | L | M | S | 用途 |
|---|---|---|---|---|
| display | 56 | 48 | 38 | 视觉锚点（每卡 ≤1） |
| title | 30 | 24 | 20 | 区段/卡片强调标题 |
| subtitle | 18 | 16 | 14 | 行标题/强调文案/按钮文字 |
| body | 16 | 14 | 12 | 默认阅读/列表正文 |
| caption | 12 | 10 | 8 | 元数据/单位/提示/时间戳 |

- 每格 = `{tier}-{size}-{weight}`，共 45 角色矩阵（如 `body-s-regular` = 12vp/400）。
- **专用 token**：`metric-primary` 40vp/700（无辅助信息时主数值）；`metric-primary-with-support` 32vp/700（下方有 12vp 辅助时）。
- **桌面服务卡片 `title-text` 统一用 `body-s-regular`(12/400)**（不再用 14/18 的 subtitle）；副标题/辅助也用 `caption-l-regular`(12/400)。
- content-area 普通正文/列表行/时间/说明默认 `body-s-regular`(12/400)，不得因内容多默认升至 14vp；仅当前决策主数值/主状态/强调一行主文案可升至 display/subtitle 层级。
- 按钮文字默认 `body-m-regular`(14/400)，>6 字降级 `body-s-regular`(12/400)，不得再降。
- 同尺寸不同语境用字重区分（如 14vp 既可 `subtitle-s-medium` 强调，也可 `body-m-regular` 正文）。

---

## 5. 间距与圆角

### 间距刻度（vp）

`xxs 2` · `xs 4` · `sm 6` · `md 8` · `lg 12` · `xl 16` · `xxl 24` · **safe-margin 12**

语义间距：标题→副标题 2–4；标签→数值 4–6；图标→文字 6–8；组→组 8–12；内容→操作 8–12。

### 圆角刻度（共 14 token）

`none 0` · `level1 2` · `level2 4` · `level3 6` · `level4 8` · `level5 10` · `level6 12` · `level7 14` · `level8 16` · `level9 18` · **`level10 20`** · `level11 22` · `level12 24` · `level16 32`（跳过 13/14/15）

- **主圆角**：card-root 与按钮 = `level10`(20vp)；小元素（图片/徽标/标签）= `level2`–`level4`；辅助信息底板 = `level6`(12)。
- 同一功能用同一圆角，不做逐实例微调；不使用装饰性嵌套圆矩形。
- 胶囊/圆形按钮用 `level10`(20vp) 表达（适配 36vp 高），不用 `9999vp`。
- 预览壳外圆角：`2×2` 18vp、`2×4` 22vp（属壳，非卡片内容）。

---

## 6. 布局槽位（Slot Model）

卡片先选尺寸，再映射到三槽；不得从示意图反推坐标。HTML 三槽直接父容器为全高纵向 `.card-content`。

### title-area（必选，顶部）

- 含可选 `leading-icon` + 必选 `title-text`（+ 可选 `subtitle-text`）。`gapAfter` 8vp，单行。
- `leading-icon` 两形态：**左上前置 12×12vp**（与标题水平对齐）/ **右上 20×20vp**（贴标题区右上角，应用图标/Logo/装饰状态图标）。一卡至多 2 个（左上 12 + 右上 20）。
- title-text 排版：常规卡 primary=`subtitle-s-medium`、prominent=`subtitle-l-medium`、数字卡=`body-s-regular`；**桌面服务卡片统一 `body-s-regular`(12/400)**。色 `font_primary`，单行。

### content-area（必选，中部）

- 与 title-area 必须 **8vp** 间距（槽位栅格，优先于内部对齐，不得折叠）。
- `fill-remaining-budget`：占满 title 下方至 button 上方（无 button 时至安全区底）；内容少也不收缩高度。
- 默认正文 `body-s-regular`(12/400)；`overflowPolicy: remove-secondary-content-before-render`。

**按内容类型的对齐（不得一刀切）**：

| 内容类型 | 纵向 | 横向 | 判定 |
|---|---|---|---|
| 纯文本/数值（含 value-group 大数字，无 SVG/图/表/环/图标） | `bottom` | `left` | 默认，左下角 |
| 装饰型 hero 图标（天气/心率/场景插画，无图表/环） | `center` | `flex-start` | 居中居左，图标 48–56vp 不撑满 |
| 表现型内容（content-preview 图表/图/媒体、data-dataviz、display-ring、paired-data-ring） | `center` | `center` | 视觉焦点居中 |

判定优先级：先查表现型节点 → 否则查 hero 图标 → 否则纯文本左下。`value-group` 始终归纯文本类。不允许表现型贴左下，也不允许纯文本居中悬浮。对齐不改变 content-area 高度。

**content-area 子节点**：

- `content-preview`（图/图/列表/地图/媒体/占位）：fill 模式（hero/chart 占满，`min-height:0`）或 fixed 模式（sparkline/进度条声明定高，不拉伸）；背景 `comp_background_tertiary`，圆角 `level4`(8)。
- `value-group`（数值组）：`metric-primary` 数值 + `body-s-regular` 单位/辅助，单行。
- `bottom-information-surface`（2×2 仅 title 时）：标题 `body-s-bold`(12/700) + 辅助 `body-s-regular`(12/400)，内边距 8vp，贴 content-area 底部，**不允许同时有 button-area**。

### button-area（可选，底部）

- 默认非必选；但 query 提到具体操作/点击/打开/进入/查看详情时**必须**出现显式按钮，不得用整卡点击替代。
- 与 content-area 8vp 间距，贴安全区底；`marginTop` = `spacing.md`(8)。
- `2×2` ≤1 按钮；`2×4` ≤2 按钮（次操作须独立即时目标且不与主操作竞争），两按钮等宽等高上下对齐，间距 8–12vp。
- 按钮直接位于卡片根背景，不叠放在 content-preview/辅助面板内。

### `2×2` 内容组合

| 槽组合 | content-area 上限 | 允许组合 |
|---|---|---|
| title + text button | 58vp | 单决策状态/单主数值/一句短决策文案 + 文字主操作 |
| title + icon button | 64vp | 主决策信号 + ≤1 必要辅助，或必要紧凑定高数据可视化 + 唯一图标操作 |
| title only | 102vp | 单决策状态/单主数值/双数据并列圆环/两文字信息底板（四选一） |

**禁止**：一句话+大数字+状态胶囊+按钮；多行正文+状态胶囊+按钮；重复指标+按钮；状态与数值表达同一决策时并置；不影响动作的精确差值；解释性文案+重复状态；无独立目标的次操作。

---

## 7. 图标与资源

- 功能/状态/天气主视觉图标皆可选，**不为填充留白而添加**。
- 仅用本地 SVG，从 `resource/icons/catalog.json` 选 `eligibility: approved` 且语义精确匹配的 canonical icon；**禁止**自绘 path、emoji（含系统/Apple）、字符图标、外部图标库、网络图标。语义无精确匹配时省略图标用短文本。
- 快速生成时模型只输出 `<span data-resource-icon-ref="canonical-id"></span>` 占位，由确定性组装器读取 normalized SVG 内联。
- 单色图标用 `currentColor` 继承 `icon_*`/`icon_on_*` token；`multicolor`/`legacy` 资源须 catalog 标 `approved` 才用，且不得自动改色。
- 24×24 等原始尺寸是坐标系，**不是最终显示尺寸**，按场景定：

| 场景 | 尺寸 |
|---|---|
| 标题左上前置 leading-icon | 12vp |
| 标题右上 leading-icon | 20vp |
| button-icon-2x2 内部图标 | 16vp |
| display-ring 中心图标 | 24vp |
| paired-data-ring 中心图标 | 16vp |
| hero-visual（仅天气） | 56vp |

- **唯一 56×56vp 天气 Hero** 固定 `icon_weather1`，须同时标 `data-resource-icon="icon_weather1"` + `data-hero-visual="weather-icon"`；普通线性图标不得放大到 56vp 充当 Hero。
- 所有内联 SVG 必须二选一标 `data-resource-icon` 或 `data-dataviz`，不得同时标，不得有未分类 SVG。
- `data-dataviz` 取值必须是 `display-ring` / `paired-data-ring` / `linear-progress` 三者之一，其他值机器按 `unregistered_dataviz` 拒收。
- **全卡禁止**：手绘 ECG/心电折线、自定义分段进度条、自定义柱/散点/折线/趋势线。多值趋势合规降级：多段 `linear-progress` 并列 + 数值文字，或 `display-ring` 表达当前/汇总值。

---

## 8. 组件

### Card Root（卡片根）

- 接受宿主画布，不写死外层宽高。
- 两层背景：`comp_background_primary` 基底 + 精确命中的场景渐变（未命中用 `general-fallback`）。
- 圆角 `level10`(20vp)，内边距 `safe-margin`(12vp)。

### Title & Identity

- title-text 必选（不得因内容自明而省略），单行；左上可显服务名（`doNotRepeatAppName`）；右上可放本地 SVG 应用图标（不外链不 emoji）；`appIconAllowed: false`。

### Hero（主信息，仅 1）

可为：数值/当前状态/下一事件/日期倒计时/图片媒体预览/单一进度。`value-group.value`：无辅助用 `metric-primary`(40/700)，有辅助用 `metric-primary-with-support`(32/700)。
- `hero-visual-text` 横向变体：左 56×56 hero-visual（天气仅 `icon_weather1`，图表须 `data-dataviz`）+ 右 text-block（仅大字主文本/仅辅助/大字+辅助 三组合）。视觉与文本须表达同一数据对象并共为一个 Hero。

### Supporting Content（辅助）

- 必须帮助理解主信息或决定下一步；禁止无关推荐/广告/快捷入口。
- `2×2` ≤2 行；`2×4` 普通列表 ≤3 行，带图表 ≤2 行。

### Action（操作）

| 属性 | 值 |
|---|---|
| 主按钮 background/text | `brand` / `font_on_primary`（渐变卡按 §3.4 覆盖） |
| 次按钮 background/text | `comp_background_tertiary` / `font_primary` |
| 圆角 | `level10`(20vp，固定不按高度变) |
| 高度 | 36vp（文字按钮/胶囊） |
| 内边距 | 10vp 8vp，gap 8vp，居中 |
| 文字 | `body-m-regular`(14/400)，>6 字降 `body-s-regular`(12/400)，不再降 |
| 最小可视尺寸 | 24vp；最小热区 40vp |
| 距卡片边 | ≥12vp |
| 2×2 圆形/图标按钮 | 30×30vp，内部图标 16vp，右下角 end 对齐 |
| button-icon-2x2 | 视觉 30×30，热区 ≥40×40（向 gap/安全边距扩展，不覆盖 content/不溢出），`data-component="button-icon-2x2"`，无可见文字，须 `aria-label` 来自完整操作文案 |
| 形状 | 仅 `ordinary-filled`，禁 emphasized/textOnly；允许 circular/capsule |
| 反馈态 | 必备 default/pressed；条件：selected/disabled/loading/success/error |
| 热区 | 无按钮=整卡 1 热区；有按钮=内容区 + 每按钮各 1 独立不重叠热区，反馈独立；点按钮只触发按钮操作 |

**图标按钮优先触发条件（须全部满足）**：2×2；仅 1 个显式操作；删某辅助/紧凑数据可视化会改变用户下一步；catalog 有 `approved` 且语义精确匹配图标；不看文字也能理解操作。任一不满足用文字按钮。**禁止图标化**：危险/不可逆操作、需确认/同意操作、无精确 approved 图标的「查看详情」。

### List（列表）

- `list-row` 高 32vp，`body-s-regular`(12/400)，内边距 0/8vp。
- 仅当前决策项可升 subtitle 层级。

### Progress（进度）

- 类型：环形（单一连续比例）/ 线性（连续或多可比较数值）/ 分段（具名阶段/离散步骤）。
- 无目标/总量/范围/阶段参照时不加进度作装饰。
- `2×2` 默认 ≤1 展示环；仅「双数据并列圆环」变体允许 2 环，且不得与 button-area 同现。`2×4` ≤1 展示环。
- **display-ring**：外径 52vp，描边 6vp 内描边，圆端帽，轨道 `progress_ring_track`；圆心二选一：`subtitle-m-regular` 文本 或 24vp 图标；位置 content-area 或左下角。
- **paired-data-ring**（仅 2×2）：2 环，外径 44vp，描边 6vp 内描边；圆心仅 16vp 图标；标签 `caption-m-regular` 在环下方；**环间距固定 24vp（`spacing.xxl`）**，标签-环间距固定 4vp（`spacing.xs`）；不允许 button-area。
- **linear/分段（2×2）**：条本体贴 content-area 底边（优先于内容组居中）；相关辅助文字在条正上方紧凑。
- 圆心数值+单位须同一行、水平垂直居中；空间不足：先降单位到 8vp → 再降数值一档 → 仍不行则整组移至环旁。

### Auxiliary Info Surface（辅助信息区域）

- 底板色 `comp_background_tertiary`，文字 `comp_foreground_primary`，圆角 `level6`(12)，内边距 4vp 8vp，左对齐，dot/图标与文字垂直居中。
- 位于 content-area 底部，与上方主内容 ≥8vp；同区 ≤3 个，相邻间距 4vp，各仍填满剩余宽度。
- 空间降级顺序：行间距压到 2vp → 辅助正文降级/省略 → 标题降级 → 标题换更短 → 仅留单行正文。

---

## 9. 内容预算与删减（necessary-actionable-only）

- 服务卡片不是缩小版应用页面。生成器须**布局前先判信息优先级**，不得先堆满再缩小字号/裁切/换行补救。
- 优先级（高→低）：主操作及其决策信号 > 操作上下文 > 会改变操作的辅助信息 > 有独立即时目标的次操作 > 解释性背景。
- 取舍测试：**删除它后用户下一步会改变吗？不会就不呈现。**
- 决策信号三选一：state | value | short-sentence；风险/截止时间折叠进决策信号，不另起一行；状态+数值并置仅当各自改变下一步。
- 文案上限：标题 ≤6 字，主句 ≤12 字，状态标签 ≤4 字，按钮文案 ≤4 字。
- 数字 ≤1（双数据并列圆环可 2，仍为上限非配额），须影响判断/操作；不影响操作的精确数字/差值/更新时间/说明性统计默认不呈现；能用「已超时/偏高/待处理」时不再附精确差值。

### Overflow Resolution（删减顺序，不得压缩/裁切/叠放）

1. 缩短操作文案（"查看报告"→"报告"）。
2. 删不影响操作的精确数字/差值/更新时间/说明性统计。
3. 删解释性文案；必要说明改短标签或并入主信息组。
4. 图表降级为 sparkline，移除坐标轴/网格/日期/数据点说明。
5. 日历/列表降级为 1 条摘要。
6. 删次操作，保留主操作。
7. 删重复信息（主数值已在一处表达，他处不再重复）。
8. 状态胶囊降级为图标/短标签，不遮挡标题或主信息。

**禁止的补救手段**：缩字号到 token 下限以下、压缩安全边距、负间距、绝对定位、裁切隐藏布局失败；禁止内容重叠、卡片溢出。

---

## 10. 状态与交互

### Content States

- 必备：normal。条件：loading/empty/error/offline/stale/unauthenticated/unauthorized/partial_data/privacy_hidden/service_unavailable。
- 不变式：状态切换不得 resize 画布；主意图须可识别；错误信息须可操作或可解释。

### Interaction Model

- 默认 `conditional-by-button-presence`；允许 `whole-card` 或 `content-and-action-group`。
- 无按钮：1 热区=整卡。有按钮：热区数 = 1 + 显式操作数（内容区 + 每按钮各 1 独立区），区域不重叠、反馈独立。
- 允许动作：open-detail / execute-single-command / toggle-single-state。
- 禁止：复杂表单、多步流程、隐藏手势依赖、密集按钮网格、依赖 hover 的交互。

---

## 11. 深度（Elevation）

- 深度靠**调性分层**（`comp_background_primary`/`secondary`/`tertiary` 叠出安静层次），不靠投影。
- 分割线仅在间距不足以表达分组时用，`comp_divider`（20% 透明前景色，明暗各自覆盖）。
- 默认禁装饰投影；卡片不发明与桌面摆放位置相悖的高度。

---

## 12. Do's & Don'ts 速查

**Do**

- 颜色用 token 名引用；`card-root` 先铺 `comp_background_primary` 再叠精确命中场景渐变（未命中用 `general-fallback`）。
- 用 `value-group.value` + `metric-primary` 确立单一主数据点，其他退让。
- 内容保持在 12vp 安全边距内；提供 default + pressed 反馈态。
- 圆角：card-root 与按钮 `level10`(20vp)，标签 `level2`(4vp)；渐变预设原样用 stops，不自配对手调或新建。

**Don't**

- 不在普通组件/正文硬编码 hex；不用废弃旧场景渐变/扩展色板/自定义渐变作 card-root 背景。
- 不给装饰元素加投影；不让 `2×2` 超 1 操作或 `2×4` 超 1 主+1 次操作；不在同组件族混用圆角。
- 不引入第四字重/新字体族/低于 8vp 字号；不把 `warning` 红用作品牌色；不混用非 13 档 alpha。
- 不在 `themes.dark` 外另起主题层；不为内容拉大画布；不用缩字号/压缩边距/负间距/绝对定位/裁切掩盖过载；不让按钮覆盖图表/列表/内容预览。

---

## 附录：关键数值速查

| 项 | 值 |
|---|---|
| 画布 2×2 / 2×4 | 160×160 / 320×160 vp |
| 安全区 / 内边距 | 12 vp |
| 间距刻度 | 2/4/6/8/12/16/24 vp |
| 圆角（card/button） | level10 = 20 vp |
| alpha 档 | FF/E5/CC/B2/99/7F/66/4D/33/26/19/0C/00 |
| 对比度（文本/正文长文） | ≥3:1 强制 / ≥4.5:1 建议 |
| brand（light/dark） | #0A59F7 / #317AF7 |
| 文字阶（light→dark） | #000000E5→#FFFFFFE5 等 |
| 字体族 | HarmonyOS Sans SC |
| 字重 | 400/500/700 |
| 字号 tiers | display 56/48/38 · title 30/24/20 · subtitle 18/16/14 · body 16/14/12 · caption 12/10/8 |
| 主数值 token | metric-primary 40/700 · metric-primary-with-support 32/700 |
| 按钮高度/圆角/文字 | 36vp / 20vp / 14→12vp |
| 按钮最小可视/热区 | 24vp / 40vp |
| button-icon-2x2 | 30×30vp / 图标 16vp |
| display-ring | 52vp / 描边 6vp 内描边 |
| paired-data-ring | 44vp ×2 / 环距 24vp / 标签距 4vp |
| list-row | 32vp / 12vp |
| Hero 天气图标 | icon_weather1 56×56vp |
| 层级上限 | 3 |
