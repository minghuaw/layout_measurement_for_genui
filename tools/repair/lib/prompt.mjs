/* prompt.mjs — assemble the repair prompt from a base report + source files. */
import { readFileSync } from 'node:fs';

export function assemblePrompt({ baseReport, promptBase, specs }) {
  let s = readFileSync(promptBase, 'utf8').replace(/\n+$/, '') + '\n';
  for (const { rel, path } of specs) {
    s += '\n=== FILE: ' + rel + ' ===\n' + readFileSync(path, 'utf8').replace(/\n+$/, '') + '\n';
  }
  const rep = readFileSync(baseReport, 'utf8');
  const idx = rep.indexOf('ISSUES (');
  if (idx === -1) throw new Error('ISSUES block not found in ' + baseReport);
  s += '\n\n' + rep.slice(idx).trim() + '\n';
  return s;
}