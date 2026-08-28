import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const EXP = resolve(DIR, '..');
const ROOT = resolve(EXP, '..', '..');
const ARMS = {
  before: join(EXP, 'reports'),
  blind: resolve(ROOT, 'experiments', 'blind_repair', 'reports_repaired'),
  guided: resolve(ROOT, 'experiments', 'guided_repair', 'reports_repaired'),
  layout_only: join(EXP, 'reports_repaired')
};
const NAMES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['overflow', 'overlap', 'mixed', 'font-chaos', 'align-chaos', 'card-chaos', 'cramped', 'img-chaos'];

function issues(dir, name) {
  const path = join(dir, name + '.report.txt');
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith('ISSUES'));
  if (i === -1) return null;
  return lines
    .slice(i + 1)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('['))
    .map((l) => l.match(/^\[(\w+)\]/)[1]);
}

const rows = NAMES.map((name) => ({
  name,
  before: issues(ARMS.before, name),
  blind: issues(ARMS.blind, name),
  guided: issues(ARMS.guided, name),
  layoutOnly: issues(ARMS.layout_only, name)
}));

const count = (a) => (a === null ? '-' : a.length);
console.log('fixture        before  blind  guided  layout-only  判定(layout-only)');
let tb = 0, tbl = 0, tg = 0, tlo = 0;
for (const r of rows) {
  const b = r.before === null ? 0 : r.before.length;
  const lo = r.layoutOnly === null ? '?' : r.layoutOnly.length;
  let verdict;
  if (r.layoutOnly === null) verdict = 'CRASH';
  else if (r.layoutOnly.length === 0) verdict = '全修复';
  else if (lo < b) verdict = `部分 (${b}→${lo})`;
  else verdict = `无效 (${b}→${lo})`;
  console.log(
    `${r.name.padEnd(14)} ${String(count(r.before)).padEnd(6)} ${String(count(r.blind)).padEnd(6)} ${String(count(r.guided)).padEnd(7)} ${String(count(r.layoutOnly)).padEnd(11)} ${verdict}`
  );
  tb += b; tbl += r.blind?.length ?? 0; tg += r.guided?.length ?? 0;
  if (r.layoutOnly) tlo += r.layoutOnly.length;
}
console.log(`${'TOTAL'.padEnd(14)} ${String(tb).padEnd(6)} ${String(tbl).padEnd(6)} ${String(tg).padEnd(7)} ${String(tlo).padEnd(11)}`);

console.log('\n=== 分类型明细 (before/blind/guided/layout-only) ===');
const types = [
  'OVERFLOW', 'ELEMENT_OVERFLOW', 'TEXT_CLIP', 'OVERLAP', 'TAP_TARGET', 'SPACING',
  'FONT_INCONSISTENT', 'ALIGN_INCONSISTENT', 'SIZE_INCONSISTENT', 'RADIUS_INCONSISTENT',
  'LINE_HEIGHT_TIGHT', 'IMG_SIZE_INCONSISTENT', 'ASPECT_INCONSISTENT', 'ASPECT_EXTREME',
  'CARD_VOID', 'VOID_BAND', 'CONTRAST_LOW', 'COLOR_INCONSISTENT', 'ACCENT_BLOAT',
  'COLOR_DOMINANCE', 'HARMONY_OFF', 'GARISH_SATURATION',
  'MIN_FONT_SIZE', 'FOCUS_INVISIBLE', 'GREY_ON_COLOR', 'LINK_INDISTINCT',
  'RADIUS_SCALE_OFF', 'BORDER_INCONSISTENT', 'BORDER_OVERUSE', 'WEIGHT_INCONSISTENT',
  'FONT_FAMILY_BLOAT', 'GRAY_SHADE_BLOAT', 'LINE_LENGTH', 'DENSITY_EXTREME', 'BALANCE_OFF',
  'GRAY_UNTINTED', 'SHADE_UNSYSTEMATIC', 'SHADOW_INCONSISTENT', 'SHADOW_DIR_CONFLICT',
  'SHADOW_OVERKILL', 'GLASS_NO_BLUR', 'GLASS_BAD_RANGE', 'MOTION_DURATION_OFF',
  'MOTION_ALL_PROPERTY', 'MOTION_MISSING', 'TYPE_SCALE', 'SPACING_8PT', 'CONTRAST_AAA'
];
const occ = (arr, t) => (arr === null ? '-' : arr.filter((x) => x === t).length);
for (const t of types) {
  let any = false;
  const lines = [];
  for (const r of rows) {
    const vals = [occ(r.before, t), occ(r.blind, t), occ(r.guided, t), occ(r.layoutOnly, t)];
    if (vals.some((v) => typeof v === 'number' && v > 0)) {
      any = true;
      lines.push(`  ${t.padEnd(20)} ${r.name.padEnd(12)} ${vals.join(' / ')}`);
    }
  }
  if (any) console.log(lines.join('\n'));
}

console.log('\n=== 新引入问题检查（各臂相对 before） ===');
for (const arm of ['blind', 'guided', 'layoutOnly']) {
  let any = false;
  for (const r of rows) {
    const before = new Set(r.before || []);
    const fresh = [...new Set((r[arm] || []).filter((t) => !before.has(t)))];
    if (r[arm] !== null && fresh.length) {
      console.log(`${arm} > ${r.name}: 新增 ${fresh.join(',')}`);
      any = true;
    }
  }
  if (!any) console.log(`${arm} > none`);
}
