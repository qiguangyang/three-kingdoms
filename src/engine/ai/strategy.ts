import { adjacentCities, citiesOf } from '../map.js';
import type { CityId, FactionId, GameState } from '../types.js';

// A city is "threatened" when an enemy army is on its way or massed next
// door. Reads state.pendingOps and adjacency — pure, deterministic.
export function threatenedCityIds(state: GameState, factionId: FactionId): CityId[] {
  const owned = citiesOf(state, factionId);
  const ownedIds = new Set(owned.map((c) => c.id));
  const threatened = new Set<CityId>();

  for (const op of state.pendingOps) {
    if (op.kind === 'siege' && ownedIds.has(op.targetCityId)) {
      threatened.add(op.targetCityId);
    }
    if (
      op.kind === 'march' &&
      op.intent === 'attack' &&
      op.factionId !== factionId &&
      ownedIds.has(op.toCityId)
    ) {
      threatened.add(op.toCityId);
    }
  }

  for (const city of owned) {
    for (const n of adjacentCities(state, city.id)) {
      if (n.factionId === null || n.factionId === factionId) continue;
      if (n.garrison > city.garrison * 1.5) {
        threatened.add(city.id);
        break;
      }
    }
  }

  return [...threatened];
}

export function isFactionThreatened(state: GameState, factionId: FactionId): boolean {
  return threatenedCityIds(state, factionId).length > 0;
}
