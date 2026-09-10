/**
 * layer-rhythm.mjs —— L3 空间节奏（12 条）
 *
 * 语义：留白与比例（不违规但"不舒服"）。判定对象为空白带、卡片饱满度、
 *   宽高比、行/屏幕密度、左右视觉重量；多为从宽阈值（宁可漏报不可误报）。
 */
import { label, loc, r0, spread, pct } from '../engine/util.mjs';

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
      const voids = [];
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
          if (voids.length < 3) voids.push(loc(item));
        }
      }
      if (voidCount >= 2) return { voidCount, total: g.items.length, key: g.key, parent: g.parent, voids };
      return null;
    },
    message: (h) => `${h.voidCount}/${h.total} 个 ${h.key} 内容占比过低（大面积空白）(容器 ${h.parent})${h.voids.length ? '；如: ' + h.voids.join(', ') : ''}`
  },
  /* ---- 比例 ---- */
  {
    id: 'ASPECT_INCONSISTENT', layer: 'L3', severity: 'warn', runner: 'listGroup',
    theory: '比例一致性',
    detect: (g, T) => {
      const ratios = g.items.map((n) => n.rect.h / n.rect.w);
      if (spread(ratios) > T.SPREAD) {
        /* 偏离中位数最远的成员定位串（≤3），便于源码定位 */
        const rs = [...ratios].sort((a, b) => a - b);
        const med = rs.length % 2 ? rs[(rs.length - 1) / 2] : (rs[rs.length / 2 - 1] + rs[rs.length / 2]) / 2;
        const sorted = [...g.items].sort((a, b) => Math.abs(b.rect.h / b.rect.w - med) - Math.abs(a.rect.h / a.rect.w - med));
        const outliers = sorted.slice(0, 3).map((n) => `${loc(n)}(${(n.rect.h / n.rect.w).toFixed(2)})`);
        return { n: g.items.length, key: g.key, ratios: ratios.map((v) => v.toFixed(2)), parent: g.parent, outliers };
      }
      return null;
    },
    message: (h) => `${h.n} 个 ${h.key} 宽高比不一致: ${h.ratios.join('/')} (容器 ${h.parent})${h.outliers.length ? '；偏离: ' + h.outliers.join(', ') : ''}`
  },
  {
    id: 'ASPECT_EXTREME', layer: 'L3', severity: 'warn', runner: 'listGroup',
    theory: '比例协调',
    detect: (g, T) => {
      const extremes = g.items.filter((n) => n.rect.h / n.rect.w > T.MAX || n.rect.h / n.rect.w < T.MIN);
      if (extremes.length) {
        const members = extremes.slice(0, 3).map((n) => `${loc(n)}(${(n.rect.h / n.rect.w).toFixed(2)})`);
        return { count: extremes.length, key: g.key, ratios: extremes.map((n) => (n.rect.h / n.rect.w).toFixed(2)), parent: g.parent, members };
      }
      return null;
    },
    message: (h) => `${h.count} 个 ${h.key} 宽高比失调: ${h.ratios.join('/')} (容器 ${h.parent})${h.members.length ? '；如: ' + h.members.join(', ') : ''}`
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
        const members = thumbs.slice(0, 3).map((n) => `${loc(n)}(${r0(n.rect.w)}px)`);
        return { n: g.items.length, key: g.key, thumbs: thumbs.map((n) => r0(n.rect.w)), members };
      }
      return null;
    },
    message: (h) => `${h.n} 个 ${h.key} 的缩略图尺寸不一致: ${h.thumbs.join('/')}px${h.members.length ? '；如: ' + h.members.join(', ') : ''}`
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
    message: (h, T) => `${loc(h.n)} 每行约 ${h.cpl} 字，超出舒适行长 (${T.MIN_CPL}-${T.MAX_CPL})，应限制内容宽度`
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
  },
  /* ---- 图表/媒体周边留白 & 相关数字聚簇 ---- */
  {
    id: 'MEDIA_GUTTER', layer: 'L3', severity: 'info', runner: 'page',
    theory: '图表不应窄于同行内容包络并在两侧留大空白',
    detect: (F, T) => {
      const hits = [];
      const chart = (n) => (n.chartTextFgs && n.chartTextFgs.length) || n.tag === 'canvas';
      for (const c of F.containers || []) {
        const kids = c.children;
        if (!kids || kids.length < 1) continue;
        let fullL = Infinity, fullR = -Infinity;
        for (const k of kids) { fullL = Math.min(fullL, k.rect.x); fullR = Math.max(fullR, k.rect.x + k.rect.w); }
        for (const k of kids) {
          if (!chart(k)) continue;
          const slack = fullR - fullL - k.rect.w;
          if (slack >= T.GUTTER) hits.push({ n: k, slack: r0(slack) });
        }
      }
      return hits.length ? hits : null;
    },
    message: (h) => `${label(h.n)} 图表宽 ${r0(h.n.rect.w)}px，同行内容包络两侧共 ${h.slack}px 空白，建议让图表占满可用宽度或调整排版`
  },
  {
    id: 'RELATED_SPLIT', layer: 'L3', severity: 'warn', runner: 'page',
    theory: '数值与带符号的变化量（如主数值与 +x% / -x(-y%)）应相邻且基线对齐（通用仪表盘模式，不做领域假设）',
    detect: (F, T) => {
      const hits = [];
      const textOf = (n) => {
        if (n.text) return n.text;
        for (const ch of n.children || []) { const t = textOf(ch); if (t) return t; }
        return '';
      };
      const isDelta = (t) => /^[+-]\s*[\d.,]/.test(t) || /[+-]\s*[\d.,]+\s*%/.test(t);
      const isNumeric = (t) => /[\d]/.test(t);
      const sep = (a, b) => Math.max(0, a.rect.x - (b.rect.x + b.rect.w),
                                     b.rect.x - (a.rect.x + a.rect.w));
      for (const c of F.containers || []) {
        const kids = c.children.filter((k) => isNumeric(textOf(k)));
        const deltas = kids.filter((k) => isDelta(textOf(k)));
        const mains = kids.filter((k) => !isDelta(textOf(k)));
        if (!deltas.length || !mains.length) continue;
        for (const d of deltas) {
          const top = d.rect.y, bottom = d.rect.y + d.rect.h;
          const dmid = d.rect.y + d.rect.h / 2;
          // same-row main figures overlapping the delta vertically
          const row = mains.filter((m) => m.rect.y < bottom && m.rect.y + m.rect.h > top);
          if (!row.length) continue;
          // nearest main (min horizontal separation, direction-agnostic)
          row.sort((a, b) => sep(a, d) - sep(b, d));
          const m = row[0];
          const gap = Math.max(0, Math.max(m.rect.x - (d.rect.x + d.rect.w),
                                         d.rect.x - (m.rect.x + m.rect.w)));
          const dy = Math.abs((m.rect.y + m.rect.h / 2) - dmid);
          if (gap > T.GAP_MAX || dy > T.CENTER_MAX) {
            hits.push({ m, d, gap: r0(gap), dy: r0(dy) });
          }
        }
      }
      return hits.length ? hits : null;
    },
    message: (h) => `${label(h.m)}(${h.m.text}) 与其变化量 ${label(h.d)}(${h.d.text}) 间距 ${h.gap}px / 纵向差 ${h.dy}px，应保持相邻并基线对齐`
  },
  /* ---- 图表容器过高（内部留白） ---- */
  {
    id: 'CHART_OVER_TALL', layer: 'L3', severity: 'warn', runner: 'page',
    theory: '图表容器过高时绘图只占上部、内部留白大（canvas 内空白 DOM 不可见）',
    detect: (F, T) => {
      const vh = F.pageInfo.viewport.h;
      const hits = F.allNodes.filter((n) =>
        (n.chartTextFgs || n.tag === 'canvas') &&
        n.rect.w >= 150 &&
        n.rect.h >= T.MIN_H &&
        n.rect.h > vh * T.RATIO);
      return hits.length ? hits : null;
    },
    message: (h, T) => `${label(h)} 图表容器过高（${r0(h.rect.w)}×${r0(h.rect.h)}px），内部留白大——请压缩图表高度并让绘图占满容器（建议 ≤ ~视口×${Math.round((T && T.RATIO || 0.3) * 100)}%），保持内容/数据不变`
  },
  /* ---- 纵轴范围（0 起点/范围过宽 → 画布下方空白） ---- */
  {
    id: 'CHART_Y_RANGE', layer: 'L3', severity: 'warn', runner: 'page',
    theory: '数值纵轴不应从 0 起或范围过宽：数据远离 0/只占轴高一小部分时画布下方大段空白',
    detect: (F, T) => {
      const hits = [];
      for (const n of F.allNodes) {
        const yr = n.yRange;
        if (!yr) continue;
        const { dataMin, dataMax, yMin, yMax } = yr;
        if (!(dataMax > dataMin) || dataMin < 0) continue;
        const span = dataMax - dataMin;
        const effMin = yMin === null ? 0 : yMin;
        const effMax = yMax === null ? dataMax : yMax;
        const axisH = Math.max(0, effMax - effMin);
        const zeroBaseVoid = (yMin === null || yMin <= 0) && dataMin > dataMax * T.MIN_FRAC;
        const overWide = axisH > span * T.MAX_SPAN_RATIO;
        if (!zeroBaseVoid && !overWide) continue;
        const lo = Math.max(0, Math.floor(dataMin - T.PAD * span));
        const hi = Math.ceil(dataMax + T.PAD * span);
        hits.push({ n, dataMin, dataMax, lo, hi, zeroBaseVoid, overWide: overWide && !zeroBaseVoid });
      }
      return hits.length ? hits : null;
    },
    message: (h) => `${label(h.n)} 纵轴${h.zeroBaseVoid ? '从 0 起' : '范围过宽'}，数据范围 ${r0(h.dataMin)}~${r0(h.dataMax)} 只占轴高一小部分、画布下方大量空白——请把 min/max 放在 yAxis 顶层（与 type 同级，不要在 axisLine 内）：yAxis: { type: 'value', min: ${h.lo}, max: ${h.hi} } 使坐标轴紧贴数据范围`
  }
];
