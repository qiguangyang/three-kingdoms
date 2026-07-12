import { describe, expect, it } from 'vitest';
import { FACTION_GENERAL_IDS, GENERALS, findDuplicateId } from '../../src/data/generals/index.js';
import type { TroopType } from '../../src/engine/types.js';

// Appendix A (Phase 3 plan): the 19 Scenario-2 general records. These must
// resolve in GENERALS but must NOT be added to any FACTION_GENERAL_IDS array
// (Scenario 2 references them via inline generalIds, so Scenario 1 rosters stay
// byte-identical).
interface ExpectedGeneral {
  id: string;
  zh: string;
  en: string;
  stats: [number, number, number, number]; // wu / zhi / tong / zheng
  age: number;
  troopType: TroopType;
  locationCityId: string | null; // set only for the two WILD searchers
  loyalty?: number; // defaults to 80 when omitted
}

const S2_NEW_EXPECTED: ExpectedGeneral[] = [
  { id: 'xunyou', zh: '荀攸', en: 'Xun You', stats: [30, 92, 65, 88], age: 39, troopType: 'infantry', locationCityId: null },
  { id: 'yujin', zh: '于禁', en: 'Yu Jin', stats: [84, 70, 88, 70], age: 40, troopType: 'infantry', locationCityId: null },
  { id: 'zhouyu', zh: '周瑜', en: 'Zhou Yu', stats: [80, 95, 95, 85], age: 21, troopType: 'navy', locationCityId: null },
  { id: 'sunquan', zh: '孙权', en: 'Sun Quan', stats: [55, 80, 75, 88], age: 14, troopType: 'infantry', locationCityId: null },
  { id: 'zhoutai', zh: '周泰', en: 'Zhou Tai', stats: [88, 50, 75, 40], age: 26, troopType: 'navy', locationCityId: null },
  { id: 'gaoshun', zh: '高顺', en: 'Gao Shun', stats: [88, 65, 88, 50], age: 40, troopType: 'infantry', locationCityId: null },
  { id: 'zhangliao', zh: '张辽', en: 'Zhang Liao', stats: [92, 80, 92, 70], age: 27, troopType: 'cavalry', locationCityId: null },
  { id: 'zangba', zh: '臧霸', en: 'Zang Ba', stats: [82, 65, 75, 55], age: 31, troopType: 'cavalry', locationCityId: null },
  { id: 'chengong', zh: '陈宫', en: 'Chen Gong', stats: [35, 90, 70, 80], age: 41, troopType: 'infantry', locationCityId: null },
  { id: 'zhangxiu', zh: '张绣', en: 'Zhang Xiu', stats: [88, 55, 80, 50], age: 33, troopType: 'cavalry', locationCityId: null },
  { id: 'liuzhang', zh: '刘璋', en: 'Liu Zhang', stats: [15, 55, 45, 60], age: 35, troopType: 'infantry', locationCityId: null },
  { id: 'chunyuqiong', zh: '淳于琼', en: 'Chunyu Qiong', stats: [72, 45, 68, 40], age: 46, troopType: 'cavalry', locationCityId: null },
  { id: 'guotu', zh: '郭图', en: 'Guo Tu', stats: [25, 72, 55, 65], age: 40, troopType: 'infantry', locationCityId: null },
  { id: 'xinping', zh: '辛评', en: 'Xin Ping', stats: [30, 70, 50, 68], age: 40, troopType: 'infantry', locationCityId: null },
  { id: 'weixu', zh: '魏续', en: 'Wei Xu', stats: [72, 40, 65, 35], age: 35, troopType: 'cavalry', locationCityId: null },
  { id: 'songxian', zh: '宋宪', en: 'Song Xian', stats: [73, 38, 63, 33], age: 34, troopType: 'cavalry', locationCityId: null },
  { id: 'houcheng', zh: '侯成', en: 'Hou Cheng', stats: [74, 42, 64, 38], age: 36, troopType: 'cavalry', locationCityId: null },
  { id: 'caizhong', zh: '蔡中', en: 'Cai Zhong', stats: [60, 40, 55, 35], age: 30, troopType: 'navy', locationCityId: 'xiapi' },
  { id: 'hanxuan', zh: '韩玄', en: 'Han Xuan', stats: [55, 45, 58, 50], age: 45, troopType: 'infantry', locationCityId: 'xiliang' },
];

