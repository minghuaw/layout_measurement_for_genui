export const r0 = (n) => Math.round(n);
export const spread = (arr) => (arr.length >= 2 ? Math.max(...arr) - Math.min(...arr) : 0);
export const label = (n) => n.tag + (n.id ? '#' + n.id : '') + (n.cls ? '.' + n.cls : '');
export const pct = (v) => Math.round(v * 100) + '%';
