import { describe, expect, it } from 'vitest';
import { assessBattle } from '../../src/engine/ai/tactics/assessment.js';
import type { Battle, BattleUnit } from '../../src/engine/types.js';
import type { BattleField } from '../../src/engine/battle/types.js';

export function flatField(w = 12, h = 10): BattleField {
  return { width: w, height: h, heights: new Array(w * h).fill(0), cells: new Array(w * h).fill('plain'), seed: 3 };
}
export function u(over: Partial<BattleUnit> & Pick<BattleUnit, 'id' | 'factionId' | 'pos'>): BattleUnit {
  return { generalId: over.id, troops: 5000, troopType: 'infantry', morale: 100, hasActed: false,
    state: 'fielded', formationRole: 'center', ...over } as BattleUnit;
}
export function mkBattle(units: BattleUnit[], field: BattleField = flatField()): Battle {
  return { cityId: 'c', attackerFactionId: 'A', defenderFactionId: 'B', daysElapsed: 0,
    units, field, seed: 9, rngCursor: 9, log: [] };
}

describe('assessBattle', () => {
  it('sums fielded troops per side and computes advantage', () => {
    const b = mkBattle([
      u({ id: 'a1', factionId: 'A', pos: { x: 2, y: 8 }, troops: 8000 }),
      u({ id: 'e1', factionId: 'B', pos: { x: 2, y: 2 }, troops: 4000 }),
    ]);
    const a = assessBattle(b, 'A');
    expect(a.myFielded).toBe(8000);
    expect(a.enemyFielded).toBe(4000);
    expect(a.advantage).toBeCloseTo(2, 5);
  });

  it('lists my reserve unit ids', () => {
    const b = mkBattle([
      u({ id: 'a1', factionId: 'A', pos: { x: 2, y: 8 } }),
      u({ id: 'ar', factionId: 'A', pos: { x: 3, y: 9 }, state: 'reserve' }),
      u({ id: 'e1', factionId: 'B', pos: { x: 2, y: 2 } }),
    ]);
    expect(assessBattle(b, 'A').reserveUnitIds).toEqual(['ar']);
  });

  it('picks the weakest active enemy as the priority target', () => {
    const b = mkBattle([
      u({ id: 'a1', factionId: 'A', pos: { x: 2, y: 8 } }),
      u({ id: 'strong', factionId: 'B', pos: { x: 2, y: 2 }, troops: 9000 }),
      u({ id: 'weak', factionId: 'B', pos: { x: 5, y: 2 }, troops: 1200 }),
    ]);
    expect(assessBattle(b, 'A').priorityTargetId).toBe('weak');
  });

  it('has a null priority target when no enemy is active', () => {
    const b = mkBattle([u({ id: 'a1', factionId: 'A', pos: { x: 2, y: 8 } })]);
    const a = assessBattle(b, 'A');
    expect(a.priorityTargetId).toBeNull();
    expect(a.advantage).toBeGreaterThan(0);
  });
});
