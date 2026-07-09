// tests/engine/battle-gambits.test.ts
import { describe, expect, it } from 'vitest';
import { detectGambits } from '../../src/engine/battle/gambits.js';
import type { Battle, BattleUnit } from '../../src/engine/types.js';
import type { BattleField } from '../../src/engine/battle/types.js';

function field(cells: BattleField['cells'], w = 6, h = 4): BattleField {
  return { width: w, height: h, heights: new Array(w * h).fill(0), cells, seed: 1 };
}
function u(over: Partial<BattleUnit> & Pick<BattleUnit, 'id' | 'factionId' | 'pos'>): BattleUnit {
  return { generalId: 'g', troops: 4000, troopType: 'infantry', morale: 100, hasActed: false, state: 'fielded', formationRole: 'center', ...over } as BattleUnit;
}
function mk(units: BattleUnit[], f: BattleField): Battle {
  return { cityId: 'c', attackerFactionId: 'A', defenderFactionId: 'B', daysElapsed: 0, units, field: f, seed: 1, rngCursor: 1, log: [] };
}

describe('detectGambits', () => {
  it('offers cavalryCharge when a cavalry unit has an enemy within a couple cells', () => {
    const f = field(new Array(24).fill('plain'));
    const b = mk([
      u({ id: 'a', factionId: 'A', pos: { x: 1, y: 1 }, troopType: 'cavalry' }),
      u({ id: 'e', factionId: 'B', pos: { x: 3, y: 1 } }),
    ], f);
    const ids = detectGambits(b).map((g) => g.id);
    expect(ids).toContain('cavalryCharge');
  });

  it('offers fireAttack only when a unit sits in forest with wind up', () => {
    const cells = new Array(24).fill('plain');
    cells[1 * 6 + 2] = 'forest';
    const f = field(cells);
    const noWind = mk([u({ id: 'e', factionId: 'B', pos: { x: 2, y: 1 } }), u({ id: 'a', factionId: 'A', pos: { x: 2, y: 2 } })], f);
    expect(detectGambits(noWind).map((g) => g.id)).not.toContain('fireAttack');
    const windy = { ...noWind, wind: { dir: { x: 0, y: -1 }, strength: 1 } };
    expect(detectGambits(windy).map((g) => g.id)).toContain('fireAttack');
  });

  it('offers duelChallenge when two high-wu generals are adjacent', () => {
    const f = field(new Array(24).fill('plain'));
    const b = mk([
      u({ id: 'a', factionId: 'A', pos: { x: 2, y: 1 }, generalId: 'lvbu', wu: 100 }),
      u({ id: 'e', factionId: 'B', pos: { x: 3, y: 1 }, generalId: 'guanyu', wu: 96 }),
    ], f);
    expect(detectGambits(b).map((g) => g.id)).toContain('duelChallenge');
  });

  it('offers fordCrossing when a unit is adjacent to a ford', () => {
    const cells = new Array(24).fill('plain');
    cells[1 * 6 + 3] = 'ford';
    const f = field(cells);
    const b = mk([u({ id: 'a', factionId: 'A', pos: { x: 2, y: 1 } })], f);
    expect(detectGambits(b).map((g) => g.id)).toContain('fordCrossing');
  });

  it('offers floodAttack when a land unit is beside a river with an enemy in range', () => {
    const plain = new Array(24).fill('plain');
    const noRiver = field([...plain]);
    const bDry = mk([
      u({ id: 'a', factionId: 'A', pos: { x: 2, y: 1 } }),
      u({ id: 'e', factionId: 'B', pos: { x: 3, y: 1 } }),
    ], noRiver);
    expect(detectGambits(bDry).map((g) => g.id)).not.toContain('floodAttack');

    const cells = [...plain];
    cells[1 * 6 + 3] = 'river'; // (x=3,y=1) is a river cell
    const wet = field(cells);
    const bWet = mk([
      u({ id: 'a', factionId: 'A', pos: { x: 2, y: 1 } }), // beside the river cell
      u({ id: 'e', factionId: 'B', pos: { x: 4, y: 1 } }), // enemy within 4
    ], wet);
    expect(detectGambits(bWet).map((g) => g.id)).toContain('floodAttack');
  });
});
