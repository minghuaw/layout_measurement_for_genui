import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePalette, luminance, parseHex, rgbToHsl } from '../../../src/color.mjs';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const EXP = resolve(DIR, '..');
const STYLES = ['dark', 'warm', 'cool', 'mono'];
const ARMS = ['cmd', 'palette', 'spec'];

function loadGeo(dir, name) {
  const p = join(dir, name + '.geometry.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

function issueCount(dir, name) {
  const p = join(dir, name + '.report.txt');
  if (!existsSync(p)) return null;
  const lines = readFileSync(p, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith('ISSUES'));
  if (i === -1) return null;
  return lines.slice(i + 1).filter((l) => l.trim().startsWith('[')).length;
}

function flatRects(nodes, out) {
  for (const n of nodes) {
    out.push(`${n.tag}|${n.rect.x}|${n.rect.y}|${n.rect.w}|${n.rect.h}`);
    flatRects(n.children, out);
  }
  return out;
}

function styleMatch(style, geo) {
  const p = computePalette(geo.tree, geo.pageInfo);
  if (style === 'dark') {
    const bgLum = p.bgTop.reduce((s, b) => s + b.share * luminance(parseHex(b.hex)), 0);
    return { match: bgLum < 0.25, detail: `bgLum=${bgLum.toFixed(3)} (<0.25)` };
  }
  if (style === 'warm' || style === 'cool') {
    if (!p.accentTop.length) return { match: false, detail: '无强调色' };
    const [h] = rgbToHsl(parseHex(p.accentTop[0].hex));
    const range = style === 'warm' ? [15, 55] : [195, 250];
    return { match: h >= range[0] && h <= range[1], detail: `主强调 ${p.accentTop[0].hex} hue=${h.toFixed(0)}° (∈${range[0]}~${range[1]}°)` };
  }
  const sats = p.accentColors.map((c) => rgbToHsl(parseHex(c))[1]);
  const avgSat = sats.length ? sats.reduce((a, b) => a + b, 0) / sats.length : 0;
  return {
    match: p.hueClusters.length <= 2 && avgSat <= 0.35,
    detail: `hues=${p.hueClusters.length} avgSat=${avgSat.toFixed(2)} (≤2 且 ≤0.35)`
  };
}

const baseGeo = loadGeo(join(EXP, 'reports_base'), 'good');
console.log('style   arm       风格达成            回归   位移     总判定');
for (const style of STYLES) {
  for (const arm of ARMS) {
    const name = `${style}.${arm}`;
    const geo = loadGeo(join(EXP, 'reports'), name);
    if (!geo) {
      console.log(`${style.padEnd(8)} ${arm.padEnd(9)} N/A(未产出)`);
      continue;
    }
    const sm = styleMatch(style, geo);
    const reg = issueCount(join(EXP, 'reports'), name) ?? 0;
    const baseRects = baseGeo ? flatRects(baseGeo.tree, []) : [];
    const rects = flatRects(geo.tree, []);
    const moved = JSON.stringify(baseRects) === JSON.stringify(rects) ? 0 : -1;
    let verdict;
    if (sm.match && reg === 0 && moved === 0) verdict = '✓达成+零回归+零位移';
    else if (sm.match && reg === 0) verdict = '达成+零回归+有位移';
    else if (sm.match) verdict = `达成但回归${reg}`;
    else verdict = `未达成${reg ? `+回归${reg}` : ''}`;
    console.log(
      `${style.padEnd(8)} ${arm.padEnd(9)} ${sm.match ? 'Y' : 'N'} ${sm.detail.padEnd(18)} ${String(reg).padEnd(6)} ${moved === 0 ? 'none' : 'MOVED'} ${verdict}`
    );
  }
}
