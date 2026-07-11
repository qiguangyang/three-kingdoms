import type { General, GeneralId, TroopType } from '../../engine/types.js';

// Compact builder so the per-faction tables below stay readable.
// Stats order: wu / zhi / tong / zheng (martial / intellect / command / politics).
function g(
  id: GeneralId,
  zh: string,
  en: string,
  stats: [number, number, number, number],
  age: number,
  troopType: TroopType = 'infantry',
  loyalty = 80,
  startCityId: string | null = null,
): General {
  return {
    id,
    name: { zh, en },
    stats: { wu: stats[0], zhi: stats[1], tong: stats[2], zheng: stats[3] },
    loyalty,
    age,
    factionId: null, // assigned by scenario loader
    locationCityId: startCityId,
    troopType,
    troops: 0,
    status: 'active',
  };
}

// Dong Zhuo's Liangzhou faction.
const DONG: General[] = [
  g('dongzhuo', '董卓', 'Dong Zhuo', [78, 60, 80, 35], 55, 'cavalry', 100),
  g('lvbu', '吕布', 'Lü Bu', [100, 30, 88, 15], 26, 'cavalry', 70),
  g('lijue', '李傕', 'Li Jue', [80, 50, 72, 35], 40, 'cavalry'),
  g('guosi', '郭汜', 'Guo Si', [78, 45, 70, 30], 38, 'cavalry'),
  g('huaxiong', '华雄', 'Hua Xiong', [88, 25, 70, 20], 32, 'cavalry'),
  g('zhangji', '张济', 'Zhang Ji', [72, 55, 70, 50], 45, 'infantry'),
  g('fanchou', '樊稠', 'Fan Chou', [75, 30, 65, 25], 35, 'cavalry'),
  g('jiaxu', '贾诩', 'Jia Xu', [25, 96, 65, 78], 43, 'infantry'),
  g('liru', '李儒', 'Li Ru', [20, 90, 50, 80], 42, 'infantry'),
];

// Yuan Shao (Hebei).
const YUAN_SHAO: General[] = [
  g('yuanshao', '袁绍', 'Yuan Shao', [70, 70, 80, 75], 41, 'cavalry', 100),
  g('yanliang', '颜良', 'Yan Liang', [92, 30, 78, 25], 33, 'cavalry'),
  g('wenchou', '文丑', 'Wen Chou', [91, 28, 75, 22], 32, 'cavalry'),
  g('tianfeng', '田丰', 'Tian Feng', [15, 92, 50, 85], 50, 'infantry'),
  g('jushou', '沮授', 'Ju Shou', [18, 90, 55, 88], 48, 'infantry'),
  g('shenpei', '审配', 'Shen Pei', [30, 85, 75, 80], 45, 'infantry'),
  g('zhanghe', '张郃', 'Zhang He', [88, 75, 88, 60], 32, 'cavalry'),
  g('gaolan', '高览', 'Gao Lan', [85, 50, 75, 40], 33, 'cavalry'),
];

// Yuan Shu (Huainan).
const YUAN_SHU: General[] = [
  g('yuanshu', '袁术', 'Yuan Shu', [55, 50, 65, 50], 40, 'cavalry', 100),
  g('jiling', '纪灵', 'Ji Ling', [85, 50, 78, 40], 36, 'infantry'),
  g('zhangxun', '张勋', 'Zhang Xun', [65, 45, 65, 35], 35, 'infantry'),
  g('yanghong', '杨弘', 'Yang Hong', [25, 75, 50, 70], 42, 'infantry'),
];

