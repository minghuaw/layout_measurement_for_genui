/**
 * layer-refine.mjs —— L5 质感精致（11 条）
 *
 * 语义：高端效果系统化（锦上添花）。判据基于采集阶段解析的效果属性：
 *   box-shadow（y 偏移/blur/alpha/层数）、backdrop-filter blur、transition 时长/属性、
 *   以及 CSSOM 伪类扫描结果。TYPE_SCALE / SPACING_8PT / CONTRAST_AAA 为 aspirational，
 *   默认关闭（config DEFAULTS enabled:false），经 METRICS_ON 按需开启。
 */
import { label, r0 } from '../engine/util.mjs';
import { contrastRatio as cr, suggestAccessible as sa } from '../color.mjs';

/** 全页带阴影的节点集合（L5 阴影类规则共用） */
const shadowed = (F) => F.allNodes.filter((n) => n.shadow);
/** 全页有文本的节点集合（字阶/AAA 类规则共用） */
const withText = (F) => F.allNodes.filter((n) => n.text);

export const refineRules = [
  /* ---- 阴影（elevation 系统化） ---- */
  {
    id: 'SHADOW_INCONSISTENT', layer: 'L5', severity: 'warn', runner: 'page',
    theory: '阴影应聚类到 elevation 刻度（Tailwind sm~2xl）',
    detect: (F, T) => {
      const blurs = [...new Set(shadowed(F).map((n) => r0(n.shadow.blur)))];
      if (blurs.length > T.MAX_DISTINCT_BLUR) return { blurs };
      return null;
    },
    message: (h) => `阴影模糊半径 ${h.blurs.length} 种 (${h.blurs.join('/')}px)，应收敛到 elevation 刻度（如 Tailwind sm/md/lg/xl/2xl）`
  },
  {
    id: 'SHADOW_DIR_CONFLICT', layer: 'L5', severity: 'warn', runner: 'page',
    theory: 'Refactoring UI：模拟统一光源',
    detect: (F) => {
      const ys = shadowed(F).map((n) => n.shadow.y).filter((y) => y !== 0);
      const pos = ys.some((y) => y > 0);
      const neg = ys.some((y) => y < 0);
      if (pos && neg) return { ys: [...new Set(ys.map(r0))] };
      return null;
    },
    message: (h) => `阴影 y 偏移方向冲突 (${h.ys.join('/')}px)，光源应统一（通常自上而下）`
  },
  {
    id: 'SHADOW_OVERKILL', layer: 'L5', severity: 'warn', runner: 'page',
    theory: 'elevation 系统克制',
    detect: (F, T) => {
      const bad = shadowed(F).filter((n) => n.shadow.alpha > T.MAX_ALPHA || n.shadow.layers > T.MAX_LAYERS);
      if (bad.length) return { count: bad.length, ex: label(bad[0]), alpha: bad[0].shadow.alpha, layers: bad[0].shadow.layers };
      return null;
    },
    message: (h, T) => `${h.count} 个元素阴影过重（如 ${h.ex} alpha=${h.alpha} 层数=${h.layers}），建议 alpha ≤${T.MAX_ALPHA} 且 ≤${T.MAX_LAYERS} 层`
  },
  /* ---- 毛玻璃（Glassmorphism） ---- */
  {
    id: 'GLASS_NO_BLUR', layer: 'L5', severity: 'info', runner: 'page',
    theory: 'Glassmorphism：半透明面应配合 backdrop-blur',
    detect: (F, T) => {
      const bad = F.allNodes.filter((n) =>
        n.bgOwnAlpha > T.ALPHA_MIN && n.bgOwnAlpha < T.ALPHA_MAX && !(n.backBlur > 0) && n.rect.w * n.rect.h > T.MIN_AREA
      );
      if (bad.length) return { count: bad.length, ex: label(bad[0]) };
      return null;
    },
    message: (h) => `${h.count} 个半透明背景元素未配合 backdrop-blur（如 ${h.ex}），毛玻璃质感缺失`
  },
  {
    id: 'GLASS_BAD_RANGE', layer: 'L5', severity: 'info', runner: 'page',
    theory: 'backdrop-blur 合理区间 4-24px（Tailwind 刻度）',
    detect: (F, T) => {
      const bad = F.allNodes.filter((n) => n.backBlur > 0 && (n.backBlur < T.MIN || n.backBlur > T.MAX));
      if (bad.length) return { count: bad.length, values: [...new Set(bad.map((n) => r0(n.backBlur)))] };
      return null;
    },
    message: (h, T) => `${h.count} 个元素 backdrop-blur 越界 (${h.values.join('/')}px，建议 ${T.MIN}-${T.MAX}px)`
  },
  /* ---- 动效 ---- */
  {
    id: 'MOTION_DURATION_OFF', layer: 'L5', severity: 'info', runner: 'page',
    theory: 'UI 过渡时长 100-500ms（典型 150-250ms）',
    detect: (F, T) => {
      const bad = F.allNodes.filter((n) => n.trMs > 0 && (n.trMs < T.MIN_MS || n.trMs > T.MAX_MS));
      if (bad.length) return { count: bad.length, ex: bad[0].trMs };
      return null;
    },
    message: (h, T) => `${h.count} 个元素过渡时长越界（如 ${r0(h.ex)}ms，建议 ${T.MIN_MS}-${T.MAX_MS}ms）`
  },
  {
    id: 'MOTION_ALL_PROPERTY', layer: 'L5', severity: 'info', runner: 'page',
    theory: 'transition:all 反模式',
    detect: (F) => {
      const bad = F.allNodes.filter((n) => n.trMs > 0 && n.trAll);
      if (bad.length) return { count: bad.length };
      return null;
    },
    message: (h) => `${h.count} 个元素使用 transition: all，应限定具体过渡属性`
  },
  {
    id: 'MOTION_MISSING', layer: 'L5', severity: 'info', runner: 'page',
    theory: '交互反馈一致性',
    detect: (F) => {
      const hover = F.cssom.hover || [];
      if (!hover.length) return null;
      const inter = F.allNodes.filter((n) => n.interactive);
      const hoverTags = hover.join(' ').toLowerCase();
      const uncovered = inter.filter((n) => !hoverTags.includes(n.tag) && !(n.cls && hoverTags.includes('.' + n.cls.split('.')[0])));
      if (uncovered.length && uncovered.length < inter.length) {
        return { count: uncovered.length, total: inter.length, ex: label(uncovered[0]) };
      }
      return null;
    },
    message: (h) => `${h.count}/${h.total} 个可交互元素缺少 hover 反馈（如 ${h.ex}），与已有 hover 样式不一致`
  },
  /* ---- 类型/间距/无障碍（aspirational，默认关闭） ---- */
  {
    id: 'TYPE_SCALE', layer: 'L5', severity: 'info', runner: 'page',
    theory: '字阶成 ~1.2 倍率（aspirational，默认关闭）',
    detect: (F, T) => {
      const sizes = [...new Set(withText(F).map((n) => n.fontSize).filter(Boolean))].sort((a, b) => a - b);
      let v = 0;
      for (let i = 1; i < sizes.length; i++) {
        const r = sizes[i] / sizes[i - 1];
        if (r < T.RATIO_MIN || r > T.RATIO_MAX) v++;
      }
      if (v >= T.MIN_VIOLATIONS) return { v, sizes: sizes.map(r0) };
      return null;
    },
    message: (h) => `字阶不成系统（${h.v} 处相邻档倍率越界，当前 ${h.sizes.join('/')}px），应按 ~1.2 倍率建立 type scale`
  },
  {
    id: 'SPACING_8PT', layer: 'L5', severity: 'info', runner: 'page',
    theory: '间距 4/8pt 网格（aspirational，默认关闭）',
    detect: (F, T) => {
      const pads = F.allNodes.map((n) => r0(n.padding || 0)).filter((p) => p > 0);
      const off = pads.filter((p) => p % T.GRID !== 0);
      if (off.length >= T.MIN_ELEMS) return { count: off.length, values: [...new Set(off)] };
      return null;
    },
    message: (h) => `${h.count} 处 padding 不在 4pt 网格 (${h.values.join('/')}px)，应对齐 4/8 基准网格`
  },
  {
    id: 'CONTRAST_AAA', layer: 'L5', severity: 'info', runner: 'page',
    theory: 'WCAG AAA 7:1（aspirational，默认关闭）',
    detect: (F, T) => {
      const bad = withText(F).filter((n) => cr(n.fg, n.bg) < T.RATIO);
      if (bad.length) return { count: bad.length, ex: label(bad[0]), sugg: sa(bad[0].fg, bad[0].bg, T.RATIO) };
      return null;
    },
    message: (h, T) => `${h.count} 处对比度未达 AAA ${T.RATIO}:1（如 ${h.ex}，建议 ${h.sugg}）`
  }
];
