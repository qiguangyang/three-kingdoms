import { describe, expect, it } from 'vitest';
import { stepBattle } from '../../src/engine/battle/simulate.js';
import type { Battle, BattleUnit } from '../../src/engine/types.js';
import type { BattleField } from '../../src/engine/battle/types.js';

function flatField(w: number, h: number): BattleField {
  return { width: w, height: h, heights: new Array(w * h).fill(0), cells: new Array(w * h).fill('plain'), seed: 1 };
}

function unit(over: Partial<BattleUnit> & Pick<BattleUnit, 'id' | 'factionId' | 'pos'>): BattleUnit {
  return {
    generalId: 'g', troops: 5000, troopType: 'infantry', morale: 100,
    hasActed: false, state: 'fielded', formationRole: 'center',
    ...over,
  } as BattleUnit;
}

function battle(units: BattleUnit[]): Battle {
  return {
    cityId: 'c', attackerFactionId: 'A', defenderFactionId: 'B', daysElapsed: 0,
    units, field: flatField(10, 8), seed: 5, rngCursor: 5, log: [],
  };
}

describe('stepBattle — movement + melee', () => {
  it('advances the day counter and emits dayAdvanced', () => {
    const b = battle([unit({ id: 'a', factionId: 'A', pos: { x: 5, y: 6 } })]);
    const { battle: next, events } = stepBattle({ battle: b, commands: [] });
    expect(next.daysElapsed).toBe(1);
    expect(events.some((e) => e.kind === 'dayAdvanced')).toBe(true);
  });

  it('moves an unordered unit toward the nearest enemy (emits move)', () => {
    const b = battle([
      unit({ id: 'a', factionId: 'A', pos: { x: 1, y: 4 } }),
      unit({ id: 'e', factionId: 'B', pos: { x: 8, y: 4 } }),
    ]);
    const { battle: next, events } = stepBattle({ battle: b, commands: [] });
    const a = next.units.find((u) => u.id === 'a')!;
    expect(a.pos.x).toBeGreaterThan(1); // advanced toward the enemy
    expect(events.some((e) => e.kind === 'move' && e.unitId === 'a')).toBe(true);
  });

  it('resolves melee between adjacent enemies with symmetric-ish casualties + clash event', () => {
    const b = battle([
      unit({ id: 'a', factionId: 'A', pos: { x: 4, y: 4 }, troops: 6000 }),
      unit({ id: 'e', factionId: 'B', pos: { x: 5, y: 4 }, troops: 6000 }),
    ]);
    const { battle: next, events } = stepBattle({ battle: b, commands: [] });
    const a = next.units.find((u) => u.id === 'a')!;
    const e = next.units.find((u) => u.id === 'e')!;
    expect(a.troops).toBeLessThan(6000);
    expect(e.troops).toBeLessThan(6000);
    expect(events.some((ev) => ev.kind === 'clash')).toBe(true);
  });

  it('a large force beats a tiny one: defender loses more', () => {
    const b = battle([
      unit({ id: 'a', factionId: 'A', pos: { x: 4, y: 4 }, troops: 12000 }),
      unit({ id: 'e', factionId: 'B', pos: { x: 5, y: 4 }, troops: 2000 }),
    ]);
    const { battle: next } = stepBattle({ battle: b, commands: [] });
    const a = next.units.find((u) => u.id === 'a')!;
    const e = next.units.find((u) => u.id === 'e')!;
    expect(12000 - a.troops).toBeLessThan(2000); // attacker barely dented (<~17% loss)
    expect(e.troops).toBeLessThan(2000); // defender mauled
  });

  it('honors an explicit hold command (no move)', () => {
    const b = battle([
      unit({ id: 'a', factionId: 'A', pos: { x: 1, y: 4 } }),
      unit({ id: 'e', factionId: 'B', pos: { x: 8, y: 4 } }),
    ]);
    const { battle: next } = stepBattle({ battle: b, commands: [{ kind: 'hold', unitId: 'a' }] });
    const a = next.units.find((u) => u.id === 'a')!;
    expect(a.pos).toEqual({ x: 1, y: 4 });
  });

  it('is deterministic for identical inputs', () => {
    const mk = () => battle([
      unit({ id: 'a', factionId: 'A', pos: { x: 4, y: 4 } }),
      unit({ id: 'e', factionId: 'B', pos: { x: 5, y: 4 } }),
    ]);
    expect(stepBattle({ battle: mk(), commands: [] })).toEqual(stepBattle({ battle: mk(), commands: [] }));
  });
});
