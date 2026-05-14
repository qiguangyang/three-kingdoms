import { adjacentCities, citiesOf } from '../map.js';
import { factionPower, powerLeader } from '../selectors.js';
import type { City, CityId, FactionId, GameState } from '../types.js';
import type { PersonalityParams } from './personality.js';

// A city is "threatened" when an enemy army is on its way or massed next
// door. Reads state.pendingOps and adjacency — pure, deterministic.
export function threatenedCityIds(state: GameState, factionId: FactionId): CityId[] {
  const owned = citiesOf(state, factionId);
  const ownedIds = new Set(owned.map((c) => c.id));
  const threatened = new Set<CityId>();

  for (const op of state.pendingOps) {
    if (op.kind === 'siege' && op.factionId !== factionId && ownedIds.has(op.targetCityId)) {
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

export interface ExpansionTarget {
  targetFactionId: FactionId;
  targetCityId: CityId;
  stagingCityId: CityId;
}

// Pick an enemy faction + a specific border city to march on, plus our own
// staging city. Prefers weak enemies that border us, biased toward the
// current power leader by the personality's leaderBiasWeight.
export function selectExpansionTarget(
  state: GameState,
  factionId: FactionId,
  params: PersonalityParams,
): ExpansionTarget | null {
  const owned = citiesOf(state, factionId);
  if (owned.length === 0) return null;
  const leader = powerLeader(state);

  type Pair = { our: City; enemy: City };
  const pairs: Pair[] = [];
  for (const our of owned) {
    for (const enemy of adjacentCities(state, our.id)) {
      if (enemy.factionId === null || enemy.factionId === factionId) continue;
      pairs.push({ our, enemy });
    }
  }
  if (pairs.length === 0) return null;

  // Lower score = better target. Soft city + weak faction lower it; being
  // the power leader lowers it further (gang-up bias).
  let best: Pair | null = null;
  let bestScore = Infinity;
  for (const p of pairs) {
    const enemyFactionPower = factionPower(state, p.enemy.factionId as FactionId);
    const leaderBonus =
      p.enemy.factionId === leader ? -params.leaderBiasWeight * 60000 : 0;
    const score = p.enemy.garrison + enemyFactionPower * 0.1 + leaderBonus;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (!best) return null;

  return {
    targetFactionId: best.enemy.factionId as FactionId,
    targetCityId: best.enemy.id,
    stagingCityId: best.our.id,
  };
}
