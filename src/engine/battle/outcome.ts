// Bridges the emergent battle back to the strategic layer. battleToResult
// reproduces resolveQuickBattle's win-path (ownership flip, loyalty haircut,
// defender wounding, attacker relocation, cityFell/attackerRetreated log) plus
// the loss-path attacker retreat to a friendly neighbor. resolveBattleHeadless
// runs the sim to completion with AI orders for both sides.
import { BATTLE_DAY_LIMIT } from '../constants.js';
import { adjacentCities } from '../map.js';
import { tacticalRules } from '../ai/tactical.js';
import type { QuickBattleResult } from '../combat.js';
import type {
  Battle,
  FactionId,
  GameState,
  General,
  LogEntry,
  Personality,
  TacticalCommand,
} from '../types.js';
import { stepBattle } from './simulate.js';

// Personality-driven default orders for a side (thin wrapper over the existing
// tactical AI; kept here so the sim module has no AI dependency).
export function defaultTacticalCommands(
  battle: Battle,
  factionId: FactionId,
  personality: Personality,
): TacticalCommand[] {
  return tacticalRules(battle, factionId, personality);
}

// Troops still actively holding the field for a side. Only 'fielded' units
// count: a reserve block that was never committed (no tactical AI currently
// issues commitReserves) does not keep a city in contention once its fielded
// defense is annihilated, and a 'routing'/'gone' unit is no longer fighting
// either way.
function sumTroops(battle: Battle, factionId: FactionId): number {
  return battle.units
    .filter((u) => u.factionId === factionId && u.state === 'fielded')
    .reduce((n, u) => n + Math.max(0, u.troops), 0);
}

export function battleToResult(state: GameState, battle: Battle): QuickBattleResult {
  const city = state.cities[battle.cityId];
  if (!city) {
    return { state, attackerWon: false, attackerCasualties: 0, defenderCasualties: 0, log: [] };
  }

  // Winner: attacker wins iff it still has fighting troops and the defender has
  // none (mirrors the sim's end-check).
  const atkTroops = sumTroops(battle, battle.attackerFactionId);
  const defTroops = sumTroops(battle, battle.defenderFactionId);
  const timedOut = battle.daysElapsed >= BATTLE_DAY_LIMIT;
  const attackerWon = defTroops <= 0 && atkTroops > 0 && !(timedOut && defTroops > 0);

  // Casualties = starting - surviving, reconstructed from the units.
  const attackerGenerals = battle.units
    .filter((u) => u.factionId === battle.attackerFactionId && u.generalId)
    .map((u) => state.generals[u.generalId])
    .filter((g): g is General => Boolean(g));
  const defenderGenerals = city.generals
    .map((id) => state.generals[id])
    .filter((g): g is General => Boolean(g));

  // We do not carry pre-battle totals on the finished battle, so derive
  // casualties from the city + committed-force snapshot in `state`.
  const committedAtk = attackerGenerals.reduce((n, g) => n + g.troops, 0) || atkTroops;
  const attackerCasualties = Math.max(0, committedAtk - atkTroops);
  const defStart = city.garrison + defenderGenerals.reduce((n, g) => n + g.troops, 0);
  const defenderCasualties = Math.max(0, defStart - defTroops);

  const updatedCities = { ...state.cities };
  const updatedGenerals = { ...state.generals };
  let updatedCity = { ...city };
  const log: LogEntry[] = [];
  const rng = battle.rngCursor; // final battle RNG cursor threads back to state

  if (attackerWon) {
    updatedCity = {
      ...updatedCity,
      factionId: battle.attackerFactionId,
      loyalty: Math.max(20, Math.floor(updatedCity.loyalty * 0.6)),
      generals: attackerGenerals.map((g) => g.id),
    };
    for (const g of defenderGenerals) {
      updatedGenerals[g.id] = { ...g, locationCityId: null, status: 'wounded' };
    }
    for (const g of attackerGenerals) {
      updatedGenerals[g.id] = { ...g, locationCityId: city.id };
    }
    const faction = state.factions[battle.attackerFactionId];
    log.push({
      turn: state.turn, year: state.year, month: state.month, key: 'event.cityFell',
      vars: { city: city.name, faction: faction ? faction.name : { zh: battle.attackerFactionId, en: battle.attackerFactionId } },
      factionId: battle.attackerFactionId,
    });
  } else {
    // Attackers retreat to a friendly neighbor of the target, if any.
    const nearbyFriendly = adjacentCities(state, city.id).find((c) => c.factionId === battle.attackerFactionId);
    for (const g of attackerGenerals) {
      if (g.status === 'active') {
        updatedGenerals[g.id] = { ...g, locationCityId: nearbyFriendly ? nearbyFriendly.id : null };
      }
    }
    if (nearbyFriendly) {
      updatedCities[nearbyFriendly.id] = {
        ...nearbyFriendly,
        generals: [...nearbyFriendly.generals, ...attackerGenerals.filter((g) => g.status === 'active' && !nearbyFriendly.generals.includes(g.id)).map((g) => g.id)],
      };
    }
    log.push({
      turn: state.turn, year: state.year, month: state.month, key: 'event.attackerRetreated',
      factionId: battle.attackerFactionId,
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
  return { state: nextState, attackerWon, attackerCasualties, defenderCasualties, log };
}

export function resolveBattleHeadless(state: GameState, battle: Battle): QuickBattleResult {
  const atkPers = state.factions[battle.attackerFactionId]?.personality ?? 'balanced';
  const defPers = state.factions[battle.defenderFactionId]?.personality ?? 'balanced';
  let cur = battle;
  for (let day = 0; day < BATTLE_DAY_LIMIT; day++) {
    const commands = [
      ...defaultTacticalCommands(cur, battle.attackerFactionId, atkPers),
      ...defaultTacticalCommands(cur, battle.defenderFactionId, defPers),
    ];
    const stepped = stepBattle({ battle: cur, commands });
    cur = stepped.battle;
    if (stepped.events.some((e) => e.kind === 'end')) break;
  }
  return battleToResult(state, cur);
}
