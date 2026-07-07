import { describe, expect, it } from 'vitest';
import {
  HEIGHT_SCALE, cellColor, cellWorldXZ, terrainHeight, unitWorldPosition,
  blockScale, buildTerrainGeometry, battleCentroidXZ, fieldWorldSize,
} from '../../src/web/battle/geometry.js';
import type { BattleField } from '../../src/engine/battle/types.js';
import type { BattleUnit } from '../../src/engine/types.js';

function field(w: number, h: number, heights?: number[]): BattleField {
  return {
    width: w, height: h,
    heights: heights ?? new Array(w * h).fill(0),
    cells: new Array(w * h).fill('plain'),
    seed: 1,
  };
}
function unit(over: Partial<BattleUnit> & Pick<BattleUnit, 'id' | 'factionId' | 'pos'>): BattleUnit {
  return {
    generalId: 'g', troops: 100, troopType: 'infantry', morale: 100,
    hasActed: false, state: 'fielded', formationRole: 'center', ...over,
  } as BattleUnit;
}

describe('battle geometry', () => {
  it('builds a vertex grid sized width*height with (w-1)(h-1)*6 indices', () => {
    const g = buildTerrainGeometry(field(4, 3));
    expect(g.positions.length).toBe(4 * 3 * 3);
    expect(g.colors.length).toBe(4 * 3 * 3);
    expect(g.indices.length).toBe((4 - 1) * (3 - 1) * 6);
  });

  it('vertex Y tracks terrain height', () => {
    const heights = new Array(9).fill(0);
    heights[4] = 1;
    const f = field(3, 3, heights);
    expect(terrainHeight(1, 1, f)).toBeCloseTo(HEIGHT_SCALE);
    expect(terrainHeight(0, 0, f)).toBe(0);
    const g = buildTerrainGeometry(f);
    const centerIdx = (1 * 3 + 1) * 3;
    expect(g.positions[centerIdx + 1]).toBeCloseTo(HEIGHT_SCALE);
  });

  it('centers the grid on the origin', () => {
    const f = field(4, 4);
    const c = cellWorldXZ(0, 0, f);
    const c2 = cellWorldXZ(3, 3, f);
    expect(c.x).toBeCloseTo(-c2.x);
    expect(c.z).toBeCloseTo(-c2.z);
  });

  it('places a unit on the terrain surface (higher on a raised cell)', () => {
    const heights = new Array(9).fill(0);
    heights[4] = 1;
    const f = field(3, 3, heights);
    const raised = unitWorldPosition({ x: 1, y: 1 }, f);
    const flat = unitWorldPosition({ x: 0, y: 0 }, f);
    expect(raised.y).toBeGreaterThanOrEqual(HEIGHT_SCALE);
    expect(raised.y).toBeGreaterThan(flat.y);
  });

  it('blockScale is monotonic and clamped', () => {
    expect(blockScale(1000)).toBeLessThan(blockScale(9000));
    expect(blockScale(0)).toBeGreaterThan(0);
    expect(blockScale(1e9)).toBeLessThan(100);
  });

  it('cellColor is distinct per terrain class and in 0..1', () => {
    const plain = cellColor('plain');
    const river = cellColor('river');
    expect(plain).not.toEqual(river);
    for (const c of [...plain, ...river]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('centroid stays within field world bounds', () => {
    const f = field(6, 4);
    const units = [
      unit({ id: 'a', factionId: 'A', pos: { x: 1, y: 1 } }),
      unit({ id: 'b', factionId: 'B', pos: { x: 4, y: 2 } }),
    ];
    const c = battleCentroidXZ(units, f);
    const size = fieldWorldSize(f);
    expect(Math.abs(c.x)).toBeLessThanOrEqual(size.w / 2);
    expect(Math.abs(c.z)).toBeLessThanOrEqual(size.h / 2);
  });
});
