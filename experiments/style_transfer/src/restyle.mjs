import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const EXP = resolve(DIR, '..');
const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.MODEL || 'qwen3:8b';
const OUT = join(EXP, 'repaired');
mkdirSync(OUT, { recursive: true });

const HARD = `只允许修改颜色相关 CSS（color、background、border-color、渐变色），不得改动任何尺寸、布局、字体、内容或 HTML 结构。输出修改后的完整 HTML 文档。只输出 HTML 代码，不要解释。`;

const STYLES = {
  dark: {
    cmd: '将页面配色改为深色模式风格（大面积深色背景、浅色文字）',
    spec: '背景面积加权亮度 < 0.25（如 #1e1e1e、#121212 等深色背景占页面大部分面积）；所有文字对比度 ≥ 4.5:1；强调色 ≤ 3 种；只改颜色'
  },
  warm: {
    cmd: '将页面配色改为暖秋风格（暖色调、秋日氛围）',
    spec: '面积最大的强调色色相 ∈ 15°~55°（橙棕色系，如 #d97706、#c2410c）；所有文字对比度 ≥ 4.5:1；强调色 ≤ 3 种；只改颜色'
  },
  cool: {
    cmd: '将页面配色改为科技蓝风格（冷色调、蓝色主色）',
    spec: '面积最大的强调色色相 ∈ 195°~250°（蓝色系，如 #2563eb、#0ea5e9）；所有文字对比度 ≥ 4.5:1；强调色 ≤ 3 种；只改颜色'
  },
  mono: {
    cmd: '将页面配色改为极简灰风格（低饱和、克制用色）',
    spec: '强调色色相种类 ≤ 2 且平均饱和度 ≤ 0.35（灰色/灰蓝等中性色）；所有文字对比度 ≥ 4.5:1；只改颜色'
  }
};
const ARMS = ['cmd', 'palette', 'spec'];

const baseReport = readFileSync(join(EXP, 'reports_base', 'good.report.txt'), 'utf8');
const paletteLine = baseReport.split('\n').find((l) => l.startsWith('Palette'));
const html = readFileSync(join(EXP, 'fixtures', 'good.html'), 'utf8');

function buildPrompt(style, arm) {
  const s = STYLES[style];
  let p = `${s.cmd}。\n`;
  if (arm !== 'cmd') p += `当前页面配色：${paletteLine}\n`;
  if (arm === 'spec') p += `验收标准（必须全部满足）：${s.spec}\n`;
  p += `\n${HARD}\n\n${html}`;
  return p;
}

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
      } catch {}
    }
  }
  return out;
}

const summary = [];
for (const style of Object.keys(STYLES)) {
  for (const arm of ARMS) {
    const name = `${style}.${arm}`;
    process.stdout.write(`[${name}] requesting ${MODEL} ... `);
    const t0 = Date.now();
    let raw;
    try {
      raw = await chat(buildPrompt(style, arm), true);
    } catch {
      try {
        raw = await chat(buildPrompt(style, arm), false);
      } catch (e) {
        console.log('FAILED (' + e.message + ')');
        summary.push({ name, status: 'FAILED' });
        continue;
      }
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const fixed = clean(raw);
    if (!fixed) {
      console.log(`TRUNCATED (${secs}s)`);
      summary.push({ name, status: 'TRUNCATED' });
      continue;
    }
    writeFileSync(join(OUT, name + '.html'), fixed, 'utf8');
    console.log(`OK (${secs}s, out ${fixed.length} chars)`);
    summary.push({ name, status: 'OK' });
  }
}
const ok = summary.filter((s) => s.status === 'OK').length;
console.log(`\n=== restyle summary: ${ok}/${summary.length} OK ===`);
for (const s of summary) console.log(`${s.name.padEnd(14)} ${s.status}`);
