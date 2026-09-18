#!/usr/bin/env node
/* repair.mjs — CLI for the one-page repair feedback loop.
 *
 * Stages (each callable standalone):
 *   analyze  — measure a URL with the analyzer
 *   prompt   — assemble the prompt from base report + source files
 *   request  — send prompt to DeepSeek API
 *   apply    — write === FILE: === blocks into a worktree
 *   build    — tsc + vite build in a worktree
 *   gate     — innerText A/B content check
 *   measure  — measure a URL (same as analyze)
 *   run      — chain all stages: analyze -> prompt -> request -> apply -> build -> gate -> measure
 *
 * Flags: --help, --dry-run, --url, --base-url, --name, --out, --worktree,
 *   --whitelist (comma-sep "rel=path" pairs), --prompt-base, --base, --baseline,
 *   --content, --prompt, --thinking (off|low|high|max), --model, --temperature,
 *   --max-tokens, --from, --to, --build-cmd
 */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './lib/config.mjs';
import { analyze } from './lib/analyze.mjs';
import { assemblePrompt } from './lib/prompt.mjs';
import { request } from './lib/api.mjs';
import { applyContent } from './lib/apply.mjs';
import { gate } from './lib/gate.mjs';
import { execSync } from 'node:child_process';

/* ── CLI arg parsing ── */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help:     { type: 'boolean', short: 'h' },
    'dry-run':{ type: 'boolean' },
    url:      { type: 'string' },
    'base-url':{ type: 'string' },
    name:     { type: 'string' },
    out:      { type: 'string' },
    worktree: { type: 'string' },
    whitelist:{ type: 'string' },
    'prompt-base':{ type: 'string' },
    base:     { type: 'string' },
    baseline: { type: 'string' },
    content:  { type: 'string' },
    prompt:   { type: 'string' },
    thinking: { type: 'string' },
    model:    { type: 'string' },
    temperature:{ type: 'string' },
    'max-tokens':{ type: 'string' },
    from:     { type: 'string' },
    to:       { type: 'string' },
    'build-cmd':{ type: 'string' },
  },
});

const stage = positionals[0];
if (!stage || values.help) {
  console.log(`Usage: repair <stage> [flags]

Stages:
  analyze   --url <page-url> --name <n> --out <dir>
  prompt    --base <report> --prompt-base <pb> --whitelist <specs> --name <n> --out <dir>
  request   --prompt <file> --name <n> --out <dir> [--thinking off|low|high|max]
  apply     --content <file> --worktree <dir>
  build     --worktree <dir> [--build-cmd <cmd>]
  gate      --base-url <A> --url <B> [--baseline <file>]
  measure   --url <page-url> --name <n> --out <dir>
  run       --base-url <base-url> --url <result-url> --name <n> --out <dir>
            --worktree <dir> --whitelist <specs> --prompt-base <pb>
            [--thinking high] [--model ...] [--from analyze] [--to measure] [--dry-run]

--whitelist format: "rel1=path1,rel2=path2" where = separates the FILE: label
from the filesystem path (which must be resolvable).

Config file: repair.json in cwd or near the tool (defaults below). CLI flags override.
`);
  process.exit(0);
}

const cfg = loadConfig({
  ...values,
  thinking: values.thinking || undefined,
  model: values.model || undefined,
  temperature: values.temperature || undefined,
  max_tokens: values['max-tokens'] || undefined,
  build_cmd: values['build-cmd'] || undefined,
});

/* ── helpers ── */
function parseWhitelist(raw) {
  if (!raw) throw new Error('--whitelist is required');
  return raw.split(',').map(s => {
    const eq = s.indexOf('=');
    if (eq === -1) return { rel: s, path: s };
    return { rel: s.slice(0, eq), path: s.slice(eq + 1) };
  });
}

function requireFlags(flags) {
  for (const f of flags) {
    if (!cfg[f]) throw new Error(`--${f} is required`);
  }
}

/* ── stage handlers ── */
async function cmdAnalyze() {
  requireFlags(['url', 'name', 'out']);
  console.log(`analyze: ${cfg.url}`);
  const r = await analyze({ url: cfg.url, name: cfg.name, outDir: cfg.out });
  console.log(`  issues=${r.issues}  report=${r.report}`);
  return r;
}

async function cmdPrompt() {
  requireFlags(['base', 'prompt-base', 'whitelist', 'name', 'out']);
  const specs = parseWhitelist(cfg.whitelist);
  console.log(`prompt: source files ${specs.map(s => s.rel).join(', ')}`);
  const text = assemblePrompt({ baseReport: cfg.base, promptBase: cfg['prompt-base'], specs });
  const outFile = join(cfg.out, `${cfg.name}.prompt.txt`);
  mkdirSync(cfg.out, { recursive: true });
  writeFileSync(outFile, text, 'utf8');
  console.log(`  wrote ${outFile} (${text.split('\n').length} lines)`);
}

async function cmdRequest() {
  requireFlags(['prompt', 'name', 'out']);
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY env var required');
  console.log(`request: thinking=${cfg.thinking}  model=${cfg.model}`);
  const r = await request({
    prompt: readFileSync(cfg.prompt, 'utf8'),
    name: cfg.name,
    outDir: cfg.out,
    thinking: cfg.thinking,
    model: cfg.model,
    temperature: cfg.temperature,
    max_tokens: cfg.max_tokens,
  });
  return r;
}

