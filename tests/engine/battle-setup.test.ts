import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { createBattle } from '../../src/engine/battle/setup.js';

function baseState() {
  return buildInitialState({
    scenario: SCENARIO_DONGZHUO,
    playerFactionId: 'caocao',
    refData: REF_DATA,
    seed: 100,
  });
}

describe('createBattle', () => {
  it('seeds attacker units from generals + troops and defender from garrison/generals', () => {
    const s = baseState();
    // Pick any city with a defender faction + generals.
    const city = Object.values(s.cities).find((c) => c.generals.length > 0 && c.factionId)!;
    const attackerGenerals = ['caocao'];
    const battle = createBattle(s, {
      cityId: city.id,
      attackerFactionId: 'caocao',
      defenderFactionId: city.factionId!,
      attackingGeneralIds: attackerGenerals,
      attackingTroops: 8000,
    });

    const atk = battle.units.filter((u) => u.factionId === 'caocao');
    const def = battle.units.filter((u) => u.factionId === city.factionId);
    expect(atk.length).toBeGreaterThan(0);
    expect(def.length).toBeGreaterThan(0);
    // Attacker troop total equals the committed troops (split across blocks).
    const atkTotal = atk.reduce((n, u) => n + u.troops, 0);
    expect(atkTotal).toBe(8000);
    expect(battle.daysElapsed).toBe(0);
    expect(battle.cityId).toBe(city.id);
    expect(battle.rngCursor).toBe(battle.seed);
  });

  it('places attackers along the bottom edge and defenders near the top wall', () => {
    const s = baseState();
    const city = Object.values(s.cities).find((c) => c.generals.length > 0 && c.factionId)!;
    const battle = createBattle(s, {
      cityId: city.id,
      attackerFactionId: 'caocao',
      defenderFactionId: city.factionId!,
      attackingGeneralIds: ['caocao'],
      attackingTroops: 6000,
    });
    const atk = battle.units.filter((u) => u.factionId === 'caocao' && u.state === 'fielded');
    const def = battle.units.filter((u) => u.factionId === city.factionId && u.state === 'fielded');
    const avg = (us: typeof atk) => us.reduce((n, u) => n + u.pos.y, 0) / us.length;
    expect(avg(atk)).toBeGreaterThan(avg(def)); // attackers lower on the field (higher y)
  });

  it('is deterministic for a given state seed', () => {
    const a = baseState();
    const b = baseState();
    const city = Object.values(a.cities).find((c) => c.generals.length > 0 && c.factionId)!;
    const input = {
      cityId: city.id, attackerFactionId: 'caocao', defenderFactionId: city.factionId!,
      attackingGeneralIds: ['caocao'], attackingTroops: 5000,
    };
    expect(createBattle(a, input)).toEqual(createBattle(b, input));
  });
});
