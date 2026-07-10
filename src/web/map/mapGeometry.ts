// Pure projection + sizing math for the 3D campaign map.
//
// This module is deliberately free of any `three` import: it is plain
// deterministic math so it runs in jsdom tests and can be reused by the
// Three.js `MapScene` glue. It maps the logical game grid (0..MAP_WIDTH x
// 0..MAP_HEIGHT) into a world-space coordinate system centered at the origin,
// and derives a per-city marker size from the city's economic importance.

import { MAP_WIDTH, MAP_HEIGHT } from '../../engine/constants.js';
import type { City } from '../../engine/types.js';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// Render proportions (world units per logical cell), independent of the
// gameplay grid. The logical grid is 500x200 (2.5:1, historically compressed
// north-south), which crams the dense central-plain cities together. Real
// Han-era China is far more square, so we stretch the north-south (Z) axis in
// RENDER SPACE only — gameplay still uses the logical coords. This spreads the
// cities apart and gives the map real-China proportions. RENDER_SX also scales
// the whole map up a little so it fills the viewport.
export const RENDER_SX = 1.15; // world units per logical x (east-west)
export const RENDER_SZ = 2.7; // world units per logical y (north-south) — the stretch
export const WORLD_W = MAP_WIDTH * RENDER_SX; // ~575 world units east-west
export const WORLD_D = MAP_HEIGHT * RENDER_SZ; // ~540 world units north-south

// Project a logical grid position to 3D world coordinates centered at the
// origin. The grid's X axis maps to world X and the grid's Y axis maps to
// world Z (the ground plane), each scaled by the render proportion; world Y is
// left at 0 here — terrain height is added later by the scene from its
// heightmap. Centering keeps the camera and orbit controls symmetric.
export function gridToWorld(pos: { x: number; y: number }): Vec3 {
  return {
    x: (pos.x - MAP_WIDTH / 2) * RENDER_SX,
    y: 0,
    z: (pos.y - MAP_HEIGHT / 2) * RENDER_SZ,
  };
}

// Inverse of gridToWorld's XZ mapping: recover logical grid coords from a world
// XZ position (used by the terrain builder to key noise/masks on logical space).
export function worldToGrid(wx: number, wz: number): { x: number; y: number } {
  return {
    x: wx / RENDER_SX + MAP_WIDTH / 2,
    y: wz / RENDER_SZ + MAP_HEIGHT / 2,
  };
}

// Marker size for a city, growing monotonically with the city's importance.
//
// Importance uses the mean of `agriculture` and `commerce`: together these two
// economic outputs are the best available proxy for a city's size/prosperity
// (capitals like Luoyang/Chengdu score highest; frontier outposts like Yunnan
// score lowest). Both are authored on a 0..100 scale, so the mean is 0..100
// and maps linearly onto the marker range. The result is clamped to
// [MARKER_MIN, MARKER_MAX] so out-of-range stats can never produce a degenerate
// (too small / too large) marker.
const MARKER_MIN = 1;
const MARKER_MAX = 2.2;

export function markerScale(city: City): number {
  const importance = (city.agriculture + city.commerce) / 2; // 0..100
  const scale = MARKER_MIN + (importance / 100) * (MARKER_MAX - MARKER_MIN);
  return Math.min(MARKER_MAX, Math.max(MARKER_MIN, scale));
}
