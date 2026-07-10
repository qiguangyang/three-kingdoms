import {
  BASE_MAP_HEIGHT,
  BASE_MAP_WIDTH,
  GRID_SCALE,
  MAP_HEIGHT,
  MAP_WIDTH,
} from '../../engine/constants.js';
import type { Terrain } from '../../engine/types.js';

// Procedurally-generated terrain grid honoring the rough geography described
// in SCENARIOS.md:
//   - The Yellow River (黄河) cuts west-to-east around y=14..17
//   - The Yangtze (长江) cuts west-to-east around y=28..31
//   - Qinling / Taihang ranges in the west and north (mountains)
//   - Wuling / Wuyi ranges in the deep south (forest)
//   - Everything else is plain
//
// The grid is generated at the BASE 100x40 resolution (the coordinate meaning
// `classify` was authored against) and decoupled from GRID_SCALE. `terrainAt`
// samples it by dividing runtime (scaled) coordinates back down, so we neither
// balloon the grid to 100k cells nor break the hardcoded sin-frequencies.

function genTerrain(): Terrain[][] {
  const grid: Terrain[][] = [];
  for (let y = 0; y < BASE_MAP_HEIGHT; y++) {
    const row: Terrain[] = [];
    for (let x = 0; x < BASE_MAP_WIDTH; x++) {
      row.push(classify(x, y));
    }
    grid.push(row);
  }
  return grid;
}

function classify(x: number, y: number): Terrain {
  // Yellow River band (slightly wavy)
  const yellowRiverY = 15 + Math.round(Math.sin(x * 0.18) * 1.5);
  if (y === yellowRiverY) return 'river';

  // Yangtze band (more pronounced curve)
  const yangtzeY = 29 + Math.round(Math.sin(x * 0.12 + 1.5) * 2);
  if (y === yangtzeY && x > 10 && x < 78) return 'river';

  // Western mountains (Qinling): rough belt around x=5..18, y=20..26
  if (x >= 5 && x <= 18 && y >= 19 && y <= 27) {
    if ((x + y) % 3 === 0 || y >= 25) return 'mountain';
  }
  // Yunnan / Nanzhong highlands
  if (x >= 10 && x <= 22 && y >= 33 && y <= 39) {
    return (x + y) % 4 === 0 ? 'forest' : 'mountain';
  }
  // Wuling / Wuyi forests south of Yangtze, east half
  if (x >= 28 && x <= 50 && y >= 33 && y <= 39) {
    return (x + y) % 3 === 0 ? 'forest' : 'mountain';
  }
  // Taihang ridge running south from y=8 down to y=14 along x=33..37
  if (x >= 33 && x <= 37 && y >= 8 && y <= 14) return 'mountain';
  // Liaodong forest stretch
  if (x >= 70 && x <= 80 && y <= 5) return 'forest';
  // Bingzhou highlands
  if (x >= 28 && x <= 36 && y >= 5 && y <= 12) {
    return (x + y) % 4 === 0 ? 'mountain' : 'plain';
  }
  // Hexi corridor mountains
  if (x <= 13 && y >= 12 && y <= 19) {
    return (x + y) % 3 === 0 ? 'mountain' : 'plain';
  }
  // Sichuan basin (around Chengdu) — mostly plain framed by mountains
  if (x >= 13 && x <= 22 && y >= 26 && y <= 31) return 'plain';
  if ((x >= 12 && x <= 24 && (y === 25 || y === 32)) && (x + y) % 2 === 0) return 'mountain';

  return 'plain';
}

export const TERRAIN_GRID: Terrain[][] = genTerrain();

// Sample the base-resolution grid from runtime (scaled) coordinates. Runtime
// coords span 0..MAP_WIDTH/MAP_HEIGHT (500x200); dividing by GRID_SCALE maps
// back to the 100x40 cell whose classification applies.
export function terrainAt(x: number, y: number): Terrain {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return 'plain';
  return classify(Math.floor(x / GRID_SCALE), Math.floor(y / GRID_SCALE));
}
