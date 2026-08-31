/**
 * layer-order.mjs —— L2 结构秩序（13 条）
 *
 * 语义：一致性与对齐（不齐=业余感）。多数规则跑在 textGroup / listGroup 执行器上，
 *   即"同类元素应统一"——左缘/宽度/圆角/字号/颜色/字重/边框一致，间距成系统。
 * 判据数值一律来自 config.mjs 的 T（DIFF/SPREAD/MAX 等），本文件无魔法数字。
 */
import { hex, rgbToHsl } from '../color.mjs';
import { label, r0, spread } from '../engine/util.mjs';

/** isStacked —— 判断一组兄弟是否纵向堆叠布局（排除横向并排导致的左缘差异天然成立） */
function isStacked(items) {
  const s = [...items].sort((a, b) => a.rect.y - b.rect.y);
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1].rect;
    const b = s[i].rect;
    if (b.y === a.y) return false;
    const xo = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    if (xo <= Math.min(a.w, b.w) * 0.5) return false;
  }
  return true;
}

/** findThumb —— 递归找"正方形占位缩略图"节点（无文本无子、24-128px 见方；IMG_SIZE 规则用） */
function findThumb(n, out) {
  if (!n.children.length && !n.text && r0(n.rect.w) === r0(n.rect.h) && n.rect.w >= 24 && n.rect.w <= 128) {
    out.push(n);
  }
  for (const c of n.children) findThumb(c, out);
}

/** collectTextNodes —— 递归收集子树内所有带文本的节点（CARD_VOID 等内容饱满度规则复用） */
function collectTextNodes(n, out) {
  if (n.text) out.push(n);
  for (const c of n.children) collectTextNodes(c, out);
}

