/**
 * color.mjs —— 颜色核心库（纯函数，无状态，无副作用）
 *
 * 职责：
 *   为全部规则层提供颜色数学能力，包括：
 *   - 格式解析/转换：字符串 ↔ rgb 数组 ↔ hex ↔ HSL
 *   - alpha 合成（source-over）、WCAG 亮度/对比度
 *   - 全页调色板统计（computePalette：背景/文本/强调三角色制归因 + 和声判定）
 *
 * 约束：所有函数均为纯计算，不接触 DOM；输入一律为 [r,g,b(,a)] 数组或 CSS 色串。
 *   browser 侧不可直接引用（collect.mjs 内联了等价副本）。
 */

/** 将分量夹取到 0-255 并取整（hex/建议色输出前的归一化） */
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** rgb 数组 → "#rrggbb" 十六进制串 */
export function hex(rgb) {
  return '#' + [rgb[0], rgb[1], rgb[2]].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}

/** 解析 "rgb(r,g,b)" / "rgba(r,g,b,a)" 字符串 → {r,g,b,a}；不匹配或非法返回 null */
export function parseColorStr(s) {
  const m = s && s.match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;
  const p = m[1].split(',').map((v) => parseFloat(v));
  if (p.length < 3 || p.slice(0, 3).some((v) => Number.isNaN(v))) return null;
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

/** alpha 合成：前景 f 覆盖到底色 bg 上（source-over 公式），返回不含 alpha 的 rgb 数组 */
export function blendFg(f, bg) {
  if (!f || f.a <= 0) return [bg[0], bg[1], bg[2]];
  const a = f.a;
  return [f.r * a + bg[0] * (1 - a), f.g * a + bg[1] * (1 - a), f.b * a + bg[2] * (1 - a)];
}

/** WCAG 相对亮度：对 sRGB 分量先做线性化（分段函数），再按人眼敏感度加权求和 */
export function luminance(rgb) {
  const lin = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/** WCAG 对比度 (L1+0.05)/(L2+0.05)，恒 ≥1；规则层用其判定 AA/AAA 达标 */
export function contrastRatio(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** rgb → HSL 色轮角度（0-360°）、饱和度（0-1）、明度（0-1）；用于鲜艳度/和声/灰阶判定 */
export function rgbToHsl(rgb) {
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return [h, s, l];
}

/** 高饱和判定：饱和度 ≥0.5 且明度在 0.2-0.8 之间（用于强调色/鲜艳面积归因） */
export function isVivid(rgb) {
  const [, s, l] = rgbToHsl(rgb);
  return s >= 0.5 && l >= 0.2 && l <= 0.8;
}

/** Map 累加助手（同一 key 面积累加） */
const addMap = (m, key, val) => m.set(key, (m.get(key) || 0) + val);
/** 取 Map 中面积/占比 Top N 项（降序） */
const topN = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

/**
 * computePalette —— 全页调色板统计（L4 色彩和谐类规则的唯一输入）
 *
 * 归因模型：
 *   - 背景：bgOwn 节点记自身面积，减去被 bgOwn 子节点覆盖的面积（防止叠加计数）
 *   - 文本：按 fg 记面积；高饱和文本额外计入 vividSet
 *   - 强调色：bgOwn 且高饱和 或 可交互 的背景色（interactive 色块视为强调）
 *   - 未归因面积用 bodyBg 补齐（树从 body.children 开始，body 底色遗漏）
 * 和声判定：强调色相聚簇到 30° 档位后，恰好 3 簇且最小环间距 ≥60° 视为三角和声，
 *   >3 簇视为无和声（类似/互补不单独建模）。
 */
export function computePalette(tree, pageInfo) {
  const total = Math.max(1, pageInfo.viewport.w * Math.max(pageInfo.scrollHeight, pageInfo.viewport.h));
  const bgMap = new Map();
  const textMap = new Map();
  const accentMap = new Map();
  let vividArea = 0;
  const vividList = [];
  const vividSet = new Map();
  const walk = (nodes) => {
    for (const n of nodes) {
      const area = n.rect.w * n.rect.h;
      const covered = n.children
        .filter((c) => c.bgOwn)
        .reduce((s, c) => s + Math.min(c.rect.w * c.rect.h, area), 0);
      if (n.bgOwn) addMap(bgMap, hex(n.bg), Math.max(0, area - covered));
      if (n.text) {
        addMap(textMap, hex(n.fg), area);
        if (isVivid(n.fg)) addMap(vividSet, hex(n.fg), area);
      }
      const vivid = isVivid(n.bg);
      if (n.bgOwn && vivid) {
        vividArea += area;
        vividList.push({ hex: hex(n.bg), area });
        addMap(vividSet, hex(n.bg), area);
      }
      if (n.bgOwn && (vivid || n.interactive)) addMap(accentMap, hex(n.bg), area);
      walk(n.children);
    }
  };
  walk(tree);
  const attributed = [...bgMap.values()].reduce((s, v) => s + v, 0);
  if (attributed < total && pageInfo.bodyBg) addMap(bgMap, hex(pageInfo.bodyBg), total - attributed);
  const accentColors = [...vividSet.entries()].filter(([, a]) => a > 200).map(([h]) => h);
  const hues = accentColors.map((c) => Math.round(rgbToHsl(parseHex(c))[0] / 30) * 30 % 360);
  const clusters = [...new Set(hues)].sort((a, b) => a - b);
  let harmony = true;
  if (clusters.length === 3) {
    const gaps = [clusters[1] - clusters[0], clusters[2] - clusters[1], clusters[0] + 360 - clusters[2]];
    harmony = Math.min(...gaps) >= 60;
  } else if (clusters.length > 3) harmony = false;
  return {
    total,
    bgTop: topN(bgMap, 2).map(([h, a]) => ({ hex: h, share: a / total })),
    textTop: topN(textMap, 2).map(([h, a]) => ({ hex: h, share: a / total })),
    accentTop: topN(accentMap, 3).map(([h, a]) => ({ hex: h, share: a / total })),
    accentArea: [...accentMap.values()].reduce((s, v) => s + v, 0) / total,
    vividArea: vividArea / total,
    vividTop: vividList.sort((a, b) => b.area - a.area).slice(0, 3),
    accentColors,
    hueClusters: clusters,
    harmony
  };
}

/** "#rrggbb" → rgb 数组（computePalette 内聚簇时的逆向解析） */
export function parseHex(h) {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

/** 调色板 → 报告 "Palette ..." 一行（压缩为 token 友好的单行文本，LLM 回流输入） */
export function paletteLine(p) {
  const pct = (v) => Math.round(v * 100) + '%';
  const bg = p.bgTop.map((x) => `${x.hex} ${pct(x.share)}`).join('|');
  const tx = p.textTop.map((x) => `${x.hex} ${pct(x.share)}`).join('|');
  const ac = p.accentTop.map((x) => `${x.hex} ${pct(x.share)}`).join('|');
  const hues = p.hueClusters.map((h) => h + '°').join('/') || '-';
  const harm = p.hueClusters.length >= 3 ? (p.harmony ? '和声OK' : '无和声') : '和声OK';
  return `Palette bg:${bg} | text:${tx} | accent:${ac} | accentArea:${pct(p.accentArea)} | accentHues:${hues} ${harm}`;
}
