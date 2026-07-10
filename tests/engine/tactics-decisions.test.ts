import { describe, expect, it } from 'vitest';
import { offerPlayerDecisions } from '../../src/engine/ai/tactics/decisions.js';
import type { Battle, BattleUnit } from '../../src/engine/types.js';
import type { BattleField } from '../../src/engine/battle/types.js';

function field(over: Partial<BattleField> = {}): BattleField {
  const w = 12, h = 10;
  return { width: w, height: h, heights: new Array(w * h).fill(0), cells: new Array(w * h).fill('plain'), seed: 3, ...over };
}
function u(over: Partial<BattleUnit> & Pick<BattleUnit, 'id' | 'factionId' | 'pos'>): BattleUnit {
  return { generalId: over.id, troops: 5000, troopType: 'infantry', morale: 100, hasActed: false,
    state: 'fielded', formationRole: 'center', ...over } as BattleUnit;
}
function mk(units: BattleUnit[], f: BattleField = field()): Battle {
  return { cityId: 'c', attackerFactionId: 'A', defenderFactionId: 'B', daysElapsed: 0,
    units, field: f, seed: 9, rngCursor: 9, log: [] };
}
const ids = (ds: ReturnType<typeof offerPlayerDecisions>) => ds.map((d) => d.id);
const find = (ds: ReturnType<typeof offerPlayerDecisions>, id: string) => ds.find((d) => d.id === id || d.id.startsWith(id));

describe('offerPlayerDecisions', () => {
  it('returns nothing when the side has no active enemy', () => {
    expect(offerPlayerDecisions(mk([u({ id: 'a', factionId: 'A', pos: { x: 2, y: 8 } })]), 'A')).toEqual([]);
  });

  it('offers Commit Reserves when reserves exist, salient when not already winning', () => {
    const losing = mk([
      u({ id: 'a', factionId: 'A', pos: { x: 6, y: 8 }, troops: 2000 }),
      u({ id: 'r', factionId: 'A', pos: { x: 6, y: 9 }, state: 'reserve', troops: 3000 }),
      u({ id: 'e', factionId: 'B', pos: { x: 6, y: 2 }, troops: 6000 }),
    ]);
    const d = find(offerPlayerDecisions(losing, 'A'), 'commitReserves')!;
    expect(d).toBeDefined();
    expect(d.salient).toBe(true);
    expect(d.commands).toEqual([{ kind: 'commitReserves', factionId: 'A' }]);
  });

  it('offers Commit Reserves NON-salient when already comfortably ahead', () => {
    const winning = mk([
      u({ id: 'a', factionId: 'A', pos: { x: 6, y: 8 }, troops: 9000 }),
      u({ id: 'r', factionId: 'A', pos: { x: 6, y: 9 }, state: 'reserve', troops: 3000 }),
      u({ id: 'e', factionId: 'B', pos: { x: 6, y: 2 }, troops: 2000 }),
    ]);
    expect(find(offerPlayerDecisions(winning, 'A'), 'commitReserves')!.salient).toBe(false);
  });

  it('offers Hold the Line when a fielded unit stands on favorable ground with no adjacent enemy', () => {
    const f = field();
    f.cells[4 * 12 + 6] = 'hill'; f.heights[4 * 12 + 6] = 0.8;
    const b = mk([
      u({ id: 'a', factionId: 'A', pos: { x: 6, y: 4 } }),
      u({ id: 'e', factionId: 'B', pos: { x: 6, y: 8 } }),
    ], f);
    const d = find(offerPlayerDecisions(b, 'A'), 'holdLine')!;
    expect(d).toBeDefined();
    expect(d.commands).toEqual([{ kind: 'hold', unitId: 'a' }]);
    expect(d.salient).toBe(false);
  });

  it('offers Focus Fire on the weakest enemy, compiling per-unit orders by range', () => {
    const b = mk([
      u({ id: 'melee', factionId: 'A', pos: { x: 5, y: 3 } }),            // adjacent to weak
      u({ id: 'arch', factionId: 'A', pos: { x: 4, y: 5 }, troopType: 'archer' }), // within volley range 3
      u({ id: 'far', factionId: 'A', pos: { x: 1, y: 9 } }),              // must march
      u({ id: 'strong', factionId: 'B', pos: { x: 8, y: 3 }, troops: 9000 }),
      u({ id: 'weak', factionId: 'B', pos: { x: 4, y: 3 }, troops: 1000 }),
    ]);
    const d = find(offerPlayerDecisions(b, 'A'), 'focusFire')!;
    expect(d).toBeDefined();
    expect(d.id).toBe('focusFire:weak');
    expect(d.commands).toContainEqual({ kind: 'meleeAttack', unitId: 'melee', targetUnitId: 'weak' });
    expect(d.commands).toContainEqual({ kind: 'rangedAttack', unitId: 'arch', targetUnitId: 'weak' });
    expect(d.commands).toContainEqual({ kind: 'march', unitId: 'far', target: { x: 4, y: 3 } });
  });

  it('is deterministic', () => {
    const build = () => mk([
      u({ id: 'a', factionId: 'A', pos: { x: 6, y: 8 } }),
      u({ id: 'r', factionId: 'A', pos: { x: 6, y: 9 }, state: 'reserve' }),
      u({ id: 'e', factionId: 'B', pos: { x: 6, y: 2 } }),
    ]);
    expect(offerPlayerDecisions(build(), 'A')).toEqual(offerPlayerDecisions(build(), 'A'));
  });
});
