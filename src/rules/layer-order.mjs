/**
 * layer-order.mjs —— L2 结构秩序（16 条）
 *
 * 语义：一致性与对齐（不齐=业余感）。多数规则跑在 textGroup / listGroup 执行器上，
 *   即"同类元素应统一"——左缘/宽度/圆角/字号/颜色/字重/边框一致，间距成系统。
 * 判据数值一律来自 config.mjs 的 T（DIFF/SPREAD/MAX 等），本文件无魔法数字。
 */
import { hex, rgbToHsl } from '../color.mjs';
import { label, loc, r0, spread } from '../engine/util.mjs';

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

/** paintsSurface —— 节点是否绘制可见表面（自身底色/渐变/背景图/阴影/媒体）。
    圆角、边框单独不计——否则会选中「透明包裹层」（如 background:transparent 的 button），
    其尺寸由行拉伸决定、掩盖内部真实卡片盒的差异。 */
function paintsSurface(n) {
  return !!(n.bgOwn || n.gradient || n.bgUrl || n.shadow || n.media);
}

/** visibleBox —— 解析列表项的「可见卡片盒」：子树内绘制表面的最大面积节点（同面积取最外层）；
    无绘制表面则回退为节点自身。返回 { node, resolved }（resolved=false 表示未找到可见子盒）。 */
