import { describe, expect, it } from 'vitest';
import { FACTION_GENERAL_IDS, GENERALS } from '../../src/data/generals/index.js';
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
