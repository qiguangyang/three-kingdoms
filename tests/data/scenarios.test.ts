import { describe, expect, it } from 'vitest';
import { CITIES } from '../../src/data/cities.js';
import { GENERALS } from '../../src/data/generals/index.js';
import { REF_DATA } from '../../src/data/index.js';
import { SCENARIO_JUNXIONG, SCENARIO_LIST } from '../../src/data/scenarios/index.js';
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
