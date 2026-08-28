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

const PROMPT = `这是一个移动端 H5 页面，存在布局问题、美观问题与配色问题。
布局问题如：横向溢出、元素重叠、可点击元素过小、间距不均、文本被裁切。
美观问题如：同类元素字号不一致、卡片左缘未对齐、卡片宽度/圆角/内边距不统一、行高过挤、图片尺寸不一、卡片宽高比失调或比例不一、卡片内大面积空白、页面存在明显空白段。
配色问题如：文字与背景对比度不足（WCAG AA：正文 4.5:1、24px 以上大字 3:1）、同类元素颜色不一致、强调色过多且互不成和声、大面积高饱和刺眼、背景主导色比例失衡（60-30-10 法则）。
请修复全部问题，输出修复后的完整 HTML 文档。只输出 HTML 代码，不要解释。`;

function clean(text) {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/<!DOCTYPE/i);
  const end = t.toLowerCase().lastIndexOf('</html>');
  if (start === -1 || end === -1) return null;
  return t.slice(start, end + 7);
}

async function chat(fixtureHtml, useThinkParam) {
  const body = {
    model: MODEL,
    stream: true,
    options: { temperature: 0 },
    messages: [{ role: 'user', content: PROMPT + '\n\n' + fixtureHtml }]
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
  let content = '';
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
        if (j.message?.content) content += j.message.content;
        if (j.done) evalCount = j.eval_count || 0;
      } catch {}
    }
  }
  return { content, evalCount };
}

const summary = [];
for (const name of NAMES) {
  const html = readFileSync(join(EXP, 'fixtures', name + '.html'), 'utf8');
  process.stdout.write(`[${name}] requesting ${MODEL} ... `);
  const t0 = Date.now();
  let r;
  try {
    r = await chat(html, true);
  } catch {
    try {
      r = await chat(html, false);
    } catch (e) {
      console.log('FAILED (' + e.message + ')');
      summary.push({ name, status: 'FAILED', reason: e.message, secs: 0 });
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
console.log('\n=== repair summary ===');
for (const s of summary) console.log(`${s.name.padEnd(10)} ${s.status.padEnd(10)} ${s.secs}s`);
