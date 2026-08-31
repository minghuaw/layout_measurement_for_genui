/**
 * metrics.mjs —— 度量门面（降级入口）
 *
 * 职责：对调用方暴露稳定签名 runMetrics(data, cfg?) → issues[]，
 *   内部一行委托给 engine/（buildFacts + 规则分发 + 汇总）。
 * 存在意义：collect.mjs / 历史调用点零改动（重构前为 344 行上帝文件，现仅为兼容壳）。
 */
import { runAll } from './engine/index.mjs';

export function runMetrics(data, cfg) {
  return runAll(data, cfg);
}
