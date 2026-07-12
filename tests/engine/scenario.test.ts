import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';

describe('scenario s1-dongzhuo', () => {
  it('builds an initial state with all referenced cities and generals', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 1,
    });
    // Every faction's cityIds and generalIds resolve cleanly.
    for (const setup of SCENARIO_DONGZHUO.factions) {
      for (const cid of setup.cityIds) {
        expect(state.cities[cid]).toBeDefined();
        expect(state.cities[cid]!.factionId).toBe(setup.id);
      }
      for (const gid of setup.generalIds) {
        expect(state.generals[gid]).toBeDefined();
        expect(state.generals[gid]!.factionId).toBe(setup.id);
      }
    }
    // Player faction is the one we asked for.
    expect(state.playerFactionId).toBe('dongzhuo');
    expect(state.year).toBe(189);
    expect(state.month).toBe(9);
  });

  it('distributes pooled resources across each faction\'s cities', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 1,
    });
    const chenliu = state.cities['chenliu'];
    expect(chenliu).toBeDefined();
    expect(chenliu!.money).toBe(15000);
    expect(chenliu!.food).toBe(20000);
    expect(chenliu!.garrison).toBe(8000);
  });

  it('places stationed generals in their faction\'s capital city', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 1,
    });
    const liubei = state.generals['liubei'];
    expect(liubei!.locationCityId).toBe('pingyuan');
    expect(state.cities['pingyuan']!.generals).toContain('liubei');
  });

  it('applies generalOverrides (era-variant stats) at build time', () => {
    // sunce is a teenager in the base GENERALS table; scenario-level
    // overrides let a later era load an adult variant without mutating the
    // shared base or Scenario 1.
    const base = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 1,
    });
    const baseSunce = base.generals['sunce']!;
    // Sanity: the base record is the teenaged version.
    expect(baseSunce.age).toBe(13);

    const overridden = buildInitialState({
      scenario: {
        ...SCENARIO_DONGZHUO,
        generalOverrides: {
          sunce: {
            stats: { wu: 92, zhi: 75, tong: 88, zheng: 70 },
            age: 21,
          },
        },
      },
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 1,
    });
    const sunce = overridden.generals['sunce']!;
    expect(sunce.stats.wu).toBe(92);
    expect(sunce.age).toBe(21);

    // A build WITHOUT the override is left untouched (Scenario 1 unaffected)
    // and the base GENERALS table was not mutated.
    expect(base.generals['sunce']!.stats.wu).toBe(baseSunce.stats.wu);
    expect(base.generals['sunce']!.age).toBe(13);
  });

  it('shallow-merges a partial stats override, keeping other dims', () => {
    const base = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 1,
    });
    const baseSunce = base.generals['sunce']!;

    const overridden = buildInitialState({
      scenario: {
        ...SCENARIO_DONGZHUO,
        generalOverrides: { sunce: { stats: { wu: 99 } } },
      },
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 1,
    });
    const sunce = overridden.generals['sunce']!;
    // Overridden dimension replaced; the rest come from the base record.
    expect(sunce.stats.wu).toBe(99);
    expect(sunce.stats.zhi).toBe(baseSunce.stats.zhi);
    expect(sunce.stats.tong).toBe(baseSunce.stats.tong);
    expect(sunce.stats.zheng).toBe(baseSunce.stats.zheng);
    // Fields not present in the patch are unchanged.
    expect(sunce.age).toBe(baseSunce.age);
  });

  it('refuses to build a todo (stub) scenario', () => {
    expect(() =>
      buildInitialState({
        scenario: { id: 's2-junxiong', name: { zh: 'x', en: 'x' }, description: { zh: 'x', en: 'x' }, startYear: 0, startMonth: 1, factions: [], victory: { kind: 'unify' }, todo: true },
        playerFactionId: 'foo',
        refData: REF_DATA,
        seed: 1,
      }),
    ).toThrow();
  });
});
