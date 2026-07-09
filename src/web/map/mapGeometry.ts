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

// Project a logical grid position to 3D world coordinates centered at the
// origin. The grid's X axis maps to world X and the grid's Y axis maps to
// world Z (the ground plane); world Y is left at 0 here — terrain height is
// added later by the scene from its heightmap. Centering keeps the camera and
// orbit controls symmetric around the landmass.
export function gridToWorld(pos: { x: number; y: number }): Vec3 {
  return {
    x: pos.x - MAP_WIDTH / 2,
    y: 0,
    z: pos.y - MAP_HEIGHT / 2,
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
