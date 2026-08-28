import { computePalette, paletteLine, hex } from './color.mjs';
import { LAYERS, SEVERITY_ORDER } from './schema.mjs';

export function formatReport(name, data, issues, configEcho) {
  const pi = data.pageInfo;
  const lines = [];
  lines.push(`=== Layout Report: ${name}.html ===`);
  lines.push(`Page ${pi.viewport.w}×${pi.viewport.h} contentH=${pi.scrollHeight} scrollW=${pi.scrollWidth}`);
  if (configEcho) lines.push(`Config: ${configEcho}`);
  lines.push(paletteLine(computePalette(data.tree, pi)));
  buildTree(data.tree, '', lines);
  lines.push(`ISSUES (${issues.length}):`);
  if (!issues.length) {
    lines.push('  none - 布局正常');
  } else {
    const sorted = [...issues].sort((a, b) => {
      const la = LAYERS[a.layer].order - LAYERS[b.layer].order;
      if (la !== 0) return la;
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    });
    let curLayer = null;
    for (const is of sorted) {
      if (is.layer !== curLayer) {
        curLayer = is.layer;
        lines.push(`  ── ${LAYERS[curLayer].name} ──`);
      }
      lines.push(`  [${is.type}] ${is.msg}`);
    }
    const counts = {};
    for (const is of issues) counts[is.layer] = (counts[is.layer] || 0) + 1;
    lines.push(`Layers: ${Object.keys(LAYERS).map((l) => `${l}=${counts[l] || 0}`).join(' ')}`);
  }
  return lines.join('\n') + '\n';
}

function buildTree(nodes, prefix, lines) {
  nodes.forEach((n, i) => {
    const last = i === nodes.length - 1;
    const label = n.tag + (n.id ? '#' + n.id : '') + (n.cls ? '.' + n.cls : '');
    const meta = [];
    if (n.pos && n.pos !== 'static') meta.push(n.pos);
    if (n.interactive) meta.push('interactive');
    if (n.textClip) meta.push('text-clip');
    if (n.text && n.fontSize) meta.push('fs' + Math.round(n.fontSize));
    if (n.lineHeight) meta.push('lh' + n.lineHeight);
    if (n.radius >= 1) meta.push('r' + Math.round(n.radius));
    if (n.text) meta.push(hex(n.fg) + '/' + hex(n.bg));
    if (n.shadow) meta.push(`sh${Math.round(n.shadow.blur)}/${n.shadow.alpha}`);
    if (n.backBlur > 0) meta.push('blur' + Math.round(n.backBlur));
    if (n.trMs > 0) meta.push('tr' + Math.round(n.trMs));
    if (n.fw && n.fw !== 400) meta.push('w' + n.fw);
    const r = n.rect;
    let line = `${prefix}${last ? '└─' : '├─'} ${label} (${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}×${Math.round(r.h)})`;
    if (meta.length) line += ` <${meta.join(',')}>`;
    if (n.text) line += ` "${n.text}"`;
    lines.push(line);
    buildTree(n.children, prefix + (last ? '   ' : '│  '), lines);
  });
}
