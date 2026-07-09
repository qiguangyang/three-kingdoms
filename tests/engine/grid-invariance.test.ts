import { describe, expect, it } from 'vitest';
import { CITIES, CITY_IDS } from '../../src/data/cities.js';
import { buildAdjacencyMap, marchCost } from '../../src/engine/map.js';
import type { GameState } from '../../src/engine/types.js';

// Guard test freezing today's gameplay topology (the pre-rescale, GRID_SCALE=1
// baseline). The upcoming logical-grid rescale from 100x40 to 500x200 scales
// both the city coordinates and the distance/cost thresholds by GRID_SCALE, so
// the adjacency relation and marchCost must stay byte-identical afterward. If
// this test breaks after the rescale, a coefficient was missed.
//
// The EXPECTED_* literals below are baked from a run of the CURRENT code. To
// regenerate them if the intended topology ever legitimately changes, run this
// throwaway script from the repo root (`npx tsx <file>.mts`) and paste its
// output back into the literals:
//
//   import { CITIES, CITY_IDS } from './src/data/cities.js';
//   import { buildAdjacencyMap, marchCost } from './src/engine/map.js';
//   import type { GameState } from './src/engine/types.js';
//   const adj = buildAdjacencyMap({ cities: CITIES } as GameState);
//   const expected: Record<string, string[]> = {};
//   for (const id of CITY_IDS) expected[id] = [...(adj[id] ?? [])].sort();
//   console.log(JSON.stringify(expected, null, 2));
//   for (const [a, b] of PAIRS) console.log(a, b, marchCost(CITIES[a]!, CITIES[b]!));

