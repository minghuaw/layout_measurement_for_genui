import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const EXP = resolve(DIR, '..');
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.MODEL || 'qwen3:8b';
const NAMES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['overflow', 'overlap', 'mixed', 'font-chaos', 'align-chaos', 'card-chaos', 'cramped', 'img-chaos', 'ratio-chaos', 'void-band', 'sparse-card', 'contrast-chaos', 'color-chaos', 'palette-chaos'];
const OUT = join(EXP, 'repaired');
mkdirSync(OUT, { recursive: true });

const stripIssues = (report) => {
  const i = report.indexOf('ISSUES (');
  return i === -1 ? report : report.slice(0, i).trimEnd();
};

const buildPrompt = (facts) => `这是一个移动端 H5 页面（视口 375×812），以及对该页面布局的度量信息（元素坐标/尺寸/字号等事实，不含结论）。
请按以下规则分析度量信息，修复所有违反规则之处：
1) 页面任何内容横向宽度不得超过视口 375px；
2) 任何两个元素矩形不得重叠；
3) 可交互元素（按钮/链接）点击区域不小于 44×44px；
4) 同列相邻卡片垂直间距应一致；
5) 文本必须完整显示（树中 text-clip 标记表示文本被裁切），应允许换行；
6) 同类元素（同级标题/正文/价格）字号应一致；
7) 同列表卡片左缘应对齐、宽度应一致；
8) 同列表卡片圆角应统一；
9) 文本行高不低于 1.3；
10) 同列表缩略图尺寸应一致；
11) 同列表卡片宽高比应一致且协调（避免过高、过矮或比例不一），卡片内容应占满卡片高度（不得大面积空白）；
12) 页面垂直方向不应存在 96px 以上的连续空白带；
13) 文字与所在背景对比度不低于 4.5:1（字号 ≥24px 时 3:1），树中每个文本节点的 #前景/#背景 标记与 Palette 行可直接换算；
14) 同类元素（同级标题/正文/按钮/标签）颜色必须一致；
15) 全页强调色控制在 2-3 种，色相成类似或互补关系（参考 Palette 行 accentHues）；
16) 高饱和颜色总面积不超过页面的 20%，大面积区域使用中性色；
17) 主导背景色应占页面大部分面积（60-30-10 法则：主导色约 60%、辅助色约 30%、强调色约 10%）。
输出修复后的完整 HTML 文档。只输出 HTML 代码，不要解释。

--- 布局度量信息 ---
${facts}
--- 信息结束 ---`;

function clean(text) {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/<!DOCTYPE/i);
  const end = t.toLowerCase().lastIndexOf('</html>');
  if (start === -1 || end === -1) return null;
  return t.slice(start, end + 7);
}

async function chat(content, useThinkParam) {
  const body = {
    model: MODEL,
    stream: true,
    options: { temperature: 0 },
    messages: [{ role: 'user', content }]
  };
  if (useThinkParam) body.think = false;
  const res = await fetch(OLLAMA + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let out = '';
  let evalCount = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (j.message?.content) out += j.message.content;
        if (j.done) evalCount = j.eval_count || 0;
      } catch {}
    }
  }
  return { content: out, evalCount };
}

const summary = [];
for (const name of NAMES) {
  const html = readFileSync(join(EXP, 'fixtures', name + '.html'), 'utf8');
  const report = readFileSync(join(EXP, 'reports', name + '.report.txt'), 'utf8');
  const prompt = buildPrompt(stripIssues(report)) + '\n\n' + html;
  process.stdout.write(`[${name}] requesting ${MODEL} ... `);
  const t0 = Date.now();
  let r;
  try {
    r = await chat(prompt, true);
  } catch {
    try {
      r = await chat(prompt, false);
    } catch (e) {
      console.log('FAILED (' + e.message + ')');
      summary.push({ name, status: 'FAILED', secs: 0 });
      continue;
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const fixed = clean(r.content);
  if (!fixed) {
    console.log(`TRUNCATED (${secs}s, ${r.content.length} chars, no </html>)`);
    summary.push({ name, status: 'TRUNCATED', secs });
    continue;
  }
  writeFileSync(join(OUT, name + '.html'), fixed, 'utf8');
  console.log(`OK (${secs}s, ${r.evalCount} eval tokens, out ${fixed.length} chars)`);
  summary.push({ name, status: 'OK', secs });
}
console.log('\n=== layout-only repair summary ===');
for (const s of summary) console.log(`${s.name.padEnd(12)} ${s.status.padEnd(10)} ${s.secs}s`);
