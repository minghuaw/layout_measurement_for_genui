/**
 * util.mjs —— 执行层/规则层共用小工具（纯函数）
 */

/** 取整（消息文案中的尺寸显示） */
export const r0 = (n) => Math.round(n);
/** 数组极差 max-min（≥2 元素才有意义；一致性规则的核心统计量） */
export const spread = (arr) => (arr.length >= 2 ? Math.max(...arr) - Math.min(...arr) : 0);
/** 节点标签 "tag#id.cls"（报告树与消息文案共用） */
export const label = (n) => n.tag + (n.id ? '#' + n.id : '') + (n.cls ? '.' + n.cls : '');
/** 比率 → 百分数串（Palette 行 / 面积占比消息） */
export const pct = (v) => Math.round(v * 100) + '%';
