// Hand-authored Three Kingdoms-era China geography.
//
// All coordinates live in the same 0..MAP_WIDTH (100) x 0..MAP_HEIGHT (40)
// logical space as city positions. The map renderer applies a single
// `scale(CELL)` transform so a path written as `M 20 17` lands exactly on
// Chang-an at (20, 17).
//
// Coordinate orientation: x grows east, y grows south. So `y=0` is roughly
// the northern frontier (Yan / Liaodong), `y=40` the Lingnan / Yunnan
// frontier; `x=0` is the western frontier (Liangzhou), `x=100` the eastern
// sea. The map deliberately spans ~95E..125E longitude and ~42N..20N
// latitude — the heartland of the late Han empire.
//
// Paths are SVG `d` strings. Authoring style:
//   - Smooth Bezier curves (Q/C) for rivers and coastlines.
//   - Closed jagged paths for mountains (silhouette style).
//   - Polygons for lakes and forest patches.
// Nothing here is surveyor-grade — it's a stylized historical atlas.
//
// AUTHORING vs EXPORT SCALE: the literals below are authored against the
// readable 100x40 base grid for legibility, but every exported coordinate
// payload is multiplied by GRID_SCALE (via scale.ts) so it lines up with the
// runtime 500x200 grid that city positions and the 3D renderer operate on.
// Phase 2 will re-author this data directly at 500x200 and drop the wrapping.

import { GRID_SCALE } from '../../engine/constants.js';
import { scalePath, scalePoints } from './scale.js';

// Scale a lone scalar (mountain baseline) or an [x, y] label anchor. Mirrors
// scale.ts rounding so exported magnitudes match scalePath/scalePoints output.
function scaleN(n: number): number {
  return Math.round(n * GRID_SCALE * 1e6) / 1e6;
}
function scaleXY([x, y]: [number, number]): [number, number] {
  return [scaleN(x), scaleN(y)];
}

export interface NamedFeature {
  id: string;
  name: { zh: string; en: string };
  path: string;
}

export interface NamedRegion extends NamedFeature {
  // Optional fill override (overrides the layer-default).
  fill?: string;
}

export interface LabelPlacement {
  text: { zh: string; en: string };
  x: number; // logical
  y: number; // logical
  // Optional sizing/rotation overrides.
  size?: number; // multiplier on the base label size
  rotate?: number; // degrees
}

// ---------------------------------------------------------------- sea / land

// Sea polygon — paint everything east of this curve as sea so the eastern
// coastline reads naturally. The shape traces (north→south):
//   - Liaodong peninsula juts down around x=75..82
//   - Bohai bay sweeps inland near (62, 11)
//   - Shandong peninsula bulges east near (72, 16)
//   - Laizhou bay re-enters near (66, 19)
//   - Jiangsu / Yangtze delta jut at (74, 30)
//   - Hangzhou bay concave near (70, 32)
//   - Fujian coast rugged toward (66, 38)
export const SEA_PATH = scalePath(
  'M 100 0 L 100 40 L 66 40 ' +
    'C 67 38 67 36 67 34 ' +
    'C 70 33 71 32 70 30 ' +
    'C 73 29 75 29 75 28 ' +
    'C 73 26 71 23 71 21 ' +
    'C 71 19 67 18 66 18 ' +
    'C 68 16 71 15 72 15 ' +
    'C 71 13 67 13 64 12 ' +
    'C 64 10 66 8 70 5 ' +
    'C 76 3 80 4 82 6 ' +
    'C 84 4 88 3 92 2 ' +
    'L 100 2 Z',
  GRID_SCALE,
);

// Bohai bay inset — gives it visual weight as a named gulf.
export const BOHAI_BAY: NamedFeature = {
  id: 'bohai',
  name: { zh: '渤海', en: 'Bohai Sea' },
  // Soft enclosed lobe, used for the label position more than visuals.
  path: '',
};

