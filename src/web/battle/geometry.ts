// Pure battlefield -> world geometry math. No Three.js import: returns plain
// numbers/arrays so it can be unit-tested and reused by the scene manager.
import type { BattleCell, BattleField, Vec2 } from '../../engine/battle/types.js';
import type { BattleUnit } from '../../engine/types.js';

// World units per battlefield cell, and elevation (0..1) -> world-Y multiplier.
export const CELL_SIZE = 2;
export const HEIGHT_SCALE = 3;

const CELL_RGB: Record<BattleCell, [number, number, number]> = {
  plain: [0.8, 0.69, 0.47], // dry sand
  hill: [0.56, 0.45, 0.31], // packed mud / dirt
  forest: [0.34, 0.42, 0.26],
  river: [0.34, 0.55, 0.68],
  ford: [0.58, 0.56, 0.46], // wet churned crossing
  wall: [0.45, 0.4, 0.32],
  gate: [0.32, 0.26, 0.16],
  ramp: [0.68, 0.56, 0.39],
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

// Sub-quads per battlefield cell edge — subdividing the coarse cell grid into a
// fine mesh so terrain reads as smooth relief rather than blocky facets.
export const TERRAIN_RES = 5;

// fbm value-noise + a height color-ramp blended with each cell's terrain tint.
// Technique adapted from the MIT-licensed battlefield-editor
// (github.com/yazelin/battlefield-editor) — original implementation here.
function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let tot = 0;
  for (let i = 0; i < 4; i++) {
    sum += vnoise(x * freq, y * freq, seed) * amp;
    tot += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / tot;
}

// Height (world Y) -> natural base color: wet sand -> churned mud -> dry dirt.
// Deliberately arid/earthy (no grass green) so the field reads as a muddy,
// sandy battleground trampled by armies.
const RAMP: Array<{ h: number; c: [number, number, number] }> = [
  { h: 0.0, c: [0.71, 0.61, 0.43] }, // damp sand in the hollows
  { h: 0.7, c: [0.54, 0.43, 0.3] },  // churned mud
  { h: 1.7, c: [0.61, 0.51, 0.37] }, // dry dirt
  { h: 3.2, c: [0.68, 0.61, 0.5] },  // pale sandy rise
];
function rampColor(h: number): [number, number, number] {
  if (h <= RAMP[0]!.h) return [RAMP[0]!.c[0], RAMP[0]!.c[1], RAMP[0]!.c[2]];
  for (let i = 1; i < RAMP.length; i++) {
    const b = RAMP[i]!;
    if (h <= b.h) {
      const a = RAMP[i - 1]!;
      const t = (h - a.h) / (b.h - a.h);
      return [a.c[0] + (b.c[0] - a.c[0]) * t, a.c[1] + (b.c[1] - a.c[1]) * t, a.c[2] + (b.c[2] - a.c[2]) * t];
    }
  }
  const last = RAMP[RAMP.length - 1]!;
  return [last.c[0], last.c[1], last.c[2]];
}

// How strongly a cell's terrain-type tint overrides the natural ramp color.
function tintStrength(cell: BattleCell): number {
  switch (cell) {
    case 'river':
    case 'ford':
      return 0.85;
    case 'wall':
    case 'gate':
    case 'ramp':
      return 0.7;
    case 'forest':
      return 0.6;
    case 'hill':
      return 0.25;
    default:
      return 0.12;
  }
}

function bilinearHeight(field: BattleField, cx: number, cz: number): number {
  const { width: W, height: H } = field;
  const x0 = Math.max(0, Math.min(W - 1, Math.floor(cx)));
  const z0 = Math.max(0, Math.min(H - 1, Math.floor(cz)));
  const x1 = Math.min(W - 1, x0 + 1);
  const z1 = Math.min(H - 1, z0 + 1);
  const fx = cx - x0;
  const fz = cz - z0;
  const h00 = field.heights[z0 * W + x0] ?? 0;
  const h10 = field.heights[z0 * W + x1] ?? 0;
  const h01 = field.heights[z1 * W + x0] ?? 0;
  const h11 = field.heights[z1 * W + x1] ?? 0;
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

export function buildTerrainGeometry(
  field: BattleField,
): { positions: number[]; colors: number[]; indices: number[] } {
  const { width: W, height: H, seed } = field;
  const nx = (W - 1) * TERRAIN_RES + 1;
  const nz = (H - 1) * TERRAIN_RES + 1;
  const positions: number[] = [];
  const colors: number[] = [];
  for (let gz = 0; gz < nz; gz++) {
    for (let gx = 0; gx < nx; gx++) {
      const cx = gx / TERRAIN_RES;
      const cz = gz / TERRAIN_RES;
      const y = bilinearHeight(field, cx, cz) * HEIGHT_SCALE + (fbm(cx * 1.7, cz * 1.7, seed) - 0.5) * 0.6;
      positions.push((cx - (W - 1) / 2) * CELL_SIZE, y, (cz - (H - 1) / 2) * CELL_SIZE);
      const cell = field.cells[Math.min(H - 1, Math.round(cz)) * W + Math.min(W - 1, Math.round(cx))] ?? 'plain';
      const base = rampColor(y);
      const tint = cellColor(cell);
      const s = tintStrength(cell);
      const shade = 0.82 + fbm(cx * 3.1, cz * 3.1, seed + 97) * 0.32;
      colors.push(
        (base[0] * (1 - s) + tint[0] * s) * shade,
        (base[1] * (1 - s) + tint[1] * s) * shade,
        (base[2] * (1 - s) + tint[2] * s) * shade,
      );
    }
  }
  const indices: number[] = [];
  for (let gz = 0; gz < nz - 1; gz++) {
    for (let gx = 0; gx < nx - 1; gx++) {
      const a = gz * nx + gx;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { positions, colors, indices };
}

// Number of soldier figures to draw for a unit block — scaled to troop count,
// clamped so a small rout still reads and a huge stack stays performant.
export function soldierCount(troops: number): number {
  return Math.max(4, Math.min(48, Math.round(Math.sqrt(Math.max(0, troops)) / 3)));
}

// Local XZ offsets arranging `count` soldiers in a roughly-square grid centered
// on the origin (ranks along Z, files along X). Deterministic.
export function formationOffsets(count: number, spacing = 0.34): { x: number; z: number }[] {
  const n = Math.max(1, Math.floor(count));
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    out.push({ x: (c - (cols - 1) / 2) * spacing, z: (r - (rows - 1) / 2) * spacing });
  }
  return out;
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
