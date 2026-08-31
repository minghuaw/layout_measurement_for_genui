/**
 * analyze.mjs —— 单文件独立分析器（直接对任意 HTML 产出 report.txt）
 *
 * 与 run.mjs（批量夹具启动器）互补：run.mjs 面向 fixtures/ 批量管线，
 * 本文件面向"随手一个 HTML 文件"的轻量用法——指定路径即出报告。
 *
 * 用法：
 *   node src/analyze.mjs <path/to/page.html>            # 位置参数（相对/绝对路径均可）
 *   node src/analyze.mjs --file page.html               # 旗标形式
 *   node src/analyze.mjs --file page.html --out ./out   # --out 覆盖输出目录（默认 HTML 同目录）
 *   $env:METRICS_OFF='L5'; node src/analyze.mjs page.html   # 配置能力与 run.mjs 一致
 *
 * 行为：
 *   - 校验文件存在且为 .html/.htm 后缀，解析为绝对路径
 *   - name = 去扩展名 basename；outDir = --out || 文件所在目录 → 产出 <name>.report.txt
 *   - 复用 loadConfig()（继承 metrics.config.json / METRICS_* 四级配置）
 *   - 复用 collectPage（经 filePath 参数直接打开目标文件），工具模式仅产 report.txt
 *   - 控制台打印报告文件路径 + 报告原文
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { collectPage } from './collect.mjs';
import { loadConfig } from './config.mjs';

/** 解析命令行：--file / --out 旗标 + 首个非旗标参数（位置形式） */
const args = process.argv.slice(2);
let fileArg = null;
let outDirArg = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file') fileArg = args[++i];
  else if (args[i] === '--out') outDirArg = args[++i];
  else if (!args[i].startsWith('--') && !fileArg) fileArg = args[i];
}

if (!fileArg) {
  console.error('用法: node src/analyze.mjs <page.html> [--out <dir>]');
  process.exit(1);
}

/** 输入文件：解析为绝对路径并校验存在 */
const HTML_EXT = ['.html', '.htm'];
const filePath = resolve(fileArg);
if (!existsSync(filePath)) {
  console.error(`文件不存在: ${filePath}`);
  process.exit(1);
}
if (!HTML_EXT.includes(extname(filePath).toLowerCase())) {
  console.error(`仅支持 HTML 文件（.html/.htm）: ${filePath}`);
  process.exit(1);
}

/** 输出：--out 覆盖，默认落在 HTML 同目录（<name>.report.txt） */
const name = basename(filePath, extname(filePath));
const outDir = outDirArg ? resolve(outDirArg) : dirname(filePath);

/* 配置一次性加载（与 run.mjs 同源，继承全部配置能力） */
const { cfg, echo } = loadConfig();

const browser = await chromium.launch();
const result = await collectPage(browser, { name, inputDir: dirname(filePath), outDir, cfg, echo, filePath });
await browser.close();

/* 摘要 + 报告原文 */
console.log(`=== 单文件分析: ${filePath} ===`);
console.log(`${result.name}.html  ${result.issues} issues  report ${(result.sizes.report / 1024).toFixed(1)} KB`);
console.log(`报告文件: ${join(outDir, name + '.report.txt')}`);
console.log('\n' + readFileSync(join(outDir, name + '.report.txt'), 'utf8'));