export const YELLOW_SEA: NamedFeature = {
  id: 'huanghai',
  name: { zh: '黄海', en: 'Yellow Sea' },
  path: '',
};

export const EAST_SEA: NamedFeature = {
  id: 'donghai',
  name: { zh: '东海', en: 'East China Sea' },
  path: '',
};

// Decorative coastline that hugs the inland side of the sea polygon. Same
// shape, rendered as a darker stroke.
export const COASTLINE_PATH = scalePath(
  'M 92 2 L 88 3 L 84 4 ' +
    'C 80 4 76 3 70 5 ' +
    'C 66 8 64 10 64 12 ' +
    'C 67 13 71 13 72 15 ' +
    'C 71 15 68 16 66 18 ' +
    'C 67 18 71 19 71 21 ' +
    'C 71 23 73 26 75 28 ' +
    'C 75 29 73 29 70 30 ' +
    'C 71 32 70 33 67 34 ' +
    'C 67 36 67 38 66 40',
  GRID_SCALE,
);

// Closed outline of Han China in logical base coords (x east 0..100, y south
// 0..40), traced to real proportions AROUND the fixed city positions. Clockwise
// from the northwest: the northern steppe frontier, the NE Liaodong peninsula,
// the Bohai gulf sweeping inland, the Shandong peninsula, the Yangtze delta +
// Hangzhou bay, the SE/Fujian coast, the southern coast curving out to 交州, and
// the western/interior taper of Liangzhou/Yizhou. The 3D map fills this polygon
// as land and floods everything outside it as sea, so its whole outline reads as
// coast. Every city sits inside it.
const CHINA_LAND_RAW: Array<[number, number]> = [
  [2, 12],   // NW, west of Xiliang (5,13)
  [3, 6],    // north-west frontier
  [9, 3],
  [18, 2],
  [28, 2],   // north of Jinyang
  [40, 1],
  [52, 1],   // north of Yecheng/Beiping
  [61, 2],   // north of Beiping (60,5)
  [70, 2],   // toward Liaodong
  [78, 2],   // Liaodong base, Xiangping (75,3)
  [85, 3],   // Liaodong / far NE
  [90, 4],   // NE tip
  [85, 7],   // sea coast: Liaodong east side descends
  [79, 8],
  [73, 8],   // into the Bohai approach
  [67, 10],  // Bohai gulf mouth
  [61, 13],  // Bohai gulf bottom (Nanpi 58,10 / Pingyuan 55,15 sit west of here)
  [63, 16],  // Shandong base
  [70, 17],  // Shandong peninsula tip (Beihai 63,18 inside)
  [73, 19],  // Shandong SE
  [67, 20],  // Laizhou bay indent
  [66, 23],  // east coast (Pengcheng 58,20 / Xiapi 55,22 inside)
  [70, 26],
  [75, 29],  // Yangtze delta bulge (Wujun 68,28 inside)
  [77, 32],  // near Kuaiji (73,32)
  [73, 33],  // Hangzhou bay indent
  [72, 35],  // Fujian coast
  [69, 38],
  [64, 40],  // SE corner
  [56, 41],  // south coast toward Jiaozhou
  [48, 42],  // far-south bulge (Panyu / Guangzhou)
  [40, 41],
  [30, 40],  // south of Guiyang (40,35)
  [22, 40],  // south of Jianning (20,35)
  [15, 39],  // Yunnan (15,37) inside
  [9, 37],   // southwest
  [5, 32],   // west of Chengdu (15,30)
  [3, 25],
  [2, 18],   // west of Tianshui (10,18)
];
export const CHINA_LAND: Array<[number, number]> = scalePoints(CHINA_LAND_RAW, GRID_SCALE);

// ---------------------------------------------------------------- rivers