// Cao Cao (Chenliu start).
const CAO: General[] = [
  g('caocao', '曹操', 'Cao Cao', [72, 95, 95, 92], 35, 'cavalry', 100),
  g('xiahoudun', '夏侯惇', 'Xiahou Dun', [90, 65, 85, 60], 33, 'cavalry'),
  g('xiahouyuan', '夏侯渊', 'Xiahou Yuan', [89, 60, 85, 50], 32, 'cavalry'),
  g('caoren', '曹仁', 'Cao Ren', [85, 70, 90, 65], 31, 'infantry'),
  g('caohong', '曹洪', 'Cao Hong', [80, 50, 70, 45], 30, 'cavalry'),
  g('yuejin', '乐进', 'Yue Jin', [84, 55, 78, 40], 29, 'infantry'),
  g('lidian', '李典', 'Li Dian', [78, 75, 78, 70], 28, 'infantry'),
];

// Gongsun Zan (Beiping) — Zhao Yun starts as his subordinate.
const GONGSUN_ZAN: General[] = [
  g('gongsunzan', '公孙瓒', 'Gongsun Zan', [85, 55, 80, 50], 38, 'cavalry', 100),
  g('yangang', '严纲', 'Yan Gang', [75, 30, 70, 25], 34, 'cavalry'),
  g('zoudan', '邹丹', 'Zou Dan', [70, 35, 65, 30], 33, 'cavalry'),
  g('zhaoyun', '赵云', 'Zhao Yun', [97, 78, 90, 70], 22, 'cavalry'),
];

// Liu Bei (Pingyuan).
const LIU_BEI: General[] = [
  g('liubei', '刘备', 'Liu Bei', [65, 78, 80, 88], 28, 'infantry', 100),
  g('guanyu', '关羽', 'Guan Yu', [97, 75, 92, 60], 27, 'cavalry'),
  g('zhangfei', '张飞', 'Zhang Fei', [96, 40, 82, 25], 25, 'cavalry'),
  g('jianyong', '简雍', 'Jian Yong', [25, 75, 40, 80], 30, 'infantry'),
];

// Sun Jian (Changsha).
const SUN_JIAN: General[] = [
  g('sunjian', '孙坚', 'Sun Jian', [88, 70, 85, 65], 34, 'cavalry', 100),
  g('sunce', '孙策', 'Sun Ce', [60, 60, 65, 50], 13, 'cavalry'),
  g('chengpu', '程普', 'Cheng Pu', [82, 70, 80, 65], 41, 'cavalry'),
  g('huanggai', '黄盖', 'Huang Gai', [84, 65, 80, 55], 40, 'navy'),
  g('handang', '韩当', 'Han Dang', [82, 55, 75, 45], 38, 'cavalry'),
  g('zumao', '祖茂', 'Zu Mao', [75, 40, 65, 30], 35, 'cavalry'),
];

// Liu Biao (Xiangyang).
const LIU_BIAO: General[] = [
  g('liubiao', '刘表', 'Liu Biao', [50, 70, 65, 80], 47, 'infantry', 100),
  g('kuaiyue', '蒯越', 'Kuai Yue', [30, 88, 65, 85], 40, 'infantry'),
  g('kuailiang', '蒯良', 'Kuai Liang', [28, 85, 60, 82], 42, 'infantry'),
  g('caimao', '蔡瑁', 'Cai Mao', [65, 60, 75, 55], 38, 'navy'),
  g('zhangyun', '张允', 'Zhang Yun', [60, 50, 65, 45], 36, 'navy'),
  g('huangzu', '黄祖', 'Huang Zu', [70, 45, 70, 40], 50, 'navy'),
  g('wenpin', '文聘', 'Wen Pin', [82, 70, 82, 65], 33, 'infantry'),
];

// Liu Yan (Yizhou).
const LIU_YAN: General[] = [
  g('liuyan', '刘焉', 'Liu Yan', [40, 65, 60, 75], 51, 'infantry', 100),
  g('zhangren', '张任', 'Zhang Ren', [88, 80, 88, 60], 32, 'archer'),
  g('yanyan', '严颜', 'Yan Yan', [86, 70, 85, 55], 55, 'infantry'),
  g('huangquan', '黄权', 'Huang Quan', [75, 85, 78, 80], 38, 'infantry'),
  g('liyan', '李严', 'Li Yan', [80, 78, 82, 75], 36, 'infantry'),
  g('wuyi', '吴懿', 'Wu Yi', [78, 60, 75, 65], 35, 'cavalry'),
];

