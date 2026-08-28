import { computePalette } from '../color.mjs';
import { label } from './util.mjs';

function hasClip(nodes) {
  for (const n of nodes) {
    if (n.textClip || hasClip(n.children)) return true;
  }
  return false;
}

export function buildFacts(data, cfg) {
  const pi = data.pageInfo;
  const edgeTol = cfg?.rules?.ELEMENT_OVERFLOW?.thresholds?.EDGE_TOL ?? 1;
  const bandMin = cfg?.rules?.VOID_BAND?.thresholds?.MIN ?? 96;

  const allNodes = [];
  const containers = [];
  if (data.tree.length >= 2) containers.push({ children: data.tree, parentLabel: 'body' });

  const walk = (nodes, parentTag, pe) => {
    for (const n of nodes) {
      n._pt = parentTag;
      n._pe = pe;
      n._clipInner = n.textClip ? !hasClip(n.children) : false;
      const right = n.rect.x + n.rect.w;
      const exceeds = right > pi.viewport.w + edgeTol;
      n._outerExceeds = exceeds && !pe;
      allNodes.push(n);
      if (n.children.length >= 2) containers.push({ children: n.children, parentLabel: label(n) });
      walk(n.children, n.tag, pe || exceeds);
    }
  };
  walk(data.tree, 'body', false);

  const textGroups = new Map();
  for (const n of allNodes) {
    if (!n.text) continue;
    const key = `${n.tag}|${n._pt}|${n.cls}`;
    if (!textGroups.has(key)) textGroups.set(key, []);
    textGroups.get(key).push(n);
  }

  const listGroups = [];
  const collect = (nodes, parent) => {
    const byKey = new Map();
    for (const n of nodes) {
      if (n.rect.w < 100) continue;
      const key = n.tag + (n.cls ? '.' + n.cls.split('.')[0] : '');
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(n);
    }
    for (const [key, items] of byKey) {
      if (items.length >= 3) listGroups.push({ key, items, parent });
    }
    for (const n of nodes) collect(n.children, label(n));
  };
  collect(data.tree, 'body');

  const ivs = allNodes
    .filter((n) => n.text)
    .map((n) => [n.rect.y, n.rect.y + n.rect.h])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of ivs) {
    if (merged.length && s <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    } else {
      merged.push([s, e]);
    }
  }
  const voidBands = [];
  for (let i = 1; i < merged.length; i++) {
    const gap = merged[i][0] - merged[i - 1][1];
    if (gap >= bandMin) voidBands.push({ from: merged[i - 1][1], to: merged[i][0], gap });
  }

  return {
    allNodes,
    containers,
    textGroups: [...textGroups.entries()],
    listGroups,
    palette: computePalette(data.tree, pi),
    voidBands,
    pageInfo: pi,
    cssom: pi.cssom || {}
  };
}
