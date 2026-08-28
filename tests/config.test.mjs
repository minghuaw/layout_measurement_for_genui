import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { RULES } from '../src/rules/index.mjs';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const TMP = join(DIR, '.tmp.config.json');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}
const layerOf = (id) => RULES.find((r) => r.id === id)?.layer;

console.log('G1 文件覆盖');
writeFileSync(TMP, JSON.stringify({
  rules: {
    TAP_TARGET: { thresholds: { TAP_MIN: 48 } },
    GRAY_UNTINTED: { enabled: false },
    LINE_HEIGHT_TIGHT: { severity: 'error' }
  }
}));
{
  const { cfg, echo } = loadConfig({ METRICS_CONFIG: TMP });
  check('阈值覆盖 TAP_MIN=48', cfg.rules.TAP_TARGET.thresholds.TAP_MIN === 48);
  check('开关覆盖 GRAY_UNTINTED 关闭', cfg.rules.GRAY_UNTINTED.enabled === false);
  check('severity 覆盖为 error', cfg.rules.LINE_HEIGHT_TIGHT.severity === 'error');
  check('echo 含覆盖数', echo.includes('处覆盖'), echo);
}
rmSync(TMP, { force: true });

console.log('G2 整层开关');
{
  const { cfg } = loadConfig({ METRICS_OFF: 'L5' });
  check('L5 层被禁用', cfg.layers.L5?.enabled === false);
  const l5 = RULES.filter((r) => r.layer === 'L5');
  check('L5 共 11 条', l5.length === 11, `count=${l5.length}`);
  check('L1 规则 enabled 不受影响', cfg.rules.TAP_TARGET.enabled === true);
}

console.log('G3 环境变量 ON');
{
  const { cfg } = loadConfig({ METRICS_ON: 'TYPE_SCALE,CONTRAST_AAA' });
  check('TYPE_SCALE 启用', cfg.rules.TYPE_SCALE.enabled === true);
  check('CONTRAST_AAA 启用', cfg.rules.CONTRAST_AAA.enabled === true);
  check('其余 aspirational 仍关闭', cfg.rules.SPACING_8PT.enabled === false);
}

console.log('G4 非法配置报错');
{
  let threw = false;
  try { loadConfig({ METRICS_OFF: 'NOT_A_RULE' }); } catch { threw = true; }
  check('未知规则 ID 报错', threw);

  threw = false;
  writeFileSync(TMP, JSON.stringify({ rules: { TAP_TARGET: { thresholds: { TAP_MIN: 'big' } } } }));
  try { loadConfig({ METRICS_CONFIG: TMP }); } catch { threw = true; }
  check('阈值类型错误报错', threw);

  threw = false;
  writeFileSync(TMP, JSON.stringify({ rules: { TAP_TARGET: { enabled: 'yes' } } }));
  try { loadConfig({ METRICS_CONFIG: TMP }); } catch { threw = true; }
  check('enabled 非布尔报错', threw);
  rmSync(TMP, { force: true });
}

console.log('G5 默认态与注册表一致性');
{
  const { cfg } = loadConfig({});
  const ids = RULES.map((r) => r.id);
  const missing = ids.filter((id) => !cfg.rules[id]);
  check('44+ 规则全有默认配置项', missing.length === 0, missing.join(','));
  const enabledCount = RULES.filter((r) => cfg.rules[r.id].enabled !== false).length;
  const total = RULES.length;
  console.log(`  注册表共 ${total} 条规则，默认启用 ${enabledCount} 条（L5 三条 aspirational 默认关闭）`);
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
