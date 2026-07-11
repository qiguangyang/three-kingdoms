import { describe, expect, it } from 'vitest';
import { CITIES } from '../../src/data/cities.js';
import { GENERALS } from '../../src/data/generals/index.js';
import { REF_DATA } from '../../src/data/index.js';
import { SCENARIO_CHIBI, SCENARIO_JUNXIONG, SCENARIO_LIST } from '../../src/data/scenarios/index.js';
import { buildInitialState } from '../../src/engine/scenario.js';

describe('Scenario 2 (群雄逐鹿) roster', () => {
  it('is implemented (todo removed) and selectable in the scenario list', () => {
    expect(SCENARIO_JUNXIONG.todo).toBeFalsy();
    expect(SCENARIO_LIST).toContain(SCENARIO_JUNXIONG);
    expect(SCENARIO_JUNXIONG.startYear).toBe(196);
    expect(SCENARIO_JUNXIONG.startMonth).toBe(1);
    expect(SCENARIO_JUNXIONG.victory).toEqual({ kind: 'unify' });
    expect(SCENARIO_JUNXIONG.factions.length).toBe(12);
  });

  it('builds an initial state with all 12 factions alive', () => {
    const state = buildInitialState({
      scenario: SCENARIO_JUNXIONG,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 1,
    });
    expect(Object.keys(state.factions)).toHaveLength(12);
    for (const f of Object.values(state.factions)) {
      expect(f.alive, `faction ${f.id} should be alive`).toBe(true);
    }
  });

  it('every faction cityId / generalId in Appendix B resolves in the reference data', () => {
    for (const f of SCENARIO_JUNXIONG.factions) {
      for (const cityId of f.cityIds) {
        expect(CITIES[cityId], `Missing city ${cityId} for faction ${f.id}`).toBeDefined();
      }
      for (const generalId of f.generalIds) {
        expect(
          GENERALS[generalId],
          `Missing general ${generalId} for faction ${f.id}`,
        ).toBeDefined();
      }
    }
  });

  it('assigns generals to the correct faction (inline rosters differ from s1)', () => {
    const state = buildInitialState({
      scenario: SCENARIO_JUNXIONG,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 1,
    });
    // s2-only generals wired to their s2 factions.
    expect(state.generals['zhouyu'].factionId).toBe('sunce');
    expect(state.generals['sunquan'].factionId).toBe('sunce');
    expect(state.generals['xunyu'].factionId).toBe('caocao');
    expect(state.generals['xunyou'].factionId).toBe('caocao');
    expect(state.generals['guojia'].factionId).toBe('caocao');
    expect(state.generals['zhangliao'].factionId).toBe('lvbu');
    expect(state.generals['zhangxiu'].factionId).toBe('zhangxiu');
    expect(state.generals['jiaxu'].factionId).toBe('zhangxiu');
    expect(state.generals['liuzhang'].factionId).toBe('liuzhang');
    expect(state.generals['machao'].factionId).toBe('mahan');
  });

  it('gives Liu Bei only Xiaopei and holds Cao out of Wancheng', () => {
    const state = buildInitialState({
      scenario: SCENARIO_JUNXIONG,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 1,
    });
    expect(state.cities['xiaopei'].factionId).toBe('liubei');
    // Wancheng belongs to Zhang Xiu, not Cao Cao.
    expect(state.cities['wancheng'].factionId).toBe('zhangxiu');
    expect(state.cities['xuchang'].factionId).toBe('caocao');
    expect(state.cities['chenliu'].factionId).toBe('caocao');
    expect(state.cities['puyang'].factionId).toBe('caocao');
  });

  it('applies the era-variant overrides making Sun Ce and Ma Chao adults', () => {
    const state = buildInitialState({
      scenario: SCENARIO_JUNXIONG,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 1,
    });
    expect(state.generals['sunce'].stats.wu).toBe(92);
    expect(state.generals['sunce'].age).toBe(21);
    expect(state.generals['machao'].stats.wu).toBe(95);
    expect(state.generals['machao'].age).toBe(21);
  });

  it('has exclusive city ownership (no city owned by two factions)', () => {
    const seen = new Map<string, string>();
    for (const f of SCENARIO_JUNXIONG.factions) {
      for (const cityId of f.cityIds) {
        expect(
          seen.has(cityId),
          `City ${cityId} claimed by both ${seen.get(cityId)} and ${f.id}`,
        ).toBe(false);
        seen.set(cityId, f.id);
      }
    }
  });

  it('has exclusive general ownership (no general in two factions)', () => {
    const seen = new Map<string, string>();
    for (const f of SCENARIO_JUNXIONG.factions) {
      for (const generalId of f.generalIds) {
        expect(
          seen.has(generalId),
          `General ${generalId} claimed by both ${seen.get(generalId)} and ${f.id}`,
        ).toBe(false);
        seen.set(generalId, f.id);
      }
    }
  });
});

