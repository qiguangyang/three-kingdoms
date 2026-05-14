import type { Scenario } from '../../engine/types.js';

export const SCENARIO_CHIBI: Scenario = {
  id: 's3-chibi',
  name: { zh: '赤壁之战', en: 'Battle of Red Cliffs' },
  description: {
    zh: '208 年 7 月,曹操南下。(占位,未实现)',
    en: 'July 208 CE. Cao Cao marches south. (stub)',
  },
  startYear: 208,
  startMonth: 7,
  factions: [],
  victory: { kind: 'unify' },
  todo: true,
};
