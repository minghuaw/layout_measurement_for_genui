import { RULES } from '../rules/index.mjs';
import { makeIssue, LAYERS, SEVERITY_ORDER } from '../schema.mjs';
import { buildFacts } from './facts.mjs';
import { runners } from './runners.mjs';

export function runAll(geometry, cfg) {
  const facts = buildFacts(geometry, cfg);
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
  issues.sort((a, b) => {
    const la = LAYERS[a.layer].order - LAYERS[b.layer].order;
    if (la !== 0) return la;
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  });
  return issues;
}
