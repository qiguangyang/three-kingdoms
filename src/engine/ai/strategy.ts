import { adjacentCities, citiesOf } from '../map.js';
import { factionPower, factionTotals, powerLeader } from '../selectors.js';
import type {
  AgentContext,
  City,
  CityId,
  FactionId,
  FactionStrategy,
  GameState,
} from '../types.js';
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
  //
  // Weights: 0.1 scales factionPower (~10k-100k) down to garrison range
  // (~1k-20k) so neither dominates alone. 20000 bounds the max leader bonus
  // to ~20k troops-equivalent at leaderBiasWeight=1 — a meaningful nudge,
  // not an absolute override.
  let best: Pair | null = null;
  let bestScore = Infinity;
  for (const p of pairs) {
    const enemyFactionPower = factionPower(state, p.enemy.factionId as FactionId);
    const leaderBonus =
      p.enemy.factionId === leader ? -params.leaderBiasWeight * 20000 : 0;
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

function consolidate(turn: number): FactionStrategy {
  return {
    posture: 'consolidate',
    targetFactionId: null,
    targetCityId: null,
    stagingCityId: null,
    updatedTurn: turn,
  };
}

// "Internally weak": a city below a loyalty/food/money floor, or the
// faction's troops are thin relative to its city count.
export function isInternallyWeak(state: GameState, factionId: FactionId): boolean {
  const owned = citiesOf(state, factionId);
  for (const c of owned) {
    if (c.loyalty < 30) return true;
    if (c.food < c.garrison) return true;
    if (c.money < c.garrison * 0.5) return true;
  }
  const totals = factionTotals(state, factionId);
  if (totals.troops < totals.cities * 3000) return true;
  return false;
}

// A persisted expand strategy stays valid while the target faction still
// owns the target city (or it is neutral) and our staging city is still
// ours.
export function isStrategyStillValid(
  state: GameState,
  factionId: FactionId,
  s: FactionStrategy,
): boolean {
  if (!s.targetFactionId || !s.targetCityId || !s.stagingCityId) return false;
  const targetCity = state.cities[s.targetCityId];
  const stagingCity = state.cities[s.stagingCityId];
  if (!targetCity || !stagingCity) return false;
  if (stagingCity.factionId !== factionId) return false;
  if (targetCity.factionId === factionId) return false; // already captured
  if (targetCity.factionId === null) return true; // neutral, still grabbable
  const targetFaction = state.factions[s.targetFactionId];
  if (!targetFaction || !targetFaction.alive) return false;
  return targetCity.factionId === s.targetFactionId;
}

// Recompute a faction's standing strategy. Deterministic given state.
// Posture priority: defend > consolidate > expand. An expand strategy is
// kept verbatim while it stays valid, giving multi-month coherence.
export function reassessStrategy(
  ctx: AgentContext,
  current: FactionStrategy | null,
  params: PersonalityParams,
): FactionStrategy {
  const { state, factionId } = ctx;
  const owned = citiesOf(state, factionId);
  if (owned.length === 0) return consolidate(state.turn);

  if (isFactionThreatened(state, factionId)) {
    return {
      posture: 'defend',
      targetFactionId: null,
      targetCityId: null,
      stagingCityId: null,
      updatedTurn: state.turn,
    };
  }

  if (isInternallyWeak(state, factionId)) return consolidate(state.turn);

  if (
    current &&
    current.posture === 'expand' &&
    isStrategyStillValid(state, factionId, current)
  ) {
    return current;
  }

  const target = selectExpansionTarget(state, factionId, params);
  if (!target) return consolidate(state.turn);
  return {
    posture: 'expand',
    targetFactionId: target.targetFactionId,
    targetCityId: target.targetCityId,
    stagingCityId: target.stagingCityId,
    updatedTurn: state.turn,
  };
}
