import { createSeed } from './rng.js';
import type {
  City,
  CityId,
  Faction,
  GameState,
  General,
  GeneralId,
  Item,
  ItemId,
  Scenario,
} from './types.js';

// Build the initial GameState for a scenario plus a chosen player faction.
//
// Takes pre-loaded reference data (every city / general / item id used by
// the scenario must exist in these dictionaries) and produces a fully
// hydrated GameState with the scenario's faction setups applied.
export interface ReferenceData {
  cities: Record<CityId, City>;
  generals: Record<GeneralId, General>;
  items: Record<ItemId, Item>;
}

export interface BuildInitialStateOptions {
  scenario: Scenario;
  playerFactionId: string;
  refData: ReferenceData;
  seed: number;
}

export function buildInitialState(opts: BuildInitialStateOptions): GameState {
  const { scenario, playerFactionId, refData, seed } = opts;
  if (scenario.todo) {
    throw new Error(`Scenario "${scenario.id}" is not implemented yet.`);
  }
  if (!scenario.factions.some((f) => f.id === playerFactionId)) {
    throw new Error(
      `Player faction "${playerFactionId}" is not part of scenario "${scenario.id}".`,
    );
  }

  // Deep-clone the reference dictionaries so the engine can mutate freely
  // through immutable replacements without affecting the source data.
  const cities: Record<CityId, City> = {};
  for (const c of Object.values(refData.cities)) {
    cities[c.id] = { ...c, terrain: [...c.terrain], generals: [], flags: {} };
  }
  const generals: Record<GeneralId, General> = {};
  for (const g of Object.values(refData.generals)) {
    generals[g.id] = { ...g, factionId: null, locationCityId: g.locationCityId };
  }
  const items: Record<ItemId, Item> = {};
  for (const it of Object.values(refData.items)) {
    items[it.id] = { ...it };
  }

  // Stamp scenario faction setups onto the cloned data.
  const factions: Record<string, Faction> = {};
  for (const setup of scenario.factions) {
    factions[setup.id] = {
      id: setup.id,
      name: setup.name,
      lordId: setup.lordId,
      color: setup.color,
      difficulty: setup.difficulty,
      personality: setup.personality,
      alive: setup.cityIds.length > 0,
    };

    for (const cityId of setup.cityIds) {
      const city = cities[cityId];
      if (!city) {
        throw new Error(`Faction "${setup.id}" references missing city "${cityId}".`);
      }
      city.factionId = setup.id;
      // Distribute the faction's pooled resources roughly across its cities.
    }

    // Capital (first listed city) gets half; the rest is split among
    // remaining cities. This roughly mirrors how the original game pools
    // resources in the lord's seat.
    const cityCount = setup.cityIds.length || 1;
    const capitalId = setup.cityIds[0];
    const otherIds = setup.cityIds.slice(1);
    const capitalShare = cityCount === 1 ? 1.0 : 0.5;
    const moneyForCapital = Math.floor(setup.resources.money * capitalShare);
    const foodForCapital = Math.floor(setup.resources.food * capitalShare);
    const troopsForCapital = Math.floor(setup.resources.troops * capitalShare);
    const moneyPerOther = otherIds.length > 0
      ? Math.floor((setup.resources.money - moneyForCapital) / otherIds.length)
      : 0;
    const foodPerOther = otherIds.length > 0
      ? Math.floor((setup.resources.food - foodForCapital) / otherIds.length)
      : 0;
    const troopsPerOther = otherIds.length > 0
      ? Math.floor((setup.resources.troops - troopsForCapital) / otherIds.length)
      : 0;
    if (capitalId && cities[capitalId]) {
      const c = cities[capitalId];
      c.money += moneyForCapital;
      c.food += foodForCapital;
      c.garrison += troopsForCapital;
    }
    for (const cityId of otherIds) {
      const city = cities[cityId];
      if (!city) continue;
      city.money += moneyPerOther;
      city.food += foodPerOther;
      city.garrison += troopsPerOther;
    }

    for (const generalId of setup.generalIds) {
      const g = generals[generalId];
      if (!g) {
        throw new Error(`Faction "${setup.id}" references missing general "${generalId}".`);
      }
      g.factionId = setup.id;
      // Place the general into the faction's capital (first listed city).
      const capital = setup.cityIds[0];
      if (capital && cities[capital]) {
        g.locationCityId = capital;
        cities[capital].generals.push(g.id);
      }
    }
  }

  // Items: if an item has an initial location, leave it there (search) or
  // hand it to its named carrier via the scenario's item table — for now
  // we just store the catalog; gameplay assigns ownership on pickup.

  return {
    scenarioId: scenario.id,
    year: scenario.startYear,
    month: scenario.startMonth,
    day: 1,
    turn: 0,
    playerFactionId,
    factions,
    cities,
    generals,
    items,
    ownedItems: {},
    events: [],
    log: [],
    rngState: createSeed(seed),
    actionLog: [],
    pendingOps: [],
    nextOpId: 1,
  };
}