// cityId -> sorted neighbor cityIds, captured from the pre-rescale run.
const EXPECTED_ADJACENCY: Record<string, string[]> = {
  xiliang: ['anding', 'tianshui'],
  anding: ['changan', 'chengdu', 'hanzhong', 'hongnong', 'tianshui', 'xiliang', 'zitong'],
  tianshui: [
    'anding', 'changan', 'chengdu', 'hanzhong', 'hongnong', 'mianzhu', 'xiliang', 'zitong',
  ],
  changan: [
    'anding', 'bajun', 'chengdu', 'hanzhong', 'henei', 'hongnong', 'jianning', 'jinyang',
    'luoyang', 'mianzhu', 'tianshui', 'zitong',
  ],
  luoyang: [
    'changan', 'chenliu', 'hanzhong', 'henei', 'hongnong', 'jinyang', 'puyang', 'shangdang',
    'wancheng', 'xiangyang', 'xuchang',
  ],
  henei: [
    'changan', 'chenliu', 'hongnong', 'jiangling', 'jinyang', 'luoyang', 'puyang', 'shangdang',
    'wancheng', 'xiangyang', 'xuchang', 'yecheng',
  ],
  hongnong: [
    'anding', 'bajun', 'changan', 'chenliu', 'hanzhong', 'henei', 'jinyang', 'luoyang',
    'mianzhu', 'shangdang', 'tianshui', 'wancheng', 'zitong',
  ],
  jinyang: ['changan', 'chenliu', 'henei', 'hongnong', 'luoyang', 'shangdang'],
  shangdang: [
    'chenliu', 'henei', 'hongnong', 'jinyang', 'luoyang', 'puyang', 'wancheng', 'xiangyang',
    'xuchang', 'yecheng',
  ],
  beiping: ['beihai', 'nanpi', 'pengcheng', 'pingyuan', 'xiangping'],
  xiangping: ['beiping'],
  yecheng: [
    'chenliu', 'henei', 'nanpi', 'pengcheng', 'pingyuan', 'puyang', 'shangdang', 'shouchun',
    'xiaopei', 'xiapi', 'xuchang',
  ],
  nanpi: ['beihai', 'beiping', 'pengcheng', 'pingyuan', 'xiaopei', 'xiapi', 'yecheng'],
  pingyuan: [
    'beihai', 'beiping', 'chaisang', 'chenliu', 'jianye', 'lujiang', 'nanpi', 'pengcheng',
    'puyang', 'shouchun', 'xiaopei', 'xiapi', 'xuchang', 'yecheng',
  ],
  beihai: [
    'beiping', 'jianye', 'nanpi', 'pengcheng', 'pingyuan', 'shouchun', 'wujun', 'xiaopei',
    'xiapi',
  ],
  puyang: [
    'chenliu', 'henei', 'jiangling', 'jiangxia', 'lujiang', 'luoyang', 'pengcheng', 'pingyuan',
    'shangdang', 'shouchun', 'wancheng', 'xiangyang', 'xiaopei', 'xiapi', 'xuchang', 'yecheng',
  ],
  xuchang: [
    'changsha', 'chenliu', 'guiyang', 'henei', 'jiangling', 'jiangxia', 'lujiang', 'luoyang',
    'pengcheng', 'pingyuan', 'puyang', 'shangdang', 'shouchun', 'wancheng', 'xiangyang',
    'xiaopei', 'xiapi', 'yecheng',
  ],
  chenliu: [
    'changsha', 'guiyang', 'henei', 'hongnong', 'jiangling', 'jiangxia', 'jinyang', 'luoyang',
    'pingyuan', 'puyang', 'shangdang', 'shouchun', 'wancheng', 'xiangyang', 'xiaopei', 'xuchang',
    'yecheng',
  ],
  wancheng: [
    'changsha', 'chenliu', 'guiyang', 'henei', 'hongnong', 'jiangling', 'jiangxia', 'lingling',
    'luoyang', 'puyang', 'shangdang', 'shouchun', 'wuling', 'xiangyang', 'xiaopei', 'xiapi',
    'xuchang',
  ],
  xiapi: [
    'beihai', 'chaisang', 'jiangxia', 'jianye', 'lujiang', 'nanpi', 'pengcheng', 'pingyuan',
    'puyang', 'shouchun', 'wancheng', 'xiaopei', 'xuchang', 'yecheng',
  ],
  xiaopei: [
    'beihai', 'chaisang', 'chenliu', 'jiangxia', 'jianye', 'lujiang', 'nanpi', 'pengcheng',
    'pingyuan', 'puyang', 'shouchun', 'wancheng', 'xiapi', 'xuchang', 'yecheng',
  ],
  pengcheng: [
    'beihai', 'beiping', 'chaisang', 'jianye', 'lujiang', 'nanpi', 'pingyuan', 'puyang',
    'shouchun', 'wujun', 'xiaopei', 'xiapi', 'xuchang', 'yecheng',
  ],
  shouchun: [
    'beihai', 'chaisang', 'chenliu', 'jiangling', 'jiangxia', 'jianye', 'lujiang', 'pengcheng',
    'pingyuan', 'puyang', 'wancheng', 'xiangyang', 'xiaopei', 'xiapi', 'xuchang', 'yecheng',
  ],
  lujiang: [
    'chaisang', 'changsha', 'jiangling', 'jiangxia', 'jianye', 'pengcheng', 'pingyuan', 'puyang',
    'shouchun', 'wujun', 'xiangyang', 'xiaopei', 'xiapi', 'xuchang',
  ],
  jianye: [
    'beihai', 'chaisang', 'jiangxia', 'kuaiji', 'lujiang', 'pengcheng', 'pingyuan', 'shouchun',
    'wujun', 'xiaopei', 'xiapi',
  ],
  wujun: ['beihai', 'chaisang', 'jianye', 'kuaiji', 'lujiang', 'pengcheng'],
  kuaiji: ['jianye', 'wujun'],
  chaisang: [
    'changsha', 'guiyang', 'jiangling', 'jiangxia', 'jianye', 'lujiang', 'pengcheng', 'pingyuan',
    'shouchun', 'wujun', 'xiaopei', 'xiapi',
  ],
  xiangyang: [
    'changsha', 'chenliu', 'guiyang', 'henei', 'jiangling', 'jiangxia', 'lingling', 'lujiang',
    'luoyang', 'puyang', 'shangdang', 'shouchun', 'wancheng', 'wuling', 'xuchang',
  ],
  jiangxia: [
    'chaisang', 'changsha', 'chenliu', 'guiyang', 'jiangling', 'jianye', 'lingling', 'lujiang',
    'puyang', 'shouchun', 'wancheng', 'wuling', 'xiangyang', 'xiaopei', 'xiapi', 'xuchang',
  ],
  jiangling: [
    'bajun', 'chaisang', 'changsha', 'chenliu', 'guiyang', 'henei', 'jiangxia', 'lingling',
    'lujiang', 'puyang', 'shouchun', 'wancheng', 'wuling', 'xiangyang', 'xuchang',
  ],
  changsha: [
    'chaisang', 'chenliu', 'guiyang', 'jiangling', 'jiangxia', 'lingling', 'lujiang', 'wancheng',
    'wuling', 'xiangyang', 'xuchang',
  ],
  guiyang: [
    'chaisang', 'changsha', 'chenliu', 'jiangling', 'jiangxia', 'lingling', 'wancheng', 'wuling',
    'xiangyang', 'xuchang',
  ],
  wuling: [
    'bajun', 'changsha', 'guiyang', 'jiangling', 'jiangxia', 'jianning', 'lingling', 'wancheng',
    'xiangyang',
  ],
  lingling: [
    'changsha', 'guiyang', 'jiangling', 'jiangxia', 'jianning', 'wancheng', 'wuling', 'xiangyang',
  ],
  hanzhong: [
    'anding', 'bajun', 'changan', 'chengdu', 'hongnong', 'jianning', 'luoyang', 'mianzhu',
    'tianshui', 'zitong',
  ],
  bajun: [
    'changan', 'chengdu', 'hanzhong', 'hongnong', 'jiangling', 'jianning', 'mianzhu', 'wuling',
    'yunnan', 'zitong',
  ],
  zitong: [
    'anding', 'bajun', 'changan', 'chengdu', 'hanzhong', 'hongnong', 'jianning', 'mianzhu',
    'tianshui', 'yunnan',
  ],
  chengdu: [
    'anding', 'bajun', 'changan', 'hanzhong', 'jianning', 'mianzhu', 'tianshui', 'yunnan',
    'zitong',
  ],
  mianzhu: [
    'bajun', 'changan', 'chengdu', 'hanzhong', 'hongnong', 'jianning', 'tianshui', 'yunnan',
    'zitong',
  ],
  jianning: [
    'bajun', 'changan', 'chengdu', 'hanzhong', 'lingling', 'mianzhu', 'wuling', 'yunnan', 'zitong',
  ],
  yunnan: ['bajun', 'chengdu', 'jianning', 'mianzhu', 'zitong'],
};