describe('Scenario 2 new general records (Appendix A)', () => {
  it('adds exactly 19 records', () => {
    expect(S2_NEW_EXPECTED).toHaveLength(19);
  });

  it.each(S2_NEW_EXPECTED)(
    'general $id resolves in GENERALS with the exact Appendix A stats',
    (exp) => {
      const gen = GENERALS[exp.id];
      expect(gen, `Missing general ${exp.id}`).toBeDefined();
      expect(gen.name).toEqual({ zh: exp.zh, en: exp.en });
      expect(gen.stats).toEqual({
        wu: exp.stats[0],
        zhi: exp.stats[1],
        tong: exp.stats[2],
        zheng: exp.stats[3],
      });
      expect(gen.age).toBe(exp.age);
      expect(gen.troopType).toBe(exp.troopType);
      expect(gen.locationCityId).toBe(exp.locationCityId);
      // Ownership is assigned by the scenario loader, never baked into the record.
      expect(gen.factionId).toBeNull();
    },
  );

  it('the two WILD searchers carry loyalty 80 and a locationCityId', () => {
    expect(GENERALS['caizhong'].loyalty).toBe(80);
    expect(GENERALS['caizhong'].locationCityId).toBe('xiapi');
    expect(GENERALS['hanxuan'].loyalty).toBe(80);
    expect(GENERALS['hanxuan'].locationCityId).toBe('xiliang');
  });

  it('does NOT add any of the 19 to Scenario 1 rosters (FACTION_GENERAL_IDS.caocao unchanged)', () => {
    const newIds = new Set(S2_NEW_EXPECTED.map((e) => e.id));
    for (const id of FACTION_GENERAL_IDS.caocao) {
      expect(newIds.has(id), `s2 general ${id} leaked into FACTION_GENERAL_IDS.caocao`).toBe(false);
    }
    // Belt-and-braces: none of the 19 appear in ANY faction roster array.
    for (const [factionId, ids] of Object.entries(FACTION_GENERAL_IDS)) {
      for (const id of ids) {
        expect(newIds.has(id), `s2 general ${id} leaked into FACTION_GENERAL_IDS.${factionId}`).toBe(false);
      }
    }
  });
});

// Appendix A (Phase 4 plan): the 17 Scenario-3 (赤壁之战, 208 CE) general records.
// Same rule as S2_NEW — they must resolve in GENERALS but must NOT be added to
// any FACTION_GENERAL_IDS array (Scenario 3 references them via inline generalIds,
// keeping Scenario 1/2 rosters byte-identical). xushu@xuchang / pangtong@chaisang
// are WILD-style (loyalty 40 + a locationCityId); gongsunkang carries loyalty 100.
const S3_NEW_EXPECTED: ExpectedGeneral[] = [
  { id: 'zhugeliang', zh: '诸葛亮', en: 'Zhuge Liang', stats: [30, 100, 92, 95], age: 27, troopType: 'infantry', locationCityId: null },
  { id: 'lusu', zh: '鲁肃', en: 'Lu Su', stats: [42, 92, 82, 88], age: 36, troopType: 'infantry', locationCityId: null },
  { id: 'lvmeng', zh: '吕蒙', en: 'Lü Meng', stats: [80, 75, 82, 65], age: 30, troopType: 'navy', locationCityId: null },
  { id: 'luxun', zh: '陆逊', en: 'Lu Xun', stats: [60, 82, 78, 82], age: 25, troopType: 'navy', locationCityId: null },
  { id: 'ganning', zh: '甘宁', en: 'Gan Ning', stats: [90, 62, 82, 40], age: 39, troopType: 'navy', locationCityId: null },
  { id: 'lingtong', zh: '凌统', en: 'Ling Tong', stats: [85, 55, 76, 45], age: 20, troopType: 'navy', locationCityId: null },
  { id: 'jiangqin', zh: '蒋钦', en: 'Jiang Qin', stats: [80, 58, 76, 52], age: 35, troopType: 'navy', locationCityId: null },
  { id: 'zhangzhao', zh: '张昭', en: 'Zhang Zhao', stats: [15, 85, 62, 95], age: 52, troopType: 'infantry', locationCityId: null },
  { id: 'zhanghong', zh: '张紘', en: 'Zhang Hong', stats: [15, 80, 55, 90], age: 55, troopType: 'infantry', locationCityId: null },
  { id: 'guyong', zh: '顾雍', en: 'Gu Yong', stats: [20, 78, 58, 92], age: 40, troopType: 'infantry', locationCityId: null },
  { id: 'xuhuang', zh: '徐晃', en: 'Xu Huang', stats: [89, 75, 88, 55], age: 39, troopType: 'infantry', locationCityId: null },
  { id: 'simayi', zh: '司马懿', en: 'Sima Yi', stats: [45, 92, 82, 88], age: 29, troopType: 'infantry', locationCityId: null },
  { id: 'mifang', zh: '糜芳', en: 'Mi Fang', stats: [60, 50, 60, 65], age: 35, troopType: 'infantry', locationCityId: null },
  { id: 'sunqian', zh: '孙乾', en: 'Sun Qian', stats: [25, 72, 45, 78], age: 45, troopType: 'infantry', locationCityId: null },
  { id: 'gongsunkang', zh: '公孙康', en: 'Gongsun Kang', stats: [72, 60, 70, 58], age: 35, troopType: 'cavalry', locationCityId: null, loyalty: 100 },
  { id: 'xushu', zh: '徐庶', en: 'Xu Shu', stats: [45, 90, 80, 78], age: 38, troopType: 'infantry', locationCityId: 'xuchang', loyalty: 40 },
  { id: 'pangtong', zh: '庞统', en: 'Pang Tong', stats: [40, 96, 85, 75], age: 29, troopType: 'infantry', locationCityId: 'chaisang', loyalty: 40 },
];

