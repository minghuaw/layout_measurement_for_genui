/**
 * util.mjs —— 执行层/规则层共用小工具（纯函数）
 */

/** 取整（消息文案中的尺寸显示） */
export const r0 = (n) => Math.round(n);
/** 数组极差 max-min（≥2 元素才有意义；一致性规则的核心统计量） */
export const spread = (arr) => (arr.length >= 2 ? Math.max(...arr) - Math.min(...arr) : 0);
/** 节点标签 "tag#id.cls[tid]#ord"（报告树与消息文案共用；tid = data-test* 锚点值，
 *  ord = 同标签渲染兄弟序号 —— 对应 .map() 迭代序，源码可对应） */
export const label = (n) =>
  n.tag + (n.id ? '#' + n.id : '') + (n.cls ? '.' + n.cls : '') + (n.tid ? '[' + n.tid + ']' : '') + (n.ord ? '#' + n.ord : '');
/** 元素定位串：label + 文本锚（≤10 字）——全部为源码可对应锚点（文本/testid/类名/序号）；
 *  像素坐标不进消息（生成模型只见源码不见渲染，几何信息在事实树中查询） */
export const loc = (n) => {
  const t = (n.text || '').replace(/\s+/g, ' ').trim().slice(0, 10);
  return label(n) + (t ? '“' + t + '”' : '');
};
/** 比率 → 百分数串（Palette 行 / 面积占比消息） */
export const pct = (v) => Math.round(v * 100) + '%';
/** 中位数（GROUP_CHILD_ALIGN / IMG_SIZE_INCONSISTENT 偏离统计共用） */
export const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
/** 结构签名：子树骨架的规范化串（逐层 tag+首类，文本/几何不参与）。
 *  同构兄弟归同组、异构不跨组比较——页面级不同角色兄弟（hero/列表/徽标区）
 *  骨架各异，混入同组会让尺寸/比例类规则跨角色误报 */
export const structuralSignature = (n) => {
  const own = n.tag + (n.cls ? '.' + n.cls.split('.')[0] : '');
  if (!n.children.length) return own;
  return own + '[' + n.children.map(structuralSignature).join(',') + ']';
};
/** 结构路径收集：以 item 为根 DFS，产出每个命中节点的跨项匹配路径
 *  （逐层 tag+首类签名+出现序，同 GROUP_CHILD_ALIGN 的路径方案） */
export const collectByPath = (item, isTarget) => {
  const out = [];
  const walk = (n, path) => {
    if (isTarget(n)) out.push({ path: path || 'root', node: n });
    const occ = new Map();
    for (const c of n.children) {
      const sig = c.tag + (c.cls ? '.' + c.cls.split('.')[0] : '');
      const k = occ.get(sig) || 0;
      occ.set(sig, k + 1);
      walk(c, (path ? path + ' > ' : '') + sig + '#' + k);
    }
  };
  walk(item, '');
  return out;
};
