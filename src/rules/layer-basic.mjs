/**
 * layer-basic.mjs —— L1 基础规范（10 条）
 *
 * 语义：页面可用底线，违反即"坏页面"（绝大多数 severity=error）。
 * 每条规则形状：{ id, layer, severity, runner, theory, when?, detect, message }
 *   - runner：engine/runners.mjs 的执行器类型（node/pair/textGroup/listGroup/container/page）
 *   - when：node 类规则的预筛谓词（避免对无关节点跑 detect）
 *   - detect：返回 null（不命中）或单对象/数组（命中，对象即 message 的输入 h）
 *   - message：由命中对象渲染为带 CSS 修复线索 + 理论依据的消息串（LLM 回流文本）
 */
import { hex, contrastRatio, suggestAccessible, rgbToHsl } from '../color.mjs';
import { label, r0 } from '../engine/util.mjs';

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
      return `${label(n)} 右边缘 ${r0(right)}px 超出视口 ${vw}px (+${r0(right - vw)}px)`;
    }
  },
  {
    id: 'TEXT_CLIP', layer: 'L1', severity: 'error', runner: 'node',
    theory: '文本完整显示',
    when: (n) => n._clipInner,
    detect: (n) => n,
    message: (n) => `${label(n)} 文本超出容器宽度未换行 (scrollW>clientW) "${n.text}"`
  },
  {
    id: 'OVERLAP', layer: 'L1', severity: 'error', runner: 'pair',
    theory: '元素矩形互斥',
    detect: (a, b, T, F, parent) => {
      const ra = a.rect, rb = b.rect;
      const w = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
      const h = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
      if (w >= T.MIN_W && h >= T.MIN_H) return { a, b, w: r0(w), h: r0(h), parent };
      return null;
    },
    message: (h) => `${label(h.a)} 与 ${label(h.b)} 重叠 ${h.w}×${h.h}px (容器 ${h.parent})`
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
    when: (n) => !!n.text,
    detect: (n, T) => {
      const ratio = contrastRatio(n.fg, n.bg);
      const need = (n.fontSize || 16) >= T.LARGE_FS ? T.RATIO_LARGE : T.RATIO_NORMAL;
      if (ratio < need - 0.02) {
        return { n, ratio, need, sugg: suggestAccessible(n.fg, n.bg, need) };
      }
      return null;
    },
    message: (h) => `${label(h.n)} 文字 ${hex(h.n.fg)} 对背景 ${hex(h.n.bg)} 对比度 ${h.ratio.toFixed(2)}:1 (<${h.need}:1 WCAG AA)，建议改为 ${h.sugg}`
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