function visibleBox(n) {
  let best = null;
  (function walk(m) {
    if (paintsSurface(m)) {
      const area = m.rect.w * m.rect.h;
      if (!best || area > best.area) best = { node: m, area };
    }
    for (const c of m.children) walk(c);
  })(n);
  return best ? { node: best.node, resolved: true } : { node: n, resolved: false };
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
    theory: '尺寸一致性（含可见卡片盒：绘制表面的最大子盒；严格同 tag 才可比）',
    detect: (g, T) => {
      const ws = g.items.map((n) => n.rect.w);
      if (spread(ws) > T.DIFF) return { n: g.items.length, key: g.key, ws: ws.map(r0), parent: g.parent };
      /* 可见卡片盒尺寸：解析每项「绘制表面最大子盒」（严格守卫：全部 resolved 且同 tag，
         避免 div 卡片 vs img 缩略图 vs span 徽标 的跨结构误报） */
      const boxes = g.items.map(visibleBox);
      if (boxes.every((b) => b.resolved) && new Set(boxes.map((b) => b.node.tag)).size === 1) {
        const bw = boxes.map((b) => b.node.rect.w);
        const bh = boxes.map((b) => b.node.rect.h);
        if (spread(bw) > T.DIFF || spread(bh) > T.DIFF) {
          return { n: g.items.length, key: g.key, parent: g.parent, bw: bw.map(r0), bh: bh.map(r0) };
        }
      }
      return null;
    },
    message: (h) => h.bw
      ? `${h.n} 个 ${h.key} 可见卡片盒尺寸不一致: 宽 ${h.bw.join('/')} 高 ${h.bh.join('/')}px (容器 ${h.parent})`
      : `${h.n} 个 ${h.key} 宽度不一致: ${h.ws.join('/')}px (容器 ${h.parent})`
  },
  {
    id: 'GROUP_CHILD_ALIGN', layer: 'L2', severity: 'warn', runner: 'pathGroup',
    theory: '重复项内「对应子元素」几何一致性——全子树按结构路径（逐层 tag+首类签名+出现序）跨项匹配（含结构性孙元素，如图标），各维 (dx/dy/w/h) 相对自身项取值；偏离组内中位 >TOL 的项为错位。文本驱动的偏移按文字方向豁免（横排豁免 h/dy、竖排豁免 w/dx）——段落高度随内容长度自然变化，而图标/图片等结构性子元素应对齐。每组建报各偏离路径组',
    detect: (g, T) => {
      const items = g.items;
      if (items.length < 3) return null;
      /* 1) 全子树展平：结构路径（逐层 签名+出现序）→ 跨项匹配（含结构性孙元素） */
      const groups = new Map();
      const order = [];
      const walkTree = (item, node, path) => {
        const seen = new Map();
        for (const ch of node.children) {
          const sig = ch.tag + (ch.cls ? '.' + ch.cls.split('.')[0] : '');
          const occ = seen.get(sig) || 0;
          seen.set(sig, occ + 1);
          const p = path ? path + ' > ' + sig + '#' + occ : sig + '#' + occ;
          if (!groups.has(p)) { groups.set(p, { path: p, rows: [] }); order.push(p); }
          groups.get(p).rows.push({ item, node: ch });
          walkTree(item, ch, p);
        }
      };
      for (const item of items) walkTree(item, item, '');
      /* 2) 逐路径组（≥3 项）比对各维（相对自身项）；文本驱动的偏移按方向豁免 */
      const median = (arr) => {
        const s = [...arr].sort((a, b) => a - b);
        return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
      };
      const DIMS = [
        ['dx', (it, c) => c.rect.x - it.rect.x], ['dy', (it, c) => c.rect.y - it.rect.y],
        ['w', (it, c) => c.rect.w], ['h', (it, c) => c.rect.h],
      ];
      const hits = [];
      for (const p of order) {
        const grp = groups.get(p);
        if (grp.rows.length < 3) continue; /* 样本不足（<3），中位数不稳 */
        /* 文本驱动豁免：子树含文本（≥TEXT_MIN_LEN）→ 其几何（w/h/dx/dy）整体归因于内容：
           段落高度随换行变化、行内宽度随文字长度变化、后续子元素位置随之级联——
           均为内容驱动的自然变化，不比对；无文本的结构性子元素（图标/图片）严格比对 */
        const node0 = grp.rows[0].node;
        const minTextLen = Math.min(...grp.rows.map((r) => r.node.textLen || 0));
        if (minTextLen >= T.TEXT_MIN_LEN) continue;
        const dev = [];
        for (const [name, get] of DIMS) {
          const vals = grp.rows.map((r) => get(r.item, r.node));
          const med = median(vals);
          const outliers = grp.rows
            .map((r, i) => ({ r, d: Math.abs(vals[i] - med) }))
            .filter((o) => o.d > T.TOL)
            .sort((a, b) => b.d - a.d);
          if (outliers.length) dev.push({ dim: name, vals: vals.map(r0), med: r0(med), outliers });
        }
        if (!dev.length) continue;
        const top = dev.sort((a, b) => b.outliers[0].d - a.outliers[0].d)[0];
        hits.push({
          n: items.length, key: g.key, parent: g.parent,
          path: grp.path, dim: top.dim, vals: top.vals, med: top.med,
          ex: top.outliers.slice(0, 3).map((o) => `${label(o.r.item)} > ${loc(o.r.node)}`),
        });
      }
      return hits.length ? hits : null;
    },
    message: (h) => `${h.n} 个 ${h.key} 内对应子元素几何不一致：${h.path} 的 ${h.dim} ${h.vals.join('/')}px，偏离中位 ${h.med}px（如 ${h.ex[0]}）— 重复项内对应子元素应几何一致，多由某项文本过长换行导致；建议统一/截断文本或固定子元素尺寸`
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
      const sized = arr.filter((n) => n.fontSize !== null);
      const sizes = sized.map((n) => n.fontSize);
      const uniq = [...new Set(sizes.map((v) => r0(v)))];
      if (uniq.length > 1 && spread(sizes) > T.DIFF) {
        /* 多数值 = 多数派；异常元素 = 偏离多数值者（定位串列举，≤3） */
        const counts = {};
        for (const v of sizes) { const k = r0(v); counts[k] = (counts[k] || 0) + 1; }
        const mode = Number(Object.keys(counts).reduce((a, b) => (counts[a] >= counts[b] ? a : b)));
        const outliers = sized.filter((n) => r0(n.fontSize) !== mode).slice(0, 3)
          .map((n) => `${loc(n)}(${r0(n.fontSize)}px)`);
        return { n: arr.length, tag: key.split('|')[0], uniq, pt: arr[0]._pt, outliers };
      }
      return null;
    },
    message: (h) => `${h.n} 个同类 ${h.tag} 字号不一致: ${h.uniq.join('/')}px (容器 ${h.pt})${h.outliers.length ? '；异常: ' + h.outliers.join(', ') : ''}`
  },
  {
    id: 'COLOR_INCONSISTENT', layer: 'L2', severity: 'warn', runner: 'textGroup',
    theory: '颜色一致性',
    detect: (arr, T, F, key) => {
      const ckeys = [...new Set(arr.map((n) => `${n.fg[0] >> 4}-${n.fg[1] >> 4}-${n.fg[2] >> 4}`))];
      if (ckeys.length > 1) {
        /* 多数色 = 出现最多者；偏离元素按定位串列举（≤3） */
        const counts = {};
        for (const n of arr) { const h = hex(n.fg); counts[h] = (counts[h] || 0) + 1; }
        const mode = Object.keys(counts).reduce((a, b) => (counts[a] >= counts[b] ? a : b));
        const outliers = arr.filter((n) => hex(n.fg) !== mode).slice(0, 3)
          .map((n) => `${loc(n)}(${hex(n.fg)})`);
        return { n: arr.length, tag: key.split('|')[0], hexes: [...new Set(arr.map((n) => hex(n.fg)))], pt: arr[0]._pt, outliers };
      }
      return null;
    },
    message: (h) => `${h.n} 个同类 ${h.tag} 颜色不一致: ${h.hexes.join('/')}，应统一为同一颜色 (容器 ${h.pt})${h.outliers.length ? '；偏离多数色: ' + h.outliers.join(', ') : ''}`
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
      const ex = [];
      for (const n of F.allNodes) {
        const r = n.radius || 0;
        if (r < 1) continue;
        if (!T.SCALE.some((s) => Math.abs(s - r) <= 1)) {
          off[r0(r)] = (off[r0(r)] || 0) + 1;
          if (ex.length < 3) ex.push(`${loc(n)}(${r0(r)}px)`);
        }
      }
      const distinct = Object.keys(off);
      if (distinct.length >= T.MIN_DISTINCT) return { distinct, total: Object.values(off).reduce((a, b) => a + b, 0), ex };
      return null;
    },
    message: (h, T) => `出现 ${h.distinct.length} 种刻度外圆角 (${h.distinct.join('/')}px，共 ${h.total} 处)，应收敛到设计刻度 ${T.SCALE.join('/')}；如: ${h.ex.join(', ')}`
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
      if (ws.length > 1) {
        const counts = {};
        for (const n of arr) { const w = n.fw || 400; counts[w] = (counts[w] || 0) + 1; }
        const mode = Number(Object.keys(counts).reduce((a, b) => (counts[a] >= counts[b] ? a : b)));
        const outliers = arr.filter((n) => (n.fw || 400) !== mode).slice(0, 3)
          .map((n) => `${loc(n)}(${n.fw || 400})`);
        return { n: arr.length, tag: key.split('|')[0], ws, pt: arr[0]._pt, outliers };
      }
      return null;
    },
    message: (h) => `${h.n} 个同类 ${h.tag} 字重不一致: ${h.ws.join('/')} (容器 ${h.pt})${h.outliers.length ? '；异常: ' + h.outliers.join(', ') : ''}`
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
  },
  /* ---- 交互控件文字垂直居中（观测：加大高度后文字贴顶） ---- */
  {
    id: 'CONTROL_TEXT_CENTER', layer: 'L2', severity: 'warn', runner: 'node',
    theory: '交互控件（按钮/链接）内文字应垂直居中',
    when: (n) => n.interactive && !!n.text && n.rect.h >= 28 && typeof n.vcenterDelta === 'number',
    detect: (n, T) => (Math.abs(n.vcenterDelta) > T.MAX ? n : null),
    message: (n, T) => {
      const side = n.vcenterDelta < 0 ? '偏上' : '偏下';
      return `${label(n)} (${r0(n.rect.w)}×${r0(n.rect.h)}) 文字垂直偏移 ${r0(Math.abs(n.vcenterDelta))}px（${side}），建议 inline-flex + items-center 使文字垂直居中`;
    }
  },
  {
    id: 'CHART_TOP_CLIP', layer: 'L2', severity: 'warn', runner: 'page',
    theory: '图表 y 轴顶部（最大值刻度/轴名）裁切风险——顶部空间依赖默认边距',
    detect: (F, T) => {
      const hits = F.allNodes.filter((n) =>
        n.chartTopRisk === true && n.rect.h >= T.H_MIN && n.rect.h <= T.H_MAX);
      return hits.length ? hits : null;
    },
    message: (h) => `${label(h)} (${r0(h.rect.w)}×${r0(h.rect.h)}) y 轴顶部刻度/轴名可能被裁切——请给 data-echarts 显式 grid.containLabel:true（仅加大 grid.top 不够），让 ECharts 自动为坐标轴标签保留顶部空间`
  },
  {
    id: 'CHART_OVER_PARENT', layer: 'L2', severity: 'warn', runner: 'page',
    theory: '图表/媒体节点底部超出其外层卡片（容器含内边距/边框时子级同高会溢出）',
    detect: (F, T) => {
      const hits = [];
      const parentOf = new Map();
      for (const n of F.allNodes) for (const c of n.children || []) parentOf.set(c, n);
      for (const n of F.allNodes) {
        if (!(n.chartTextFgs || n.tag === 'canvas')) continue;
        const p = parentOf.get(n);
        if (!p) continue;
        const cardLike = p.bgOwn || (p.bw || 0) >= 1 || (p.radius || 0) > 0;
        if (!cardLike) continue;
        const over = n.rect.y + n.rect.h - (p.rect.y + p.rect.h);
        if (over > T.TOL) hits.push({ n, p, over: r0(over) });
      }
      return hits.length ? hits : null;
    },
    message: (h) => `${label(h.n)} 图表容器底部超出其外层卡片 ${label(h.p)} ${h.over}px——外层含内边距/边框时子级高度不应与其总高相同；请压缩图表高度或去掉冲突的内边距，使图表完整落在卡片内`
  },
  /* ---- 水平滑动容器左缘留白 ---- */
  {
    id: 'HSCROLL_EDGE_SPACING', layer: 'L2', severity: 'warn', runner: 'node',
    theory: '水平滑动容器首项不应紧贴视口左缘（按视口坐标判，非容器内边距）：首项 rect.x < MIN_LEFT 时报。判定基于初始加载几何（未滚动时的首个可见子项），与 ELEMENT_OVERFLOW 的 hscroll 豁免互补：溢出是设计使然，但首项贴视口边缘缺呼吸空间仍是不美观。消息不预设具体数值，建议与页面其他元素的左缘留白保持一致（模型可从页面源码对齐）。',
    when: (n) => n._isScrollX && (n.children || []).some((c) => c.rect.w > 0),
    detect: (n, T) => {
      const first = n.children.find((c) => c.rect.w > 0);
      if (!first) return null;
      const gap = first.rect.x;
      if (gap < T.MIN_LEFT) return { n, first, gap: r0(gap) };
      return null;
    },
    message: (h) =>
      `水平滑动容器 ${loc(h.n)}（首项 ${loc(h.first)}）首项紧贴左缘（间距 ${h.gap}px）——应添加左内边距，与页面其他元素的左缘留白保持一致，避免首项贴边`
  },
  /* ---- 文本被纵向挤压（本应横排却成垂直列） ---- */
  {
    id: 'TEXT_SQUISHED', layer: 'L2', severity: 'warn', runner: 'node',
    theory: '检测因布局冲突被纵向挤压的文本——本应横排的文字（writingMode=horizontal-tb）在 flex/grid 父容器中因空间不足被压缩到极窄宽度、堆栈成垂直列。区别于有意纵向排盘（writingMode:vertical-rl 等，when 排除）。判定：实际宽 < 估算横排宽 ×EST_RATIO 且 高 > 宽 ×H_W_RATIO。',
    when: (n) => !!n.text && n.text.length >= 3 && (!n.writingMode || n.writingMode === 'horizontal-tb'),
    detect: (n, T) => {
      const estW = n.text.length * (n.fontSize || 16) * 0.55;
      if (n.rect.w >= estW * T.EST_RATIO) return null;
      if (n.rect.h <= n.rect.w * T.H_W_RATIO) return null;
      return { n, w: r0(n.rect.w), h: r0(n.rect.h), est: Math.ceil(estW), txt: n.text.slice(0, 10) };
    },
    message: (h) => `${loc(h.n)} 文本宽 ${h.w}px 高 ${h.h}px（估算横排至少需 ${h.est}px）——文字可能因布局冲突被纵向挤压，应检查包裹容器宽度/间距/flex 换行等布局`
  }
];