export const orderRules = [
  /* ---- 几何一致性（listGroup 类） ---- */
  {
    id: 'ALIGN_INCONSISTENT', layer: 'L2', severity: 'warn', runner: 'listGroup',
    theory: '对齐一致性',
    detect: (g, T) => {
      const xs = g.items.map((n) => n.rect.x);
      if (spread(xs) > T.DIFF && isStacked(g.items)) {
        return { n: g.items.length, key: g.key, xs: xs.map(r0), parent: g.parent };
      }
      return null;
    },
    message: (h) => `${h.n} 个 ${h.key} 左缘未对齐: x=${h.xs.join('/')} (容器 ${h.parent})`
  },
  {
    id: 'SIZE_INCONSISTENT', layer: 'L2', severity: 'warn', runner: 'listGroup',
    theory: '尺寸一致性',
    detect: (g, T) => {
      const ws = g.items.map((n) => n.rect.w);
      if (spread(ws) > T.DIFF) return { n: g.items.length, key: g.key, ws: ws.map(r0), parent: g.parent };
      return null;
    },
    message: (h) => `${h.n} 个 ${h.key} 宽度不一致: ${h.ws.join('/')}px (容器 ${h.parent})`
  },
  {
    id: 'RADIUS_INCONSISTENT', layer: 'L2', severity: 'warn', runner: 'listGroup',
    theory: '圆角一致性',
    detect: (g, T) => {
      const rs = g.items.map((n) => n.radius || 0);
      if (spread(rs) > T.DIFF) return { n: g.items.length, key: g.key, rs: rs.map(r0), parent: g.parent };
      return null;
    },
    message: (h) => `${h.n} 个 ${h.key} 圆角不统一: ${h.rs.join('/')}px (容器 ${h.parent})`
  },
  /* ---- 排版一致性（textGroup 类） ---- */
  {
    id: 'FONT_INCONSISTENT', layer: 'L2', severity: 'warn', runner: 'textGroup',
    theory: '排版层级一致性',
    detect: (arr, T, F, key) => {
      const sizes = arr.map((n) => n.fontSize).filter((v) => v !== null);
      const uniq = [...new Set(sizes.map((v) => r0(v)))];
      if (uniq.length > 1 && spread(sizes) > T.DIFF) {
        return { n: arr.length, tag: key.split('|')[0], uniq, pt: arr[0]._pt };
      }
      return null;
    },
    message: (h) => `${h.n} 个同类 ${h.tag} 字号不一致: ${h.uniq.join('/')}px (容器 ${h.pt})`
  },
  {
    id: 'COLOR_INCONSISTENT', layer: 'L2', severity: 'warn', runner: 'textGroup',
    theory: '颜色一致性',
    detect: (arr, T, F, key) => {
      const ckeys = [...new Set(arr.map((n) => `${n.fg[0] >> 4}-${n.fg[1] >> 4}-${n.fg[2] >> 4}`))];
      if (ckeys.length > 1) {
        return { n: arr.length, tag: key.split('|')[0], hexes: [...new Set(arr.map((n) => hex(n.fg)))], pt: arr[0]._pt };
      }
      return null;
    },
    message: (h) => `${h.n} 个同类 ${h.tag} 颜色不一致: ${h.hexes.join('/')}，应统一为同一颜色 (容器 ${h.pt})`
  },
  /* ---- 间距/系统化 ---- */
  {
    id: 'SPACING', layer: 'L2', severity: 'warn', runner: 'container',
    theory: '间距系统一致性',
    detect: (sibs, T, F, parent) => {
      const gaps = [];
      for (let i = 1; i < sibs.length; i++) {
        const a = sibs[i - 1].rect;
        const b = sibs[i].rect;
        const xo = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        if (xo > Math.min(a.w, b.w) * 0.5 && b.y >= a.y) {
          const g = b.y - (a.y + a.h);
          if (g >= 0) gaps.push(g);
        }
      }
      if (gaps.length >= 2 && spread(gaps) > T.SPREAD) {
        return { parent, gaps: gaps.map(r0) };
      }
      return null;
    },
    message: (h) => `容器 ${h.parent} 内相邻元素垂直间距不均: ${h.gaps.join('/')}px`
  },
  {
    id: 'LINE_HEIGHT_TIGHT', layer: 'L2', severity: 'warn', runner: 'textGroup',
    theory: '可读行高',
    detect: (arr, T, F, key) => {
      const tight = arr.filter((n) => n.lineHeight !== null && n.lineHeight < T.LH_MIN);
      if (tight.length) return { count: tight.length, tag: key.split('|')[0], lh: tight[0].lineHeight, min: T.LH_MIN };
      return null;
    },
    message: (h) => `${h.count} 个 ${h.tag} 行高过挤 (<${h.min}, 如 lh=${h.lh})`
  },
  {
    id: 'RADIUS_SCALE_OFF', layer: 'L2', severity: 'warn', runner: 'page',
    theory: '圆角应落在设计刻度（Tailwind rounded 刻度）',
    detect: (F, T) => {
      const off = {};
      for (const n of F.allNodes) {
        const r = n.radius || 0;
        if (r < 1) continue;
        if (!T.SCALE.some((s) => Math.abs(s - r) <= 1)) off[r0(r)] = (off[r0(r)] || 0) + 1;
      }
      const distinct = Object.keys(off);
      if (distinct.length >= T.MIN_DISTINCT) return { distinct, total: Object.values(off).reduce((a, b) => a + b, 0) };
      return null;
    },
    message: (h, T) => `出现 ${h.distinct.length} 种刻度外圆角 (${h.distinct.join('/')}px，共 ${h.total} 处)，应收敛到设计刻度 ${T.SCALE.join('/')}`
  },
  /* ---- 边框与字重 ---- */
  {
    id: 'BORDER_INCONSISTENT', layer: 'L2', severity: 'warn', runner: 'listGroup',
    theory: '边框一致性',
    detect: (g) => {
      const bws = [...new Set(g.items.map((n) => r0(n.bw || 0)))];
      if (bws.length > 1) return { n: g.items.length, key: g.key, bws, parent: g.parent };
      return null;
    },
    message: (h) => `${h.n} 个 ${h.key} 边框宽度不一致: ${h.bws.join('/')}px (容器 ${h.parent})`
  },
  {
    id: 'BORDER_OVERUSE', layer: 'L2', severity: 'info', runner: 'page',
    theory: 'Refactoring UI：更少边框，以阴影/留白替代',
    detect: (F, T) => {
      const bordered = F.allNodes.filter((n) => (n.bw || 0) >= 1).length;
      if (F.allNodes.length && bordered / F.allNodes.length > T.MAX_RATIO) {
        return { count: bordered, total: F.allNodes.length };
      }
      return null;
    },
    message: (h, T) => `${h.count}/${h.total} 个元素带边框（> ${Math.round(T.MAX_RATIO * 100)}%），边框过密应以阴影或留白替代`
  },
  {
    id: 'WEIGHT_INCONSISTENT', layer: 'L2', severity: 'warn', runner: 'textGroup',
    theory: '字重层级一致性',
    detect: (arr, T, F, key) => {
      const ws = [...new Set(arr.map((n) => n.fw || 400))];
      if (ws.length > 1) return { n: arr.length, tag: key.split('|')[0], ws, pt: arr[0]._pt };
      return null;
    },
    message: (h) => `${h.n} 个同类 ${h.tag} 字重不一致: ${h.ws.join('/')} (容器 ${h.pt})`
  },
  /* ---- 全局收敛（page 类） ---- */
  {
    id: 'FONT_FAMILY_BLOAT', layer: 'L2', severity: 'info', runner: 'page',
    theory: '单页字族 ≤2',
    detect: (F, T) => {
      const fams = [...new Set(F.allNodes.map((n) => (n.ff || '').toLowerCase()).filter(Boolean))];
      if (fams.length > T.MAX) return { fams };
      return null;
    },
    message: (h) => `使用了 ${h.fams.length} 个字族 (${h.fams.slice(0, 3).join('/')}...)，应收敛到 2 个以内`
  },
  {
    id: 'GRAY_SHADE_BLOAT', layer: 'L2', severity: 'info', runner: 'page',
    theory: 'limited grays：文字灰阶收敛',
    detect: (F, T) => {
      const shades = new Set();
      for (const n of F.allNodes) {
        if (!n.text) continue;
        const [, s] = rgbToHsl(n.fg);
        if (s < T.GRAY_S) shades.add(hex(n.fg));
      }
      if (shades.size > T.MAX) return { shades: [...shades] };
      return null;
    },
    message: (h) => `文字灰阶 ${h.shades.length} 种 (${h.shades.join('/')})，应收敛到 3-5 档`
  }
];
