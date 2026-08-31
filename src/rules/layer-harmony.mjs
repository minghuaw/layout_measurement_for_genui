/**
 * layer-harmony.mjs —— L4 色彩和谐（6 条）
 *
 * 语义：配色章法（从不出错到有修养）。判据核心是 color.mjs computePalette 的
 *   面积归因结果（bg 占比/强调色面积/鲜艳面积/色相聚簇/和声），以及灰阶与明暗系统化。
 */
import { rgbToHsl, parseHex, hex } from '../color.mjs';
import { pct } from '../engine/util.mjs';

export const harmonyRules = [
  /* ---- 面积法则（60-30-10） ---- */
  {
    id: 'COLOR_DOMINANCE', layer: 'L4', severity: 'warn', runner: 'page',
    theory: '60-30-10 法则',
    detect: (F, T) => {
      const p = F.palette;
      const out = [];
      if (p.bgTop.length && p.bgTop[0].share < T.MIN_BG) {
        out.push({ kind: 'bg', hex: p.bgTop[0].hex, share: p.bgTop[0].share });
      }
      if (p.accentArea > T.MAX_ACCENT) {
        out.push({ kind: 'accent', share: p.accentArea, hexes: p.accentTop.map((x) => x.hex) });
      }
      return out;
    },
    message: (h) => h.kind === 'bg'
      ? `主导背景 ${h.hex} 仅占 ${pct(h.share)}（60-30-10 法则建议主导色 ≥50%），背景色过于碎片化`
      : `强调色面积占 ${pct(h.share)}（60-30-10 法则建议 ≤10-15%）：${h.hexes.join('/')}，建议大面积使用中性色`
  },
  /* ---- 和声与克制 ---- */
  {
    id: 'HARMONY_OFF', layer: 'L4', severity: 'info', runner: 'page',
    theory: '色彩和声（类似/互补/三角）',
    detect: (F) => (!F.palette.harmony && F.palette.hueClusters.length >= 3 ? F.palette : null),
    message: (p) => `强调色相 ${p.hueClusters.map((h) => h + '°').join('/')} 互不成和声（类似/互补/三角），建议保留 1 个主强调色，其余改同族或中性色`
  },
  {
    id: 'GARISH_SATURATION', layer: 'L4', severity: 'warn', runner: 'page',
    theory: '饱和度平衡',
    detect: (F, T) => (F.palette.vividArea > T.MAX_AREA ? F.palette : null),
    message: (p) => `高饱和色块总面积 ${pct(p.vividArea)}（建议 ≤20%）：${p.vividTop.map((v) => v.hex).join('/')}，建议降饱和或缩小面积`
  },
  {
    id: 'ACCENT_BLOAT', layer: 'L4', severity: 'info', runner: 'page',
    theory: '色板克制',
    detect: (F, T) => (F.palette.accentColors.length > T.MAX ? F.palette : null),
    message: (p) => `强调色 ${p.accentColors.length} 种: ${p.accentColors.join('/')}，建议收敛到 2-3 种同族色`
  },
  /* ---- 灰与色阶系统化 ---- */
  {
    id: 'GRAY_UNTINTED', layer: 'L4', severity: 'info', runner: 'page',
    theory: 'Refactoring UI：灰应带主色调',
    detect: (F, T) => {
      if (!F.palette.hueClusters.length) return null;
      const found = new Set();
      for (const n of F.allNodes) {
        if (!n.text) continue;
        const [, s, l] = rgbToHsl(n.fg);
        if (s < T.MAX_S && l >= T.L_MIN && l <= T.L_MAX) found.add(hex(n.fg));
      }
      if (found.size >= 1) return { list: [...found] };
      return null;
    },
    message: (h) => `存在 ${h.list.length} 种纯中性灰文字色 (${h.list.join('/')})，UI 带彩色时灰应带主色调（如蓝灰 #6b7280）`
  },
  {
    id: 'SHADE_UNSYSTEMATIC', layer: 'L4', severity: 'info', runner: 'page',
    theory: 'Refactoring UI：色阶系统化',
    detect: (F, T) => {
      const byHue = new Map();
      for (const c of F.palette.accentColors) {
        const [h, , l] = rgbToHsl(parseHex(c));
        const k = Math.round(h / 30) * 30;
        if (!byHue.has(k)) byHue.set(k, new Set());
        byHue.get(k).add(Math.round(l * 20) / 20);
      }
      for (const [hue, ls] of byHue) {
        if (ls.size >= T.MAX_SHADES) return { hue, count: ls.size };
      }
      return null;
    },
    message: (h) => `色相 ${h.hue}° 出现 ${h.count} 档离散明度，应预先定义系统色阶（如 50-900）`
  }
];
