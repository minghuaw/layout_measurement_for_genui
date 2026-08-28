import { readFileSync, existsSync } from 'node:fs';
import { SEVERITIES, LAYERS } from './schema.mjs';
import { RULES } from './rules/index.mjs';

const VALID_IDS = RULES.map((r) => r.id);
const VALID_LAYERS = Object.keys(LAYERS);

export const DEFAULTS = {
  rules: {
    OVERFLOW:          { enabled: true, thresholds: {} },
    ELEMENT_OVERFLOW:  { enabled: true, thresholds: { EDGE_TOL: 1 } },
    TEXT_CLIP:         { enabled: true, thresholds: { TOL: 1 } },
    OVERLAP:           { enabled: true, thresholds: { MIN_W: 0.5, MIN_H: 0.5 } },
    TAP_TARGET:        { enabled: true, thresholds: { TAP_MIN: 44 } },
    CONTRAST_LOW:      { enabled: true, thresholds: { RATIO_NORMAL: 4.5, RATIO_LARGE: 3, LARGE_FS: 24 } },
    MIN_FONT_SIZE:     { enabled: true, thresholds: { MIN_FS: 10 } },
    FOCUS_INVISIBLE:   { enabled: true, thresholds: {} },
    GREY_ON_COLOR:     { enabled: true, thresholds: { BG_MIN_S: 0.15, FG_MAX_S: 0.03 } },
    LINK_INDISTINCT:   { enabled: true, thresholds: {} },
    ALIGN_INCONSISTENT:{ enabled: true, thresholds: { DIFF: 4 } },
    SIZE_INCONSISTENT: { enabled: true, thresholds: { DIFF: 6 } },
    RADIUS_INCONSISTENT:{ enabled: true, thresholds: { DIFF: 2 } },
    FONT_INCONSISTENT: { enabled: true, thresholds: { DIFF: 1 } },
    COLOR_INCONSISTENT:{ enabled: true, thresholds: {} },
    SPACING:           { enabled: true, thresholds: { SPREAD: 24 } },
    LINE_HEIGHT_TIGHT: { enabled: true, thresholds: { LH_MIN: 1.2 } },
    RADIUS_SCALE_OFF:  { enabled: true, thresholds: { SCALE: [2, 4, 6, 8, 12, 16, 24], MIN_DISTINCT: 2 } },
    BORDER_INCONSISTENT:{ enabled: true, thresholds: {} },
    BORDER_OVERUSE:    { enabled: true, thresholds: { MAX_RATIO: 0.5 } },
    WEIGHT_INCONSISTENT:{ enabled: true, thresholds: {} },
    FONT_FAMILY_BLOAT: { enabled: true, thresholds: { MAX: 2 } },
    GRAY_SHADE_BLOAT:  { enabled: true, thresholds: { MAX: 5, GRAY_S: 0.08 } },
    VOID_BAND:         { enabled: true, thresholds: { MIN: 96 } },
    CARD_VOID:         { enabled: true, thresholds: { RATIO: 0.6, BOTTOM: 40, BOTTOM_PCT: 0.25 } },
    ASPECT_INCONSISTENT:{ enabled: true, thresholds: { SPREAD: 0.3 } },
    ASPECT_EXTREME:    { enabled: true, thresholds: { MAX: 3, MIN: 0.15 } },
    IMG_SIZE_INCONSISTENT:{ enabled: true, thresholds: { DIFF: 2 } },
    LINE_LENGTH:       { enabled: true, thresholds: { MIN_CPL: 12, MAX_CPL: 60, MIN_TEXT: 20 } },
    DENSITY_EXTREME:   { enabled: true, thresholds: { MIN: 3, MAX: 80 } },
    BALANCE_OFF:       { enabled: true, thresholds: { MAX_IMBALANCE: 0.25 } },
    COLOR_DOMINANCE:   { enabled: true, thresholds: { MIN_BG: 0.4, MAX_ACCENT: 0.15 } },
    HARMONY_OFF:       { enabled: true, thresholds: {} },
    GARISH_SATURATION: { enabled: true, thresholds: { MAX_AREA: 0.2 } },
    ACCENT_BLOAT:      { enabled: true, thresholds: { MAX: 6 } },
    GRAY_UNTINTED:     { enabled: true, thresholds: { MAX_S: 0.03, L_MIN: 0.25, L_MAX: 0.7 } },
    SHADE_UNSYSTEMATIC:{ enabled: true, thresholds: { MAX_SHADES: 4 } },
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

for (const r of RULES) {
  if (!DEFAULTS.rules[r.id]) throw new Error(`规则 "${r.id}" 缺少 DEFAULTS 配置项`);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

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
