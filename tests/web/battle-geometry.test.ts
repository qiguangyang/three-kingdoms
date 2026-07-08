import { describe, expect, it } from 'vitest';
import {
  HEIGHT_SCALE, TERRAIN_RES, cellColor, cellWorldXZ, terrainHeight, unitWorldPosition,
  blockScale, buildTerrainGeometry, battleCentroidXZ, fieldWorldSize,
  soldierCount, formationOffsets,
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
  it('builds a subdivided vertex grid with matching color + index counts', () => {
    const g = buildTerrainGeometry(field(4, 3));
    const nx = (4 - 1) * TERRAIN_RES + 1;
    const nz = (3 - 1) * TERRAIN_RES + 1;
    expect(g.positions.length).toBe(nx * nz * 3);
    expect(g.colors.length).toBe(nx * nz * 3);
    expect(g.indices.length).toBe((nx - 1) * (nz - 1) * 6);
  });

  it('vertex Y tracks terrain height (raised center higher than flat corner)', () => {
    const heights = new Array(9).fill(0);
    heights[4] = 1;
    const f = field(3, 3, heights);
    expect(terrainHeight(1, 1, f)).toBeCloseTo(HEIGHT_SCALE);
    expect(terrainHeight(0, 0, f)).toBe(0);
    const g = buildTerrainGeometry(f);
    const nx = (3 - 1) * TERRAIN_RES + 1;
    const center = (TERRAIN_RES * nx + TERRAIN_RES) * 3; // vertex at cell (1,1)
    const corner = 0; // vertex at cell (0,0)
    expect(g.positions[center + 1]!).toBeGreaterThan(g.positions[corner + 1]! + HEIGHT_SCALE * 0.5);
  });

  it('is deterministic for a given field seed', () => {
    expect(buildTerrainGeometry(field(5, 4))).toEqual(buildTerrainGeometry(field(5, 4)));
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

  it('soldierCount is monotonic and clamped to 4..48', () => {
    expect(soldierCount(0)).toBe(4);
    expect(soldierCount(500)).toBeLessThan(soldierCount(20000));
    expect(soldierCount(1e9)).toBe(48);
  });

  it('formationOffsets returns count offsets in a centered grid', () => {
    expect(formationOffsets(1)).toHaveLength(1);
    const nine = formationOffsets(9, 1);
    expect(nine).toHaveLength(9);
    // centered: mean offset ~ 0
    const mean = nine.reduce((a, o) => ({ x: a.x + o.x, z: a.z + o.z }), { x: 0, z: 0 });
    expect(mean.x / 9).toBeCloseTo(0);
    expect(mean.z / 9).toBeCloseTo(0);
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
