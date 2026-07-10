// Bridges the emergent battle back to the strategic layer. battleToResult
// reproduces resolveQuickBattle's win-path (ownership flip, loyalty haircut,
// defender wounding, attacker relocation, cityFell/attackerRetreated log) plus
// the loss-path attacker retreat to a friendly neighbor. resolveBattleHeadless
// runs the sim to completion with AI orders for both sides.
import { BATTLE_DAY_LIMIT } from '../constants.js';
import { adjacentCities } from '../map.js';
import { planTactical } from '../ai/tactics/index.js';
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

// Personality-driven default orders for a side. Delegates to the utility
// tactical planner (src/engine/ai/tactics/), and is kept here so the sim module
// has no AI dependency. Drives the enemy, the player's auto-line, and headless
// resolution alike.
export function defaultTacticalCommands(
  battle: Battle,
  factionId: FactionId,
  personality: Personality,
): TacticalCommand[] {
  return planTactical(battle, factionId, personality);
}

// Troops still actively holding the field for a side. Only 'fielded' units
// count: a reserve block still uncommitted at battle's end is not defending, so
// it does not keep a city in contention once the fielded defense is
// annihilated, and a 'routing'/'gone' unit is no longer fighting either way.
// (The planner can commit reserves mid-battle; once committed they are
// 'fielded' and counted here.)
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

  // Surviving troops for a general's block(s), reconstructed from the finished
  // battle's units (a general has exactly one block, but sum defensively).
  const survOf = (gid: string): number =>
    battle.units.filter((u) => u.generalId === gid).reduce((n, u) => n + Math.max(0, u.troops), 0);
  // Surviving defender garrison blocks (unled units: generalId === '').
  const survGarrison = battle.units
    .filter((u) => u.factionId === battle.defenderFactionId && !u.generalId)
    .reduce((n, u) => n + Math.max(0, u.troops), 0);

  // Winner: decided on FIELDED-ONLY troops (a never-committed reserve does not
  // keep a city in contention). When defTroops<=0 the timeout term is moot, so
  // the win test is simply "defender's field is gone, attacker still has one".
  const atkFielded = sumTroops(battle, battle.attackerFactionId);
  const defFielded = sumTroops(battle, battle.defenderFactionId);
  const attackerWon = defFielded <= 0 && atkFielded > 0;

  const attackerGenerals = battle.units
    .filter((u) => u.factionId === battle.attackerFactionId && u.generalId)
    .map((u) => state.generals[u.generalId])
    .filter((g): g is General => Boolean(g));
  const defenderGenerals = city.generals
    .map((id) => state.generals[id])
    .filter((g): g is General => Boolean(g));

  // Casualties = committed start - surviving, over ALL units (fielded+reserve),
  // against the battle's recorded start totals when available.
  const atkSurv = battle.units
    .filter((u) => u.factionId === battle.attackerFactionId)
    .reduce((n, u) => n + Math.max(0, u.troops), 0);
  const defSurv = battle.units
    .filter((u) => u.factionId === battle.defenderFactionId)
    .reduce((n, u) => n + Math.max(0, u.troops), 0);
  const attackerCasualties = Math.max(0, (battle.startTroops?.attacker ?? atkSurv) - atkSurv);
  const defenderCasualties = Math.max(0, (battle.startTroops?.defender ?? defSurv) - defSurv);

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
      garrison: survGarrison,
      generals: attackerGenerals.map((g) => g.id),
    };
    for (const g of defenderGenerals) {
      updatedGenerals[g.id] = { ...g, locationCityId: null, status: 'wounded', troops: survOf(g.id) };
    }
    for (const g of attackerGenerals) {
      updatedGenerals[g.id] = { ...g, locationCityId: city.id, troops: survOf(g.id) };
    }
    const faction = state.factions[battle.attackerFactionId];
    log.push({
      turn: state.turn, year: state.year, month: state.month, key: 'event.cityFell',
      vars: { city: city.name, faction: faction ? faction.name : { zh: battle.attackerFactionId, en: battle.attackerFactionId } },
      factionId: battle.attackerFactionId,
    });
  } else {
    // Attackers retreat to a friendly neighbor of the target, if any, at their
    // surviving strength. The defender keeps the city with its post-siege
    // garrison + surviving generals.
    const nearbyFriendly = adjacentCities(state, city.id).find((c) => c.factionId === battle.attackerFactionId);
    for (const g of attackerGenerals) {
      if (g.status === 'active') {
        updatedGenerals[g.id] = { ...g, locationCityId: nearbyFriendly ? nearbyFriendly.id : null, troops: survOf(g.id) };
      }
    }
    for (const g of defenderGenerals) {
      updatedGenerals[g.id] = { ...g, troops: survOf(g.id) };
    }
    updatedCity = { ...updatedCity, garrison: survGarrison };
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