// Representative city pairs (mix of adjacent and distant, including several
// luoyang pairs) with their pre-rescale marchCost.
const EXPECTED_COST_PAIRS: { a: string; b: string; cost: number }[] = [
  { a: 'luoyang', b: 'changan', cost: 2.25 },
  { a: 'luoyang', b: 'henei', cost: 1.875 },
  { a: 'luoyang', b: 'hongnong', cost: 2.75 },
  { a: 'luoyang', b: 'chenliu', cost: 2.375 },
  { a: 'luoyang', b: 'chengdu', cost: 4.5 },
  { a: 'changan', b: 'hanzhong', cost: 2.625 },
  { a: 'chengdu', b: 'mianzhu', cost: 1.625 },
  { a: 'jianye', b: 'wujun', cost: 5 },
  { a: 'beiping', b: 'xiangping', cost: 3.125 },
  { a: 'xiangyang', b: 'jiangling', cost: 2.875 },
  { a: 'xuchang', b: 'chenliu', cost: 1.625 },
  { a: 'xiliang', b: 'yunnan', cost: 6.25 },
];

describe('grid rescale is gameplay-invariant', () => {
  it('adjacency graph is unchanged (same neighbor sets by city id)', () => {
    const adj = buildAdjacencyMap({ cities: CITIES } as GameState);
    for (const id of CITY_IDS) {
      const neighbors = [...(adj[id] ?? [])].sort();
      expect(neighbors, id).toEqual(EXPECTED_ADJACENCY[id]);
    }
  });

  it('marchCost between a fixed set of city pairs is unchanged', () => {
    EXPECTED_COST_PAIRS.forEach(({ a, b, cost }) => {
      expect(marchCost(CITIES[a]!, CITIES[b]!), `${a}->${b}`).toBeCloseTo(cost, 9);
    });
  });
});
