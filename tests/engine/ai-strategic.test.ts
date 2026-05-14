import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { strategicRules, internalAffairsCommands, recruitmentCommands, concentrationCommands } from '../../src/engine/ai/strategic.js';
import { factionGenerals } from '../../src/engine/selectors.js';
import type { FactionStrategy } from '../../src/engine/types.js';
import { PERSONALITY_PRESETS } from '../../src/engine/ai/personality.js';
import { makeTopology } from './_ai-fixtures.js';
import { militaryCommands } from '../../src/engine/ai/strategic.js';
import { siegeOp } from './_ai-fixtures.js';

describe('strategic AI', () => {
  it('always emits an endTurn command at the end', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 5,
    });
    const cmds = strategicRules({ state, factionId: 'dongzhuo' }, 'active');
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds[cmds.length - 1]!.kind).toBe('endTurn');
  });

  it('prioritizes governance when loyalty is below 30', () => {
    const baseState = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 6,
    });
    const broken = {
      ...baseState,
      cities: {
        ...baseState.cities,
        luoyang: { ...baseState.cities['luoyang']!, loyalty: 15 },
      },
    };
    const cmds = strategicRules({ state: broken, factionId: 'dongzhuo' }, 'balanced');
    expect(cmds.some((c) => c.kind === 'govern' && c.cityId === 'luoyang')).toBe(true);
  });
});

describe('internalAffairsCommands', () => {
  it('emits up to two distinct internal-affairs actions for a needy city', () => {
    const base = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 7,
    });
    // Make Dong Zhuo's Luoyang both disloyal and short on food.
    const luoyang = base.cities['luoyang']!;
    const state = {
      ...base,
      cities: {
        ...base.cities,
        luoyang: { ...luoyang, loyalty: 12, food: 10, garrison: 9000 },
      },
    };
    const generals = factionGenerals(state, 'dongzhuo');
    const cmds = internalAffairsCommands(state, 'dongzhuo', generals);
    const forLuoyang = cmds.filter(
      (c) => 'cityId' in c && c.cityId === 'luoyang',
    );
    expect(forLuoyang.length).toBe(2);
    expect(forLuoyang.some((c) => c.kind === 'govern')).toBe(true);
    expect(forLuoyang.some((c) => c.kind === 'develop')).toBe(true);
  });
});

describe('recruitmentCommands', () => {
  it('recruits hardest at the staging city when expanding', () => {
    const base = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 8,
    });
    // Give Dong Zhuo's cities plenty of gold so affordability never blocks.
    const cities = { ...base.cities };
    for (const c of Object.values(cities)) {
      if (c.factionId === 'dongzhuo') {
        cities[c.id] = { ...c, money: 500000, garrison: 5000 };
      }
    }
    const state = { ...base, cities };
    const stagingId = Object.values(cities).find((c) => c.factionId === 'dongzhuo')!.id;
    const strategy: FactionStrategy = {
      posture: 'expand',
      targetFactionId: 'caocao',
      targetCityId: 'chenliu',
      stagingCityId: stagingId,
      updatedTurn: 0,
    };
    const cmds = recruitmentCommands(state, 'dongzhuo', strategy);
    const staging = cmds.find(
      (c) => c.kind === 'recruit' && c.cityId === stagingId,
    );
    expect(staging).toBeDefined();
    expect(staging && staging.kind === 'recruit' && staging.count).toBe(2000);
  });

  it('skips cities that cannot afford even a small draft', () => {
    const base = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 8,
    });
    const cities = { ...base.cities };
    for (const c of Object.values(cities)) {
      if (c.factionId === 'dongzhuo') cities[c.id] = { ...c, money: 0 };
    }
    const state = { ...base, cities };
    const strategy: FactionStrategy = {
      posture: 'consolidate',
      targetFactionId: null,
      targetCityId: null,
      stagingCityId: null,
      updatedTurn: 0,
    };
    expect(recruitmentCommands(state, 'dongzhuo', strategy)).toEqual([]);
  });
});

