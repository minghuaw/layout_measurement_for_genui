/**
 * schema.mjs —— issue 构造与元数据（L1-L5 层级 / 三级 severity）
 *
 * 职责：
 *   - LAYERS：五层美学体系的有序注册表（渲染分组 + 排序依据）
 *   - SEVERITY_ORDER / SEVERITIES：error < warn < info 三级
 *   - makeIssue：统一 issue 对象形状 { type, layer, severity, theory, msg }
 *     （[TYPE] 行 / compare.mjs / style_eval 均依赖 type 字段不变）
 */

/** 五层美学体系（L1 基础规范 → L5 质感精致），order 决定报告/排序顺序 */
export const LAYERS = {
  L1: { order: 1, name: 'L1 基础规范' },
  L2: { order: 2, name: 'L2 结构秩序' },
  L3: { order: 3, name: 'L3 空间节奏' },
  L4: { order: 4, name: 'L4 色彩和谐' },
  L5: { order: 5, name: 'L5 质感精致' }
};

/** severity 排序权重（越小越靠前） */
export const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
/** 合法 severity 值集合（配置校验用） */
export const SEVERITIES = ['error', 'warn', 'info'];

/** makeIssue —— 由规则命中构造标准 issue 对象（layer 继承规则声明，severity 可被配置覆盖） */
export function makeIssue(rule, severity, msg) {
  return { type: rule.id, layer: rule.layer, severity, theory: rule.theory || '', msg };
}
