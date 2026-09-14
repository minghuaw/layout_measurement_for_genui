/**
 * config.mjs —— 判据配置层（DEFAULTS + loader + 零依赖校验器）
 *
 * 职责：
 *   1. DEFAULTS：全量规则默认值表（每数字带出处注释：WCAG/HIG/Tailwind/60-30-10 等）
 *   2. loader 四级优先级：内置默认 < metrics.config.json（根目录自动发现）
 *      < METRICS_CONFIG=path 指定 < 环境变量 METRICS_OFF / METRICS_ON
 *   3. 校验：未知规则 ID 报错并列合法清单、阈值键/类型检查、severity/enabled 校验、深度合并
 *
 * 设计约束：纯数据化配置，不支持 JS 规则注入（DEFAULTS 表本身即 schema）。
 * 输出：{ cfg, echo } —— cfg 为冻结语义的完整配置，echo 为报告 Config: 行回显串。
 */
import { readFileSync, existsSync } from 'node:fs';
import { SEVERITIES, LAYERS } from './schema.mjs';
import { RULES } from './rules/index.mjs';

/** 合法规则 ID / 层级清单（由注册表与 schema 派生，供校验器使用） */
const VALID_IDS = RULES.map((r) => r.id);
const VALID_LAYERS = Object.keys(LAYERS);