// Ma Teng / Han Sui (Liangzhou).
const MA_HAN: General[] = [
  g('mateng', '马腾', 'Ma Teng', [85, 60, 80, 65], 40, 'cavalry', 100),
  g('hansui', '韩遂', 'Han Sui', [75, 75, 78, 70], 45, 'cavalry'),
  g('machao', '马超', 'Ma Chao', [75, 50, 80, 40], 14, 'cavalry'),
  g('pangde', '庞德', 'Pang De', [90, 60, 82, 50], 28, 'cavalry'),
];

// Tao Qian (Xuzhou).
const TAO_QIAN: General[] = [
  g('taoqian', '陶谦', 'Tao Qian', [45, 60, 65, 78], 57, 'infantry', 100),
  g('caobao', '曹豹', 'Cao Bao', [70, 30, 60, 35], 38, 'infantry'),
  g('mizhu', '糜竺', 'Mi Zhu', [25, 65, 40, 88], 32, 'infantry'),
  g('chendeng', '陈登', 'Chen Deng', [35, 88, 70, 85], 30, 'infantry'),
];

// Kong Rong (Beihai).
const KONG_RONG: General[] = [
  g('kongrong', '孔融', 'Kong Rong', [30, 78, 50, 80], 36, 'infantry', 100),
  g('wuanguo', '武安国', 'Wu Anguo', [80, 30, 65, 25], 35, 'infantry'),
];

// Liu Yu (Bingzhou stand-in).
const LIU_YU: General[] = [
  g('liuyu', '刘虞', 'Liu Yu', [35, 70, 60, 85], 50, 'infantry', 100),
  g('xianyufu', '鲜于辅', 'Xianyu Fu', [75, 55, 70, 60], 38, 'cavalry'),
  g('xianyuyin', '鲜于银', 'Xianyu Yin', [72, 50, 65, 55], 36, 'cavalry'),
];

// Zhang Lu (Hanzhong).
const ZHANG_LU: General[] = [
  g('zhanglu', '张鲁', 'Zhang Lu', [60, 70, 65, 70], 38, 'infantry', 100),
  g('yangsong', '杨松', 'Yang Song', [30, 60, 40, 55], 40, 'infantry', 30),
  g('yangren', '杨任', 'Yang Ren', [75, 55, 70, 50], 33, 'infantry'),
  g('yangang2', '杨昂', 'Yang Ang', [72, 45, 65, 40], 32, 'infantry'),
];

// Gongsun Du (Xiangping, Liaodong).
const GONGSUN_DU: General[] = [
  g('gongsundu', '公孙度', 'Gongsun Du', [75, 65, 70, 60], 40, 'cavalry', 100),
  g('liangji', '梁畿', 'Liang Ji', [60, 55, 60, 50], 36, 'infantry'),
];

// Unaligned (wild) generals. locationCityId marks where they can be found via
// the search command.
const WILD: General[] = [
  g('dianwei', '典韦', 'Dian Wei', [96, 30, 75, 25], 28, 'infantry', 50, 'chenliu'),
  g('xuchu', '许褚', 'Xu Chu', [95, 30, 78, 30], 26, 'infantry', 50, 'puyang'),
  g('xunyu', '荀彧', 'Xun Yu', [30, 95, 70, 95], 27, 'infantry', 50, 'xuchang'),
  g('guojia', '郭嘉', 'Guo Jia', [25, 98, 70, 75], 19, 'infantry', 40, 'yecheng'),
  g('taishici', '太史慈', 'Taishi Ci', [92, 70, 85, 60], 24, 'archer', 50, 'beihai'),
  g('chengyu', '程昱', 'Cheng Yu', [60, 92, 78, 85], 49, 'infantry', 50, 'puyang'),
  // Hidden tribute generals — found only by specific generals in specific cities.
  // Ageless youths in their mid-20s; the 99s are their peak stat scores, not
  // their age (without this, they'd die of "old age" by year two).
  g('tongxiao', '通宵虫', 'Tongxiao Chong', [99, 99, 99, 99], 25, 'xuan', 80, 'yunnan'),
  g('nanfang', '南方小鬼', 'Nanfang Xiaogui', [99, 99, 99, 99], 25, 'xuan', 80, 'yunnan'),
];