const RIVERS_RAW: NamedFeature[] = [
  {
    id: 'huanghe',
    name: { zh: '黄河', en: 'Yellow River' },
    // From Qinghai source, up into Hetao bend, south through Loess
    // plateau, east through Henan plain, NE to Bohai mouth.
    path:
      'M 2 18 ' +
      'C 5 17 7 16 9 14 ' +
      'C 11 11 13 8 16 7 ' +
      'C 20 5 24 5 28 6 ' +
      'C 31 7 33 9 32 12 ' +
      'C 31 14 30 15 30 17 ' + // dip south past Hekou
      'C 32 17 36 16 40 15 ' +
      'C 46 14 52 13 56 13 ' +
      'C 60 12 62 12 64 11',
  },
  {
    id: 'weishui',
    name: { zh: '渭水', en: 'Wei River' },
    // Tianshui → Chang-an → joins Yellow River near Tongguan.
    path: 'M 5 19 C 9 19 13 18 17 18 C 21 17 25 17 30 17',
  },
  {
    id: 'hanshui',
    name: { zh: '汉水', en: 'Han River' },
    // Source in Qinling → Hanzhong → Xiangyang → joins Yangtze at Jiangxia.
    path:
      'M 17 20 C 18 22 20 23 23 23 ' +
      'C 28 24 33 25 38 25 ' +
      'C 42 26 44 27 45 28',
  },
  {
    id: 'huaihe',
    name: { zh: '淮河', en: 'Huai River' },
    // West-to-east trunk through Shouchun region.
    path: 'M 36 22 C 42 22 47 22 50 23 C 56 23 61 22 66 21',
  },
  {
    id: 'changjiang',
    name: { zh: '长江', en: 'Yangtze River' },
    // Source in Tibetan plateau → through Sichuan basin → Three Gorges →
    // Jiangling → Jiangxia → Chaisang → Jianye → East Sea delta.
    path:
      'M 0 28 ' +
      'C 4 30 8 31 13 31 ' +
      'C 17 31 21 30 24 29 ' +
      'C 27 27 30 27 33 28 ' +
      'C 36 29 40 29 44 29 ' +
      'C 48 29 52 30 56 29 ' +
      'C 60 28 64 28 68 29 ' +
      'C 71 29 73 30 75 30',
  },
  {
    id: 'xiangjiang',
    name: { zh: '湘江', en: 'Xiang River' },
    // South-to-north: from Lingling area, past Changsha, into Dongting Lake.
    path: 'M 38 37 C 39 35 40 33 40 32 C 40 31 40 30 40 29',
  },
  {
    id: 'ganjiang',
    name: { zh: '赣江', en: 'Gan River' },
    // South-to-north into Poyang Lake.
    path: 'M 50 38 C 51 36 52 34 52 33 C 52 32 52 31 53 30',
  },
  {
    id: 'minjiang',
    name: { zh: '岷江', en: 'Min River' },
    // North-to-south through Chengdu plain into Yangtze.
    path: 'M 14 23 C 14 25 15 27 16 29 C 16 30 16 31 16 31',
  },
];

export const RIVERS: NamedFeature[] = RIVERS_RAW.map((r) => ({
  ...r,
  path: scalePath(r.path, GRID_SCALE),
}));

// ---------------------------------------------------------------- mountains

// Mountain ridges: each rendered as a jagged silhouette polygon. The
// renderer applies multi-stroke shading so the path itself is just the
// upper rim — we close it back to the baseline `y` value at render time.
export interface MountainRange {
  id: string;
  name: { zh: string; en: string };
  // Comma-separated x,y peak control points along the ridge.
  ridge: Array<[number, number]>;
  // Baseline y; the silhouette fills from ridge down to this y.
  baseline: number;
  // Label position.
  labelAt: [number, number];
}

