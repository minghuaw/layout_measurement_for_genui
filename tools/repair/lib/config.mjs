import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* config.mjs — resolve effective config: defaults <- repair.json <- CLI flags. */

const TOOL_DIR = fileURLToPath(new URL('..', import.meta.url)); // tools/repair/
const ANALYZER_ROOT = resolve(TOOL_DIR, '../..');                // repo root

const DEFAULTS = {
  model: 'deepseek-v4-flash',
  temperature: 0.7,
  max_tokens: 65536,
  thinking: 'high',
  analyzer_root: ANALYZER_ROOT,
  build_cmd: 'npx tsc --noEmit && npx vite build',
};

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/* CLI flags arrive as strings; coerce numbers where expected. */
function normalize(cli) {
  const out = { ...cli };
  if (out.temperature != null) out.temperature = Number(out.temperature);
  if (out.max_tokens != null) out.max_tokens = Number(out.max_tokens);
  if (out.thinking != null && !['off', 'low', 'high', 'max'].includes(out.thinking)) {
    throw new Error(`--thinking must be off|low|high|max (got "${out.thinking}")`);
  }
  return out;
}

export function loadConfig(cli = {}) {
  const fromCwd = readJson(join(process.cwd(), 'repair.json'));
  const fromTool = readJson(join(TOOL_DIR, 'repair.json'));
  const file = fromCwd || fromTool || {};
  // drop undefined/null/'' from CLI so they don't shadow defaults
  const clean = Object.fromEntries(Object.entries(cli).filter(([_, v]) => v != null && v !== ''));
  return normalize({ ...DEFAULTS, ...file, ...clean });
}