// Scenario 2 (群雄逐鹿, 196 CE) new general records. Added to GENERALS so their
// ids resolve, but deliberately NOT wired into any FACTION_GENERAL_IDS array:
// Scenario 2 references them via inline generalIds in its scenario file, keeping
// Scenario 1's shared rosters byte-identical. Ownership is assigned by the
// scenario loader (factionId stays null here). caizhong/hanxuan are WILD-style
// searchers found in a specific city, like the WILD entries above.
const S2_NEW: General[] = [
  g('xunyou', '荀攸', 'Xun You', [30, 92, 65, 88], 39, 'infantry'),
  g('yujin', '于禁', 'Yu Jin', [84, 70, 88, 70], 40, 'infantry'),
  g('zhouyu', '周瑜', 'Zhou Yu', [80, 95, 95, 85], 21, 'navy'),
  g('sunquan', '孙权', 'Sun Quan', [55, 80, 75, 88], 14, 'infantry'),
  g('zhoutai', '周泰', 'Zhou Tai', [88, 50, 75, 40], 26, 'navy'),
  g('gaoshun', '高顺', 'Gao Shun', [88, 65, 88, 50], 40, 'infantry'),
  g('zhangliao', '张辽', 'Zhang Liao', [92, 80, 92, 70], 27, 'cavalry'),
  g('zangba', '臧霸', 'Zang Ba', [82, 65, 75, 55], 31, 'cavalry'),
  g('chengong', '陈宫', 'Chen Gong', [35, 90, 70, 80], 41, 'infantry'),
  g('zhangxiu', '张绣', 'Zhang Xiu', [88, 55, 80, 50], 33, 'cavalry'),
  g('liuzhang', '刘璋', 'Liu Zhang', [15, 55, 45, 60], 35, 'infantry'),
  g('chunyuqiong', '淳于琼', 'Chunyu Qiong', [72, 45, 68, 40], 46, 'cavalry'),
  g('guotu', '郭图', 'Guo Tu', [25, 72, 55, 65], 40, 'infantry'),
  g('xinping', '辛评', 'Xin Ping', [30, 70, 50, 68], 40, 'infantry'),
  g('weixu', '魏续', 'Wei Xu', [72, 40, 65, 35], 35, 'cavalry'),
  g('songxian', '宋宪', 'Song Xian', [73, 38, 63, 33], 34, 'cavalry'),
  g('houcheng', '侯成', 'Hou Cheng', [74, 42, 64, 38], 36, 'cavalry'),
  g('caizhong', '蔡中', 'Cai Zhong', [60, 40, 55, 35], 30, 'navy', 80, 'xiapi'),
  g('hanxuan', '韩玄', 'Han Xuan', [55, 45, 58, 50], 45, 'infantry', 80, 'xiliang'),
];