const MOUNTAINS_RAW: MountainRange[] = [
  {
    id: 'qinling',
    name: { zh: '秦岭', en: 'Qinling Range' },
    // East-west belt separating Guanzhong from Hanzhong.
    ridge: [
      [12, 21],
      [14, 19.6],
      [16, 20.4],
      [18, 19.4],
      [20, 20.2],
      [22, 19.4],
      [24, 20.4],
      [26, 19.6],
      [28, 20.6],
      [30, 19.8],
      [32, 20.6],
      [34, 20.0],
    ],
    baseline: 21.6,
    labelAt: [23, 21],
  },
  {
    id: 'taihang',
    name: { zh: '太行', en: 'Taihang Range' },
    // North-south spine east of Bingzhou, walling off Hebei plain.
    ridge: [
      [33, 14],
      [33.6, 12.4],
      [34.2, 13.4],
      [34.8, 11.4],
      [35.4, 12.4],
      [36, 10.6],
      [36.6, 11.6],
      [37, 9.6],
      [37.4, 10.4],
      [37.6, 8.6],
    ],
    baseline: 14.4,
    labelAt: [35, 11],
  },
  {
    id: 'yanshan',
    name: { zh: '燕山', en: 'Yan Range' },
    // East-west belt running across Youzhou's northern frontier.
    ridge: [
      [48, 5],
      [50, 3.6],
      [52, 4.4],
      [54, 3.2],
      [56, 4.2],
      [58, 3.0],
      [60, 4.0],
      [62, 2.8],
      [64, 3.6],
      [66, 2.4],
      [68, 3.4],
    ],
    baseline: 5.4,
    labelAt: [56, 5.2],
  },
  {
    id: 'dabie',
    name: { zh: '大别山', en: 'Dabie Range' },
    // Between Huai and Yangtze in modern Anhui-Hubei.
    ridge: [
      [42, 27],
      [43, 25.4],
      [44, 26.4],
      [45, 25.0],
      [46, 26.2],
      [47, 25.0],
      [48, 26.2],
      [49, 25.4],
      [50, 26.4],
      [51, 25.8],
      [52, 26.6],
    ],
    baseline: 27.4,
    labelAt: [46, 27],
  },
  {
    id: 'wuling',
    name: { zh: '武陵山', en: 'Wuling Range' },
    // Wild mountainous belt in modern western Hunan / Hubei.
    ridge: [
      [28, 33],
      [29, 31.6],
      [30, 32.6],
      [31, 31.2],
      [32, 32.4],
      [33, 31.0],
      [34, 32.2],
      [35, 31.4],
      [36, 32.6],
      [37, 31.8],
    ],
    baseline: 33.6,
    labelAt: [32, 33],
  },
  {
    id: 'wuyi',
    name: { zh: '武夷山', en: 'Wuyi Range' },
    // Southeast hills running NE-SW across modern Fujian / Jiangxi border.
    ridge: [
      [58, 38],
      [59, 36.4],
      [60, 37.2],
      [61, 35.8],
      [62, 36.8],
      [63, 35.4],
      [64, 36.4],
      [65, 35.0],
      [66, 36.0],
    ],
    baseline: 38.6,
    labelAt: [62, 38],
  },
  {
    id: 'wushan',
    name: { zh: '巫山大巴', en: 'Wushan / Daba' },
    // Three Gorges escarpment, separating Sichuan basin from Jingzhou.
    ridge: [
      [22, 27],
      [23, 25.4],
      [24, 26.6],
      [25, 25.2],
      [26, 26.4],
      [27, 25.4],
      [28, 26.6],
      [29, 25.6],
      [30, 26.8],
    ],
    baseline: 27.4,
    labelAt: [25, 27.2],
  },
  {
    id: 'hengduan',
    name: { zh: '横断山', en: 'Hengduan Mts' },
    // Southwestern highlands fading into Tibetan plateau.
    ridge: [
      [2, 36],
      [3, 33.5],
      [4, 34.5],
      [5, 32.5],
      [6, 33.5],
      [7, 31.5],
      [8, 32.5],
      [9, 31.0],
      [10, 32.0],
      [11, 30.5],
      [12, 31.5],
    ],
    baseline: 39.6,
    labelAt: [6, 38],
  },
  {
    id: 'wuyi-mt-shandong',
    name: { zh: '泰山', en: 'Mt. Tai' },
    // Solitary Shandong peak — drawn smaller as a single hump.
    ridge: [
      [58, 17],
      [58.5, 15.6],
      [59, 16.4],
      [59.5, 15.2],
      [60, 16.0],
    ],
    baseline: 17.2,
    labelAt: [59, 17.2],
  },
  {
    id: 'nanling',
    name: { zh: '五岭', en: 'Nanling' },
    // East-west belt across the south, dividing Jingzhou from Lingnan.
    ridge: [
      [22, 37],
      [26, 35.4],
      [30, 36.4],
      [34, 35.2],
      [38, 36.4],
      [42, 35.0],
      [46, 36.2],
      [50, 35.4],
      [54, 36.4],
    ],
    baseline: 37.6,
    labelAt: [38, 37.2],
  },
];

