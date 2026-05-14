import type { Scenario } from '../../engine/types.js';
import { SCENARIO_DONGZHUO } from './s1-dongzhuo.js';
import { SCENARIO_JUNXIONG } from './s2-junxiong.js';
import { SCENARIO_CHIBI } from './s3-chibi.js';
import { SCENARIO_DINGLI } from './s4-dingli.js';

export const SCENARIOS: Record<string, Scenario> = {
  's1-dongzhuo': SCENARIO_DONGZHUO,
  's2-junxiong': SCENARIO_JUNXIONG,
  's3-chibi': SCENARIO_CHIBI,
  's4-dingli': SCENARIO_DINGLI,
};

export const SCENARIO_LIST: Scenario[] = [
  SCENARIO_DONGZHUO,
  SCENARIO_JUNXIONG,
  SCENARIO_CHIBI,
  SCENARIO_DINGLI,
];

export { SCENARIO_DONGZHUO, SCENARIO_JUNXIONG, SCENARIO_CHIBI, SCENARIO_DINGLI };
