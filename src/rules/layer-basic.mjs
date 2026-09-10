/**
 * layer-basic.mjs —— L1 基础规范（12 条）
 *
 * 语义：页面可用底线，违反即"坏页面"（绝大多数 severity=error）。
 * 每条规则形状：{ id, layer, severity, runner, theory, when?, detect, message }
 *   - runner：engine/runners.mjs 的执行器类型（node/pair/textGroup/listGroup/container/page）
 *   - when：node 类规则的预筛谓词（避免对无关节点跑 detect）
 *   - detect：返回 null（不命中）或单对象/数组（命中，对象即 message 的输入 h）
 *   - message：由命中对象渲染为带 CSS 修复线索 + 理论依据的消息串（LLM 回流文本）
 */
import { hex, contrastRatio, rgbToHsl, parseHex } from '../color.mjs';
import { label, loc, r0, pct } from '../engine/util.mjs';

export const basicRules = [
  /* ---- 视口/尺寸底线 ---- */
  {
    id: 'OVERFLOW', layer: 'L1', severity: 'error', runner: 'page',
    theory: '视口适配底线',
    detect: (F, T) => F.pageInfo.scrollWidth > F.pageInfo.viewport.w
      ? { sw: F.pageInfo.scrollWidth, vw: F.pageInfo.viewport.w } : null,
    message: (h) => `body scrollWidth=${h.sw} > viewport ${h.vw} (+${h.sw - h.vw}px) 横向溢出`
  },
  {
    id: 'ELEMENT_OVERFLOW', layer: 'L1', severity: 'error', runner: 'node',
    theory: '视口适配底线',
    when: (n) => n._outerExceeds,
    detect: (n) => n,
    message: (n, T, F) => {
      const vw = F.pageInfo.viewport.w;
      const right = n.rect.x + n.rect.w;
      return `${loc(n)} 右边缘 ${r0(right)}px 超出视口 ${vw}px (+${r0(right - vw)}px) (容器 ${n._pLabel})`;
    }
  },
  {
    id: 'TEXT_CLIP', layer: 'L1', severity: 'error', runner: 'node',
    theory: '文本完整显示',
    when: (n) => n._clipInner,
    detect: (n) => n,
    message: (n) => `${loc(n)} 文本超出容器宽度未换行 (scrollW>clientW) "${n.text}" (容器 ${n._pLabel})`
  },
  {
    id: 'OVERLAP', layer: 'L1', severity: 'error', runner: 'pair',
    theory: '元素矩形互斥（区分有意分层与意外碰撞）',
    detect: (a, b, T, F, parent) => {
      /* 豁免一：定位分层——任一兄弟 absolute/fixed 即视为有意分层
         （背景层/渐变遮罩/角标/FAB/悬浮组件），布局语义上不算缺陷 */
      if (T.EXEMPT_POS.includes(a.pos) || T.EXEMPT_POS.includes(b.pos)) return null;
      const ra = a.rect, rb = b.rect;
      const w = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
      const h = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
      if (w < T.MIN_W || h < T.MIN_H) return null;
      /* 豁免二：浅交叠——交叠面积占较小元素面积比例过低时视为
         "视觉紧贴"设计（负 margin 微堆叠），不构成可用性缺陷 */
      const ratio = (w * h) / Math.min(ra.w * ra.h, rb.w * rb.h);
      if (ratio < T.MIN_AREA_PCT) return null;
      return { a, b, w: r0(w), h: r0(h), ratio: Math.round(ratio * 100), parent };
    },
    message: (h) => `${loc(h.a)} 与 ${loc(h.b)} 重叠 ${h.w}×${h.h}px 占较小元素 ${h.ratio}% (容器 ${h.parent})`
  },
  {
    id: 'MEDIA_COVERED', layer: 'L1', severity: 'error', runner: 'page',
    theory: '富媒体被不透明元素大面积遮挡（内容不可见）：img/video/canvas/svg/iframe/object/echarts 容器 + url 背景图容器。候选 = 同容器更晚兄弟（DOM 序绘制在上）+ 更早的定位兄弟（定位绘制在 static 之上）+ 全局 fixed/sticky；祖先排除（包含≠遮挡）；渐变 scrim 与半透明元素豁免（合法设计）。已知边界见 BACKLOG.md A1',
    detect: (F, T) => {
      const area = (r) => Math.max(0, r.w) * Math.max(0, r.h);
      const interFrac = (a, b) => {
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        return (w <= 0 || h <= 0) ? 0 : (w * h) / Math.max(1, area(a));
      };
      const isSolid = (c) => c.bgOwn && !c.gradient && c.bgOwnAlpha >= T.COVER_ALPHA;
      const isMedia = (n) => n.media || n.bgUrl;
      const best = new Map();
      const medias = [];
      const covers = [];
      const test = (media, cover, anc) => {
        if (cover === media || anc.has(cover) || !isSolid(cover)) return;
        const frac = interFrac(media.rect, cover.rect);
        if (frac < T.MIN_COVER) return;
        const cur = best.get(media);
        if (!cur || frac > cur.frac) best.set(media, { media, cover, frac });
      };
      const dfs = (nodes, anc) => {
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (isMedia(n)) {
            medias.push({ n, anc });
            /* 同容器候选：更晚兄弟（DOM 序绘制在上）+ 更早的定位兄弟（定位绘制在 static 之上） */
            for (let j = i + 1; j < nodes.length; j++) test(n, nodes[j], anc);
            for (let j = 0; j < i; j++) if (nodes[j].pos !== 'static') test(n, nodes[j], anc);
          }
          if (n.pos === 'fixed' || n.pos === 'sticky') covers.push(n);
          const next = new Set(anc);
          next.add(n);
          dfs(n.children, next);
        }
      };
      dfs(F.tree, new Set());
      /* 全局 fixed/sticky 候选：排除媒体祖先后逐对测试 */
      for (const { n, anc } of medias) {
        for (const c of covers) test(n, c, anc);
      }
      return [...best.values()];
    },
    message: (h) => `${loc(h.media)}${h.media.alt ? '“' + h.media.alt + '”' : ''} 被 ${loc(h.cover)} 遮挡 ${pct(h.frac)} — 移开/移动遮挡元素或调整层级；若为有意设计请忽略`
  },
  /* ---- 交互可用性 ---- */
  {
    id: 'TAP_TARGET', layer: 'L1', severity: 'error', runner: 'node',
    theory: 'iOS HIG 最小点击区 44pt',
    when: (n) => n.interactive,
    detect: (n, T) => (Math.min(n.rect.w, n.rect.h) < T.TAP_MIN ? n : null),
    message: (n, T) => `${label(n)} (${r0(n.rect.w)}×${r0(n.rect.h)}) 点击区域小于 ${T.TAP_MIN}px`
  },
  /* ---- 可读性 ---- */
  {
    id: 'CONTRAST_LOW', layer: 'L1', severity: 'error', runner: 'node',
    theory: 'WCAG AA 对比度',
    when: (n) => !!n.text && !n.gradStops,
    detect: (n, T) => {
      const ratio = contrastRatio(n.fg, n.bg);
      const need = (n.fontSize || 16) >= T.LARGE_FS ? T.RATIO_LARGE : T.RATIO_NORMAL;
      if (ratio < need - 0.02) {
        return { n, ratio, need };
      }
      return null;
    },
    message: (h) => `${loc(h.n)} 文字 ${hex(h.n.fg)} 对背景 ${hex(h.n.bg)} 对比度 ${h.ratio.toFixed(2)}:1 (<${h.need}:1 WCAG AA) (容器 ${h.n._pLabel})`
  },
  {
    id: 'GRADIENT_CONTRAST', layer: 'L1', severity: 'error', runner: 'node',
    theory: '渐变背景上文字的 WCAG AA 对比度（按最不利 stop 校正）——CONTRAST_LOW 只读纯色背景，渐变此前不可度量',
    when: (n) => !!n.text && !!n.gradStops,
    detect: (n, T) => {
      const need = (n.fontSize || 16) >= T.LARGE_FS ? T.RATIO_LARGE : T.RATIO_NORMAL;
      let worst = Infinity;
      let stopHex = '';
      for (const s of n.gradStops) {
        const r = contrastRatio(n.fg, s);
        if (r < worst) { worst = r; stopHex = hex(s); }
      }
      if (worst < need - 0.02) return { n, ratio: worst, need, stopHex };
      return null;
    },
    message: (h) => `${loc(h.n)} 文字 ${hex(h.n.fg)} 对渐变背景对比度仅 ${h.ratio.toFixed(2)}:1（最不利 stop ${h.stopHex}）(<${h.need}:1 WCAG AA) — 校正文字与该 stop 的对比，或改用纯色背景`
  },
  {
    id: 'IMG_BROKEN', layer: 'L1', severity: 'error', runner: 'node',
    theory: '图像加载失败（complete && naturalWidth===0）——破图直接影响可用性；懒加载未触发时 complete=false 天然排除',
    when: (n) => n.imgBroken,
    detect: (n) => (n.imgBroken ? { n } : null),
    message: (h) => `${loc(h.n)}${h.n.alt ? '“' + h.n.alt + '”' : ''} 图像加载失败 (src …${h.n.imgSrcTail}) — 尝试修复 URL（检查资源是否存在/路径拼写）；若资源不存在，改用 alt 占位（色块 + “${h.n.alt || '语义文本'}”使其美观可读）`
  },
  {
    id: 'CHART_TEXT_CONTRAST', layer: 'L1', severity: 'warn', runner: 'page',
    theory: '图表文字（axisLabel/textStyle）对图表背景的可读性（WCAG AA）——图表颜色此前不在任何规则内',
    detect: (F, T) => {
      const hits = [];
      const pageText = F.palette && F.palette.textTop && F.palette.textTop.length
        ? F.palette.textTop[0].hex : null;
      for (const c of F.chartTexts || []) {
        if (c.gradient) continue; // 渐变背景不可靠度量，交给 GRADIENT_BG
        for (const fg of c.chartTextFgs || []) {
          const ratio = contrastRatio(fg, c.bg);
          if (ratio < T.RATIO - 0.02) {
            const hit = { n: c, fg, ratio };
            // 若页面文字主色在图表背景上同样达标，则给出可直接套用的建议色（也是图表与页面文字的色一致性）
            if (pageText) {
              const pg = parseHex(pageText);
              const pr = contrastRatio(pg, c.bg);
              if (pr >= T.RATIO - 0.02) { hit.suggest = pageText; hit.suggestRatio = pr; }
            }
            hits.push(hit);
            break;
          }
        }
      }
      return hits.length ? hits : null;
    },
    message: (h) => h.suggest
      ? `${label(h.n)} 图表文字 ${hex(h.fg)} 对背景 ${hex(h.n.bg)} 对比度 ${h.ratio.toFixed(2)}:1 (<4.5:1 WCAG AA)。建议把 data-echarts 的 axisLabel / textStyle 颜色改为页面文字主色 ${h.suggest}（该色与背景对比 ${h.suggestRatio.toFixed(2)}:1 ≥4.5，同时与页面正文用色一致）`
      : `${label(h.n)} 图表文字 ${hex(h.fg)} 对背景 ${hex(h.n.bg)} 对比度 ${h.ratio.toFixed(2)}:1 (<4.5:1 WCAG AA)，建议提高图表文字与背景对比`
  },
  {
    id: 'CHART_DEGENERATE', layer: 'L1', severity: 'warn', runner: 'page',
    theory: '图表容器高度塌陷（% 高度链在重组中失效）会留下大片空白的根因',
    detect: (F, T) => {
      const hits = F.allNodes.filter((n) =>
        (n.chartTextFgs || n.tag === 'canvas') && n.rect.w >= T.W_MIN && n.rect.h < T.H_MAX);
      return hits.length ? hits : null;
    },
    message: (h) => `${label(h)} 图表容器高度 ${r0(h.rect.h)}px（宽 ${r0(h.rect.w)}px）已塌陷——高度链可能失效，须让图表填满其容器（避免 % 高度断链或固定极矮高度）`
  },
  {
    id: 'MIN_FONT_SIZE', layer: 'L1', severity: 'error', runner: 'node',
    theory: '可读性底线 10px',
    when: (n) => !!n.text,
    detect: (n, T) => ((n.fontSize || 16) < T.MIN_FS ? n : null),
    message: (n, T) => `${label(n)} 字号 ${r0(n.fontSize || 16)}px 低于可读下限 ${T.MIN_FS}px`
  },
  /* ---- 无障碍（P1 CSSOM 类） ---- */
  {
    id: 'FOCUS_INVISIBLE', layer: 'L1', severity: 'error', runner: 'page',
    theory: 'WCAG 2.4.7 Focus Visible / F78',
    detect: (F) => {
      const sel = F.cssom.outlineNone || [];
      if (!sel.length) return null;
      const hitSel = sel.filter((s) => /:focus|button|^a$|\ba\b|\*/i.test(s));
      if (!hitSel.length) return null;
      const inter = F.allNodes.filter((n) => n.interactive);
      if (!inter.length) return null;
      return { count: inter.length, sels: hitSel.slice(0, 3).join(' | ') };
    },
    message: (h) => `${h.count} 个可交互元素焦点样式被移除（${h.sels}）且无 :focus-visible 替代，违反 WCAG 2.4.7`
  },
  /* ---- 文本与背景关系 ---- */
  {
    id: 'GREY_ON_COLOR', layer: 'L1', severity: 'warn', runner: 'node',
    theory: 'Refactoring UI：彩色背景不用纯灰字',
    when: (n) => !!n.text,
    detect: (n, T) => {
      const [, fs, fl] = rgbToHsl(n.fg);
      const [, bs, bl] = rgbToHsl(n.bg);
      if (fs < T.FG_MAX_S && fl > 0.15 && fl < 0.85 && bs > T.BG_MIN_S && bl > 0.15 && bl < 0.85) return n;
      return null;
    },
    message: (n) => `${label(n)} 在彩色背景 ${hex(n.bg)} 上使用纯灰文字 ${hex(n.fg)}，应改用带背景色调的半透明深色（如 rgba(0,0,0,.6)）`
  },
  {
    id: 'LINK_INDISTINCT', layer: 'L1', severity: 'warn', runner: 'node',
    theory: 'WCAG 1.4.1 不依赖颜色区分链接',
    when: (n) => n.tag === 'a' && n._pt === 'p',
    detect: (n, T, F) => {
      if ((n.tdl || 'none') !== 'none') return null;
      const same = F.allNodes.find((p) => p.tag === 'p' && p.children.includes(n));
      if (!same) return null;
      return hex(n.fg) === hex(same.fg) ? { n, p: same } : null;
    },
    message: (h) => `${label(h.n)} 与正文 ${hex(h.p.fg)} 同色且无下划线，无法区分链接（加色或下划线）`
  }
];
