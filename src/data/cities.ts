import type { City } from '../engine/types.js';

// Forty cities placed on the 100x40 grid. Coordinates and primary terrain
// follow SCENARIOS.md §1. Initial economy is set to a modest baseline; the
// scenario file overrides with faction-specific resources.

interface CityDef {
  id: string;
  zh: string;
  en: string;
  x: number;
  y: number;
  terrain: City['terrain'];
  agriculture: number;
  commerce: number;
  defense: number;
  loyalty: number;
}

const CITY_DEFS: CityDef[] = [
  // Liangzhou (northwest)
  { id: 'xiliang',  zh: '西凉', en: 'Xiliang',  x: 5,  y: 13, terrain: ['plain', 'mountain'], agriculture: 35, commerce: 50, defense: 55, loyalty: 60 },
  { id: 'anding',   zh: '安定', en: 'Anding',   x: 12, y: 15, terrain: ['mountain'],          agriculture: 40, commerce: 35, defense: 65, loyalty: 60 },
  { id: 'tianshui', zh: '天水', en: 'Tianshui', x: 10, y: 18, terrain: ['plain'],             agriculture: 55, commerce: 40, defense: 55, loyalty: 60 },

  // Siliyuan (capital region)
  { id: 'changan',  zh: '长安', en: 'Changan',  x: 20, y: 17, terrain: ['plain'],             agriculture: 80, commerce: 80, defense: 75, loyalty: 65 },
  { id: 'luoyang',  zh: '洛阳', en: 'Luoyang',  x: 30, y: 17, terrain: ['plain', 'river'],    agriculture: 85, commerce: 90, defense: 80, loyalty: 70 },
  { id: 'henei',    zh: '河内', en: 'Henei',    x: 35, y: 15, terrain: ['plain'],             agriculture: 65, commerce: 60, defense: 60, loyalty: 65 },
  { id: 'hongnong', zh: '弘农', en: 'Hongnong', x: 25, y: 18, terrain: ['mountain'],          agriculture: 50, commerce: 45, defense: 70, loyalty: 60 },

  // Bingzhou
  { id: 'jinyang',  zh: '晋阳', en: 'Jinyang',  x: 30, y: 10, terrain: ['mountain'],          agriculture: 55, commerce: 50, defense: 70, loyalty: 60 },
  { id: 'shangdang',zh: '上党', en: 'Shangdang',x: 35, y: 12, terrain: ['mountain'],          agriculture: 45, commerce: 40, defense: 65, loyalty: 55 },

  // Youzhou
  { id: 'beiping',  zh: '北平', en: 'Beiping',  x: 60, y: 5,  terrain: ['plain', 'mountain'], agriculture: 55, commerce: 50, defense: 70, loyalty: 65 },
  { id: 'xiangping',zh: '襄平', en: 'Xiangping',x: 75, y: 3,  terrain: ['plain'],             agriculture: 45, commerce: 35, defense: 60, loyalty: 55 },

  // Jizhou
  { id: 'yecheng',  zh: '邺城', en: 'Yecheng',  x: 48, y: 12, terrain: ['plain'],             agriculture: 85, commerce: 80, defense: 75, loyalty: 70 },
  { id: 'nanpi',    zh: '南皮', en: 'Nanpi',    x: 58, y: 10, terrain: ['plain'],             agriculture: 75, commerce: 60, defense: 60, loyalty: 65 },
  { id: 'pingyuan', zh: '平原', en: 'Pingyuan', x: 55, y: 15, terrain: ['plain'],             agriculture: 65, commerce: 55, defense: 55, loyalty: 60 },
  { id: 'beihai',   zh: '北海', en: 'Beihai',   x: 63, y: 18, terrain: ['plain'],             agriculture: 60, commerce: 65, defense: 55, loyalty: 60 },

  // Yanzhou / Yuzhou
  { id: 'puyang',   zh: '濮阳', en: 'Puyang',   x: 45, y: 17, terrain: ['plain'],             agriculture: 70, commerce: 65, defense: 60, loyalty: 60 },
  { id: 'xuchang',  zh: '许昌', en: 'Xuchang',  x: 43, y: 20, terrain: ['plain'],             agriculture: 75, commerce: 70, defense: 65, loyalty: 65 },
  { id: 'chenliu',  zh: '陈留', en: 'Chenliu',  x: 40, y: 18, terrain: ['plain'],             agriculture: 70, commerce: 70, defense: 60, loyalty: 60 },
  { id: 'wancheng', zh: '宛城', en: 'Wancheng', x: 38, y: 23, terrain: ['plain'],             agriculture: 75, commerce: 70, defense: 60, loyalty: 60 },

  // Xuzhou
  { id: 'xiapi',    zh: '下邳', en: 'Xiapi',    x: 55, y: 22, terrain: ['plain', 'river'],    agriculture: 70, commerce: 70, defense: 65, loyalty: 65 },
  { id: 'xiaopei',  zh: '小沛', en: 'Xiaopei',  x: 53, y: 20, terrain: ['plain'],             agriculture: 55, commerce: 50, defense: 50, loyalty: 60 },
  { id: 'pengcheng',zh: '彭城', en: 'Pengcheng',x: 58, y: 20, terrain: ['plain'],             agriculture: 60, commerce: 55, defense: 55, loyalty: 60 },

  // Yangzhou / Jiangdong
  { id: 'shouchun', zh: '寿春', en: 'Shouchun', x: 50, y: 23, terrain: ['plain', 'river'],    agriculture: 70, commerce: 70, defense: 65, loyalty: 60 },
  { id: 'lujiang',  zh: '庐江', en: 'Lujiang',  x: 53, y: 27, terrain: ['river'],             agriculture: 60, commerce: 55, defense: 55, loyalty: 55 },
  { id: 'jianye',   zh: '建业', en: 'Jianye',   x: 60, y: 28, terrain: ['river'],             agriculture: 70, commerce: 75, defense: 70, loyalty: 70 },
  { id: 'wujun',    zh: '吴郡', en: 'Wujun',    x: 68, y: 28, terrain: ['river'],             agriculture: 75, commerce: 70, defense: 60, loyalty: 65 },
  { id: 'kuaiji',   zh: '会稽', en: 'Kuaiji',   x: 73, y: 32, terrain: ['mountain'],          agriculture: 55, commerce: 50, defense: 60, loyalty: 60 },
  { id: 'chaisang', zh: '柴桑', en: 'Chaisang', x: 53, y: 30, terrain: ['river'],             agriculture: 60, commerce: 60, defense: 65, loyalty: 60 },

  // Jingzhou
  { id: 'xiangyang',zh: '襄阳', en: 'Xiangyang',x: 38, y: 25, terrain: ['plain', 'river'],    agriculture: 80, commerce: 75, defense: 75, loyalty: 70 },
  { id: 'jiangxia', zh: '江夏', en: 'Jiangxia', x: 45, y: 28, terrain: ['river'],             agriculture: 65, commerce: 65, defense: 65, loyalty: 60 },
  { id: 'jiangling',zh: '江陵', en: 'Jiangling',x: 38, y: 28, terrain: ['river'],             agriculture: 70, commerce: 65, defense: 65, loyalty: 60 },
  { id: 'changsha', zh: '长沙', en: 'Changsha', x: 40, y: 32, terrain: ['plain'],             agriculture: 80, commerce: 65, defense: 60, loyalty: 65 },
  { id: 'guiyang',  zh: '桂阳', en: 'Guiyang',  x: 40, y: 35, terrain: ['mountain', 'forest'],agriculture: 40, commerce: 35, defense: 55, loyalty: 50 },
  { id: 'wuling',   zh: '武陵', en: 'Wuling',   x: 33, y: 33, terrain: ['mountain', 'forest'],agriculture: 35, commerce: 30, defense: 50, loyalty: 45 },
  { id: 'lingling', zh: '零陵', en: 'Lingling', x: 35, y: 35, terrain: ['mountain'],          agriculture: 35, commerce: 30, defense: 50, loyalty: 50 },

  // Yizhou
  { id: 'hanzhong', zh: '汉中', en: 'Hanzhong', x: 20, y: 22, terrain: ['mountain'],          agriculture: 70, commerce: 55, defense: 80, loyalty: 65 },
  { id: 'bajun',    zh: '巴郡', en: 'Bajun',    x: 20, y: 28, terrain: ['mountain', 'river'], agriculture: 55, commerce: 50, defense: 70, loyalty: 60 },
  { id: 'zitong',   zh: '梓潼', en: 'Zitong',   x: 18, y: 25, terrain: ['mountain'],          agriculture: 50, commerce: 45, defense: 65, loyalty: 60 },
  { id: 'chengdu',  zh: '成都', en: 'Chengdu',  x: 15, y: 30, terrain: ['plain'],             agriculture: 90, commerce: 80, defense: 75, loyalty: 75 },
  { id: 'mianzhu',  zh: '绵竹', en: 'Mianzhu',  x: 18, y: 28, terrain: ['plain'],             agriculture: 70, commerce: 55, defense: 60, loyalty: 65 },
  { id: 'jianning', zh: '建宁', en: 'Jianning', x: 20, y: 35, terrain: ['mountain'],          agriculture: 30, commerce: 25, defense: 50, loyalty: 40 },
  { id: 'yunnan',   zh: '云南', en: 'Yunnan',   x: 15, y: 37, terrain: ['mountain', 'forest'],agriculture: 25, commerce: 20, defense: 50, loyalty: 35 },
];

function buildCity(def: CityDef): City {
  return {
    id: def.id,
    name: { zh: def.zh, en: def.en },
    pos: { x: def.x, y: def.y },
    terrain: def.terrain,
    factionId: null,
    agriculture: def.agriculture,
    commerce: def.commerce,
    defense: def.defense,
    loyalty: def.loyalty,
    money: 0,
    food: 0,
    generals: [],
    garrison: 0,
    flags: {},
  };
}

export const CITIES: Record<string, City> = Object.fromEntries(
  CITY_DEFS.map((d) => [d.id, buildCity(d)]),
);

export const CITY_IDS = Object.keys(CITIES);

// SCENARIOS.md labels the table "40 cities" but the entries actually total 42
// once Hanzhong (claimed by both Liu Yan and Zhang Lu) and a handful of
// frontier outposts are counted. The integrity test in tests/data verifies
// the exact count, so adjust both there and here if you add or remove rows.