async function cmdApply() {
  requireFlags(['content', 'worktree']);
  const r = applyContent({ contentFile: cfg.content, worktree: cfg.worktree });
  console.log(`applied ${r.files.length} files: ${r.files.join(', ')}`);
}

async function cmdBuild() {
  requireFlags(['worktree']);
  console.log(`build: ${cfg.build_cmd}`);
  execSync(cfg.build_cmd, { cwd: cfg.worktree, stdio: 'inherit' });
  console.log('build OK');
}

async function cmdGate() {
  requireFlags(['url']);
  if (!cfg['base-url'] && !cfg.baseline) throw new Error('gate needs --base-url or --baseline');
  console.log(`gate: ${cfg['base-url'] || cfg.baseline}  vs  ${cfg.url}`);
  const r = await gate({ baseUrl: cfg['base-url'], url: cfg.url, baseline: cfg.baseline });
  console.log(r.pass ? 'CONTENT OK (identical)' : 'CONTENT DIFF');
  if (!r.pass) {
    const a = r.a.split(' ').filter(Boolean).join(' ');
    const b = r.b.split(' ').filter(Boolean).join(' ');
    const linesA = a.split(/\n/).slice(0, 4).join('\n');
    const linesB = b.split(/\n/).slice(0, 4).join('\n');
    console.log('diff (first 4 lines):');
    console.log('- ' + linesA);
    console.log('+ ' + linesB);
  }
  return r;
}

async function cmdMeasure() {
  return cmdAnalyze(); // same logic
}

async function cmdRun() {
  const steps = ['analyze', 'prompt', 'request', 'apply', 'build', 'gate', 'measure'];
  const startIdx = cfg.from ? steps.indexOf(cfg.from) : 0;
  const endIdx = cfg.to ? steps.indexOf(cfg.to) : steps.length - 1;
  if (startIdx === -1) throw new Error(`Unknown --from "${cfg.from}"`);
  if (endIdx === -1) throw new Error(`Unknown --to "${cfg.to}"`);

  let baseUrl = cfg['base-url'];
  const url = cfg.url;
  const name = cfg.name;
  const outDir = cfg.out;
  requireFlags(['base-url', 'url', 'name', 'out', 'worktree', 'whitelist', 'prompt-base']);
  mkdirSync(outDir, { recursive: true });

  for (let i = startIdx; i <= endIdx; i++) {
    const s = steps[i];
    console.log(`\n=== stage: ${s} ===`);

    if (s === 'analyze') {
      const r = await analyze({ url: baseUrl, name: name + '_base', outDir });
      console.log(`  base issues=${r.issues}`);
    } else if (s === 'prompt') {
      const specs = parseWhitelist(cfg.whitelist);
      const baseReport = join(outDir, `${name}_base.report.txt`);
      if (!existsSync(baseReport)) throw new Error(`Base report not found: ${baseReport}`);
      const text = assemblePrompt({ baseReport, promptBase: cfg['prompt-base'], specs });
      const pf = join(outDir, `${name}.prompt.txt`);
      writeFileSync(pf, text, 'utf8');
      console.log(`  wrote ${pf} (${text.split('\n').length} lines)`);
    } else if (s === 'request') {
      const promptFile = join(outDir, `${name}.prompt.txt`);
      if (!existsSync(promptFile)) throw new Error(`Prompt not found: ${promptFile}`);
      await request({
        prompt: readFileSync(promptFile, 'utf8'),
        name, outDir, thinking: cfg.thinking, model: cfg.model,
        temperature: cfg.temperature, max_tokens: cfg.max_tokens,
      });
      if (cfg['dry-run']) { console.log('  (--dry-run: stopping after request)'); break; }
    } else if (s === 'apply') {
      const cf = join(outDir, `${name}.content.txt`);
      if (!existsSync(cf)) throw new Error(`Content not found: ${cf}`);
      const r = applyContent({ contentFile: cf, worktree: cfg.worktree });
      console.log(`  wrote ${r.files.length} files`);
    } else if (s === 'build') {
      execSync(cfg.build_cmd, { cwd: cfg.worktree, stdio: 'inherit' });
      console.log('  build OK');
    } else if (s === 'gate') {
      if (!cfg['base-url']) throw new Error('gate needs --base-url');
      const r = await gate({ baseUrl: cfg['base-url'], url });
      console.log(r.pass ? '  CONTENT OK (identical)' : '  CONTENT DIFF');
    } else if (s === 'measure') {
      const r = await analyze({ url, name, outDir });
      console.log(`  result issues=${r.issues}`);
    }
  }
}

/* ── dispatch ── */
const handlers = {
  analyze:   cmdAnalyze,
  prompt:    cmdPrompt,
  request:   cmdRequest,
  apply:     cmdApply,
  build:     cmdBuild,
  gate:      cmdGate,
  measure:   cmdMeasure,
  run:       cmdRun,
};

(async () => {
  const fn = handlers[stage];
  if (!fn) { console.error(`Unknown stage "${stage}". Try --help.`); process.exit(1); }
  try {
    await fn();
  } catch (e) {
    console.error(`[${stage}] error:`, e.message || e);
    process.exit(1);
  }
})();