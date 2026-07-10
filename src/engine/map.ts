import { GRID_SCALE, MAP_HEIGHT, MAP_WIDTH, TERRAIN_MOVE_COST } from './constants.js';
import type { City, CityId, GameState, Terrain } from './types.js';

export interface Coord {
  x: number;
  y: number;
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT;
}

// Chebyshev distance — used for adjacency-like checks in a square grid.
export function chebyshevDistance(a: Coord, b: Coord): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// Manhattan distance — used for march cost lower bound.
export function manhattanDistance(a: Coord, b: Coord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

// Two cities are "adjacent" when they are within an unobstructed radius. In
// this game cities are sparsely placed (40 on a 100x40 base grid), so we treat
// "adjacent" as: among the four nearest cities by manhattan distance and
// within a configurable threshold. Scaled by GRID_SCALE so the threshold
// tracks the (also scaled) city coordinates — adjacency is invariant.
const ADJACENCY_THRESHOLD = 18 * GRID_SCALE; // tuned for the SCENARIOS.md city layout

export function citiesAdjacent(a: City, b: City): boolean {
  if (a.id === b.id) return false;
  return manhattanDistance(a.pos, b.pos) <= ADJACENCY_THRESHOLD;
}

export function adjacentCities(state: GameState, cityId: CityId): City[] {
  const me = state.cities[cityId];
  if (!me) return [];
  return Object.values(state.cities).filter((c) => citiesAdjacent(me, c));
}

// Movement cost between two adjacent cities, taking the average of their
// primary terrains. Used for march/timing during the strategic layer.
export function marchCost(a: City, b: City): number {
  const ta = (a.terrain[0] ?? 'plain') as Terrain;
  const tb = (b.terrain[0] ?? 'plain') as Terrain;
  const costA = TERRAIN_MOVE_COST[ta] ?? 1;
  const costB = TERRAIN_MOVE_COST[tb] ?? 1;
  return (costA + costB) / 2 + manhattanDistance(a.pos, b.pos) / (8 * GRID_SCALE);
}

// Build a quick lookup: cityId -> [cityId, ...adjacent].
export function buildAdjacencyMap(state: GameState): Record<CityId, CityId[]> {
  const cityList = Object.values(state.cities);
  const map: Record<CityId, CityId[]> = {};
  for (const c of cityList) {
    map[c.id] = cityList.filter((other) => citiesAdjacent(c, other)).map((o) => o.id);
  }
  return map;
}

// Find cities owned by a faction.
export function citiesOf(state: GameState, factionId: string): City[] {
  return Object.values(state.cities).filter((c) => c.factionId === factionId);
}

// Find border cities: owned cities adjacent to an enemy- or neutral-owned city.
export function borderCities(state: GameState, factionId: string): City[] {
  const adj = buildAdjacencyMap(state);
  return citiesOf(state, factionId).filter((c) => {
    const neighbors = adj[c.id] ?? [];
    return neighbors.some((nid) => {
      const n = state.cities[nid];
      return n && n.factionId !== factionId;
    });
  });
}

// Hostile / neutral neighbors of a given owned city.
export function enemyNeighbors(
  state: GameState,
  cityId: CityId,
  selfFactionId: string,
): City[] {
  const adj = buildAdjacencyMap(state);
  const ids = adj[cityId] ?? [];
  const out: City[] = [];
  for (const id of ids) {
    const c = state.cities[id];
    if (c && c.factionId !== selfFactionId) out.push(c);
  }
  return out;
}
