/**
 * rules/index.mjs —— 规则注册表
 *
 * 聚合五层声明文件为单一 RULES 数组（顺序即声明顺序）：
 *   [L1 基础规范 ×12] + [L2 结构秩序 ×16] + [L3 空间节奏 ×12]
 *   + [L4 色彩和谐 ×8] + [L5 质感精致 ×11] = 59 条
 * config.mjs 用其派生合法 ID 清单；engine 用其作为规则遍历源。
 */
import { basicRules } from './layer-basic.mjs';
import { orderRules } from './layer-order.mjs';
import { rhythmRules } from './layer-rhythm.mjs';
import { harmonyRules } from './layer-harmony.mjs';
import { refineRules } from './layer-refine.mjs';

export const RULES = [...basicRules, ...orderRules, ...rhythmRules, ...harmonyRules, ...refineRules];
