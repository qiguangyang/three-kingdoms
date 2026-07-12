import type { Scenario } from '../../engine/types.js';

// Scenario 4: The Three Kingdoms Stand (三国鼎立, 220 CE, 10th lunar month).
//
// The finale board. Cao Pi has deposed the last Han emperor and proclaimed the
// Wei — 22 cities and 300,000 troops straddling the whole north, with Jiang Wei
// still serving in the west. Liu Bei holds Yi Province from Chengdu (7 cities)
// and will proclaim Shu-Han; Sun Quan is dug into the Southlands and now holds
// the Jing river-line (12 cities, Jiangling + Xiangyang among them, taken in the
// Lü Meng campaign). Gongsun Yuan clings to Liaodong's lone Xiangping.
//
// Rosters use INLINE generalIds (not the shared FACTION_GENERAL_IDS) to wire the
// 220 CE staff — the next Cao/Sima generation, the Shu second wave (Jiang Wan,
// Fei Yi, Wang Ping, the sons Guan Xing & Zhang Bao), and the Wu marines — while
// leaving Scenarios 1/2/3 untouched. Deng Ai and Zhong Hui are WILD (assigned to
// no faction); Guan Yu is absent (fell in 219). generalOverrides supplies the
// 220 CE era-variant stats and ages: an aged Liu Bei (55/80/85/90 @59), a peak
// Zhuge Liang (30/100/95/100), a peak Sima Yi and Lu Xun, and an aged Sun Quan.
//
// Every one of the 42 map cities is owned (zero neutral): 22 (caopi) + 7
// (liubei) + 12 (sunquan) + 1 (gongsunyuan) = 42.
export const SCENARIO_DINGLI: Scenario = {
  id: 's4-dingli',
  name: { zh: '三国鼎立', en: 'The Three Kingdoms Stand' },
  description: {
    zh: '220 年 10 月,曹丕废帝篡汉,自立为帝。刘备坐镇成都,将继大统、立蜀汉;孙权据有江东荆襄。三分天下,鼎足而立。',
    en: 'October 220 CE. Cao Pi deposes the last Han emperor and takes the throne. Liu Bei holds Chengdu and will proclaim Shu-Han; Sun Quan commands the Southlands and the Jing river-line. The realm stands split three ways.',
  },
  startYear: 220,
  startMonth: 10,
  victory: { kind: 'unify' },
  // Era-variant stats and ages for the 220 CE cast. An aged Liu Bei (59) and a
  // peak Zhuge Liang (100 zheng) lead Shu; Sima Yi and Lu Xun are at their peak;
  // Sun Quan is the seasoned lord of 220. The age-only entries advance the
  // veterans/advisors to their 220 values (stats unchanged).
  generalOverrides: {
    caohong: { age: 61 },
    simayi: { stats: { wu: 50, zhi: 98, tong: 92, zheng: 95 }, age: 41 },
    zhangliao: { age: 51 },
    zhanghe: { age: 53 },
    xuhuang: { age: 51 },
    yujin: { stats: { wu: 70, zhi: 65, tong: 72, zheng: 62 }, age: 64 },
    liubei: { stats: { wu: 55, zhi: 80, tong: 85, zheng: 90 }, age: 59 },
    zhugeliang: { stats: { wu: 30, zhi: 100, tong: 95, zheng: 100 }, age: 39 },
    zhangfei: { age: 56 },
    zhaoyun: { age: 53 },
    machao: { stats: { wu: 95, zhi: 50, tong: 80, zheng: 40 }, age: 44 },
    sunquan: { stats: { wu: 60, zhi: 85, tong: 88, zheng: 95 }, age: 38 },
    luxun: { stats: { wu: 70, zhi: 95, tong: 95, zheng: 88 }, age: 37 },
    lvmeng: { stats: { wu: 82, zhi: 82, tong: 90, zheng: 68 }, age: 42 },
    zhangzhao: { age: 64 },
    ganning: { age: 51 },
    lingtong: { age: 32 },
    jiangqin: { age: 47 },
    guyong: { age: 52 },
  },
  factions: [
    {
      id: 'caopi',
      name: { zh: '曹魏', en: 'Cao Wei' },
      lordId: 'caopi',
      color: 'magenta',
      difficulty: 2,
      personality: 'balanced',
      cityIds: [
        'xiliang',
        'anding',
        'tianshui',
        'changan',
        'luoyang',
        'henei',
        'hongnong',
        'jinyang',
        'shangdang',
        'beiping',
        'yecheng',
        'nanpi',
        'pingyuan',
        'beihai',
        'puyang',
        'xuchang',
        'chenliu',
        'wancheng',
        'xiapi',
        'xiaopei',
        'pengcheng',
        'shouchun',
      ],
      generalIds: [
        'caopi',
        'caozhen',
        'caoxiu',
        'caohong',
        'simayi',
        'simashi',
        'simazhao',
        'zhangliao',
        'zhanghe',
        'xuhuang',
        'yujin',
        'manchong',
        'tianyu',
        'qianzhao',
        'zhongyao',
        'huaxin',
        'wanglang',
        'jiangwei',
      ],
      resources: { money: 250000, food: 400000, troops: 300000 },
    },
    {
      id: 'liubei',
      name: { zh: '蜀汉', en: 'Shu Han' },
      lordId: 'liubei',
      color: 'green',
      difficulty: 3,
      personality: 'active',
      cityIds: ['chengdu', 'mianzhu', 'zitong', 'bajun', 'hanzhong', 'jianning', 'yunnan'],
      generalIds: [
        'liubei',
        'zhugeliang',
        'zhangfei',
        'zhaoyun',
        'machao',
        'huangzhong',
        'weiyan',
        'jiangwan',
        'feiyi',
        'dongyun',
        'maliang',
        'masu',
        'wangping',
        'zhangni',
        'liaohua',
        'guanxing',
        'zhangbao',
      ],
      resources: { money: 80000, food: 150000, troops: 120000 },
    },
    {
      id: 'sunquan',
      name: { zh: '东吴', en: 'Dong Wu' },
      lordId: 'sunquan',
      color: 'cyanBright',
      difficulty: 3,
      personality: 'balanced',
      cityIds: [
        'jianye',
        'wujun',
        'kuaiji',
        'chaisang',
        'lujiang',
        'jiangxia',
        'jiangling',
        'changsha',
        'guiyang',
        'wuling',
        'lingling',
        'xiangyang',
      ],
      generalIds: [
        'sunquan',
        'luxun',
        'lvmeng',
        'zhangzhao',
        'ganning',
        'lingtong',
        'xusheng',
        'dingfeng',
        'jiangqin',
        'panzhang',
        'zhugejin',
        'guyong',
        'buzhi',
      ],
      resources: { money: 150000, food: 250000, troops: 180000 },
    },
    {
      id: 'gongsunyuan',
      name: { zh: '辽东', en: 'Liaodong' },
      lordId: 'gongsunyuan',
      color: 'blue',
      difficulty: 5,
      personality: 'turtle',
      cityIds: ['xiangping'],
      generalIds: ['gongsunyuan'],
      resources: { money: 20000, food: 30000, troops: 15000 },
    },
  ],
};
