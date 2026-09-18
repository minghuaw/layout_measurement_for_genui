/* apply.mjs — parse `=== FILE: <rel> ===` blocks from a content file and write them. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function applyContent({ contentFile, worktree }) {
  const txt = readFileSync(contentFile, 'utf8');
  const lines = txt.split('\n');
  const blocks = [];
  let cur = null, buf = [];
  for (const ln of lines) {
    const m = ln.match(/^=== FILE: (.+?) ===\s*$/);
    if (m) {
      if (cur) blocks.push([cur, buf.join('\n')]);
      cur = m[1].trim();
      buf = [];
    } else if (cur) {
      buf.push(ln);
    }
  }
  if (cur) blocks.push([cur, buf.join('\n')]);

  if (!blocks.length) throw new Error('No === FILE: === blocks found in ' + contentFile);

  const written = [];
  for (const [rel, body] of blocks) {
    const p = join(worktree, rel);
    writeFileSync(p, body.replace(/\n+$/, '') + '\n', 'utf8');
    written.push(rel);
  }
  return { files: written };
}