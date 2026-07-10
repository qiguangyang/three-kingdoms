import { describe, expect, it } from 'vitest';
import { gridToWorld, worldToGrid, markerScale, RENDER_SX, RENDER_SZ } from '../../src/web/map/mapGeometry.js';
import { MAP_WIDTH, MAP_HEIGHT } from '../../src/engine/constants.js';
import { CITIES } from '../../src/data/cities.js';
import type { City } from '../../src/engine/types.js';

// Build a City with arbitrary stats for clamp/monotonicity tests. Only the
// fields markerScale reads (agriculture, commerce) are meaningful here.
function city(over: Partial<City>): City {
  return {
    id: 'test',
    name: { zh: '测', en: 'Test' },
    pos: { x: 0, y: 0 },
    terrain: ['plain'],
    factionId: null,
    agriculture: 0,
    commerce: 0,
    defense: 0,
    loyalty: 0,
    money: 0,
    food: 0,
    generals: [],
    garrison: 0,
    flags: {},
    ...over,
  };
}

describe('mapGeometry.gridToWorld', () => {
  it('projects the map center to the world origin', () => {
    expect(gridToWorld({ x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 })).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
  });

  it('centers then scales by the render proportions (x*RENDER_SX, z*RENDER_SZ)', () => {
    // MAP_WIDTH=500, MAP_HEIGHT=200 → half = 250, 100; corners scale by SX/SZ.
    expect(gridToWorld({ x: 0, y: 0 })).toEqual({ x: -250 * RENDER_SX, y: 0, z: -100 * RENDER_SZ });
    expect(gridToWorld({ x: MAP_WIDTH, y: MAP_HEIGHT })).toEqual({
      x: 250 * RENDER_SX,
      y: 0,
      z: 100 * RENDER_SZ,
    });
  });

  it('projects a known city (Luoyang) to its centered, proportioned world coords', () => {
    // Luoyang authored at (30, 17), scaled by GRID_SCALE=5 → pos (150, 85).
    const luoyang = CITIES.luoyang!;
    expect(luoyang.pos).toEqual({ x: 150, y: 85 });
    expect(gridToWorld(luoyang.pos)).toEqual({ x: (150 - 250) * RENDER_SX, y: 0, z: (85 - 100) * RENDER_SZ });
  });

  it('worldToGrid inverts gridToWorld', () => {
    const p = { x: 150, y: 85 };
    const w = gridToWorld(p);
    const back = worldToGrid(w.x, w.z);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });
});

describe('mapGeometry.markerScale', () => {
  it('is always within [1, 2.2] for every authored city', () => {
    for (const c of Object.values(CITIES)) {
      const s = markerScale(c);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(2.2);
    }
  });

  it('grows monotonically with city importance', () => {
    const small = city({ agriculture: 20, commerce: 20 });
    const medium = city({ agriculture: 50, commerce: 50 });
    const large = city({ agriculture: 90, commerce: 90 });
    expect(markerScale(medium)).toBeGreaterThanOrEqual(markerScale(small));
    expect(markerScale(large)).toBeGreaterThanOrEqual(markerScale(medium));
  });

  it('clamps to 1 at the low end (below the natural minimum)', () => {
    expect(markerScale(city({ agriculture: -100, commerce: -100 }))).toBe(1);
    expect(markerScale(city({ agriculture: 0, commerce: 0 }))).toBe(1);
  });

  it('clamps to 2.2 at the high end (above the natural maximum)', () => {
    expect(markerScale(city({ agriculture: 500, commerce: 500 }))).toBe(2.2);
  });

  it('maps a mid-range importance to an exact interior value', () => {
    // importance = (agriculture + commerce) / 2 = 50; scale = 1 + 50/100 * 1.2 = 1.6.
    expect(markerScale(city({ agriculture: 50, commerce: 50 }))).toBeCloseTo(1.6, 9);
  });
});
