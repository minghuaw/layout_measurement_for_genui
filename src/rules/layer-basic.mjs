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
import { hex, contrastRatio, rgbToHsl, parseHex, blendFg } from '../color.mjs';
import { label, loc, r0, pct } from '../engine/util.mjs';

/** gradFractionAt —— 页面坐标点投影到渐变轴（CSS 角度：0deg 向上、顺时针），返回 0..1 渐变分数。
 *  渐变线过盒中心，方向 d = (sin θ, −cos θ)；线长 L = |W·sin θ| + |H·cos θ|（CSS 规范公式）。
 *  轴对齐（0/90/180/270）时退化为按 x/y 的线性投影。 */
const gradFractionAt = (geom, px, py) => {
  const rad = (geom.deg * Math.PI) / 180;
  const dx = Math.sin(rad), dy = -Math.cos(rad);
  const cx = geom.rect.x + geom.rect.w / 2;
  const cy = geom.rect.y + geom.rect.h / 2;
  const L = Math.abs(geom.rect.w * dx) + Math.abs(geom.rect.h * dy);
  if (L <= 0) return 0.5;
  return 0.5 + (((px - cx) * dx + (py - cy) * dy) / L);
};
/** gradColorAt —— 渐变在分数 f 处的颜色（线性插值；coincident stop 后者生效=硬切） */
const gradColorAt = (stops, f) => {
  if (f <= stops[0].pos) return stops[0].rgba;
  const last = stops[stops.length - 1];
  if (f >= last.pos) return last.rgba;
  for (let i = 1; i < stops.length; i++) {
    if (f <= stops[i].pos) {
      const s0 = stops[i - 1], s1 = stops[i];
      const span = s1.pos - s0.pos;
      if (span <= 1e-6) return s1.rgba; /* coincident：位置相同 → 后一 stop 生效 */
      const t = (f - s0.pos) / span;
      return {
        r: s0.rgba.r + (s1.rgba.r - s0.rgba.r) * t,
        g: s0.rgba.g + (s1.rgba.g - s0.rgba.g) * t,
        b: s0.rgba.b + (s1.rgba.b - s0.rgba.b) * t,
        a: s0.rgba.a + (s1.rgba.a - s0.rgba.a) * t
      };
    }
  }
  return last.rgba;
};
/**
 * coverScan —— 覆盖检测共享扫描（MEDIA_COVERED / TEXT_COVERED 共用）
 *
 * 绘制模型（同层叠上下文内）：定位元素（pos ≠ static）整体绘制在 static 内容之上
 * （static 兄弟的背景绘制阶段早于文本/被包含内容，因此 static 元素从不遮挡
 * static 文本与媒体——负 margin 卡片堆叠的"后来卡盖住先前卡"实为背景交叠，
 * 文本仍绘制在上层，故不在此规则语义内，见 BACKLOG.md B）。
 * 受害者绘制锚点 = 最近的定位祖先（自身定位则为其自身序号；无则 -∞，
 * 即任意定位元素均可遮挡）。候选 = 定位元素且树序 > 受害者锚点；祖先排除
 * （包含≠遮挡）；遮挡物不透明 = 自身实心底色（非渐变、alpha≥COVER_ALPHA）、
 * 自身为不透明媒体（img/video/canvas）或子树含充满它的不透明媒体（≥80%，
 * hainan round-0 relative 容器 + 满幅 img 盖住 static h1 的案例即此类）。
 * 当 opts.allowGradient 时（TEXT_COVERED 专用），另接受「渐变遮罩」——定位元素带
 * linear-gradient，且受害者在渐变轴上的不透明占比 ≥ MIN_COVER（stop 透明度按位置
 * 插值；非轴对齐/无 gradInfo 跳过）。MEDIA_COVERED 不开此项（图片上叠渐隐多为有意设计）。
 * 交叠 ≥ MIN_COVER（占受害者面积）；每受害者仅报最大覆盖者。
 */
