/**
 * engine/index.mjs —— 执行层编排（runAll）
 *
 * 流程：buildFacts 建索引 → 按 [配置开关 + 层级开关] 过滤规则 →
 *   按规则 runner 字段分发到对应执行器 → 命中封装为 issue 并排序。
 * 设计原则：执行层不认识具体规则（只按 runner 字段调用 detect），
 *   规则声明（rules/）与判据数值（config/）完全分离。
 */
import { RULES } from '../rules/index.mjs';
import { makeIssue, LAYERS, SEVERITY_ORDER } from '../schema.mjs';
import { buildFacts } from './facts.mjs';
import { runners } from './runners.mjs';

/** runAll —— 全量规则判定入口（metrics.mjs 门面委托至此） */
export function runAll(geometry, cfg) {
  const facts = buildFacts(geometry, cfg);
  /* 整层关闭集合（cfg.layers 中 enabled:false 的层，规则级 enabled 在循环内判定） */
  const layerOff = new Set(
    Object.entries(cfg.layers || {})
      .filter(([, v]) => v && v.enabled === false)
      .map(([k]) => k)
  );
  const issues = [];
  for (const rule of RULES) {
    const rc = cfg.rules[rule.id];
    if (!rc || rc.enabled === false) continue;
    if (layerOff.has(rule.layer)) continue;
    const T = rc.thresholds || {};
    const severity = rc.severity || rule.severity;
    const hits = runners[rule.runner](rule, T, facts);
    for (const h of hits) issues.push(makeIssue(rule, severity, rule.message(h, T, facts)));
  }
  /* 排序：先按 layer 顺序（L1→L5），同层内按 severity（error→warn→info） */
  issues.sort((a, b) => {
    const la = LAYERS[a.layer].order - LAYERS[b.layer].order;
    if (la !== 0) return la;
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  });
  return issues;
}
