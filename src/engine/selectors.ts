import type { City, Faction, GameState, General, GeneralId, FactionId } from './types.js';
import { citiesOf } from './map.js';

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

export function hasVictory(state: GameState, factionId: FactionId): boolean {
  const owned = citiesOf(state, factionId).length;
  const total = Object.keys(state.cities).length;
  return owned === total;
}
