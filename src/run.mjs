/**
 * run.mjs —— 实验启动器（夹具清单与主程序解耦的唯一持有方）
 *
 * 职责：
 *   1. 持有实验夹具清单 ALL（实验资产，不污染管线模块 collect.mjs）
 *   2. 解析命令行与环境变量：INPUT_DIR / OUTPUT_DIR / METRICS_CONFIG /
 *      METRICS_OFF / METRICS_ON（配置经 config.mjs 四级优先级合并）
 *   3. 管理 Playwright 浏览器生命周期，逐夹具驱动 collectPage
 *   4. 控制台输出（按模式分流）：
 *      工具模式（默认）—— 摘要行（名称 | issues）+ 各夹具 report.txt 原文
 *      实验模式（--full）—— 四产物体积对比表 + 各夹具报告原文
 *
 * 用法：
 *   node src/run.mjs                # 工具模式：全量 15 夹具，仅产出 report.txt
 *   node src/run.mjs good overflow  # 指定夹具子集
 *   node src/run.mjs --full good    # 实验模式：四产物全量（style_eval / 格式对比用）
 *   $env:INPUT_DIR='repaired'; $env:OUTPUT_DIR='reports_repaired'; node src/run.mjs overflow …
 *   $env:METRICS_OFF='L5'; node src/run.mjs good   # 关闭整层/单规则
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPage } from './collect.mjs';
import { loadConfig } from './config.mjs';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(DIR, '..');

/** 实验夹具清单（15 缺陷注入 + 7 OVERLAP 误报挑战 + 7 真阳性 = 29；与 tests/golden.snapshot.json 顺序一致） */
const ALL = ['good', 'overflow', 'overlap', 'mixed', 'font-chaos', 'align-chaos', 'card-chaos', 'cramped', 'img-chaos', 'ratio-chaos', 'void-band', 'sparse-card', 'contrast-chaos', 'color-chaos', 'palette-chaos', 'fp-absolute-layering', 'fp-badge-overlay', 'fp-negative-margin-stack', 'fp-hero-overlay', 'fp-decoration-layer', 'fp-fab', 'fp-gradient-overlay-card', 'tp-avatar-pile', 'tp-margin-overlap-cards', 'tp-price-collision', 'tp-relative-shift-card', 'tp-section-cover', 'tp-tag-pileup', 'tp-hainan', 'tp-card-size-mismatch', 'tp-gradient-scrim-cover', 'fp-scrim-above-text', 'fp-translucent-scrim', 'tp-body-bg-dark-text', 'tp-body-bg-gradient'];

/** 命令行解析：--full 旗标进入实验模式，其余非旗标参数为目标夹具（缺省全量） */
const args = process.argv.slice(2);
const FULL = args.includes('--full');
const names = args.filter((a) => !a.startsWith('--'));
const FIXTURES = names.length ? names : ALL;

/** 输入/输出目录：环境变量参数化（实验目录复用主管线的入口），缺省主 fixtures/reports */
const INPUT_DIR = resolve(process.env.INPUT_DIR || join(ROOT, 'fixtures'));
const OUT = resolve(process.env.OUTPUT_DIR || join(ROOT, 'reports'));

/* 配置一次性加载，进程内全部夹具共享（保证 Config 回显一致） */
const { cfg, echo } = loadConfig();

const browser = await chromium.launch();
const results = [];
for (const name of FIXTURES) {
  results.push(await collectPage(browser, { name, inputDir: INPUT_DIR, outDir: OUT, cfg, echo, fullArtifacts: FULL }));
}
await browser.close();

if (FULL) {
  /* ---- 实验模式：四产物体积对比表（回流成本代理指标） ---- */
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  console.log('\n=== 输出格式体积对比（--full 实验模式） ===');
  console.log(['fixture'.padEnd(10), 'aria.yml'.padEnd(10), 'geometry.json'.padEnd(14), 'cdp.json'.padEnd(10), 'report.txt'.padEnd(11), 'issues'].join(' '));
  for (const r of results) {
    console.log([r.name.padEnd(10), kb(r.sizes.aria).padEnd(10), kb(r.sizes.geo).padEnd(14), kb(r.sizes.cdp).padEnd(10), kb(r.sizes.report).padEnd(11), String(r.issues)].join(' '));
  }
} else {
  /* ---- 工具模式：摘要行（名称 | issues | 报告体积） ---- */
  console.log('\n=== 布局度量摘要 ===');
  for (const r of results) {
    const kb = (r.sizes.report / 1024).toFixed(1);
    console.log(`${r.name.padEnd(14)} ${String(r.issues).padStart(2)} issues  report ${kb} KB`);
  }
}
/* ---- 逐夹具打印完整报告（工具的文本布局结果输出） ---- */
for (const r of results) {
  console.log('\n' + readFileSync(join(OUT, r.name + '.report.txt'), 'utf8'));
}
