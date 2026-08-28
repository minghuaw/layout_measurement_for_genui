const asArray = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);

export const runners = {
  node: (rule, T, facts) => {
    const out = [];
    for (const n of facts.allNodes) {
      if (rule.when && !rule.when(n, facts)) continue;
      out.push(...asArray(rule.detect(n, T, facts)));
    }
    return out;
  },
  pair: (rule, T, facts) => {
    const out = [];
    for (const c of facts.containers) {
      const sibs = c.children;
      for (let i = 0; i < sibs.length; i++) {
        for (let j = i + 1; j < sibs.length; j++) {
          out.push(...asArray(rule.detect(sibs[i], sibs[j], T, facts, c.parentLabel)));
        }
      }
    }
    return out;
  },
  container: (rule, T, facts) => {
    const out = [];
    for (const c of facts.containers) {
      out.push(...asArray(rule.detect(c.children, T, facts, c.parentLabel)));
    }
    return out;
  },
  textGroup: (rule, T, facts) => {
    const out = [];
    for (const [key, arr] of facts.textGroups) {
      out.push(...asArray(rule.detect(arr, T, facts, key)));
    }
    return out;
  },
  listGroup: (rule, T, facts) => {
    const out = [];
    for (const g of facts.listGroups) {
      out.push(...asArray(rule.detect(g, T, facts)));
    }
    return out;
  },
  page: (rule, T, facts) => asArray(rule.detect(facts, T))
};
