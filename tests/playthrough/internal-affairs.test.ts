import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import {
  applyMonthlySettlement,
  commerce,
  develop,
  govern,
  patrol,
  plunder,
  recruit,
  search,
} from '../../src/engine/politics.js';

describe('internal-affairs commands move the right stats', () => {
  it('develop raises agriculture, clamped at 100', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 11,
    });
    const before = s0.cities['luoyang']!.agriculture;
    const s1 = develop(s0, { cityId: 'luoyang', generalId: 'jiaxu' });
    expect(s1.cities['luoyang']!.agriculture).toBeGreaterThan(before);
    expect(s1.cities['luoyang']!.agriculture).toBeLessThanOrEqual(100);
  });

  it('commerce raises commerce and a smart governor (high zheng) yields more', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 12,
    });
    const smartGov = commerce(s0, { cityId: 'chenliu', generalId: 'caocao' });
    const dumbGov = commerce(s0, { cityId: 'chenliu', generalId: 'caohong' });
    const smartGain = smartGov.cities['chenliu']!.commerce - s0.cities['chenliu']!.commerce;
    const dumbGain = dumbGov.cities['chenliu']!.commerce - s0.cities['chenliu']!.commerce;
    expect(smartGain).toBeGreaterThanOrEqual(dumbGain);
  });

  it('govern restores loyalty', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 13,
    });
    // Force loyalty low to make the recovery observable.
    const tampered = {
      ...s0,
      cities: {
        ...s0.cities,
        pingyuan: { ...s0.cities['pingyuan']!, loyalty: 30 },
      },
    };
    const after = govern(tampered, { cityId: 'pingyuan', generalId: 'liubei' });
    expect(after.cities['pingyuan']!.loyalty).toBeGreaterThan(30);
  });

  it('patrol nudges agri/commerce/loyalty by 1 each', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'sunjian',
      refData: REF_DATA,
      seed: 14,
    });
    const after = patrol(s0, { cityId: 'changsha', generalId: 'sunjian' });
    expect(after.cities['changsha']!.agriculture).toBe(s0.cities['changsha']!.agriculture + 1);
    expect(after.cities['changsha']!.commerce).toBe(s0.cities['changsha']!.commerce + 1);
    expect(after.cities['changsha']!.loyalty).toBe(s0.cities['changsha']!.loyalty + 1);
  });

  it('recruit consumes gold and food, adds troops', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 15,
    });
    const before = s0.cities['luoyang']!;
    const after = recruit(s0, { cityId: 'luoyang', count: 1000 });
    expect(after.cities['luoyang']!.garrison).toBe(before.garrison + 1000);
    expect(after.cities['luoyang']!.money).toBeLessThan(before.money);
    expect(after.cities['luoyang']!.food).toBeLessThan(before.food);
  });

  it('plunder moves resources out of the city and crashes loyalty', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 16,
    });
    const before = s0.cities['changan']!;
    const after = plunder(s0, { cityId: 'changan' });
    expect(after.cities['changan']!.money).toBeLessThan(before.money);
    expect(after.cities['changan']!.loyalty).toBeLessThan(before.loyalty);
    // The plundered resources should land in a sibling Dong city.
    const siblings = Object.values(after.cities).filter(
      (c) => c.factionId === 'dongzhuo' && c.id !== 'changan',
    );
    const totalSiblingMoney = siblings.reduce((s, c) => s + c.money, 0);
    const beforeSiblingMoney = Object.values(s0.cities)
      .filter((c) => c.factionId === 'dongzhuo' && c.id !== 'changan')
      .reduce((s, c) => s + c.money, 0);
    expect(totalSiblingMoney).toBeGreaterThan(beforeSiblingMoney);
  });

  it('search by Cao Cao at Chenliu can find Dian Wei (wild)', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 17,
    });
    // Cao Cao has zheng 92; the wild Dian Wei sits at Chenliu. Run many tries
    // to overcome the probability gate.
    let state = s0;
    let found = false;
    for (let i = 0; i < 200 && !found; i++) {
      state = search(state, { cityId: 'chenliu', generalId: 'caocao' });
      if (state.generals['dianwei']!.factionId === 'caocao') found = true;
    }
    expect(found).toBe(true);
  });

  it('Easter egg search: Mi Zhu at Yunnan in month 10 has a path to find Tongxiao Chong', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'taoqian',
      refData: REF_DATA,
      seed: 18,
    });
    // Manually relocate Mi Zhu to Yunnan and pretend Tao Qian conquered it.
    const tampered = {
      ...s0,
      month: 10,
      generals: {
        ...s0.generals,
        mizhu: { ...s0.generals['mizhu']!, locationCityId: 'yunnan' },
      },
      cities: {
        ...s0.cities,
        yunnan: {
          ...s0.cities['yunnan']!,
          factionId: 'taoqian',
          generals: ['mizhu'],
        },
      },
    };
    let state = tampered;
    let found = false;
    for (let i = 0; i < 500 && !found; i++) {
      state = search(state, { cityId: 'yunnan', generalId: 'mizhu' });
      if (state.generals['tongxiao']!.factionId === 'taoqian') found = true;
    }
    expect(found).toBe(true);
  });

  it('search outside Yunnan / outside October never finds Tongxiao Chong', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'taoqian',
      refData: REF_DATA,
      seed: 19,
    });
    let state = s0;
    for (let i = 0; i < 200; i++) {
      state = search(state, { cityId: 'xiapi', generalId: 'mizhu' });
    }
    expect(state.generals['tongxiao']!.factionId).toBeNull();
  });

  it('monthly settlement yields food, money and rebellions on low loyalty', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 20,
    });
    const tampered = {
      ...s0,
      cities: {
        ...s0.cities,
        luoyang: { ...s0.cities['luoyang']!, loyalty: 10 },
      },
    };
    const after = applyMonthlySettlement(tampered);
    expect(after.cities['luoyang']!.factionId).toBeNull(); // rebellion
    // A peaceful city should have gained food and money.
    const before = s0.cities['changan']!;
    expect(after.cities['changan']!.food).toBeGreaterThan(before.food);
    expect(after.cities['changan']!.money).toBeGreaterThan(before.money);
  });
});
