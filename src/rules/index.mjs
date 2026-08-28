import { basicRules } from './layer-basic.mjs';
import { orderRules } from './layer-order.mjs';
import { rhythmRules } from './layer-rhythm.mjs';
import { harmonyRules } from './layer-harmony.mjs';
import { refineRules } from './layer-refine.mjs';

export const RULES = [...basicRules, ...orderRules, ...rhythmRules, ...harmonyRules, ...refineRules];