/** DEFAULTS —— 全量默认值表；每条规则：enabled 开关 + thresholds 判据数值（魔法数字唯一收敛处） */
export const DEFAULTS = {
  rules: {
    OVERFLOW:          { enabled: true, thresholds: {} },
    ELEMENT_OVERFLOW:  { enabled: true, thresholds: { EDGE_TOL: 1 } },
    TEXT_CLIP:         { enabled: true, thresholds: { TOL: 1 } },
    /* MIN_AREA_PCT: 交叠面积占较小元素面积比门槛（工程估值，可标定）——
       挑战集实测：负 margin 紧贴设计 ≤6.8%，真实缺陷 ≥15.5%，取 10% 分界
       EXEMPT_POS: 定位分层豁免名单——absolute/fixed 交叠视为有意分层不报 */
    OVERLAP:           { enabled: true, thresholds: { MIN_W: 0.5, MIN_H: 0.5, MIN_AREA_PCT: 0.1, EXEMPT_POS: ['absolute', 'fixed'] } },
    TAP_TARGET:        { enabled: true, thresholds: { TAP_MIN: 44 } },
    CONTRAST_LOW:      { enabled: true, thresholds: { RATIO_NORMAL: 4.5, RATIO_LARGE: 3, LARGE_FS: 24 } },
    GRADIENT_CONTRAST: { enabled: true, thresholds: { RATIO_NORMAL: 4.5, RATIO_LARGE: 3, LARGE_FS: 24 } },
    IMG_BROKEN:        { enabled: true, thresholds: {} },
    SVG_ICON_HINT:     { enabled: true, thresholds: { RATIO: 3, ICON_MAX: 48 } },
    MEDIA_COVERED:     { enabled: true, thresholds: { MIN_COVER: 0.3, COVER_ALPHA: 0.5 } },
    TEXT_COVERED:      { enabled: true, thresholds: { MIN_COVER: 0.3, COVER_ALPHA: 0.5 } },
    MIN_FONT_SIZE:     { enabled: true, thresholds: { MIN_FS: 10 } },
    FOCUS_INVISIBLE:   { enabled: true, thresholds: {} },
    GREY_ON_COLOR:     { enabled: true, thresholds: { BG_MIN_S: 0.15, FG_MAX_S: 0.03 } },
    LINK_INDISTINCT:   { enabled: true, thresholds: {} },
    ALIGN_INCONSISTENT:{ enabled: true, thresholds: { DIFF: 4 } },
    SIZE_INCONSISTENT: { enabled: true, thresholds: { DIFF: 6 } },
    /* GROUP_CHILD_ALIGN: 重复项内对应子元素几何一致性的容差 px（结构路径匹配）；
       TEXT_MIN_LEN: 子树文本长度 ≥ 该值视为「文本驱动」子元素（其 h/dy 或 w/dx 偏移
       归因于内容长度换行，按文字方向豁免）——图标/图片等无文本结构性子元素不豁免 */
    GROUP_CHILD_ALIGN: { enabled: true, thresholds: { TOL: 8, TEXT_MIN_LEN: 1 } },
    RADIUS_INCONSISTENT:{ enabled: true, thresholds: { DIFF: 2 } },
    FONT_INCONSISTENT: { enabled: true, thresholds: { DIFF: 1 } },
    COLOR_INCONSISTENT:{ enabled: true, thresholds: {} },
    SPACING:           { enabled: true, thresholds: { SPREAD: 24 } },
    LINE_HEIGHT_TIGHT: { enabled: true, thresholds: { LH_MIN: 1.2 } },
    RADIUS_SCALE_OFF:  { enabled: true, thresholds: { SCALE: [2, 4, 6, 8, 12, 16, 24], MIN_DISTINCT: 2 } },
    BORDER_INCONSISTENT:{ enabled: true, thresholds: {} },
    BORDER_OVERUSE:    { enabled: true, thresholds: { MAX_RATIO: 0.5 } },
    WEIGHT_INCONSISTENT:{ enabled: true, thresholds: {} },
    HSCROLL_EDGE_SPACING: { enabled: true, thresholds: { MIN_LEFT: 12 } },
    TEXT_SQUISHED: { enabled: true, thresholds: { EST_RATIO: 0.7, H_W_RATIO: 2 } },
    FONT_FAMILY_BLOAT: { enabled: true, thresholds: { MAX: 2 } },
    GRAY_SHADE_BLOAT:  { enabled: true, thresholds: { MAX: 5, GRAY_S: 0.08 } },
    CONTROL_TEXT_CENTER: { enabled: true, thresholds: { MAX: 4 } },
    CHART_TOP_CLIP:    { enabled: true, thresholds: { H_MIN: 80, H_MAX: 320 } },
    CHART_OVER_PARENT: { enabled: true, thresholds: { TOL: 3 } },
    CHART_TEXT_CONTRAST: { enabled: true, thresholds: { RATIO: 4.5 } },
    CHART_DEGENERATE: { enabled: true, thresholds: { W_MIN: 150, H_MAX: 40 } },
    VOID_BAND:         { enabled: true, thresholds: { MIN: 96 } },
    CARD_VOID:         { enabled: true, thresholds: { RATIO: 0.6, BOTTOM: 40, BOTTOM_PCT: 0.25 } },
    ASPECT_INCONSISTENT:{ enabled: true, thresholds: { SPREAD: 0.3 } },
    ASPECT_EXTREME:    { enabled: true, thresholds: { MAX: 3, MIN: 0.15 } },
    IMG_SIZE_INCONSISTENT:{ enabled: true, thresholds: { DIFF: 2 } },
    LINE_LENGTH:       { enabled: true, thresholds: { MIN_CPL: 12, MAX_CPL: 60, MIN_TEXT: 20 } },
    DENSITY_EXTREME:   { enabled: true, thresholds: { MIN: 3, MAX: 80 } },
    BALANCE_OFF:       { enabled: true, thresholds: { MAX_IMBALANCE: 0.25 } },
    MEDIA_GUTTER:      { enabled: true, thresholds: { GUTTER: 96 } },
    RELATED_SPLIT:     { enabled: true, thresholds: { GAP_MAX: 32, CENTER_MAX: 12 } },
    CHART_OVER_TALL:   { enabled: true, thresholds: { MIN_H: 220, RATIO: 0.3 } },
    CHART_Y_RANGE:     { enabled: true, thresholds: { MIN_FRAC: 0.5, MAX_SPAN_RATIO: 4, PAD: 0.1 } },
    COLOR_DOMINANCE:   { enabled: true, thresholds: { MIN_BG: 0.4, MAX_ACCENT: 0.15 } },
    HARMONY_OFF:       { enabled: true, thresholds: {} },
    GARISH_SATURATION: { enabled: true, thresholds: { MAX_AREA: 0.2 } },
    ACCENT_BLOAT:      { enabled: true, thresholds: { MAX: 6 } },
    GRAY_UNTINTED:     { enabled: true, thresholds: { MAX_S: 0.03, L_MIN: 0.25, L_MAX: 0.7 } },
    SHADE_UNSYSTEMATIC:{ enabled: true, thresholds: { MAX_SHADES: 4 } },
    GRADIENT_BG:      { enabled: true, thresholds: {} },
    CHART_DATA_COLOR: { enabled: true, thresholds: { MAX_HUE: 60 } },
    SHADOW_INCONSISTENT:{ enabled: true, thresholds: { MAX_DISTINCT_BLUR: 3 } },
    SHADOW_DIR_CONFLICT:{ enabled: true, thresholds: {} },
    SHADOW_OVERKILL:   { enabled: true, thresholds: { MAX_ALPHA: 0.35, MAX_LAYERS: 2 } },
    GLASS_NO_BLUR:     { enabled: true, thresholds: { MIN_AREA: 2000, ALPHA_MIN: 0.05, ALPHA_MAX: 0.9 } },
    GLASS_BAD_RANGE:   { enabled: true, thresholds: { MIN: 4, MAX: 24 } },
    MOTION_DURATION_OFF:{ enabled: true, thresholds: { MIN_MS: 100, MAX_MS: 500 } },
    MOTION_ALL_PROPERTY:{ enabled: true, thresholds: {} },
    MOTION_MISSING:   { enabled: true, thresholds: {} },
    TYPE_SCALE:        { enabled: false, thresholds: { RATIO_MIN: 1.12, RATIO_MAX: 1.45, MIN_VIOLATIONS: 2 } },
    SPACING_8PT:       { enabled: false, thresholds: { GRID: 4, MIN_ELEMS: 3 } },
    CONTRAST_AAA:      { enabled: false, thresholds: { RATIO: 7 } }
  },
  layers: {}
};