// Scenario 3 (赤壁之战, 208 CE) new general records. Same rule as S2_NEW: added to
// GENERALS so their ids resolve, but deliberately NOT wired into any
// FACTION_GENERAL_IDS array — Scenario 3 references them via inline generalIds in
// its scenario file, keeping Scenario 1/2 shared rosters byte-identical. Ownership
// is assigned by the scenario loader (factionId stays null here). xushu@xuchang and
// pangtong@chaisang are WILD-style searchers (loyalty 40 + a locationCityId), found
// in a specific city like the WILD entries above. Shi Xie is intentionally omitted
// (his faction is dropped in Phase 4).
const S3_NEW: General[] = [
  g('zhugeliang', '诸葛亮', 'Zhuge Liang', [30, 100, 92, 95], 27, 'infantry'),
  g('lusu', '鲁肃', 'Lu Su', [42, 92, 82, 88], 36, 'infantry'),
  g('lvmeng', '吕蒙', 'Lü Meng', [80, 75, 82, 65], 30, 'navy'),
  g('luxun', '陆逊', 'Lu Xun', [60, 82, 78, 82], 25, 'navy'),
  g('ganning', '甘宁', 'Gan Ning', [90, 62, 82, 40], 39, 'navy'),
  g('lingtong', '凌统', 'Ling Tong', [85, 55, 76, 45], 20, 'navy'),
  g('jiangqin', '蒋钦', 'Jiang Qin', [80, 58, 76, 52], 35, 'navy'),
  g('zhangzhao', '张昭', 'Zhang Zhao', [15, 85, 62, 95], 52, 'infantry'),
  g('zhanghong', '张紘', 'Zhang Hong', [15, 80, 55, 90], 55, 'infantry'),
  g('guyong', '顾雍', 'Gu Yong', [20, 78, 58, 92], 40, 'infantry'),
  g('xuhuang', '徐晃', 'Xu Huang', [89, 75, 88, 55], 39, 'infantry'),
  g('simayi', '司马懿', 'Sima Yi', [45, 92, 82, 88], 29, 'infantry'),
  g('mifang', '糜芳', 'Mi Fang', [60, 50, 60, 65], 35, 'infantry'),
  g('sunqian', '孙乾', 'Sun Qian', [25, 72, 45, 78], 45, 'infantry'),
  g('gongsunkang', '公孙康', 'Gongsun Kang', [72, 60, 70, 58], 35, 'cavalry', 100),
  g('xushu', '徐庶', 'Xu Shu', [45, 90, 80, 78], 38, 'infantry', 40, 'xuchang'),
  g('pangtong', '庞统', 'Pang Tong', [40, 96, 85, 75], 29, 'infantry', 40, 'chaisang'),
];

const ALL = [
  ...DONG,
  ...YUAN_SHAO,
  ...YUAN_SHU,
  ...CAO,
  ...GONGSUN_ZAN,
  ...LIU_BEI,
  ...SUN_JIAN,
  ...LIU_BIAO,
  ...LIU_YAN,
  ...MA_HAN,
  ...TAO_QIAN,
  ...KONG_RONG,
  ...LIU_YU,
  ...ZHANG_LU,
  ...GONGSUN_DU,
  ...WILD,
  ...S2_NEW,
  ...S3_NEW,
];

export const GENERALS: Record<GeneralId, General> = Object.fromEntries(
  ALL.map((gen) => [gen.id, gen]),
);

export const GENERAL_IDS = Object.keys(GENERALS);

export const FACTION_GENERAL_IDS = {
  dongzhuo: DONG.map((x) => x.id),
  yuanshao: YUAN_SHAO.map((x) => x.id),
  yuanshu: YUAN_SHU.map((x) => x.id),
  caocao: CAO.map((x) => x.id),
  gongsunzan: GONGSUN_ZAN.map((x) => x.id),
  liubei: LIU_BEI.map((x) => x.id),
  sunjian: SUN_JIAN.map((x) => x.id),
  liubiao: LIU_BIAO.map((x) => x.id),
  liuyan: LIU_YAN.map((x) => x.id),
  mahan: MA_HAN.map((x) => x.id),
  taoqian: TAO_QIAN.map((x) => x.id),
  kongrong: KONG_RONG.map((x) => x.id),
  liuyu: LIU_YU.map((x) => x.id),
  zhanglu: ZHANG_LU.map((x) => x.id),
  gongsundu: GONGSUN_DU.map((x) => x.id),
};
