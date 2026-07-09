// Controlled-topology builders for AI unit tests. Not a test file (no
// `.test.` in the name) so vitest won't execute it directly.
import { buildInitialState } from '../../src/engine/scenario.js';
import { GRID_SCALE } from '../../src/engine/constants.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import type { City, CityId, FactionId, GameState, PendingOp } from '../../src/engine/types.js';

// Monotonic id source so multiple injected ops never collide.
let _nextFixtureOpId = 9000;
function nextFixtureOpId(): number {
  return ++_nextFixtureOpId;
}

export interface PlacedCity {
  id: CityId;
  factionId: FactionId | null;
  pos: { x: number; y: number };
  garrison?: number;
  generals?: string[];
}

// Build a GameState whose only mutually-adjacent cities are the ones you
// place. Every other scenario city is parked in the far corner as neutral
// so it cannot interfere with adjacency-based AI logic.
export function makeTopology(placed: PlacedCity[]): GameState {
  const base = buildInitialState({
    scenario: SCENARIO_DONGZHUO,
    playerFactionId: 'liubei',
    refData: REF_DATA,
    seed: 1,
  });
  const placedIds = new Set(placed.map((p) => p.id));
  const cities: Record<string, City> = {};
  for (const [id, city] of Object.entries(base.cities)) {
    if (placedIds.has(id)) continue;
    cities[id] = { ...city, pos: { x: 99 * GRID_SCALE, y: 39 * GRID_SCALE }, factionId: null, generals: [] };
  }
  for (const p of placed) {
    const src = base.cities[p.id];
    if (!src) throw new Error(`makeTopology: unknown city "${p.id}"`);
    cities[p.id] = {
      ...src,
      factionId: p.factionId,
      pos: p.pos,
      garrison: p.garrison ?? src.garrison,
      generals: p.generals ?? [],
    };
  }
  return { ...base, cities };
}

// Hand-crafted siege op targeting a city (for threat-detection tests).
export function siegeOp(targetCityId: string, factionId: string): PendingOp {
  return {
    id: nextFixtureOpId(),
    kind: 'siege',
    factionId,
    durationDays: 10,
    daysRemaining: 5,
    targetCityId,
    generalIds: [],
    troops: 5000,
  };
}

// Hand-crafted inbound attack-march op (for threat-detection tests).
export function attackMarchOp(
  fromCityId: string,
  toCityId: string,
  factionId: string,
): PendingOp {
  return {
    id: nextFixtureOpId(),
    kind: 'march',
    factionId,
    durationDays: 8,
    daysRemaining: 4,
    fromCityId,
    toCityId,
    generalIds: [],
    troops: 5000,
    intent: 'attack',
  };
}
