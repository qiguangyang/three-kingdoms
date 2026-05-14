import {
  BATTLE_DAY_LIMIT,
  CITY_DEFENSE_BONUS,
  DUEL_TRIGGER_PROB,
  DUEL_TRIGGER_WU_MIN,
} from './constants.js';
import { combatModifier } from './movement.js';
import { rollChance, rollInt } from './rng.js';
import type {
  Battle,
  CityId,
  FactionId,
  GameState,
  General,
  GeneralId,
  LogEntry,
  Terrain,
  TroopType,
} from './types.js';

// ----- Quick (strategic-layer) battle resolution -----
//
// Used when AI vs AI armies clash and we don't need a per-day tactical view.
// Returns the post-battle GameState plus a winner. The player is always
// dropped into the BattleScreen when they're a participant, so this function
// is only invoked for offscreen fights.

export interface QuickBattleInput {
  state: GameState;
  attackerFactionId: FactionId;
  defenderFactionId: FactionId;
  attackingGeneralIds: GeneralId[];
  attackingTroops: number;
  cityId: CityId; // the besieged city
}

export interface QuickBattleResult {
  state: GameState;
  attackerWon: boolean;
  attackerCasualties: number;
  defenderCasualties: number;
  log: LogEntry[];
}

export function resolveQuickBattle(input: QuickBattleInput): QuickBattleResult {
  const { state, attackerFactionId, attackingGeneralIds } = input;
  void input.defenderFactionId; // reserved for future loyalty / morale tracking
  const city = state.cities[input.cityId];
  if (!city) {
    return {
      state,
      attackerWon: false,
      attackerCasualties: 0,
      defenderCasualties: 0,
      log: [],
    };
  }
  const terrain = (city.terrain[0] ?? 'plain') as Terrain;

  const attackerGenerals = attackingGeneralIds
    .map((id) => state.generals[id])
    .filter((g): g is General => Boolean(g));
  const defenderGenerals = (city.generals
    .map((id) => state.generals[id])
    .filter((g): g is General => Boolean(g))) as General[];

  const atkPower = computePower(attackerGenerals, input.attackingTroops, terrain);
  const defGarrison = city.garrison;
  const defGeneralTroops = defenderGenerals.reduce((s, g) => s + g.troops, 0);
  const defPower =
    computePower(defenderGenerals, defGarrison + defGeneralTroops, terrain) *
    CITY_DEFENSE_BONUS;

  // Deterministic noise via the RNG.
  let rng = state.rngState;
  const rolled = rollInt(rng, -20, 20);
  rng = rolled.state;
  const margin = atkPower - defPower + rolled.value;

  const attackerWon = margin > 0;
  // Casualties are a fraction of the loser's troop count, scaled by margin.
  const lossFactor = Math.min(0.9, 0.3 + Math.abs(margin) / Math.max(atkPower, defPower, 1));
  const attackerCasualties = attackerWon
    ? Math.floor(input.attackingTroops * 0.15)
    : Math.floor(input.attackingTroops * lossFactor);
  const defenderCasualties = attackerWon
    ? Math.floor((defGarrison + defGeneralTroops) * lossFactor)
    : Math.floor((defGarrison + defGeneralTroops) * 0.15);

  // Apply casualties + ownership change.
  const updatedCities = { ...state.cities };
  const updatedGenerals = { ...state.generals };
  let updatedCity = { ...city };

  // Defender losses.
  let remainingDefenderLoss = defenderCasualties;
  // First eat into garrison.
  const garrisonLoss = Math.min(updatedCity.garrison, remainingDefenderLoss);
  updatedCity = { ...updatedCity, garrison: updatedCity.garrison - garrisonLoss };
  remainingDefenderLoss -= garrisonLoss;
  // Then prorate across stationed generals.
  if (remainingDefenderLoss > 0 && defenderGenerals.length > 0) {
    const totalGenTroops = defGeneralTroops || 1;
    for (const g of defenderGenerals) {
      const share = Math.floor((g.troops / totalGenTroops) * remainingDefenderLoss);
      const updated = { ...g, troops: Math.max(0, g.troops - share) };
      updatedGenerals[g.id] = updated;
    }
  }

  // Attacker losses (proportionate across attacking generals).
  if (attackerGenerals.length > 0) {
    const totalAtkTroops = input.attackingTroops || 1;
    for (const g of attackerGenerals) {
      const share = Math.floor((g.troops / totalAtkTroops) * attackerCasualties);
      const updated = { ...g, troops: Math.max(0, g.troops - share) };
      updatedGenerals[g.id] = updated;
    }
  }

  const log: LogEntry[] = [];

  if (attackerWon) {
    updatedCity = {
      ...updatedCity,
      factionId: attackerFactionId,
      loyalty: Math.max(20, Math.floor(updatedCity.loyalty * 0.6)),
      generals: [],
    };
    // Defender generals retreat to a nearby friendly city (if any) or are
    // captured. For simplicity, retreat into the void = wounded status.
    for (const g of defenderGenerals) {
      updatedGenerals[g.id] = {
        ...g,
        locationCityId: null,
        status: 'wounded',
      };
    }
    // Attackers occupy the city.
    updatedCity = {
      ...updatedCity,
      generals: attackerGenerals.map((g) => g.id),
    };
    for (const g of attackerGenerals) {
      updatedGenerals[g.id] = { ...g, locationCityId: city.id };
    }
    const attackerFaction = state.factions[attackerFactionId];
    log.push({
      turn: state.turn,
      year: state.year,
      month: state.month,
      key: 'event.cityFell',
      vars: {
        city: city.name,
        faction: attackerFaction ? attackerFaction.name : { zh: attackerFactionId, en: attackerFactionId },
      },
      factionId: attackerFactionId,
    });
  } else {
    log.push({
      turn: state.turn,
      year: state.year,
      month: state.month,
      key: 'event.attackerRetreated',
      factionId: attackerFactionId,
    });
  }

  updatedCities[city.id] = updatedCity;
  const nextState: GameState = {
    ...state,
    cities: updatedCities,
    generals: updatedGenerals,
    rngState: rng,
    log: [...state.log, ...log],
  };

  return {
    state: nextState,
    attackerWon,
    attackerCasualties,
    defenderCasualties,
    log,
  };
}

