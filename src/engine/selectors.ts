import type {
  City,
  Faction,
  GameState,
  General,
  GeneralId,
  FactionId,
  LocalizedString,
  VictoryCondition,
} from './types.js';
import { citiesOf } from './map.js';
import { SCENARIOS } from '../data/scenarios/index.js';
import { objectivesFor } from './story/objectives.js';

// Derived queries on GameState. All pure, side-effect free.

export function getPlayerFaction(state: GameState): Faction | undefined {
  return state.factions[state.playerFactionId];
}

export function getGeneral(state: GameState, id: GeneralId): General | undefined {
  return state.generals[id];
}

export function getCity(state: GameState, id: string): City | undefined {
  return state.cities[id];
}

export function factionGenerals(state: GameState, factionId: FactionId): General[] {
  return Object.values(state.generals).filter(
    (g) => g.factionId === factionId && g.status === 'active',
  );
}

export function wildGeneralsIn(state: GameState, cityId: string): General[] {
  return Object.values(state.generals).filter(
    (g) => g.factionId === null && g.locationCityId === cityId && g.status === 'active',
  );
}

export function factionTotals(
  state: GameState,
  factionId: FactionId,
): { money: number; food: number; troops: number; cities: number; generals: number } {
  const cities = citiesOf(state, factionId);
  const generals = factionGenerals(state, factionId);
  return {
    money: cities.reduce((s, c) => s + c.money, 0),
    food: cities.reduce((s, c) => s + c.food, 0),
    troops:
      cities.reduce((s, c) => s + c.garrison, 0) + generals.reduce((s, g) => s + g.troops, 0),
    cities: cities.length,
    generals: generals.length,
  };
}

export function isAlive(faction: Faction): boolean {
  return faction.alive;
}

export function aliveFactions(state: GameState): Faction[] {
  return Object.values(state.factions).filter(isAlive);
}

// Victory for `factionId` under the scenario's declared VictoryCondition.
//   unify    — own every city on the map.
//   dominate — own >= cityCount cities AND hold all requiredCityIds.
//   historic — every non-optional objective of the active scenario/storyMode
//              is 'complete' in state.objectives (the story chapter's win).
// A scenario missing from the registry falls back to unify.
export function hasVictory(state: GameState, factionId: FactionId): boolean {
  const scenario = SCENARIOS[state.scenarioId];
  const victory: VictoryCondition = scenario?.victory ?? { kind: 'unify' };
  const ownedCities = citiesOf(state, factionId);
  const ownedCount = ownedCities.length;

  switch (victory.kind) {
    case 'unify': {
      const total = Object.keys(state.cities).length;
      return ownedCount === total;
    }
    case 'dominate': {
      const need = victory.cityCount ?? Object.keys(state.cities).length;
      if (ownedCount < need) return false;
      const requiredIds = victory.requiredCityIds ?? [];
      const ownedIds = new Set(ownedCities.map((c) => c.id));
      return requiredIds.every((id) => ownedIds.has(id));
    }
    case 'historic': {
      // Historic victory is arc-driven, not per-faction: it holds when the
      // story chapter's terminal objectives are done. factionId is unused here.
      const required = objectivesFor(state.scenarioId, state.storyMode).filter(
        (o) => !o.optional,
      );
      if (required.length === 0) return false;
      return required.every((def) =>
        state.objectives.some((o) => o.id === def.id && o.status === 'complete'),
      );
    }
    default:
      return false;
  }
}

// Composite power score for a faction: troops plus 5000 per city. Used by
// both the AI's target selection and the UI's faction power panel so the
// two agree on "who is winning".
export function factionPower(state: GameState, factionId: FactionId): number {
  const totals = factionTotals(state, factionId);
  return totals.troops + totals.cities * 5000;
}

export interface FactionRanking {
  factionId: FactionId;
  name: LocalizedString;
  color: string;
  alive: boolean;
  cities: number;
  generals: number;
  troops: number;
  power: number;
  rank: number;
}

// Every faction ranked by power, strongest first. Reuses factionPower so
// the panel reflects exactly what the AI's target selection "sees".
export function factionRankings(state: GameState): FactionRanking[] {
  const rows = Object.values(state.factions).map((f) => {
    const totals = factionTotals(state, f.id);
    return {
      factionId: f.id,
      name: f.name,
      color: f.color,
      alive: f.alive,
      cities: totals.cities,
      generals: totals.generals,
      troops: totals.troops,
      power: factionPower(state, f.id),
    };
  });
  rows.sort((a, b) => b.power - a.power);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

// The strongest alive faction — the one rivals want to gang up on.
export function powerLeader(state: GameState): FactionId | null {
  let best: FactionId | null = null;
  let bestPower = -1;
  for (const f of aliveFactions(state)) {
    const p = factionPower(state, f.id);
    if (p > bestPower) {
      bestPower = p;
      best = f.id;
    }
  }
  return best;
}
