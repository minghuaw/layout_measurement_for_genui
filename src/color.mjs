const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

export function hex(rgb) {
  return '#' + [rgb[0], rgb[1], rgb[2]].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}

export function parseColorStr(s) {
  const m = s && s.match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;
  const p = m[1].split(',').map((v) => parseFloat(v));
  if (p.length < 3 || p.slice(0, 3).some((v) => Number.isNaN(v))) return null;
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

export function blendFg(f, bg) {
  if (!f || f.a <= 0) return [bg[0], bg[1], bg[2]];
  const a = f.a;
  return [f.r * a + bg[0] * (1 - a), f.g * a + bg[1] * (1 - a), f.b * a + bg[2] * (1 - a)];
}

export function luminance(rgb) {
  const lin = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

export function contrastRatio(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

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

export function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function isVivid(rgb) {
  const [, s, l] = rgbToHsl(rgb);
  return s >= 0.5 && l >= 0.2 && l <= 0.8;
}

export function suggestAccessible(fg, bg, target = 4.5) {
  const [h, s, l] = rgbToHsl(fg);
  const darken = luminance(bg) > 0.18;
  let lo = darken ? 0 : l;
  let hi = darken ? l : 1;
  let best = darken ? [0, 0, 0] : [255, 255, 255];
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const c = hslToRgb(h, s, mid);
    if (contrastRatio(c, bg) >= target) {
      best = c;
      if (darken) hi = mid; else lo = mid;
    } else {
      if (darken) lo = mid; else hi = mid;
    }
  }
  return hex(best);
}

const addMap = (m, key, val) => m.set(key, (m.get(key) || 0) + val);
const topN = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

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

export function parseHex(h) {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

export function paletteLine(p) {
  const pct = (v) => Math.round(v * 100) + '%';
  const bg = p.bgTop.map((x) => `${x.hex} ${pct(x.share)}`).join('|');
  const tx = p.textTop.map((x) => `${x.hex} ${pct(x.share)}`).join('|');
  const ac = p.accentTop.map((x) => `${x.hex} ${pct(x.share)}`).join('|');
  const hues = p.hueClusters.map((h) => h + '°').join('/') || '-';
  const harm = p.hueClusters.length >= 3 ? (p.harmony ? '和声OK' : '无和声') : '和声OK';
  return `Palette bg:${bg} | text:${tx} | accent:${ac} | accentArea:${pct(p.accentArea)} | accentHues:${hues} ${harm}`;
}
