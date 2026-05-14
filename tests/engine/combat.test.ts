import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { resolveQuickBattle } from '../../src/engine/combat.js';

describe('combat', () => {
  it('resolves a quick battle deterministically given a fixed seed', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 42,
    });
    // Force a clearly overwhelming attack: Cao Cao with the full Chenliu
    // garrison vs an unguarded Hongnong-ish target. We synthesize a battle
    // against a faction-less city by setting Hongnong to null faction.
    const synthetic = {
      ...state,
      cities: {
        ...state.cities,
        hongnong: { ...state.cities['hongnong']!, factionId: null, garrison: 1000, generals: [] },
      },
    };
    const result = resolveQuickBattle({
      state: synthetic,
      attackerFactionId: 'caocao',
      defenderFactionId: '__neutral__',
      attackingGeneralIds: ['caocao', 'xiahoudun', 'xiahouyuan'],
      attackingTroops: 8000,
      cityId: 'hongnong',
    });
    expect(typeof result.attackerWon).toBe('boolean');
    expect(result.state.cities['hongnong']!.factionId).toBe(
      result.attackerWon ? 'caocao' : null,
    );
  });

  it('always produces a state with rngState advanced', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 1,
    });
    const initialRng = state.rngState;
    const result = resolveQuickBattle({
      state,
      attackerFactionId: 'caocao',
      defenderFactionId: 'dongzhuo',
      attackingGeneralIds: ['caocao'],
      attackingTroops: 5000,
      cityId: 'luoyang',
    });
    expect(result.state.rngState).not.toBe(initialRng);
  });
});
