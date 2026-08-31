/**
 * layer-rhythm.mjs —— L3 空间节奏（8 条）
 *
 * 语义：留白与比例（不违规但"不舒服"）。判定对象为空白带、卡片饱满度、
 *   宽高比、行/屏幕密度、左右视觉重量；多为从宽阈值（宁可漏报不可误报）。
 */
import { label, r0, spread, pct } from '../engine/util.mjs';

/** collectTextNodes —— 递归收集子树内所有带文本的节点（CARD_VOID 内容包络计算用） */
function collectTextNodes(n, out) {
  if (n.text) out.push(n);
  for (const c of n.children) collectTextNodes(c, out);
}

export const rhythmRules = [
  /* ---- 留白 ---- */
  {
    id: 'VOID_BAND', layer: 'L3', severity: 'warn', runner: 'page',
    theory: '留白节奏',
    detect: (F) => (F.voidBands.length ? F.voidBands : null),
    message: (b) => `y=${r0(b.from)}..${r0(b.to)} 存在 ${r0(b.gap)}px 垂直空白带`
  },
  {
    id: 'CARD_VOID', layer: 'L3', severity: 'warn', runner: 'listGroup',
    theory: '卡片内容饱满度',
    detect: (g, T) => {
      let voidCount = 0;
      for (const item of g.items) {
        const texts = [];
        collectTextNodes(item, texts);
        if (!texts.length) continue;
        const top = Math.min(...texts.map((t) => t.rect.y));
        const bottom = Math.max(...texts.map((t) => t.rect.y + t.rect.h));
        const contentH = bottom - top;
        const bottomGap = item.rect.y + item.rect.h - bottom;
        if (contentH / item.rect.h < T.RATIO || (bottomGap >= T.BOTTOM && bottomGap >= item.rect.h * T.BOTTOM_PCT)) {
          voidCount++;
        }
      }
      if (voidCount >= 2) return { voidCount, total: g.items.length, key: g.key, parent: g.parent };
      return null;
    },
    message: (h) => `${h.voidCount}/${h.total} 个 ${h.key} 内容占比过低（大面积空白）(容器 ${h.parent})`
  },
  /* ---- 比例 ---- */
  {
    id: 'ASPECT_INCONSISTENT', layer: 'L3', severity: 'warn', runner: 'listGroup',
    theory: '比例一致性',
    detect: (g, T) => {
      const ratios = g.items.map((n) => n.rect.h / n.rect.w);
      if (spread(ratios) > T.SPREAD) {
        return { n: g.items.length, key: g.key, ratios: ratios.map((v) => v.toFixed(2)), parent: g.parent };
      }
      return null;
    },
    message: (h) => `${h.n} 个 ${h.key} 宽高比不一致: ${h.ratios.join('/')} (容器 ${h.parent})`
  },
  {
    id: 'ASPECT_EXTREME', layer: 'L3', severity: 'warn', runner: 'listGroup',
    theory: '比例协调',
    detect: (g, T) => {
      const extremes = g.items.filter((n) => n.rect.h / n.rect.w > T.MAX || n.rect.h / n.rect.w < T.MIN);
      if (extremes.length) {
        return { count: extremes.length, key: g.key, ratios: extremes.map((n) => (n.rect.h / n.rect.w).toFixed(2)), parent: g.parent };
      }
      return null;
    },
    message: (h) => `${h.count} 个 ${h.key} 宽高比失调: ${h.ratios.join('/')} (容器 ${h.parent})`
  },
  {
    id: 'IMG_SIZE_INCONSISTENT', layer: 'L3', severity: 'warn', runner: 'listGroup',
    theory: '媒体尺寸一致性',
    detect: (g, T) => {
      const thumbs = [];
      for (const item of g.items) {
        const t = [];
        (function find(n) {
          if (!n.children.length && !n.text && r0(n.rect.w) === r0(n.rect.h) && n.rect.w >= 24 && n.rect.w <= 128) t.push(n);
          for (const c of n.children) find(c);
        })(item);
        if (t.length) thumbs.push(t[0]);
      }
      if (thumbs.length >= 2 && spread(thumbs.map((n) => n.rect.w)) > T.DIFF) {
        return { n: g.items.length, key: g.key, thumbs: thumbs.map((n) => r0(n.rect.w)) };
      }
      return null;
    },
    message: (h) => `${h.n} 个 ${h.key} 的缩略图尺寸不一致: ${h.thumbs.join('/')}px`
  },
  {
    id: 'LINE_LENGTH', layer: 'L3', severity: 'warn', runner: 'node',
    theory: 'Refactoring UI：行长 45-75ch（中文等效约 20-45 字）',
    when: (n) => n.tag === 'p' && n.text && n.text.length >= 20,
    detect: (n, T) => {
      const cpl = n.rect.w / (n.fontSize || 16);
      if (cpl < T.MIN_CPL || cpl > T.MAX_CPL) return { n, cpl: cpl.toFixed(1) };
      return null;
    },
    message: (h, T) => `${label(h.n)} 每行约 ${h.cpl} 字，超出舒适行长 (${T.MIN_CPL}-${T.MAX_CPL})，应限制内容宽度`
  },
  /* ---- 页面密度与平衡 ---- */
  {
    id: 'DENSITY_EXTREME', layer: 'L3', severity: 'info', runner: 'page',
    theory: 'Ngo density：信息密度适中',
    detect: (F, T) => {
      const screens = Math.max(1, F.pageInfo.scrollHeight / F.pageInfo.viewport.h);
      const per = F.allNodes.length / screens;
      if (per < T.MIN || per > T.MAX) return { per: per.toFixed(1), total: F.allNodes.length };
      return null;
    },
    message: (h, T) => `平均每屏 ${h.per} 个元素（共 ${h.total} 个，建议 ${T.MIN}-${T.MAX}），信息密度失衡`
  },
  {
    id: 'BALANCE_OFF', layer: 'L3', severity: 'info', runner: 'page',
    theory: 'Ngo balance：左右视觉重量均衡',
    detect: (F, T) => {
      const mid = F.pageInfo.viewport.w / 2;
      let left = 0, right = 0;
      for (const n of F.allNodes) {
        const x1 = n.rect.x, x2 = n.rect.x + n.rect.w;
        const leftW = Math.max(0, Math.min(x2, mid) - x1);
        const rightW = Math.max(0, x2 - Math.max(x1, mid));
        left += leftW * n.rect.h;
        right += rightW * n.rect.h;
      }
      const imb = Math.abs(left - right) / Math.max(1, left + right);
      if (imb > T.MAX_IMBALANCE) return { pct: pct(imb) };
      return null;
    },
    message: (h) => `左右视觉重量失衡 ${h.pct}（>25%），应通过留白/元素分布再平衡`
  }
];