function computePower(generals: General[], troops: number, terrain: Terrain): number {
  if (troops <= 0) return 0;
  if (generals.length === 0) return troops * 0.5; // unled mob
  // Average leadership stats across generals.
  const avgWu = avg(generals.map((g) => g.stats.wu));
  const avgTong = avg(generals.map((g) => g.stats.tong));
  const avgZhi = avg(generals.map((g) => g.stats.zhi));
  const bestTroopType = pickBestTroop(generals);
  const mod = combatModifier(bestTroopType, terrain);
  const leadership = (avgWu * 0.4 + avgTong * 0.5 + avgZhi * 0.1) / 50; // ~1.0 baseline
  return troops * leadership * mod;
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pickBestTroop(generals: General[]): TroopType {
  // Highest-command general dictates the unit composition.
  const sorted = [...generals].sort((a, b) => b.stats.tong - a.stats.tong);
  return sorted[0]?.troopType ?? 'infantry';
}

// ----- Duel resolution (single-combat between two named generals) -----

export interface DuelInput {
  state: GameState;
  a: GeneralId;
  b: GeneralId;
}

export interface DuelResult {
  state: GameState;
  winner: GeneralId;
  loser: GeneralId;
  triggered: boolean;
}

export function tryDuel(input: DuelInput): DuelResult | null {
  const a = input.state.generals[input.a];
  const b = input.state.generals[input.b];
  if (!a || !b) return null;
  if (a.stats.wu < DUEL_TRIGGER_WU_MIN || b.stats.wu < DUEL_TRIGGER_WU_MIN) return null;
  const { hit, state: stateAfterCheck } = rollChance(input.state.rngState, DUEL_TRIGGER_PROB);
  if (!hit) {
    return {
      state: { ...input.state, rngState: stateAfterCheck },
      winner: a.id,
      loser: b.id,
      triggered: false,
    };
  }
  // Damage swap: higher wu likely wins. Tie broken by RNG.
  const margin = a.stats.wu - b.stats.wu;
  const { value: roll, state: rng2 } = rollInt(stateAfterCheck, -8, 8);
  const aWins = margin + roll >= 0;
  const winner = aWins ? a : b;
  const loser = aWins ? b : a;
  const updatedLoser = { ...loser, status: 'wounded' as const, troops: Math.floor(loser.troops * 0.5) };
  const nextGenerals = { ...input.state.generals, [loser.id]: updatedLoser };
  const log: LogEntry = {
    turn: input.state.turn,
    year: input.state.year,
    month: input.state.month,
    key: 'event.duelWin',
    vars: { winner: winner.name, loser: loser.name },
  };
  return {
    state: {
      ...input.state,
      generals: nextGenerals,
      rngState: rng2,
      log: [...input.state.log, log],
    },
    winner: winner.id,
    loser: loser.id,
    triggered: true,
  };
}

// ----- Battle (tactical layer) day advance -----
//
// Per-day battle tick. If the attacker hasn't won by BATTLE_DAY_LIMIT they
// auto-retreat (signature behavior from the original game).

export function tickBattleDay(battle: Battle): Battle {
  return { ...battle, daysElapsed: battle.daysElapsed + 1 };
}

export function isBattleTimeout(battle: Battle): boolean {
  return battle.daysElapsed >= BATTLE_DAY_LIMIT;
}
