import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(DIR, '..');
const SNAP = join(DIR, 'golden.snapshot.json');
const NAMES = ['good', 'overflow', 'overlap', 'mixed', 'font-chaos', 'align-chaos', 'card-chaos', 'cramped', 'img-chaos', 'ratio-chaos', 'void-band', 'sparse-card', 'contrast-chaos', 'color-chaos', 'palette-chaos', 'fp-absolute-layering', 'fp-badge-overlay', 'fp-negative-margin-stack', 'fp-hero-overlay', 'fp-decoration-layer', 'fp-fab', 'fp-gradient-overlay-card', 'tp-avatar-pile', 'tp-margin-overlap-cards', 'tp-price-collision', 'tp-relative-shift-card', 'tp-section-cover', 'tp-tag-pileup', 'tp-hainan', 'tp-card-size-mismatch', 'tp-gradient-scrim-cover', 'fp-scrim-above-text', 'fp-translucent-scrim'];

function parseIssues(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith('ISSUES'));
  if (i === -1) return null;
  return lines
    .slice(i + 1)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('['))
    .map((l) => l.match(/^\[(\w+)\]/)[1]);
}

const mode = process.argv[2] || 'verify';
if (mode === 'snapshot') {
  const snap = {};
  for (const n of NAMES) snap[n] = parseIssues(join(ROOT, 'reports', n + '.report.txt'));
  writeFileSync(SNAP, JSON.stringify(snap, null, 2));
  console.log('snapshot written:', Object.entries(snap).map(([k, v]) => `${k}=${v.length}`).join(' '));
} else {
  if (!existsSync(SNAP)) {
    console.error('golden.snapshot.json 不存在，先运行: node tests/golden.mjs snapshot');
    process.exit(1);
  }
  const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
  let fail = 0;
  for (const n of NAMES) {
    const cur = parseIssues(join(ROOT, 'reports', n + '.report.txt'));
    const a = [...snap[n]].sort().join(',');
    const b = [...(cur || [])].sort().join(',');
    const ok = a === b;
    if (!ok) fail++;
    console.log(`${n.padEnd(14)} ${ok ? 'OK' : 'DIFF'}  expect=[${a}] actual=[${b}]`);
  }
  console.log(fail === 0 ? `\nGOLDEN PASS (${NAMES.length}/${NAMES.length})` : `\nGOLDEN FAIL (${fail}/${NAMES.length})`);
  process.exit(fail === 0 ? 0 : 1);
}
