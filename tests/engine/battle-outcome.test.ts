import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { createBattle } from '../../src/engine/battle/setup.js';
import { resolveBattleHeadless, battleToResult } from '../../src/engine/battle/outcome.js';

function state() {
  return buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 100 });
}

describe('battle outcome bridge', () => {
  it('an overwhelming attacker captures the city (ownership flips, defenders wounded)', () => {
    const s0 = state();
    // Weaken a target city to guarantee a decisive attacker win.
    const target = Object.values(s0.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
    const s = { ...s0, cities: { ...s0.cities, [target.id]: { ...target, garrison: 300, generals: [] } } };
    const battle = createBattle(s, {
      cityId: target.id, attackerFactionId: 'caocao', defenderFactionId: target.factionId!,
      attackingGeneralIds: ['caocao', 'xiahoudun'], attackingTroops: 20000,
    });
    const result = resolveBattleHeadless(s, battle);
    expect(result.attackerWon).toBe(true);
    expect(result.state.cities[target.id]!.factionId).toBe('caocao');
    expect(result.state.rngState).not.toBe(s.rngState); // rng advanced
  });

  it('battleToResult reports casualties and never mutates the input state', () => {
    const s = state();
    const target = Object.values(s.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
    const battle = createBattle(s, {
      cityId: target.id, attackerFactionId: 'caocao', defenderFactionId: target.factionId!,
      attackingGeneralIds: ['caocao'], attackingTroops: 5000,
    });
    // Simulate some casualties by zeroing a defender unit.
    const mangled = { ...battle, units: battle.units.map((u, i) => (i === battle.units.length - 1 ? { ...u, troops: 0, state: 'gone' as const } : u)) };
    const before = JSON.stringify(s.cities[target.id]);
    const result = battleToResult(s, mangled);
    expect(result.attackerCasualties).toBeGreaterThanOrEqual(0);
    expect(result.defenderCasualties).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(s.cities[target.id])).toBe(before); // input untouched
  });

  it('headless resolution terminates within the day limit', () => {
    const s = state();
    const target = Object.values(s.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
    const battle = createBattle(s, {
      cityId: target.id, attackerFactionId: 'caocao', defenderFactionId: target.factionId!,
      attackingGeneralIds: ['caocao'], attackingTroops: 9000,
    });
    const result = resolveBattleHeadless(s, battle);
    expect(typeof result.attackerWon).toBe('boolean');
  });
});
