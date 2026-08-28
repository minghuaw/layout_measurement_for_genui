import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const EXP = resolve(DIR, '..');
const NAMES = process.argv.slice(2).length ? process.argv.slice(2) : ['overflow', 'overlap', 'mixed'];

function issues(path) {
  if (!existsSync(path)) return null;
  const txt = readFileSync(path, 'utf8');
  const lines = txt.split('\n');
  const i = lines.findIndex((l) => l.startsWith('ISSUES'));
  return lines
    .slice(i + 1)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('['))
    .map((l) => l.match(/^\[(\w+)\]/)[1]);
}

console.log('fixture    before                after                 verdict');
for (const name of NAMES) {
  const b = issues(join(EXP, 'reports', name + '.report.txt'));
  const a = issues(join(EXP, 'reports_repaired', name + '.report.txt'));
  let verdict;
  if (a === null) verdict = 'CRASH(未产出报告)';
  else if (b !== null && a.length === 0) verdict = '全修复';
  else if (b !== null && a.length < b.length) verdict = `部分修复 (${b.length}→${a.length})`;
  else verdict = `无效 (${b?.length ?? '?'}→${a?.length ?? '?'})`;
  const fmt = (arr) => (arr === null ? 'N/A' : arr.length + ': ' + (arr.join(',') || '-'));
  console.log(`${name.padEnd(10)} ${fmt(b).padEnd(20)} ${fmt(a).padEnd(20)} ${verdict}`);
  if (a) for (const t of a) console.log(`           after> [${t}]`);
  if (b) for (const t of b) console.log(`           before> [${t}]`);
}
