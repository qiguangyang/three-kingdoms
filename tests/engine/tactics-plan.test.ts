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

import { planTactical } from '../../src/engine/ai/tactics/plan.js';

const kinds = (cmds: ReturnType<typeof planTactical>) => cmds.map((c) => c.kind);
const forUnit = (cmds: ReturnType<typeof planTactical>, id: string) =>
  cmds.find((c) => 'unitId' in c && (c as { unitId: string }).unitId === id);

describe('planTactical', () => {
  it('returns no commands when there is no active enemy', () => {
    const b = mkBattle([u({ id: 'a1', factionId: 'A', pos: { x: 2, y: 8 } })]);
    expect(planTactical(b, 'A', 'balanced')).toEqual([]);
  });

  it('issues at most one command per fielded unit', () => {
    const b = mkBattle([
      u({ id: 'a1', factionId: 'A', pos: { x: 2, y: 8 } }),
      u({ id: 'a2', factionId: 'A', pos: { x: 5, y: 8 } }),
      u({ id: 'e1', factionId: 'B', pos: { x: 3, y: 2 } }),
    ]);
    const cmds = planTactical(b, 'A', 'active');
    expect(forUnit(cmds, 'a1')).toBeDefined();
    expect(cmds.filter((c) => 'unitId' in c && (c as { unitId: string }).unitId === 'a1')).toHaveLength(1);
  });

  it('an adjacent unit melee-attacks the priority (weakest) enemy — focus fire', () => {
    const b = mkBattle([
      u({ id: 'a1', factionId: 'A', pos: { x: 4, y: 4 } }),
      u({ id: 'strong', factionId: 'B', pos: { x: 5, y: 4 }, troops: 9000 }),
      u({ id: 'weak', factionId: 'B', pos: { x: 3, y: 4 }, troops: 1000 }),
    ]);
    const cmd = forUnit(planTactical(b, 'A', 'balanced'), 'a1');
    expect(cmd?.kind).toBe('meleeAttack');
    expect((cmd as { targetUnitId: string }).targetUnitId).toBe('weak'); // adjacent + weakest
  });

  it('commits reserves when losing badly', () => {
    const b = mkBattle([
      u({ id: 'a1', factionId: 'A', pos: { x: 4, y: 6 }, troops: 1000 }),
      u({ id: 'ar', factionId: 'A', pos: { x: 4, y: 9 }, state: 'reserve', troops: 4000 }),
      u({ id: 'e1', factionId: 'B', pos: { x: 4, y: 3 }, troops: 9000 }),
    ]);
    expect(kinds(planTactical(b, 'A', 'balanced'))).toContain('commitReserves');
  });

  it('a disciplined defender on high ground holds; an aggressor in the same spot does not', () => {
    const field = flatField();
    // Make (4,4) a hill so it is favorable ground; enemy is 3 cells away (not adjacent).
    field.cells[4 * 12 + 4] = 'hill';
    field.heights[4 * 12 + 4] = 0.8;
    const b = mkBattle([
      u({ id: 'd1', factionId: 'A', pos: { x: 4, y: 4 }, wu: 55, zhi: 90, command: 95 }),
      u({ id: 'e1', factionId: 'B', pos: { x: 4, y: 7 }, troops: 5000 }),
    ], field);
    const disciplined = forUnit(planTactical(b, 'A', 'turtle'), 'd1');
    expect(disciplined?.kind).toBe('hold');

    const b2 = mkBattle([
      u({ id: 'd1', factionId: 'A', pos: { x: 4, y: 4 }, wu: 99, zhi: 20, command: 60 }),
      u({ id: 'e1', factionId: 'B', pos: { x: 4, y: 7 }, troops: 5000 }),
    ], field);
    expect(forUnit(planTactical(b2, 'A', 'active'), 'd1')?.kind).not.toBe('hold');
  });

  it('an overwhelming attacker presses (never holds) so it cannot stall into a timeout', () => {
    const field = flatField();
    field.cells[4 * 12 + 4] = 'hill'; // favorable ground that would tempt a hold
    field.heights[4 * 12 + 4] = 0.8;
    const b = mkBattle([
      u({ id: 'a1', factionId: 'A', pos: { x: 4, y: 4 }, wu: 55, zhi: 95, command: 95, troops: 30000 }),
      u({ id: 'e1', factionId: 'B', pos: { x: 4, y: 7 }, troops: 800 }),
    ], field);
    // advantage = 30000/800 >> 1.5, so even a disciplined/cautious doctrine must press.
    expect(forUnit(planTactical(b, 'A', 'turtle'), 'a1')?.kind).not.toBe('hold');
  });

  it('is deterministic', () => {
    const mk = () => mkBattle([
      u({ id: 'a1', factionId: 'A', pos: { x: 4, y: 6 }, troopType: 'cavalry' }),
      u({ id: 'e1', factionId: 'B', pos: { x: 4, y: 4 } }),
    ]);
    expect(planTactical(mk(), 'A', 'active')).toEqual(planTactical(mk(), 'A', 'active'));
  });

  it('an aggressive commander adjacent to an enemy general challenges a duel', () => {
    const b = mkBattle([
      u({ id: 'lu', factionId: 'A', pos: { x: 4, y: 4 }, wu: 98, command: 70, troops: 5000 }),
      u({ id: 'guan', factionId: 'B', pos: { x: 5, y: 4 }, wu: 96, command: 90, troops: 5000 }),
    ]);
    const cmds = planTactical(b, 'A', 'active');
    expect(cmds.some((c) => c.kind === 'challengeDuel' && c.unitId === 'lu' && c.targetUnitId === 'guan')).toBe(true);
  });

  it('a cautious commander does NOT go duel-hunting', () => {
    const b = mkBattle([
      u({ id: 'sima', factionId: 'A', pos: { x: 4, y: 4 }, wu: 60, command: 95, zhi: 98, troops: 5000 }),
      u({ id: 'guan', factionId: 'B', pos: { x: 5, y: 4 }, wu: 96, command: 90, troops: 5000 }),
    ]);
    expect(planTactical(b, 'A', 'turtle').some((c) => c.kind === 'challengeDuel')).toBe(false);
  });

  it('a general near a wavering ally rallies it', () => {
    const b = mkBattle([
      u({ id: 'gen', factionId: 'A', pos: { x: 4, y: 4 }, wu: 80, command: 92, troops: 5000 }),
      u({ id: 'weak', factionId: 'A', pos: { x: 5, y: 4 }, morale: 18, troops: 2000 }),
      u({ id: 'e', factionId: 'B', pos: { x: 6, y: 4 }, troops: 5000 }),
    ]);
    const cmds = planTactical(b, 'A', 'balanced');
    expect(cmds.some((c) => c.kind === 'rally' && c.targetUnitId === 'weak')).toBe(true);
  });
});