describe('Scenario 3 new general records (Appendix A)', () => {
  it('adds exactly 17 records', () => {
    expect(S3_NEW_EXPECTED).toHaveLength(17);
  });

  it.each(S3_NEW_EXPECTED)(
    'general $id resolves in GENERALS with the exact Appendix A stats',
    (exp) => {
      const gen = GENERALS[exp.id];
      expect(gen, `Missing general ${exp.id}`).toBeDefined();
      expect(gen.name).toEqual({ zh: exp.zh, en: exp.en });
      expect(gen.stats).toEqual({
        wu: exp.stats[0],
        zhi: exp.stats[1],
        tong: exp.stats[2],
        zheng: exp.stats[3],
      });
      expect(gen.age).toBe(exp.age);
      expect(gen.troopType).toBe(exp.troopType);
      expect(gen.locationCityId).toBe(exp.locationCityId);
      expect(gen.loyalty).toBe(exp.loyalty ?? 80);
      // Ownership is assigned by the scenario loader, never baked into the record.
      expect(gen.factionId).toBeNull();
    },
  );

  it('makes xushu@xuchang and pangtong@chaisang WILD-style (loyalty 40 + locationCityId)', () => {
    expect(GENERALS['xushu'].loyalty).toBe(40);
    expect(GENERALS['xushu'].locationCityId).toBe('xuchang');
    expect(GENERALS['pangtong'].loyalty).toBe(40);
    expect(GENERALS['pangtong'].locationCityId).toBe('chaisang');
  });

  it('does NOT create shixie (his faction is dropped in Phase 4)', () => {
    expect(GENERALS['shixie']).toBeUndefined();
  });

  it('does NOT add any of the 17 to Scenario 1/2 rosters (FACTION_GENERAL_IDS unchanged)', () => {
    const newIds = new Set(S3_NEW_EXPECTED.map((e) => e.id));
    for (const id of FACTION_GENERAL_IDS.caocao) {
      expect(newIds.has(id), `s3 general ${id} leaked into FACTION_GENERAL_IDS.caocao`).toBe(false);
    }
    // Belt-and-braces: none of the 17 appear in ANY faction roster array.
    for (const [factionId, ids] of Object.entries(FACTION_GENERAL_IDS)) {
      for (const id of ids) {
        expect(newIds.has(id), `s3 general ${id} leaked into FACTION_GENERAL_IDS.${factionId}`).toBe(false);
      }
    }
  });
});

