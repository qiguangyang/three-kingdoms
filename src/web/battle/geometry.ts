// Pure battlefield -> world geometry math. No Three.js import: returns plain
// numbers/arrays so it can be unit-tested and reused by the scene manager.
import type { BattleCell, BattleField, Vec2 } from '../../engine/battle/types.js';
import type { BattleUnit } from '../../engine/types.js';

// World units per battlefield cell, and elevation (0..1) -> world-Y multiplier.
export const CELL_SIZE = 2;
export const HEIGHT_SCALE = 3;

const CELL_RGB: Record<BattleCell, [number, number, number]> = {
  plain: [0.78, 0.72, 0.5],
  hill: [0.62, 0.52, 0.36],
  forest: [0.32, 0.45, 0.25],
  river: [0.34, 0.55, 0.68],
  ford: [0.6, 0.68, 0.66],
  wall: [0.45, 0.4, 0.32],
  gate: [0.32, 0.26, 0.16],
  ramp: [0.7, 0.62, 0.42],
};

export function cellColor(cell: BattleCell): [number, number, number] {
  return CELL_RGB[cell] ?? CELL_RGB.plain;
}

export function fieldWorldSize(field: BattleField): { w: number; h: number } {
  return { w: field.width * CELL_SIZE, h: field.height * CELL_SIZE };
}

// Grid centered on the origin so the camera orbits the middle of the field.
export function cellWorldXZ(x: number, y: number, field: BattleField): { x: number; z: number } {
  return {
    x: (x - (field.width - 1) / 2) * CELL_SIZE,
    z: (y - (field.height - 1) / 2) * CELL_SIZE,
  };
}

export function terrainHeight(x: number, y: number, field: BattleField): number {
  const cx = Math.max(0, Math.min(field.width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(field.height - 1, Math.round(y)));
  return (field.heights[cy * field.width + cx] ?? 0) * HEIGHT_SCALE;
}

export function unitWorldPosition(pos: Vec2, field: BattleField): { x: number; y: number; z: number } {
  const { x, z } = cellWorldXZ(pos.x, pos.y, field);
  return { x, y: terrainHeight(pos.x, pos.y, field), z };
}

// Block size grows with troop count, gently, and is clamped so a rout of 200
// still reads and a stack of 40k doesn't dominate the field.
export function blockScale(troops: number): number {
  const MIN = 0.6;
  const MAX = 3.5;
  const K = 30;
  return Math.max(MIN, Math.min(MAX, Math.sqrt(Math.max(0, troops)) / K));
}

export function buildTerrainGeometry(
  field: BattleField,
): { positions: number[]; colors: number[]; indices: number[] } {
  const positions: number[] = [];
  const colors: number[] = [];
  for (let y = 0; y < field.height; y++) {
    for (let x = 0; x < field.width; x++) {
      const { x: wx, z: wz } = cellWorldXZ(x, y, field);
      positions.push(wx, terrainHeight(x, y, field), wz);
      const [r, g, b] = cellColor(field.cells[y * field.width + x] ?? 'plain');
      colors.push(r, g, b);
    }
  }
  const indices: number[] = [];
  for (let y = 0; y < field.height - 1; y++) {
    for (let x = 0; x < field.width - 1; x++) {
      const a = y * field.width + x;
      const b = a + 1;
      const c = a + field.width;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { positions, colors, indices };
}

// Average world XZ of the still-active units, for camera framing.
export function battleCentroidXZ(units: BattleUnit[], field: BattleField): { x: number; z: number } {
  const active = units.filter((u) => u.state === 'fielded' || u.state === 'routing');
  if (active.length === 0) return { x: 0, z: 0 };
  let sx = 0;
  let sz = 0;
  for (const u of active) {
    const { x, z } = cellWorldXZ(u.pos.x, u.pos.y, field);
    sx += x;
    sz += z;
  }
  return { x: sx / active.length, z: sz / active.length };
}