describe('concentrationCommands', () => {
  it('moves troops from a safe interior city toward the staging city', () => {
    // luoyang (staging, borders enemy chenliu) + anding (interior, safe).
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 8000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 8000 },
      { id: 'anding', factionId: 'dongzhuo', pos: { x: 60, y: 30 }, garrison: 10000 },
    ]);
    const generals = factionGenerals(state, 'dongzhuo');
    const strategy: FactionStrategy = {
      posture: 'expand',
      targetFactionId: 'caocao',
      targetCityId: 'chenliu',
      stagingCityId: 'luoyang',
      updatedTurn: 0,
    };
    const cmds = concentrationCommands(
      state,
      'dongzhuo',
      strategy,
      generals,
      PERSONALITY_PRESETS.active,
    );
    const move = cmds.find((c) => c.kind === 'move');
    expect(move).toBeDefined();
    expect(move && move.kind === 'move' && move.fromCityId).toBe('anding');
    expect(move && move.kind === 'move' && move.toCityId).toBe('luoyang');
  });

  it('grabs an adjacent neutral city when troops are spare', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 9000 },
      { id: 'chenliu', factionId: null, pos: { x: 12, y: 10 }, garrison: 1000 },
    ]);
    const generals = factionGenerals(state, 'dongzhuo');
    const strategy: FactionStrategy = {
      posture: 'consolidate',
      targetFactionId: null,
      targetCityId: null,
      stagingCityId: null,
      updatedTurn: 0,
    };
    const cmds = concentrationCommands(
      state,
      'dongzhuo',
      strategy,
      generals,
      PERSONALITY_PRESETS.balanced,
    );
    const grab = cmds.find((c) => c.kind === 'attack');
    expect(grab).toBeDefined();
    expect(grab && grab.kind === 'attack' && grab.toCityId).toBe('chenliu');
  });
});

describe('militaryCommands', () => {
  it('assaults the target once the staging force clears the threshold', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 30000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 4000 },
    ]);
    const generals = factionGenerals(state, 'dongzhuo');
    const strategy: FactionStrategy = {
      posture: 'expand',
      targetFactionId: 'caocao',
      targetCityId: 'chenliu',
      stagingCityId: 'luoyang',
      updatedTurn: 0,
    };
    const cmds = militaryCommands(
      state,
      'dongzhuo',
      strategy,
      generals,
      PERSONALITY_PRESETS.active,
    );
    const attack = cmds.find((c) => c.kind === 'attack');
    expect(attack).toBeDefined();
    expect(attack && attack.kind === 'attack' && attack.toCityId).toBe('chenliu');
  });

  it('does not assault while the staging force is too thin', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 4000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 30000 },
    ]);
    const generals = factionGenerals(state, 'dongzhuo');
    const strategy: FactionStrategy = {
      posture: 'expand',
      targetFactionId: 'caocao',
      targetCityId: 'chenliu',
      stagingCityId: 'luoyang',
      updatedTurn: 0,
    };
    const cmds = militaryCommands(
      state,
      'dongzhuo',
      strategy,
      generals,
      PERSONALITY_PRESETS.turtle,
    );
    expect(cmds.find((c) => c.kind === 'attack')).toBeUndefined();
  });

  it('reinforces a threatened city from a safe neighbor when defending', () => {
    let state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 2000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 9000 },
      { id: 'anding', factionId: 'dongzhuo', pos: { x: 11, y: 11 }, garrison: 10000 },
    ]);
    state = { ...state, pendingOps: [siegeOp('luoyang', 'caocao')] };
    const generals = factionGenerals(state, 'dongzhuo');
    const strategy: FactionStrategy = {
      posture: 'defend',
      targetFactionId: null,
      targetCityId: null,
      stagingCityId: null,
      updatedTurn: 0,
    };
    const cmds = militaryCommands(
      state,
      'dongzhuo',
      strategy,
      generals,
      PERSONALITY_PRESETS.balanced,
    );
    const move = cmds.find((c) => c.kind === 'move');
    expect(move).toBeDefined();
    expect(move && move.kind === 'move' && move.toCityId).toBe('luoyang');
    expect(move && move.kind === 'move' && move.fromCityId).toBe('anding');
  });
});
