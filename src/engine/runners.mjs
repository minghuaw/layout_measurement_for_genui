/**
 * runners.mjs —— 四类执行器（执行层的"遍历机器"）
 *
 * 每种执行器负责一种遍历/分组形态，把规则声明中的 detect 谓词应用到对应事实集：
 *   - node      单节点遍历（ELEMENT_OVERFLOW/TAP_TARGET/CONTRAST_LOW 等）
 *   - pair      同容器兄弟两两组合（OVERLAP）
 *   - container 容器内兄弟数组整体（SPACING）
 *   - textGroup 排版分组数组（FONT/COLOR/WEIGHT 一致性）
 *   - listGroup 列表分组对象 {items,...}（ALIGN/SIZE/RADIUS 一致性、卡片类）
 *   - page      全页事实集（palette/cssom/voidBands 等页面级规则）
 * 统一抑制：detect 返回 null / 单对象 / 数组均被归一为数组，避免规则层重复样板代码。
 */

/** detect 返回值归一：null/undefined → []；单对象 → 单元素数组（规则层可自由返回） */
const asArray = (v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);

export const runners = {
  /** 单节点：可选 when 谓词预筛，命中结果收集 */
  node: (rule, T, facts) => {
    const out = [];
    for (const n of facts.allNodes) {
      if (rule.when && !rule.when(n, facts)) continue;
      out.push(...asArray(rule.detect(n, T, facts)));
    }
    return out;
  },
  /** 兄弟两两组合：每个容器内所有无序元素对（重叠检测） */
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
  /** 容器整体：子节点数组一次传入（间距一致性） */
  container: (rule, T, facts) => {
    const out = [];
    for (const c of facts.containers) {
      out.push(...asArray(rule.detect(c.children, T, facts, c.parentLabel)));
    }
    return out;
  },
  /** 排版分组：按 textGroups 键逐组传入（FONT/COLOR/WEIGHT/LINE_HEIGHT 一致性） */
  textGroup: (rule, T, facts) => {
    const out = [];
    for (const [key, arr] of facts.textGroups) {
      out.push(...asArray(rule.detect(arr, T, facts, key)));
    }
    return out;
  },
  /** 列表分组：整组对象 {items, key, parent} 传入（对齐/尺寸/圆角/比例/卡片类） */
  listGroup: (rule, T, facts) => {
    const out = [];
    for (const g of facts.listGroups) {
      out.push(...asArray(rule.detect(g, T, facts)));
    }
    return out;
  },
  /** 原始列表桶（不做结构分区）：供自带结构路径匹配的规则（GROUP_CHILD_ALIGN / IMG_SIZE_INCONSISTENT） */
  pathGroup: (rule, T, facts) => {
    const out = [];
    for (const g of facts.pathGroups) {
      out.push(...asArray(rule.detect(g, T, facts)));
    }
    return out;
  },
  /** 页面级：整个 facts 一次传入（调色板/CSSOM/空白带/密度/平衡等） */
  page: (rule, T, facts) => asArray(rule.detect(facts, T))
};
