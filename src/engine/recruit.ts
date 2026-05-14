import { adjacentCities } from './map.js';
import type { General, GameState, GeneralId, LogEntry } from './types.js';

// Attempt to hire a captured / unaligned general into the recruiting
// faction. The target general's loyalty + the recruiter's zheng determine
// success.

export interface HireWildArgs {
  cityId: string;
  recruiterGeneralId: GeneralId;
  targetGeneralId: GeneralId;
}

export function hireWild(state: GameState, args: HireWildArgs): GameState {
  const recruiter = state.generals[args.recruiterGeneralId];
  const target = state.generals[args.targetGeneralId];
  const city = state.cities[args.cityId];
  if (!recruiter || !target || !city || !recruiter.factionId) return state;
  if (target.factionId !== null) return state; // already aligned
  if (target.locationCityId !== city.id) return state;

  // Simple model: success if recruiter.zheng > target.loyalty * randomness.
  // We treat the wild general's `loyalty` as their resistance level.
  if (recruiter.stats.zheng + 20 < target.loyalty) return state;

  const updatedTarget = { ...target, factionId: recruiter.factionId };
  const updatedCity = { ...city, generals: [...city.generals, target.id] };
  return {
    ...state,
    generals: { ...state.generals, [target.id]: updatedTarget },
    cities: { ...state.cities, [city.id]: updatedCity },
  };
}

// ----- Defection: bribe a rival faction's general to switch sides -----
//
// Each general carries a derived "defection cost" computed from their
// loyalty and total stats. The bribe is paid out of the originating city's
// treasury, and the target general relocates to that city under the
// briber's banner. Faction lords (general id === faction.lordId) cannot
// be bribed.

export function defectionCost(general: General): number {
  const stats = general.stats;
  const statsTotal = stats.wu + stats.zhi + stats.tong + stats.zheng;
  return general.loyalty * 50 + statsTotal * 30;
}

// Returns true if the target is a sitting lord of their faction and
// therefore immune to bribery.
export function isLord(state: GameState, general: General): boolean {
  if (!general.factionId) return false;
  const faction = state.factions[general.factionId];
  return faction?.lordId === general.id;
}

export interface DefectArgs {
  fromCityId: string;
  targetGeneralId: GeneralId;
  gold: number;
}

export interface DefectResult {
  state: GameState;
  ok: boolean;
  // Reason for failure, mainly for the UI. 'success' on the happy path.
  reason:
    | 'success'
    | 'noSuchCity'
    | 'cityNotOwned'
    | 'noSuchTarget'
    | 'sameFaction'
    | 'targetIsLord'
    | 'notAdjacent'
    | 'notEnoughGold'
    | 'insufficientOffer';
}

// Try to defect a rival general. The from city must be player-owned (or
// at least belong to the briber's faction), must hold enough gold, and
// must be geographically adjacent to the city where the target currently
// resides. The actual deduction + faction swap happens here.
export function applyDefect(
  state: GameState,
  bribingFactionId: string,
  args: DefectArgs,
): DefectResult {
  const fromCity = state.cities[args.fromCityId];
  if (!fromCity) return { state, ok: false, reason: 'noSuchCity' };
  if (fromCity.factionId !== bribingFactionId)
    return { state, ok: false, reason: 'cityNotOwned' };

  const target = state.generals[args.targetGeneralId];
  if (!target) return { state, ok: false, reason: 'noSuchTarget' };
  if (target.factionId === bribingFactionId)
    return { state, ok: false, reason: 'sameFaction' };
  if (isLord(state, target)) return { state, ok: false, reason: 'targetIsLord' };

  const targetCity = target.locationCityId ? state.cities[target.locationCityId] : null;
  if (!targetCity) return { state, ok: false, reason: 'notAdjacent' };
  const neighbors = adjacentCities(state, fromCity.id).map((c) => c.id);
  if (!neighbors.includes(targetCity.id))
    return { state, ok: false, reason: 'notAdjacent' };

  const cost = defectionCost(target);
  if (args.gold < cost) return { state, ok: false, reason: 'insufficientOffer' };
  if (fromCity.money < cost) return { state, ok: false, reason: 'notEnoughGold' };

  // Deduct gold from the bribing city; remove target from its old city's
  // general roster; place target in the bribing city; flip faction; reset
  // loyalty to 70 (the new master hasn't earned full trust yet).
  const updatedFromCity = {
    ...fromCity,
    money: fromCity.money - cost,
    generals: [...fromCity.generals, target.id],
  };
  const updatedTargetCity = {
    ...targetCity,
    generals: targetCity.generals.filter((id) => id !== target.id),
  };
  const updatedTarget: General = {
    ...target,
    factionId: bribingFactionId,
    locationCityId: fromCity.id,
    loyalty: 70,
  };
  const bribingFaction = state.factions[bribingFactionId];
  const log: LogEntry = {
    turn: state.turn,
    year: state.year,
    month: state.month,
    key: 'event.defected',
    vars: {
      general: target.name,
      faction: bribingFaction
        ? bribingFaction.name
        : { zh: bribingFactionId, en: bribingFactionId },
      cost,
    },
    factionId: bribingFactionId,
  };

  return {
    state: {
      ...state,
      cities: {
        ...state.cities,
        [fromCity.id]: updatedFromCity,
        [targetCity.id]: updatedTargetCity,
      },
      generals: { ...state.generals, [target.id]: updatedTarget },
      log: [...state.log, log],
    },
    ok: true,
    reason: 'success',
  };
}