export const MOUNTAINS: MountainRange[] = MOUNTAINS_RAW.map((m) => ({
  ...m,
  ridge: scalePoints(m.ridge, GRID_SCALE),
  baseline: scaleN(m.baseline),
  labelAt: scaleXY(m.labelAt),
}));

// ---------------------------------------------------------------- lakes

export interface Lake {
  id: string;
  name: { zh: string; en: string };
  // Polygon vertices (closed automatically).
  polygon: Array<[number, number]>;
  labelAt: [number, number];
}

const LAKES_RAW: Lake[] = [
  {
    id: 'dongting',
    name: { zh: '洞庭湖', en: 'Dongting Lake' },
    polygon: [
      [38.5, 30.5],
      [41, 30.2],
      [42.5, 31],
      [42, 32.2],
      [40.5, 32.5],
      [38.8, 32],
      [38, 31.2],
    ],
    labelAt: [40.5, 31.5],
  },
  {
    id: 'poyang',
    name: { zh: '鄱阳湖', en: 'Poyang Lake' },
    polygon: [
      [51.5, 30.5],
      [53.5, 30.8],
      [54.2, 32],
      [53.5, 33.2],
      [52, 33.4],
      [51, 32.6],
      [51, 31.4],
    ],
    labelAt: [52.5, 32],
  },
  {
    id: 'taihu',
    name: { zh: '太湖', en: 'Tai Lake' },
    polygon: [
      [65, 27.2],
      [66.6, 27.0],
      [67.4, 27.8],
      [67, 28.6],
      [65.8, 28.8],
      [65, 28.2],
    ],
    labelAt: [66.2, 28],
  },
  {
    id: 'yunmeng',
    name: { zh: '云梦泽', en: 'Yunmeng Marsh' },
    // Historical wetland north of Jiangling, partly silted-up by Han times.
    polygon: [
      [40, 26.5],
      [44, 26.2],
      [46, 27],
      [45, 28],
      [42, 28.2],
      [40, 27.5],
    ],
    labelAt: [43, 27.4],
  },
];

export const LAKES: Lake[] = LAKES_RAW.map((l) => ({
  ...l,
  polygon: scalePoints(l.polygon, GRID_SCALE),
  labelAt: scaleXY(l.labelAt),
}));

// ---------------------------------------------------------------- forests

// Approximate forested regions — drawn as a scattered cluster of small
// tree glyphs in the renderer. The polygon is the bounding region; the
// renderer samples points inside.
export interface ForestPatch {
  id: string;
  name: { zh: string; en: string };
  polygon: Array<[number, number]>;
  density?: number; // 0..1, default 0.5
}

const FORESTS_RAW: ForestPatch[] = [
  {
    id: 'wuling-forest',
    name: { zh: '武陵林', en: 'Wuling Forest' },
    polygon: [
      [27, 31],
      [38, 31],
      [38, 35],
      [27, 35],
    ],
    density: 0.6,
  },
  {
    id: 'wuyi-forest',
    name: { zh: '武夷林', en: 'Wuyi Forest' },
    polygon: [
      [55, 35],
      [68, 35],
      [68, 39],
      [55, 39],
    ],
    density: 0.55,
  },
  {
    id: 'liaodong-forest',
    name: { zh: '辽东林', en: 'Liaodong Forest' },
    polygon: [
      [70, 0],
      [80, 0],
      [80, 5],
      [70, 5],
    ],
    density: 0.4,
  },
  {
    id: 'yunnan-forest',
    name: { zh: '南中林', en: 'Yunnan Forest' },
    polygon: [
      [10, 35],
      [22, 35],
      [22, 39],
      [10, 39],
    ],
    density: 0.55,
  },
];