const coverScan = (F, T, isVictim, opts = {}) => {
  const allowGradient = !!opts.allowGradient;
  const area = (r) => Math.max(0, r.w) * Math.max(0, r.h);
  const interFrac = (a, b) => {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (w <= 0 || h <= 0) ? 0 : (w * h) / Math.max(1, area(a));
  };
  /* gradCoverFrac —— 渐变遮罩在受害者区域的「不透明占比」：把受害者投影到渐变轴
     （仅轴对齐 0/90/180/270deg；其余返回 0 跳过），逐点插值 stop alpha，
     返回 alpha ≥ COVER_ALPHA 的采样占比。用于把「渐隐到底色」的遮罩层识别为遮挡物
     （decor home：static <p> 被 absolute 渐变遮罩压住）。 */
  const gradCoverFrac = (c, vr) => {
    const gi = c._gradInfo;
    if (!gi || !gi.stops || gi.stops.length < 2) return 0;
    const rect = c.rect;
    const deg = gi.deg;
    /* 仅轴对齐渐变（0/90/180/270）可投影；斜向渐变的覆盖占比不可靠 → 跳过 */
    if (![0, 90, 180, 270].includes(deg)) return 0;
    const vert = deg === 0 || deg === 180;
    if (vert ? !(rect.h > 0) : !(rect.w > 0)) return 0;
    const proj = vert
      ? (deg === 180 ? (y) => (y - rect.y) / rect.h : (y) => (rect.y + rect.h - y) / rect.h)
      : (deg === 90 ? (x) => (x - rect.x) / rect.w : (x) => (rect.x + rect.w - x) / rect.w);
    const a0 = vert ? proj(vr.y) : proj(vr.x);
    const a1 = vert ? proj(vr.y + vr.h) : proj(vr.x + vr.w);
    const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
    const stops = gi.stops;
    const alphaAt = (f) => {
      if (f <= stops[0].pos) return stops[0].rgba.a;
      const last = stops[stops.length - 1];
      if (f >= last.pos) return last.rgba.a;
      for (let i = 1; i < stops.length; i++) {
        if (f <= stops[i].pos) {
          const s0 = stops[i - 1], s1 = stops[i];
          const t = (f - s0.pos) / Math.max(1e-6, s1.pos - s0.pos);
          return s0.rgba.a + (s1.rgba.a - s0.rgba.a) * t;
        }
      }
      return last.rgba.a;
    };
    const N = 20;
    let hit = 0;
    for (let k = 0; k < N; k++) {
      const f = lo + (hi - lo) * ((k + 0.5) / N);
      if (alphaAt(f) >= T.COVER_ALPHA) hit++;
    }
    return hit / N;
  };
  const OPAQUE_MEDIA = ['img', 'video', 'canvas'];
  const isOpaque = (c, vr) =>
    (c.bgOwn && !c.gradient && c.bgOwnAlpha >= T.COVER_ALPHA) ||
    OPAQUE_MEDIA.includes(c.tag) ||
    (allowGradient && c.gradient && gradCoverFrac(c, vr) >= T.MIN_COVER) ||
    (function filledWithMedia(n) {
      for (const ch of n.children) {
        if ((OPAQUE_MEDIA.includes(ch.tag) || (ch.bgOwn && !ch.gradient)) && interFrac(n.rect, ch.rect) >= 0.8) return true;
        if (filledWithMedia(ch)) return true;
      }
      return false;
    })(c);
  const best = new Map();
  const victims = [];
  const covers = [];
  let seq = 0;
  const dfs = (nodes, anc, anchorSeq) => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      n._seq = seq++;
      const positioned = n.pos !== 'static';
      if (isVictim(n)) {
        victims.push({ n, anc: new Set(anc), anchorSeq: positioned ? n._seq : anchorSeq });
      }
      if (positioned) covers.push(n);
      dfs(n.children, new Set(anc).add(n), positioned ? n._seq : anchorSeq);
    }
  };
  dfs(F.tree, new Set(), -Infinity);
  for (const { n, anc, anchorSeq } of victims) {
    for (const c of covers) {
      if (c === n || anc.has(c) || c._seq <= anchorSeq || !isOpaque(c, n.rect)) continue;
      const geo = interFrac(n.rect, c.rect);
      if (geo < T.MIN_COVER) continue;
      /* 渐变遮罩：遮挡比例 = 几何交叠 × 该区域的不透明占比 */
      const frac = (allowGradient && c.gradient) ? geo * gradCoverFrac(c, n.rect) : geo;
      if (frac < T.MIN_COVER) continue;
      const cur = best.get(n);
      if (!cur || frac > cur.frac) best.set(n, { victim: n, cover: c, frac, grad: !!c.gradient });
    }
  }
  return [...best.values()];
};

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
    theory: '视口适配底线（横向滚动容器自身及其 overflow-x: auto/scroll 祖先链内元素豁免——轮播/横滑行属有意设计，右缘越界可由滚动抵达）',
    when: (n) => n._outerExceeds && !n._inHScroll && !n._isScrollX,
    detect: (n) => n,
    message: (n, T, F) => {
      const vw = F.pageInfo.viewport.w;
      const right = n.rect.x + n.rect.w;
      return `${loc(n)} 右边缘 ${r0(right)}px 超出视口 ${vw}px (+${r0(right - vw)}px) (容器 ${n._pLabel})`;
    }
  },
  {
    id: 'TEXT_CLIP', layer: 'L1', severity: 'error', runner: 'node',
    theory: '文本完整显示（自身可横向滚动 auto/scroll 的溢出豁免——属横滑区，可滚动抵达）',
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
    theory: '富媒体被不透明元素大面积遮挡（内容不可见）：img/video/canvas/svg/iframe/object/echarts 容器 + url 背景图容器。共享 coverScan（绘制模型与候选见其注释）',
    detect: (F, T) => coverScan(F, T, (n) => n.media || n.bgUrl)
      .map((h) => ({ media: h.victim, cover: h.cover, frac: h.frac })),
    message: (h) => `${loc(h.media)}${h.media.alt ? '“' + h.media.alt + '”' : ''} 被 ${loc(h.cover)} 遮挡 ${pct(h.frac)} — 移开/移动遮挡元素或调整层级；若为有意设计请忽略`
  },
  {
    id: 'TEXT_COVERED', layer: 'L1', severity: 'warn', runner: 'page',
    theory: '文本被不透明元素/富媒体/渐变遮罩大面积遮挡（内容不可见）——含祖先层级候选（hainan round-0 relative hero 容器 + 满幅 img 盖住 static h1 顶部的真实案例）；渐变遮罩按受害者所在位置的 stop 透明度判定（decor home static p 被渐隐遮罩压住）。共享 coverScan',
    detect: (F, T) => coverScan(F, T, (n) => !!n.text, { allowGradient: true })
      .map((h) => ({ text: h.victim, cover: h.cover, frac: h.frac, grad: h.grad })),
    message: (h) => `${loc(h.text)} 文字被 ${loc(h.cover)}${h.grad ? ' 的渐变遮罩' : ''}遮挡 ${pct(h.frac)} — 移开/移动遮挡元素或调整层级；若为有意设计请忽略`
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
    theory: '渐变背景上文字的 WCAG AA 对比度——有渐变几何时按「文字盒沿渐变轴的两个边界点」取实际底色（文字不在最不利 stop 上则不误报，修正装饰性条纹误报）；无几何（radial/解析失败）回退为最差 stop',
    when: (n) => !!n.text && !!n.gradStops,
    detect: (n, T) => {
      const need = (n.fontSize || 16) >= T.LARGE_FS ? T.RATIO_LARGE : T.RATIO_NORMAL;
      const geom = n._gradGeom;
      if (geom && geom.stops && geom.stops.length >= 2 && geom.rect && geom.rect.w > 0 && geom.rect.h > 0) {
        /* 位置感知：文字盒四角投影到渐变轴，取最小/最大分数（两端边界），各插值出实际底色，
           对比取更差者——装饰性条纹（最不利 stop 不在文字下方）不再误报 */
        const corners = [
          [n.rect.x, n.rect.y], [n.rect.x + n.rect.w, n.rect.y],
          [n.rect.x, n.rect.y + n.rect.h], [n.rect.x + n.rect.w, n.rect.y + n.rect.h]
        ];
        const fr = corners.map(([px, py]) => gradFractionAt(geom, px, py));
        const fLo = Math.max(0, Math.min(...fr));
        const fHi = Math.min(1, Math.max(...fr));
        let worst = { stopHex: '', ratio: Infinity };
        for (const f of [fLo, fHi]) {
          const raw = gradColorAt(geom.stops, f);
          const eff = raw.a >= 1 ? [raw.r, raw.g, raw.b] : blendFg(raw, n.bg);
          const r = contrastRatio(n.fg, eff);
          if (r < worst.ratio) worst = { stopHex: hex(eff), ratio: r };
        }
        if (worst.ratio < need - 0.02) return { n, ratio: worst.ratio, need, stopHex: worst.stopHex };
        return null;
      }
      /* 回退：无几何（radial/解析失败）→ 最差 stop */
      let worst = Infinity;
      let stopHex = '';
      for (const s of n.gradStops) {
        const r = contrastRatio(n.fg, s);
        if (r < worst) { worst = r; stopHex = hex(s); }
      }
      if (worst < need - 0.02) return { n, ratio: worst, need, stopHex };
      return null;
    },
    message: (h) => `${loc(h.n)} 文字色 ${hex(h.n.fg)} 与渐变底色 ${h.stopHex} 对比度仅 ${h.ratio.toFixed(2)}:1（未达 WCAG AA ${h.need}:1）—— 建议调整文字色或该渐变颜色，或改用纯色背景`
  },
  {
    id: 'IMG_BROKEN', layer: 'L1', severity: 'error', runner: 'node',
    theory: '图像加载失败（complete && naturalWidth===0）——破图直接影响可用性；懒加载未触发时 complete=false 天然排除',
    when: (n) => n.imgBroken,
    detect: (n) => (n.imgBroken ? { n } : null),
    message: (h) => `${loc(h.n)}${h.n.alt ? '“' + h.n.alt + '”' : ''} 图像加载失败 (src …${h.n.imgSrcTail}) — 尝试修复 URL（检查资源是否存在/路径拼写）；若资源不存在，改用 alt 占位（色块 + “${h.n.alt || '语义文本'}”使其美观可读）`
  },
  {
    id: 'SVG_ICON_HINT', layer: 'L1', severity: 'info', runner: 'node',
    theory: 'SVG 图标经 <img> 引入时颜色固定在资源内、无法随主题/背景调整（currentColor 在 <img> 中解析为黑色）——疑似图标时提示改用 mask-image + background-color 控制颜色，以保证对比',
    when: (n) => n.tag === 'img' && n.imgSvg,
    detect: (n, T, F) => {
      /* 图标相似度启发：尺寸小 + 上下文（交互元素内 / alt 为空 / 页头页脚） */
      if (Math.min(n.rect.w, n.rect.h) > T.ICON_MAX) return null;
      if (!(n._inInteractive || n.alt === '' || n._inChrome)) return null;
      /* 建议图标色：优先页面文字主色 → 页面强调色 → 黑白（与图表规则同源；取首个 ≥ RATIO） */
      const p = F.palette || {};
      const cands = [];
      if (p.textTop && p.textTop[0]) cands.push(p.textTop[0].hex);
      if (p.accentTop && p.accentTop[0]) cands.push(p.accentTop[0].hex);
      cands.push('#ffffff', '#000000');
      let best = null;
      for (const hx of cands) {
        const rgb = parseHex(hx);
        if (!rgb) continue;
        const r = contrastRatio(rgb, n.bg);
        if (!best || r > best.ratio) best = { hex: hx, ratio: r };
        if (r >= T.RATIO) break;
      }
      return { n, bg: hex(n.bg), suggest: best ? best.hex : null, ratio: best ? best.ratio : 0, need: T.RATIO };
    },
    message: (h) => `${loc(h.n)}（${r0(h.n.rect.w)}×${r0(h.n.rect.h)}，疑似图标）— 若此处确为图标，建议改用 mask-image 渲染、用 background-color 控制颜色：<img> 引入的 SVG 颜色固定在资源内、无法随背景调整，难以保证图标与背景的对比。当前背景 ${h.bg} 上建议图标色 ${h.suggest}（对比 ${h.ratio.toFixed(2)}:1 ≥${h.need}:1）`
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
