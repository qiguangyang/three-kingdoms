import type { Scenario } from '../../engine/types.js';

export const SCENARIO_JUNXIONG: Scenario = {
  id: 's2-junxiong',
  name: { zh: '群雄逐鹿', en: 'Heroes Contend' },
  description: {
    zh: '196 年 1 月,曹操迎天子,袁绍坐拥河北。(占位,未实现)',
    en: 'January 196 CE. Cao Cao welcomes the emperor; Yuan Shao dominates Hebei. (stub)',
  },
  startYear: 196,
  startMonth: 1,
  factions: [],
  victory: { kind: 'unify' },
  todo: true,
};
