export const LAYERS = {
  L1: { order: 1, name: 'L1 基础规范' },
  L2: { order: 2, name: 'L2 结构秩序' },
  L3: { order: 3, name: 'L3 空间节奏' },
  L4: { order: 4, name: 'L4 色彩和谐' },
  L5: { order: 5, name: 'L5 质感精致' }
};

export const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };
export const SEVERITIES = ['error', 'warn', 'info'];

export function makeIssue(rule, severity, msg) {
  return { type: rule.id, layer: rule.layer, severity, theory: rule.theory || '', msg };
}