// Appendix A (Phase 5 plan): the 32 Scenario-4 (三国鼎立, 220 CE) general records.
// Same rule as S2_NEW/S3_NEW — they must resolve in GENERALS but must NOT be added
// to any FACTION_GENERAL_IDS array (Scenario 4 references them via inline
// generalIds, keeping Scenario 1/2/3 rosters byte-identical). Ownership is assigned
// by the scenario loader (factionId stays null here). dengai@xiangping and
// zhonghui@luoyang are WILD-style (loyalty 40 + a locationCityId); the lords caopi
// and gongsunyuan carry loyalty 100; jiangwei carries loyalty 60 (Wei assigns it
// inline in Task 2).
const S4_NEW_EXPECTED: ExpectedGeneral[] = [
  // Wei
  { id: 'caopi', zh: '曹丕', en: 'Cao Pi', stats: [60, 82, 80, 88], age: 33, troopType: 'cavalry', locationCityId: null, loyalty: 100 },
  { id: 'caozhen', zh: '曹真', en: 'Cao Zhen', stats: [85, 78, 88, 65], age: 35, troopType: 'cavalry', locationCityId: null },
  { id: 'caoxiu', zh: '曹休', en: 'Cao Xiu', stats: [84, 70, 84, 60], age: 42, troopType: 'cavalry', locationCityId: null },
  { id: 'simashi', zh: '司马师', en: 'Sima Shi', stats: [60, 72, 68, 62], age: 12, troopType: 'infantry', locationCityId: null },
  { id: 'simazhao', zh: '司马昭', en: 'Sima Zhao', stats: [55, 66, 62, 60], age: 9, troopType: 'infantry', locationCityId: null },
  { id: 'manchong', zh: '满宠', en: 'Man Chong', stats: [75, 82, 85, 80], age: 58, troopType: 'infantry', locationCityId: null },
  { id: 'tianyu', zh: '田豫', en: 'Tian Yu', stats: [80, 80, 85, 70], age: 50, troopType: 'cavalry', locationCityId: null },
  { id: 'qianzhao', zh: '牵招', en: 'Qian Zhao', stats: [80, 76, 82, 68], age: 50, troopType: 'cavalry', locationCityId: null },
  { id: 'zhongyao', zh: '钟繇', en: 'Zhong Yao', stats: [25, 85, 70, 92], age: 69, troopType: 'infantry', locationCityId: null },
  { id: 'huaxin', zh: '华歆', en: 'Hua Xin', stats: [20, 80, 55, 90], age: 63, troopType: 'infantry', locationCityId: null },
  { id: 'wanglang', zh: '王朗', en: 'Wang Lang', stats: [25, 78, 55, 88], age: 64, troopType: 'infantry', locationCityId: null },
  { id: 'jiangwei', zh: '姜维', en: 'Jiang Wei', stats: [88, 90, 90, 70], age: 18, troopType: 'cavalry', locationCityId: null, loyalty: 60 },
  { id: 'dengai', zh: '邓艾', en: 'Deng Ai', stats: [84, 90, 90, 78], age: 23, troopType: 'infantry', locationCityId: 'xiangping', loyalty: 40 },
  { id: 'zhonghui', zh: '钟会', en: 'Zhong Hui', stats: [75, 90, 85, 80], age: 15, troopType: 'infantry', locationCityId: 'luoyang', loyalty: 40 },
  // Shu
  { id: 'huangzhong', zh: '黄忠', en: 'Huang Zhong', stats: [92, 60, 82, 45], age: 72, troopType: 'archer', locationCityId: null },
  { id: 'weiyan', zh: '魏延', en: 'Wei Yan', stats: [90, 76, 88, 50], age: 42, troopType: 'infantry', locationCityId: null },
  { id: 'jiangwan', zh: '蒋琬', en: 'Jiang Wan', stats: [20, 84, 75, 92], age: 36, troopType: 'infantry', locationCityId: null },
  { id: 'feiyi', zh: '费祎', en: 'Fei Yi', stats: [25, 85, 70, 90], age: 25, troopType: 'infantry', locationCityId: null },
  { id: 'dongyun', zh: '董允', en: 'Dong Yun', stats: [20, 80, 55, 88], age: 26, troopType: 'infantry', locationCityId: null },
  { id: 'maliang', zh: '马良', en: 'Ma Liang', stats: [25, 88, 70, 85], age: 33, troopType: 'infantry', locationCityId: null },
  { id: 'masu', zh: '马谡', en: 'Ma Su', stats: [40, 82, 68, 72], age: 30, troopType: 'infantry', locationCityId: null },
  { id: 'wangping', zh: '王平', en: 'Wang Ping', stats: [80, 70, 84, 50], age: 28, troopType: 'infantry', locationCityId: null },
  { id: 'zhangni', zh: '张嶷', en: 'Zhang Ni', stats: [78, 75, 80, 65], age: 28, troopType: 'infantry', locationCityId: null },
  { id: 'liaohua', zh: '廖化', en: 'Liao Hua', stats: [77, 62, 72, 48], age: 30, troopType: 'infantry', locationCityId: null },
  { id: 'guanxing', zh: '关兴', en: 'Guan Xing', stats: [85, 65, 78, 55], age: 20, troopType: 'cavalry', locationCityId: null },
  { id: 'zhangbao', zh: '张苞', en: 'Zhang Bao', stats: [86, 45, 72, 40], age: 20, troopType: 'cavalry', locationCityId: null },
  // Wu
  { id: 'xusheng', zh: '徐盛', en: 'Xu Sheng', stats: [82, 72, 82, 55], age: 40, troopType: 'navy', locationCityId: null },
  { id: 'dingfeng', zh: '丁奉', en: 'Ding Feng', stats: [85, 68, 80, 45], age: 24, troopType: 'navy', locationCityId: null },
  { id: 'panzhang', zh: '潘璋', en: 'Pan Zhang', stats: [84, 55, 76, 40], age: 45, troopType: 'navy', locationCityId: null },
  { id: 'zhugejin', zh: '诸葛瑾', en: 'Zhuge Jin', stats: [25, 82, 72, 85], age: 46, troopType: 'infantry', locationCityId: null },
  { id: 'buzhi', zh: '步骘', en: 'Bu Zhi', stats: [30, 80, 70, 85], age: 44, troopType: 'infantry', locationCityId: null },
  // Liaodong
  { id: 'gongsunyuan', zh: '公孙渊', en: 'Gongsun Yuan', stats: [68, 62, 70, 60], age: 25, troopType: 'cavalry', locationCityId: null, loyalty: 100 },
];

