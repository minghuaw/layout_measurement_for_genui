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
 *   node src/analyze.mjs <https://…> --name x --out ./out  # URL 模式（--name/--out 必填）
 *   $env:METRICS_OFF='L5'; node src/analyze.mjs page.html   # 配置能力与 run.mjs 一致
 *
 * 行为：
 *   - 本地文件模式：校验文件存在且为 .html/.htm 后缀，解析为绝对路径；
 *     name = 去扩展名 basename（--name 可覆盖）；outDir = --out || 文件所在目录
 *   - URL 模式（输入以 http:// 或 https:// 开头）：跳过本地文件校验，直接打开远程页面，
 *     报告命名无法从 URL 推导，故 --name 与 --out 均为必填
 *   - 复用 loadConfig()（继承 metrics.config.json / METRICS_* 四级配置）
 *   - 复用 collectPage（本地文件经 filePath、URL 经 url 参数打开），工具模式仅产 report.txt
 *   - 控制台打印报告文件路径 + 报告原文
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { collectPage } from './collect.mjs';
import { loadConfig } from './config.mjs';

/** 解析命令行：--file / --out / --name 旗标 + 首个非旗标参数（位置形式） */
const args = process.argv.slice(2);
let fileArg = null;
let outDirArg = null;
let nameArg = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file') fileArg = args[++i];
  else if (args[i] === '--out') outDirArg = args[++i];
  else if (args[i] === '--name') nameArg = args[++i];
  else if (!args[i].startsWith('--') && !fileArg) fileArg = args[i];
}

const USAGE = '用法: node src/analyze.mjs <page.html> [--out <dir>] [--name <name>]\n     node src/analyze.mjs <https://…> --name <name> --out <dir>   # URL 模式';

if (!fileArg) {
  console.error(USAGE);
  process.exit(1);
}

/** URL 模式判定：输入以 http(s):// 开头 → 打开远程页面而非本地文件 */
const isUrl = /^https?:\/\//i.test(fileArg);
let name;
let outDir;
let filePath = null;
let url = null;

if (isUrl) {
  /* 报告命名无法从 URL 推导：--name 与 --out 必填，不做任何隐式默认 */
  if (!nameArg || !outDirArg) {
    console.error('URL 模式必须显式指定 --name <name> 与 --out <dir>');
    console.error(USAGE);
    process.exit(1);
  }
  url = fileArg;
  name = nameArg;
  outDir = resolve(outDirArg);
} else {
  /** 输入文件：解析为绝对路径并校验存在 */
  const HTML_EXT = ['.html', '.htm'];
  filePath = resolve(fileArg);
  if (!existsSync(filePath)) {
    console.error(`文件不存在: ${filePath}`);
    process.exit(1);
  }
  if (!HTML_EXT.includes(extname(filePath).toLowerCase())) {
    console.error(`仅支持 HTML 文件（.html/.htm）: ${filePath}`);
    process.exit(1);
  }

  /** 输出：--out 覆盖，默认落在 HTML 同目录（<name>.report.txt）；--name 可覆盖派生名 */
  name = nameArg || basename(filePath, extname(filePath));
  outDir = outDirArg ? resolve(outDirArg) : dirname(filePath);
}

/* 配置一次性加载（与 run.mjs 同源，继承全部配置能力） */
const { cfg, echo } = loadConfig();

const browser = await chromium.launch();
let result;
try {
  result = await collectPage(browser, {
    name,
    outDir,
    cfg,
    echo,
    ...(isUrl ? { url } : { filePath, inputDir: dirname(filePath) })
  });
} catch (e) {
  await browser.close();
  console.error(`页面打开失败: ${e.message.split('\n')[0]}`);
  process.exit(1);
}
await browser.close();

/* 摘要 + 报告原文 */
console.log(`=== 单文件分析: ${isUrl ? url : filePath} ===`);
console.log(`${result.name}.html  ${result.issues} issues  report ${(result.sizes.report / 1024).toFixed(1)} KB`);
console.log(`报告文件: ${join(outDir, name + '.report.txt')}`);
console.log('\n' + readFileSync(join(outDir, name + '.report.txt'), 'utf8'));
