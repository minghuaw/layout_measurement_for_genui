import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const EXP = resolve(DIR, '..');
const BLIND = resolve(EXP, '..', 'blind_repair');
const NAMES = process.argv.slice(2).length ? process.argv.slice(2) : ['overflow', 'overlap', 'mixed'];

function issues(dir, name) {
  const path = join(dir, name + '.report.txt');
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith('ISSUES'));
  return lines
    .slice(i + 1)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('['))
    .map((l) => l.match(/^\[(\w+)\]/)[1]);
}

const count = (arr) => (arr === null ? '?' : arr.length);
const newIssues = (before, after) => {
  if (after === null) return [];
  const b = new Set(before || []);
  const seen = new Set();
  const fresh = [];
  for (const t of after) {
    const key = t;
    if (!b.has(key) && !seen.has(key)) {
      seen.add(key);
      fresh.push(t);
    }
  }
  return fresh;
};

console.log('fixture    before  blind(对照)  guided(实验)  判定');
const rows = [];
for (const name of NAMES) {
  const b = issues(join(EXP, 'reports'), name);
  const blind = issues(join(BLIND, 'reports_repaired'), name);
  const guided = issues(join(EXP, 'reports_repaired'), name);
  let verdict;
  if (guided === null) verdict = 'CRASH(未产出报告)';
  else if (guided.length === 0) verdict = '全修复';
  else if (b !== null && guided.length < b.length) verdict = `部分修复 (${b.length}→${guided.length})`;
  else verdict = `无效 (${b?.length ?? '?'}→${guided.length})`;
  rows.push({ name, b, blind, guided, verdict });
  console.log(
    `${name.padEnd(10)} ${String(count(b)).padEnd(7)} ${String(count(blind)).padEnd(11)} ${String(count(guided)).padEnd(12)} ${verdict}`
  );
}

console.log('\n=== 分类型明细 ===');
const types = ['OVERFLOW', 'ELEMENT_OVERFLOW', 'TEXT_CLIP', 'OVERLAP', 'TAP_TARGET', 'SPACING'];
const occ = (arr, t) => (arr === null ? '-' : arr.filter((x) => x === t).length);
console.log(['type'.padEnd(17), 'fixture'.padEnd(10), 'before'.padEnd(7), 'blind'.padEnd(6), 'guided'.padEnd(6)].join(' '));
for (const t of types) {
  for (const r of rows) {
    const has = [r.b, r.blind, r.guided].some((a) => occ(a, t) > 0);
    if (has) {
      console.log(
        `${t.padEnd(17)} ${r.name.padEnd(10)} ${String(occ(r.b, t)).padEnd(7)} ${String(occ(r.blind, t)).padEnd(6)} ${String(occ(r.guided, t)).padEnd(6)}`
      );
    }
  }
}

console.log('\n=== 新引入问题检查（guided 相对 before） ===');
let any = false;
for (const r of rows) {
  const fresh = newIssues(r.b, r.guided);
  if (fresh.length) {
    any = true;
    console.log(`${r.name}: 新增 ${fresh.join(',')}`);
  }
}
if (!any) console.log('none - 未引入新类型问题');
