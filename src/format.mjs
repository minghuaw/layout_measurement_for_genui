/**
 * format.mjs —— 报告渲染层（report.txt 唯一产出方）
 *
 * 职责：把 [事实树 + 判定 issues + 配置回显] 渲染为紧凑、token 友好的纯文本：
 *   1. 头部：文件名 / 页面尺寸 / Config 回显 / Palette 单行
 *   2. 事实树：缩进树 + 紧凑元标记（fs/lh/r/fg/bg/sh/blur/tr/w 等）
 *   3. ISSUES 段：按 L1→L5 分层分组、组内 severity 排序，末尾 Layers 健康度行
 *
 * 兼容约束：`[TYPE] 行` 格式保持不变（compare.mjs / style_eval.mjs / 实验脚本零改动）；
 *   Config 行不以 `[` 开头（防解析器误读为 issue）。
 */
import { computePalette, paletteLine, hex } from './color.mjs';
import { LAYERS, SEVERITY_ORDER } from './schema.mjs';

/** formatReport —— 组装完整报告文本（issues 由 metrics 判定产出的 [] 传入） */
export function formatReport(name, data, issues, configEcho) {
  const pi = data.pageInfo;
  const lines = [];
  lines.push(`=== Layout Report: ${name}.html ===`);
  lines.push(`Page ${pi.viewport.w}×${pi.viewport.h} contentH=${pi.scrollHeight} scrollW=${pi.scrollWidth}`);
  if (pi.url) lines.push(`URL: ${pi.url}`);
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
  }
  /* 分层健康度行始终输出（含 0 issue 情形，此前误置于 else 分支内） */
  const counts = {};
  for (const is of issues) counts[is.layer] = (counts[is.layer] || 0) + 1;
  lines.push(`Layers: ${Object.keys(LAYERS).map((l) => `${l}=${counts[l] || 0}`).join(' ')}`);
  return lines.join('\n') + '\n';
}

/** buildTree —— 递归渲染事实树：标签 + 矩形 + 紧凑元标记（仅打印可读性关键字段） */
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
