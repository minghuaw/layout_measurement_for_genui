/**
 * layer-harmony.mjs —— L4 色彩和谐（8 条）
 *
 * 语义：配色章法（从不出错到有修养）。判据核心是 color.mjs computePalette 的
 *   面积归因结果（bg 占比/强调色面积/鲜艳面积/色相聚簇/和声），以及灰阶与明暗系统化。
 */
import { rgbToHsl, parseHex, hex } from '../color.mjs';
import { pct, label } from '../engine/util.mjs';

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
        out.push({ kind: 'accent', share: p.accentArea, hexes: p.accentTop.map((x) => x.hex), els: p.accentEls || [] });
      }
      return out;
    },
    message: (h) => h.kind === 'bg'
      ? `主导背景 ${h.hex} 仅占 ${pct(h.share)}（60-30-10 法则建议主导色 ≥50%），背景色过于碎片化`
      : `强调色面积占 ${pct(h.share)}（60-30-10 法则建议 ≤10-15%）：${h.hexes.join('/')}${h.els.length ? '，主要来源: ' + h.els.map((e) => `${e.tag}${e.cls ? '.' + e.cls : ''}@y${e.y}(${pct(e.share)})`).join(', ') : ''}，建议用中性色替换装饰性强调或减少强调元素数量`
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
  },
  /* ---- 表面一致性：渐变背景（图表/媒体容器） ---- */
  {
    id: 'GRADIENT_BG', layer: 'L4', severity: 'warn', runner: 'page',
    theory: '纯色表面页面不使用渐变背景（图表/媒体容器），且渐变不可可靠度量文字对比',
    detect: (F) => {
      const hits = F.allNodes.filter((n) => n.media && n.gradient);
      return hits.length ? hits : null;
    },
    message: (h) => `${label(h)} 使用了渐变背景，与页面纯色表面不一致且无法可靠度量文字对比——建议改用调色板内的纯色背景（若需修图表文字对比，改图表文字/坐标颜色而非背景）`
  },
  /* ---- 图表数据/线条/数据点 marker 色与页面强调色一致（逐 series） ---- */
  {
    id: 'CHART_DATA_COLOR', layer: 'L4', severity: 'warn', runner: 'page',
    theory: '每个 series 都应显式设 series.color/itemStyle.color 并与页面强调色一致——只设 lineStyle.color 时数据点 marker 用 ECharts 默认色板（随机）',
    detect: (F, T) => {
      const hits = [];
      // 页面“主色”：优先取非中性的强调色（饱和度>0.12），否则退回正文主字色
      const pick = () => {
        const cands = [
          ...((F.palette && F.palette.accentTop) || []).map((x) => x.hex),
          ...((F.palette && F.palette.textTop) || []).map((x) => x.hex)
        ];
        for (const hx of cands) {
          try {
            const [, s] = rgbToHsl(parseHex(hx));
            if (s > 0.12) return hx;
          } catch {}
        }
        return cands[0] || null;
      };
      const accent = pick();
      const hueOf = (hx) => { try { return rgbToHsl(parseHex(hx))[0]; } catch { return null; } };
      const accentHue = accent ? hueOf(accent) : null;
      const dist = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
      for (const n of F.allNodes) {
        if (!(n.chartTextFgs || n.tag === 'canvas')) continue;
        const series = n.chartSeries || [];
        for (let i = 0; i < series.length; i++) {
          const s = series[i];
          const hexes = (s.colors || []).filter((c) => /^#/.test(c));
          if (!s.hasSeriesColor) {
            hits.push({ n, i, s, suggest: accent, kind: 'noSeriesColor', hexes: hexes.slice(0, 2).join('/') });
            continue;
          }
          if (!accentHue) continue;
          if (!hexes.length) { hits.push({ n, i, s, suggest: accent, kind: 'noHex' }); continue; }
          const farAny = hexes.some((c) => {
            const hu = hueOf(c);
            return hu === null ? false : dist(hu, accentHue) > T.MAX_HUE;
          });
          if (farAny) hits.push({ n, i, s, suggest: accent, kind: 'far', hexes: hexes.slice(0, 2).join('/') });
        }
        // markLine/markPoint marker uncolored -> uncontrolled
        if (!hits.some((h) => h.n === n) && n.chartHasMark === true && n.chartMarkExplicit === false) {
          hits.push({ n, suggest: accent, kind: 'marker' });
        }
      }
      return hits.length ? hits : null;
    },
    message: (h) => {
      if (h.kind === 'marker') {
        return `${label(h.n)} 图表阈值/标记（markLine/markPoint）未显式着色，使用 ECharts 默认色（=随机/不受控）——请给其 lineStyle.color 显式设置颜色，与系列/页面强调色 ${h.suggest} 一致`;
      }
      if (h.kind === 'noSeriesColor') {
        return `${label(h.n)} 的 series[${h.i}]（${h.s.type}${h.s.name ? ' '+h.s.name : ''}）未显式设 series.color / itemStyle.color——线条与数据点 marker 会用 ECharts 默认色板（随机）。请给每个 series（含额外派生的）设 series.color = ${h.suggest}，itemStyle/lineStyle 保持同族`;
      }
      if (h.kind === 'far') {
        return `${label(h.n)} 的 series[${h.i}] 颜色 ${h.hexes} 与页面强调色 ${h.suggest} 偏差过大——请把该 series 的 series.color / itemStyle.color 设为 ${h.suggest}（数据点 marker 同色）`;
      }
      return `${label(h.n)} 的 series[${h.i}] 颜色与页面强调色 ${h.suggest} 不一致——请显式设置 series.color 为该强调色`;
    }
  }
];
