import type { Scenario } from '../../engine/types.js';

export const SCENARIO_DINGLI: Scenario = {
  id: 's4-dingli',
  name: { zh: '三国鼎立', en: 'Tripartite Stalemate' },
  description: {
    zh: '220 年 10 月,曹丕称帝,蜀汉东吴对峙。(占位,未实现)',
    en: 'October 220 CE. Cao Pi proclaims himself emperor; Shu Han and Eastern Wu face off. (stub)',
  },
  startYear: 220,
  startMonth: 10,
  factions: [],
  victory: { kind: 'unify' },
  todo: true,
};