export const FORESTS: ForestPatch[] = FORESTS_RAW.map((f) => ({
  ...f,
  polygon: scalePoints(f.polygon, GRID_SCALE),
}));

// ---------------------------------------------------------------- regions

// Province / state labels with rough centroid placements. These render
// large and dim behind everything else, like the gazetteer text on an
// antique map.
const PROVINCE_LABELS_RAW: LabelPlacement[] = [
  { text: { zh: '幽州', en: 'Youzhou' }, x: 55, y: 7, size: 1.4 },
  { text: { zh: '冀州', en: 'Jizhou' }, x: 50, y: 13, size: 1.4 },
  { text: { zh: '并州', en: 'Bingzhou' }, x: 30, y: 9, size: 1.4 },
  { text: { zh: '凉州', en: 'Liangzhou' }, x: 7, y: 13, size: 1.4 },
  { text: { zh: '司隶', en: 'Siliyuan' }, x: 26, y: 16, size: 1.4 },
  { text: { zh: '兖州', en: 'Yanzhou' }, x: 42, y: 19, size: 1.3 },
  { text: { zh: '青州', en: 'Qingzhou' }, x: 62, y: 17, size: 1.3 },
  { text: { zh: '徐州', en: 'Xuzhou' }, x: 56, y: 22, size: 1.3 },
  { text: { zh: '豫州', en: 'Yuzhou' }, x: 41, y: 22, size: 1.3 },
  { text: { zh: '扬州', en: 'Yangzhou' }, x: 60, y: 25, size: 1.4 },
  { text: { zh: '荆州', en: 'Jingzhou' }, x: 40, y: 29, size: 1.4 },
  { text: { zh: '益州', en: 'Yizhou' }, x: 15, y: 27, size: 1.4 },
  { text: { zh: '交州', en: 'Jiaozhou' }, x: 48, y: 38, size: 1.3 },
  { text: { zh: '辽东', en: 'Liaodong' }, x: 78, y: 4, size: 1.2 },
];

export const PROVINCE_LABELS: LabelPlacement[] = PROVINCE_LABELS_RAW.map((p) => ({
  ...p,
  x: scaleN(p.x),
  y: scaleN(p.y),
}));

// The Great Wall — represented as a single hand-drawn path running along
// the northern frontier from Liaodong west to Hexi. In Han times the wall
// ran roughly north of the Yin Mountains; we approximate it as a wavy line
// through y=2..5 across the top of the map.
export const GREAT_WALL_PATH = scalePath(
  'M 78 4 ' +
    'C 72 5 68 4 64 4 ' +
    'C 58 4 54 5 50 4 ' +
    'C 46 3 40 4 34 4 ' +
    'C 28 3 22 4 16 5 ' +
    'C 12 5 8 6 4 7',
  GRID_SCALE,
);

// Sea labels.
const SEA_LABELS_RAW: LabelPlacement[] = [
  { text: { zh: '渤  海', en: 'Bohai Sea' }, x: 80, y: 8, size: 1.3 },
  { text: { zh: '黄  海', en: 'Yellow Sea' }, x: 86, y: 18, size: 1.3 },
  { text: { zh: '东  海', en: 'East Sea' }, x: 88, y: 30, size: 1.3 },
];

export const SEA_LABELS: LabelPlacement[] = SEA_LABELS_RAW.map((p) => ({
  ...p,
  x: scaleN(p.x),
  y: scaleN(p.y),
}));
