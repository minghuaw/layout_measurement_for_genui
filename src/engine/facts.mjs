/**
 * facts.mjs —— 事实索引（执行层第一步：一次遍历构建全部判定输入）
 *
 * 职责：把几何事实树转成规则执行器可直接消费的索引结构：
 *   - allNodes      全量节点扁平数组（node/page 执行器遍历）
 *   - containers    所有子节点 ≥2 的容器（pair/container 执行器输入）
 *   - textGroups    排版分组（tag|父tag|cls 为键，≥1 有文本节点）
 *   - listGroups    列表分组（同 tag+首cls、宽 ≥100、数量 ≥3）
 *   - voidBands     文本叶子 y 投影合并后的垂直空白带（VOID_BAND 输入）
 *   - palette       调色板（复用 color.mjs computePalette）
 *
 * 注意：此处会向 geo 节点挂 `_` 前缀内部字段（_pt/_pe/_clipInner/_outerExceeds），
 *   collect.mjs 落盘 geometry.json 时以 replacer 剥除，保证产物只含纯净事实。
 */
import { computePalette } from '../color.mjs';
import { label } from './util.mjs';

/** hasClip —— 递归判断某节点子树内是否存在文本裁切节点 */
function hasClip(nodes) {
  for (const n of nodes) {
    if (n.textClip || hasClip(n.children)) return true;
  }
  return false;
}

/**
 * buildFacts —— 构建事实索引
 * @param data 采集事实（pageInfo + tree）
 * @param cfg  合并后配置（取 ELEMENT_OVERFLOW / VOID_BAND 阈值参与建索引）
 */
export function buildFacts(data, cfg) {
  const pi = data.pageInfo;
  const edgeTol = cfg?.rules?.ELEMENT_OVERFLOW?.thresholds?.EDGE_TOL ?? 1;
  const bandMin = cfg?.rules?.VOID_BAND?.thresholds?.MIN ?? 96;

  const allNodes = [];
  const containers = [];
  if (data.tree.length >= 2) containers.push({ children: data.tree, parentLabel: 'body' });

/** 一次深度遍历：填充内部字段 + 收集 allNodes / containers / 溢出层级标记 */
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

  /* 排版分组：同类标签+父标签+类名的有文本节点归组（FONT/COLOR/WEIGHT 等一致性规则输入） */
  const textGroups = new Map();
  for (const n of allNodes) {
    if (!n.text) continue;
    const key = `${n.tag}|${n._pt}|${n.cls}`;
    if (!textGroups.has(key)) textGroups.set(key, []);
    textGroups.get(key).push(n);
  }

  /* 列表分组：同 tag+首cls 且宽 ≥100 的兄弟节点 ≥3 构成一组（对齐/尺寸/圆角/比例类规则输入） */
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

  /* voidBands：文本叶子 y 区间先按起点排序、相邻重叠区间合并，再取区间之间的空隙（≥bandMin 视为空白带）。
     图表/媒体（media 节点，无文本但占满自身区域，如 data-echarts 容器）同样计入投影，
     避免把图表这类“无文本内容”的区块误判为垂直空白带。 */
  const ivs = allNodes
    .filter((n) => n.text || n.media)
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
    tree: data.tree,
    allNodes,
    containers,
    textGroups: [...textGroups.entries()],
    listGroups,
    palette: computePalette(data.tree, pi),
    voidBands,
    /* 图表文字（data-echarts 内 axisLabel/textStyle 等）blend 后的前景数组（CHART_TEXT_CONTRAST 输入） */
    chartTexts: allNodes.filter((n) => Array.isArray(n.chartTextFgs) && n.chartTextFgs.length),
    pageInfo: pi,
    cssom: pi.cssom || {}
  };
}