/** 启动自检：注册表里每条规则必须能在 DEFAULTS 中找到配置项（防声明/判据失配） */
for (const r of RULES) {
  if (!DEFAULTS.rules[r.id]) throw new Error(`规则 "${r.id}" 缺少 DEFAULTS 配置项`);
}

/** 纯对象判定（非 null / 非数组）——配置文件各片段的结构前提 */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * applyOverride —— 把配置片段深度合并进 cfg（就地修改），并逐项校验。
 * @param stats {n} 覆盖计数（供 Config 回显 "N 处覆盖"）
 * 支持：rules.{id}.enabled / severity / thresholds.键；layers.{id}.enabled
 */
function applyOverride(cfg, frag, stats) {
  if (frag.rules) {
    if (!isPlainObject(frag.rules)) throw new Error('config.rules 必须是对象');
    for (const [id, def] of Object.entries(frag.rules)) {
      if (!VALID_IDS.includes(id)) {
        throw new Error(`未知规则 ID: "${id}"。合法清单: ${VALID_IDS.join(', ')}`);
      }
      if (!isPlainObject(def)) throw new Error(`rules.${id} 必须是对象`);
      const target = cfg.rules[id];
      if ('enabled' in def) {
        if (typeof def.enabled !== 'boolean') throw new Error(`rules.${id}.enabled 必须是布尔值`);
        target.enabled = def.enabled;
        stats.n++;
      }
      if ('severity' in def) {
        if (!SEVERITIES.includes(def.severity)) throw new Error(`rules.${id}.severity 必须是 ${SEVERITIES.join('/')}`);
        target.severity = def.severity;
        stats.n++;
      }
      if (def.thresholds) {
        if (!isPlainObject(def.thresholds)) throw new Error(`rules.${id}.thresholds 必须是对象`);
        for (const [k, v] of Object.entries(def.thresholds)) {
          if (!(k in target.thresholds)) throw new Error(`rules.${id}.thresholds 未知阈值键: "${k}"`);
          if (typeof v !== typeof target.thresholds[k]) throw new Error(`rules.${id}.thresholds.${k} 类型应为 ${typeof target.thresholds[k]}`);
          target.thresholds[k] = v;
          stats.n++;
        }
      }
    }
  }
  if (frag.layers) {
    if (!isPlainObject(frag.layers)) throw new Error('config.layers 必须是对象');
    for (const [l, def] of Object.entries(frag.layers)) {
      if (!VALID_LAYERS.includes(l)) throw new Error(`未知层级: "${l}"。合法: ${VALID_LAYERS.join(', ')}`);
      if (!isPlainObject(def)) throw new Error(`layers.${l} 必须是对象`);
      if ('enabled' in def) {
        if (typeof def.enabled !== 'boolean') throw new Error(`layers.${l}.enabled 必须是布尔值`);
        cfg.layers[l] = { enabled: def.enabled };
        stats.n++;
      }
    }
  }
}

/** 应用环境变量清单（METRICS_OFF/ON）：逗号分隔，可含层级（L5）或规则 ID；enabled 决定开关值 */
function applyEnvList(cfg, list, enabled) {
  for (const id of list) {
    if (VALID_LAYERS.includes(id)) {
      cfg.layers[id] = { enabled };
    } else if (VALID_IDS.includes(id)) {
      cfg.rules[id].enabled = enabled;
    } else {
      throw new Error(`METRICS_${enabled ? 'ON' : 'OFF'} 未知标识: "${id}"`);
    }
  }
}

/**
 * loadConfig —— 配置加载入口（进程内只调一次，全部夹具共享）
 * 优先级：DEFAULTS < metrics.config.json（自动发现）< METRICS_CONFIG < METRICS_OFF/ON
 * @returns { cfg, echo } 完整配置 + 回显串（'defaults' 或 '<path> (N 处覆盖)'）
 */
export function loadConfig(env = process.env) {
  const cfg = structuredClone(DEFAULTS);
  let source = 'defaults';
  const stats = { n: 0 };
  const cfgPath = env.METRICS_CONFIG || (existsSync('metrics.config.json') ? 'metrics.config.json' : null);
  if (cfgPath && existsSync(cfgPath)) {
    let frag;
    try {
      frag = JSON.parse(readFileSync(cfgPath, 'utf8'));
    } catch (e) {
      throw new Error(`配置文件解析失败 (${cfgPath}): ${e.message}`);
    }
    applyOverride(cfg, frag, stats);
    source = cfgPath;
  }
  if (env.METRICS_OFF) applyEnvList(cfg, env.METRICS_OFF.split(',').map((s) => s.trim()).filter(Boolean), false);
  if (env.METRICS_ON) applyEnvList(cfg, env.METRICS_ON.split(',').map((s) => s.trim()).filter(Boolean), true);
  return { cfg, echo: source === 'defaults' ? 'defaults' : `${source} (${stats.n} 处覆盖)` };
}
