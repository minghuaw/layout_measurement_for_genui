# 轻量布局度量引擎 · 使用说明

面向 H5 静态页面的布局/配色质量度量工具：无头浏览器采集事实 → 五层美学体系（61 条规则）判定 → 输出紧凑纯文本 `report.txt`（可直接回流给 LLM）。架构与设计详见 [DESIGN.md](DESIGN.md)。

## 环境准备

- Node.js ≥ 20
- Playwright + Chromium（首次使用，国内镜像加速）：

```powershell
npm install
$env:PLAYWRIGHT_DOWNLOAD_HOST='https://registry.npmmirror.com/-/binary/playwright'
npx playwright install chromium
```

## 快速上手

### 方式一：单文件分析（任意 HTML → report.txt）

报告默认输出到 HTML 同目录（`<文件名>.report.txt`）。

```powershell
npm run analyze -- <path/to/page.html>            # 位置参数
node src/analyze.mjs --file page.html --out ./out # 旗标形式，--out 覆盖输出目录
node src/analyze.mjs https://example.com --name example --out ./out   # URL 模式
```

URL 模式：输入以 `http(s)://` 开头即直接分析远程页面（同一 375×812 移动视口）；报告命名无法从 URL 推导，`--name` 与 `--out` 必填。等待策略为 `networkidle`（30s 超时后回退 `load`，适配长轮询类页面）。

### 方式二：批量夹具管线（fixtures/ → reports/）

```powershell
npm run collect                                   # 全量 15 个夹具 → reports/（仅 report.txt）
node src/run.mjs good overflow                    # 指定夹具子集
node src/run.mjs --full good                      # 实验模式：额外产出 aria/geometry/cdp 产物
```

实验目录参数化：

```powershell
$env:INPUT_DIR='repaired'; $env:OUTPUT_DIR='reports_repaired'
node src/run.mjs overflow
```

## 报告解读

`report.txt` 结构：

```
=== Layout Report: good.html ===
Page 375×812 contentH=917 scrollW=375          # 页面尺寸 / 内容高度 / 横向滚动宽
Config: defaults                               # 配置来源（defaults 或 <文件> (N 处覆盖)）
Palette bg:#fff 86% | accent:#2563eb 5% ...    # 调色板单行（背景/文本/强调/和声）
├─ header.header (0,0 375×79)                  # 事实树（标签+矩形+紧凑元标记）
│  ├─ h1 (...) <fs20,#222/#fff,w700> "今日推荐"
ISSUES (0):                                    # 判定结果，按 L1→L5 分层分组
  ── L1 基础规范 ──
  [TYPE] 带 CSS 修复线索 + 理论依据的消息
Layers: L1=0 L2=0 L3=0 L4=0 L5=0               # 各层健康度
```

消息工程示例：`[CONTRAST_LOW] p.desc 文字 #ccc 对背景 #fff 对比度 1.61:1 (<4.5:1 WCAG AA)，建议改为 #5f5f5f`。

## 配置

优先级：内置默认 < `metrics.config.json`（根目录自动发现）< `METRICS_CONFIG=path` < 环境变量。

```powershell
# 复制样例后编辑即可自动生效
Copy-Item metrics.config.example.json metrics.config.json

$env:METRICS_CONFIG='my.config.json'; node src/run.mjs good   # 指定配置文件
$env:METRICS_OFF='L5'; node src/run.mjs good                  # 关闭整层
$env:METRICS_OFF='GRAY_UNTINTED,ACCENT_BLOAT'                 # 关闭单条规则
$env:METRICS_ON='TYPE_SCALE,SPACING_8PT,CONTRAST_AAA'         # 启用 aspirational 规则
```

支持能力：阈值覆盖 / 单规则开关 / severity 覆盖 / 整层开关。非法配置（未知规则 ID、类型错误）会在启动时报错并列出合法清单。

## 测试

```powershell
npm test          # 配置层 14 项用例（tests/config.test.mjs）
npm run golden    # Golden 基线对比（15 夹具计数 + type 序列，需先 npm run collect）
```

Golden 基线：`0/4/2/7/3/2/2/4/3/5/3/5/9/9/7`（good 恒为 0）。

## 修复实验与风格转换

```powershell
# 三臂修复实验（blind / guided / layout_only，依赖本地 Ollama qwen3:8b）
node experiments/blind_repair/repair.mjs [fixtures…]
node experiments/guided_repair/guided_repair.mjs [fixtures…]
node experiments/layout_only_repair/layout_only_repair.mjs [fixtures…]
node experiments/guided_repair/compare.mjs [fixtures…]   # 四臂对比

# 风格转换（重跑需用实验模式 --full，style_eval 依赖 geometry.json）
node experiments/style_transfer/restyle.mjs
node experiments/style_transfer/style_eval.mjs
```

## 常见问题

- **`Executable doesn't exist`**：浏览器二进制未下载，执行上方 `npx playwright install chromium`。
- **报告与历史实验不可比**：experiments/*/fixtures 为历史快照，重跑实验臂前请从主 `fixtures/` 重新复制。
- **`--full` 产物体积**：实验模式会额外落 aria/geometry/cdp 文件；工具默认只产 report.txt。