describe('Scenario 4 new general records (Appendix A)', () => {
  it('adds exactly 32 records', () => {
    expect(S4_NEW_EXPECTED).toHaveLength(32);
  });

  it.each(S4_NEW_EXPECTED)(
    'general $id resolves in GENERALS with the exact Appendix A stats',
    (exp) => {
      const gen = GENERALS[exp.id];
      expect(gen, `Missing general ${exp.id}`).toBeDefined();
      expect(gen.name).toEqual({ zh: exp.zh, en: exp.en });
      expect(gen.stats).toEqual({
        wu: exp.stats[0],
        zhi: exp.stats[1],
        tong: exp.stats[2],
        zheng: exp.stats[3],
      });
      expect(gen.age).toBe(exp.age);
      expect(gen.troopType).toBe(exp.troopType);
      expect(gen.locationCityId).toBe(exp.locationCityId);
      expect(gen.loyalty).toBe(exp.loyalty ?? 80);
      // Ownership is assigned by the scenario loader, never baked into the record.
      expect(gen.factionId).toBeNull();
    },
  );

  it('makes dengai@xiangping and zhonghui@luoyang WILD-style (loyalty 40 + locationCityId)', () => {
    expect(GENERALS['dengai'].loyalty).toBe(40);
    expect(GENERALS['dengai'].locationCityId).toBe('xiangping');
    expect(GENERALS['zhonghui'].loyalty).toBe(40);
    expect(GENERALS['zhonghui'].locationCityId).toBe('luoyang');
  });

  it('makes the lords caopi and gongsunyuan loyalty 100, and jiangwei loyalty 60', () => {
    expect(GENERALS['caopi'].loyalty).toBe(100);
    expect(GENERALS['gongsunyuan'].loyalty).toBe(100);
    expect(GENERALS['jiangwei'].loyalty).toBe(60);
  });

  it('does NOT add any of the 32 to Scenario 1/2/3 rosters (FACTION_GENERAL_IDS unchanged)', () => {
    const newIds = new Set(S4_NEW_EXPECTED.map((e) => e.id));
    for (const id of FACTION_GENERAL_IDS.caocao) {
      expect(newIds.has(id), `s4 general ${id} leaked into FACTION_GENERAL_IDS.caocao`).toBe(false);
    }
    // Belt-and-braces: none of the 32 appear in ANY faction roster array.
    for (const [factionId, ids] of Object.entries(FACTION_GENERAL_IDS)) {
      for (const id of ids) {
        expect(newIds.has(id), `s4 general ${id} leaked into FACTION_GENERAL_IDS.${factionId}`).toBe(false);
      }
    }
  });
});

// Guard: GENERALS is assembled via Object.fromEntries (last-wins), so a
// duplicate id would silently overwrite an existing officer and change another
// scenario's roster undetected. findDuplicateId + a module-init throw prevent it.
describe('no duplicate general ids', () => {
  it('findDuplicateId returns the first repeated id, else null', () => {
    expect(findDuplicateId([{ id: 'a' }, { id: 'b' }, { id: 'a' }])).toBe('a');
    expect(findDuplicateId([{ id: 'a' }, { id: 'b' }])).toBeNull();
    expect(findDuplicateId([])).toBeNull();
  });

  it('the shipped generals data has no duplicate ids', () => {
    // If a future roster addition collides, the module-init guard throws at
    // import (failing the whole suite); this asserts the current data is clean.
    expect(findDuplicateId(Object.values(GENERALS))).toBeNull();
  });
});
