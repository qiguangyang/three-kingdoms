// Deterministic battlefield terrain generation from a city's terrain type +
// a seed. Echoes the reference's parametric approach: summed gaussians for
// elevation, a Catmull-Rom spline for the river. Same seed => identical field.
import { BATTLE_HEIGHT, BATTLE_WIDTH } from '../constants.js';
import { rollInt, roll } from '../rng.js';
import type { City, Terrain } from '../types.js';
import type { BattleCell, BattleField, Vec2 } from './types.js';

const W = BATTLE_WIDTH;
const H = BATTLE_HEIGHT;

const idx = (x: number, y: number): number => y * W + x;

// Catmull-Rom through control points, sampled to `steps` points.
function catmullRom(points: Vec2[], steps: number): Vec2[] {
  if (points.length < 2) return points.slice();
  const pts = [points[0]!, ...points, points[points.length - 1]!];
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length - 3; i++) {
    const p0 = pts[i]!, p1 = pts[i + 1]!, p2 = pts[i + 2]!, p3 = pts[i + 3]!;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

export function generateField(city: City, seed: number): BattleField {
  let rng = seed >>> 0;
  const rint = (min: number, max: number): number => {
    const r = rollInt(rng, min, max);
    rng = r.state;
    return r.value;
  };
  const rfloat = (): number => {
    const r = roll(rng);
    rng = r.state;
    return r.value;
  };

  const primary = (city.terrain[0] ?? 'plain') as Terrain;
  const heights = new Array<number>(W * H).fill(0);
  const cells = new Array<BattleCell>(W * H).fill('plain');

  // --- Elevation: sum a few gaussian bumps. Mountain terrain gets more,
  //     taller bumps; plains stay flat.
  const bumpCount =
    primary === 'mountain' ? rint(5, 7) : primary === 'forest' ? rint(2, 4) : rint(1, 2);
  for (let b = 0; b < bumpCount; b++) {
    const cx = rint(0, W - 1);
    const cy = rint(0, H - 1);
    const amp = primary === 'mountain' ? 0.7 + rfloat() * 0.5 : 0.35 + rfloat() * 0.3;
    const sigma = 1.5 + rfloat() * 2.5;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        heights[idx(x, y)] = Math.min(1, (heights[idx(x, y)] ?? 0) + amp * Math.exp(-d2 / (2 * sigma * sigma)));
      }
    }
  }
  // Classify high cells as hills.
  const hillThreshold = primary === 'mountain' ? 0.45 : 0.6;
  for (let i = 0; i < cells.length; i++) {
    if ((heights[i] ?? 0) >= hillThreshold) cells[i] = 'hill';
  }

  // --- Forest patches for forest terrain.
  if (primary === 'forest') {
    const patches = rint(3, 5);
    for (let p = 0; p < patches; p++) {
      const cx = rint(1, W - 2);
      const cy = rint(1, H - 2);
      const rad = rint(1, 2);
      for (let y = cy - rad; y <= cy + rad; y++) {
        for (let x = cx - rad; x <= cx + rad; x++) {
          if (x >= 0 && x < W && y >= 0 && y < H && cells[idx(x, y)] === 'plain') {
            cells[idx(x, y)] = 'forest';
          }
        }
      }
    }
  }

  // --- River: a roughly vertical Catmull-Rom band. Present for river terrain,
  //     and occasionally elsewhere for variety (deterministic on seed).
  let river: BattleField['river'];
  const wantRiver = primary === 'river' || rfloat() < 0.2;
  if (wantRiver) {
    const ctrl: Vec2[] = [];
    const bands = 4;
    for (let i = 0; i <= bands; i++) {
      ctrl.push({ x: rint(3, W - 4), y: Math.round((i / bands) * (H - 1)) });
    }
    const path = catmullRom(ctrl, 6);
    for (const p of path) {
      const px = Math.max(0, Math.min(W - 1, Math.round(p.x)));
      const py = Math.max(0, Math.min(H - 1, Math.round(p.y)));
      cells[idx(px, py)] = 'river';
      heights[idx(px, py)] = 0; // rivers sit low
    }
    // Fords: 1-2 crossable cells punched into the river.
    const fords: Vec2[] = [];
    const fordCount = rint(1, 2);
    for (let f = 0; f < fordCount; f++) {
      const fy = rint(1, H - 2);
      // find a river cell on this row
      for (let x = 0; x < W; x++) {
        if (cells[idx(x, fy)] === 'river') {
          cells[idx(x, fy)] = 'ford';
          fords.push({ x, y: fy });
          break;
        }
      }
    }
    if (fords.length === 0) {
      // guarantee at least one ford
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] === 'river') {
          cells[i] = 'ford';
          fords.push({ x: i % W, y: Math.floor(i / W) });
          break;
        }
      }
    }
    river = { spline: path, fords };
  }

  // --- Defender wall: an arc across the defender's edge (top of the field),
  //     with exactly one gate. The attacker deploys along the bottom edge.
  const wallY = 1;
  const wallCells: Vec2[] = [];
  for (let x = 2; x < W - 2; x++) {
    if (cells[idx(x, wallY)] !== 'river' && cells[idx(x, wallY)] !== 'ford') {
      cells[idx(x, wallY)] = 'wall';
      wallCells.push({ x, y: wallY });
    }
  }
  const gate: Vec2 = wallCells[Math.floor(wallCells.length / 2)] ?? { x: Math.floor(W / 2), y: wallY };
  cells[idx(gate.x, gate.y)] = 'gate';

  return { width: W, height: H, heights, cells, river, wall: { cells: wallCells, gate }, seed };
}
