import { describe, expect, it } from 'vitest';
import { deriveDoctrine } from '../../src/engine/ai/tactics/doctrine.js';
import type { Battle, BattleUnit } from '../../src/engine/types.js';
import type { BattleField } from '../../src/engine/battle/types.js';

function field(): BattleField {
  return { width: 10, height: 8, heights: new Array(80).fill(0), cells: new Array(80).fill('plain'), seed: 1 };
}
function unit(over: Partial<BattleUnit> & Pick<BattleUnit, 'id' | 'factionId'>): BattleUnit {
  return {
    generalId: over.id, troops: 5000, troopType: 'infantry', pos: { x: 0, y: 0 }, morale: 100,
    hasActed: false, state: 'fielded', formationRole: 'center', ...over,
  } as BattleUnit;
}
function battle(units: BattleUnit[]): Battle {
  return { cityId: 'c', attackerFactionId: 'A', defenderFactionId: 'B', daysElapsed: 0,
    units, field: field(), seed: 1, rngCursor: 1, log: [] };
}

describe('deriveDoctrine', () => {
  it('a Lü Bu-type commander (high wu, low zhi, active) is aggressive and low-guile', () => {
    const b = battle([unit({ id: 'lu', factionId: 'A', wu: 100, zhi: 30, command: 65 })]);
    const d = deriveDoctrine(b, 'A', 'active');
    expect(d.aggression).toBeGreaterThan(0.85);
    expect(d.guile).toBeLessThan(0.4);
    expect(d.caution).toBeLessThan(0.2);
  });

  it('a Sima Yi-type commander (high zhi + tong, balanced) is guileful and disciplined', () => {
    const b = battle([unit({ id: 'sima', factionId: 'A', wu: 60, zhi: 98, command: 95 })]);
    const d = deriveDoctrine(b, 'A', 'balanced');
    expect(d.guile).toBeGreaterThan(0.9);
    expect(d.discipline).toBeGreaterThan(0.85);
  });

  it('is comparative: the aggressor out-aggresses the schemer, who out-guiles the aggressor', () => {
    const b = battle([
      unit({ id: 'lu', factionId: 'A', wu: 100, zhi: 30, command: 65 }),
      unit({ id: 'sima', factionId: 'B', wu: 60, zhi: 98, command: 95 }),
    ]);
    const lu = deriveDoctrine(b, 'A', 'active');
    const sima = deriveDoctrine(b, 'B', 'balanced');
    expect(lu.aggression).toBeGreaterThan(sima.aggression);
    expect(sima.guile).toBeGreaterThan(lu.guile);
    expect(sima.discipline).toBeGreaterThan(lu.discipline);
  });

  it('falls back to a personality-only doctrine when a side has no led blocks (garrison only)', () => {
    const b = battle([unit({ id: 'g', factionId: 'A', generalId: '', wu: undefined, zhi: undefined, command: undefined })]);
    const d = deriveDoctrine(b, 'A', 'turtle');
    expect(d.caution).toBeGreaterThan(0.5); // turtle
    expect(Number.isFinite(d.aggression)).toBe(true);
  });

  it('produces deterministic, clamped 0..1 weights', () => {
    const b = battle([unit({ id: 'x', factionId: 'A', wu: 120, zhi: 120, command: 120 })]); // out-of-range guard
    const d1 = deriveDoctrine(b, 'A', 'active');
    const d2 = deriveDoctrine(b, 'A', 'active');
    expect(d1).toEqual(d2);
    for (const v of Object.values(d1)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});