describe('Scenario 3 (赤壁之战) roster', () => {
  it('is implemented (todo removed) and selectable in the scenario list', () => {
    expect(SCENARIO_CHIBI.todo).toBeFalsy();
    expect(SCENARIO_LIST).toContain(SCENARIO_CHIBI);
    expect(SCENARIO_CHIBI.startYear).toBe(208);
    expect(SCENARIO_CHIBI.startMonth).toBe(7);
    expect(SCENARIO_CHIBI.victory).toEqual({ kind: 'unify' });
    expect(SCENARIO_CHIBI.factions.length).toBe(7);
  });

  it('builds an initial state with all 7 factions alive', () => {
    const state = buildInitialState({
      scenario: SCENARIO_CHIBI,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 1,
    });
    expect(Object.keys(state.factions)).toHaveLength(7);
    for (const f of Object.values(state.factions)) {
      expect(f.alive, `faction ${f.id} should be alive`).toBe(true);
    }
  });

  it('every faction cityId / generalId in Appendix B resolves in the reference data', () => {
    for (const f of SCENARIO_CHIBI.factions) {
      for (const cityId of f.cityIds) {
        expect(CITIES[cityId], `Missing city ${cityId} for faction ${f.id}`).toBeDefined();
      }
      for (const generalId of f.generalIds) {
        expect(
          GENERALS[generalId],
          `Missing general ${generalId} for faction ${f.id}`,
        ).toBeDefined();
      }
    }
  });

  it('assigns the 208 CE generals to the correct factions', () => {
    const state = buildInitialState({
      scenario: SCENARIO_CHIBI,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 1,
    });
    expect(state.generals['zhugeliang'].factionId).toBe('liubei');
    expect(state.generals['zhouyu'].factionId).toBe('sunquan');
    expect(state.generals['lusu'].factionId).toBe('sunquan');
    expect(state.generals['simayi'].factionId).toBe('caocao');
    expect(state.generals['xuhuang'].factionId).toBe('caocao');
    expect(state.generals['zhangliao'].factionId).toBe('caocao');
    expect(state.generals['machao'].factionId).toBe('mahan');
    expect(state.generals['gongsunkang'].factionId).toBe('gongsunkang');
    // WILD searchers belong to no faction.
    expect(state.generals['xushu'].factionId).toBeNull();
    expect(state.generals['pangtong'].factionId).toBeNull();
  });

  it('gives Liu Bei only Jiangxia; Cao Cao holds 22 cities incl. Xiangyang + Jiangling', () => {
    const state = buildInitialState({
      scenario: SCENARIO_CHIBI,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 1,
    });
    expect(state.cities['jiangxia'].factionId).toBe('liubei');
    const caoCities = Object.values(state.cities).filter((c) => c.factionId === 'caocao');
    expect(caoCities).toHaveLength(22);
    expect(state.cities['xiangyang'].factionId).toBe('caocao');
    expect(state.cities['jiangling'].factionId).toBe('caocao');
  });

  it('leaves the four southern Jing commanderies neutral (unowned)', () => {
    const state = buildInitialState({
      scenario: SCENARIO_CHIBI,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 1,
    });
    for (const cityId of ['changsha', 'guiyang', 'wuling', 'lingling']) {
      expect(state.cities[cityId].factionId, `${cityId} should be neutral`).toBeNull();
    }
  });

  it('accounts for all 42 cities: 38 owned + 4 neutral', () => {
    const owned = SCENARIO_CHIBI.factions.reduce((n, f) => n + f.cityIds.length, 0);
    expect(owned).toBe(38);
    const state = buildInitialState({
      scenario: SCENARIO_CHIBI,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 1,
    });
    const neutral = Object.values(state.cities).filter((c) => c.factionId === null);
    expect(neutral).toHaveLength(4);
    expect(Object.keys(state.cities)).toHaveLength(42);
  });

  it('applies the era-variant override making Sun Quan the adult lord', () => {
    const state = buildInitialState({
      scenario: SCENARIO_CHIBI,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 1,
    });
    expect(state.generals['sunquan'].stats.zhi).toBe(85);
    expect(state.generals['sunquan'].age).toBe(26);
    expect(state.generals['liubei'].stats.zhi).toBe(80);
    expect(state.generals['liubei'].age).toBe(47);
    expect(state.generals['machao'].stats.wu).toBe(95);
    expect(state.generals['machao'].age).toBe(32);
  });

  it('has exclusive city ownership (no city owned by two factions)', () => {
    const seen = new Map<string, string>();
    for (const f of SCENARIO_CHIBI.factions) {
      for (const cityId of f.cityIds) {
        expect(
          seen.has(cityId),
          `City ${cityId} claimed by both ${seen.get(cityId)} and ${f.id}`,
        ).toBe(false);
        seen.set(cityId, f.id);
      }
    }
  });

  it('has exclusive general ownership (no general in two factions)', () => {
    const seen = new Map<string, string>();
    for (const f of SCENARIO_CHIBI.factions) {
      for (const generalId of f.generalIds) {
        expect(
          seen.has(generalId),
          `General ${generalId} claimed by both ${seen.get(generalId)} and ${f.id}`,
        ).toBe(false);
        seen.set(generalId, f.id);
      }
    }
  });
});
