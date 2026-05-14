import { adjacentCities, citiesAdjacent, citiesOf, enemyNeighbors } from '../map.js';
import { factionGenerals, wildGeneralsIn } from '../selectors.js';
import type {
  AgentContext,
  StrategicCommand,
  Personality,
  City,
  General,
  GameState,
  FactionStrategy,
} from '../types.js';
import { PERSONALITY_PRESETS } from './personality.js';
import type { PersonalityParams } from './personality.js';
import { threatenedCityIds } from './strategy.js';

// Decide one faction's actions for the current month. The strategy is
// supplied by the turn loop (which calls agent.reassess first) via
// ctx.strategy; a missing strategy falls back to a neutral consolidate
// posture so direct unit-test calls never throw.
export function strategicRules(
  ctx: AgentContext,
  personality: Personality,
): StrategicCommand[] {
  const { state, factionId } = ctx;
  const params = PERSONALITY_PRESETS[personality];
  const owned = citiesOf(state, factionId);
  if (owned.length === 0) return [{ kind: 'endTurn' }];
  const generals = factionGenerals(state, factionId);
  if (generals.length === 0) return [{ kind: 'endTurn' }];

  const strategy: FactionStrategy = ctx.strategy ?? {
    posture: 'consolidate',
    targetFactionId: null,
    targetCityId: null,
    stagingCityId: null,
    updatedTurn: state.turn,
  };

  const commands: StrategicCommand[] = [
    ...internalAffairsCommands(state, factionId, generals),
    ...recruitmentCommands(state, factionId, strategy),
    ...concentrationCommands(state, factionId, strategy, generals, params),
    ...militaryCommands(state, factionId, strategy, generals, params),
  ];
  commands.push({ kind: 'endTurn' });
  return commands;
}

function topGeneralsIn(generals: General[], cityId: string, count: number): General[] {
  const inCity = generals.filter((g) => g.locationCityId === cityId && g.status === 'active');
  return [...inCity].sort((a, b) => b.stats.wu + b.stats.tong - (a.stats.wu + a.stats.tong)).slice(0, count);
}

function sumGeneralTroopsIn(state: GameState, cityId: string): number {
  return Object.values(state.generals)
    .filter((g) => g.locationCityId === cityId && g.status === 'active')
    .reduce((s, g) => s + g.troops, 0);
}

// ----- Command helpers (consumed by the rewritten strategicRules) -----

type CityNeed = 'govern' | 'develop' | 'commerce' | 'search' | 'patrol';

function hasWildGeneralIn(state: GameState, cityId: string): boolean {
  return wildGeneralsIn(state, cityId).length > 0;
}

// Ordered list of what a city most needs, most urgent first. De-duplicated.
function rankCityNeeds(state: GameState, city: City): CityNeed[] {
  const needs: CityNeed[] = [];
  if (city.loyalty < 50) needs.push('govern');
  if (city.food < city.garrison * 3) needs.push('develop');
  if (city.money < city.garrison) needs.push('commerce');
  if (city.agriculture < 70) needs.push('develop');
  if (city.commerce < 70) needs.push('commerce');
  // No zheng gate here: internalAffairsCommands assigns needs to the
  // highest-zheng available generals first, and the search command handler
  // already scales success probability by zheng — so a weak searcher is
  // merely less effective, not a bug.
  if (hasWildGeneralIn(state, city.id)) needs.push('search');
  needs.push('patrol');
  return [...new Set(needs)];
}

// Up to two distinct internal-affairs actions per owned city per month,
// each run by a different stationed general where possible.
export function internalAffairsCommands(
  state: GameState,
  factionId: string,
  generals: General[],
): StrategicCommand[] {
  const cmds: StrategicCommand[] = [];
  for (const city of citiesOf(state, factionId)) {
    const inCity = generals
      .filter((g) => g.locationCityId === city.id && g.status === 'active')
      .sort((a, b) => b.stats.zheng - a.stats.zheng);
    if (inCity.length === 0) continue;
    const needs = rankCityNeeds(state, city);
    const count = Math.min(2, needs.length);
    for (let i = 0; i < count; i++) {
      const general = inCity[i] ?? inCity[0]!;
      cmds.push({ kind: needs[i]!, cityId: city.id, generalId: general.id });
    }
  }
  return cmds;
}

// Posture-weighted recruitment. expand → mass at the staging city;
// defend → reinforce threatened cities; otherwise routine build-up. A
// city needs gold for at least 500 troops to recruit at all.
export function recruitmentCommands(
  state: GameState,
  factionId: string,
  strategy: FactionStrategy,
): StrategicCommand[] {
  const cmds: StrategicCommand[] = [];
  const threatened = new Set(threatenedCityIds(state, factionId));
  for (const city of citiesOf(state, factionId)) {
    if (city.money < 500) continue;
    let count = 0;
    if (strategy.posture === 'expand' && city.id === strategy.stagingCityId) {
      count = 2000;
    } else if (strategy.posture === 'defend' && threatened.has(city.id)) {
      count = 2000;
    } else if (city.money > city.garrison * 2 && city.garrison < 20000) {
      count = 1000;
    }
    if (count > 0) cmds.push({ kind: 'recruit', cityId: city.id, count });
  }
  return cmds;
}

// expand → funnel troops from safe interior cities to the staging city.
// Any posture → take one adjacent neutral city when troops are spare.
export function concentrationCommands(
  state: GameState,
  factionId: string,
  strategy: FactionStrategy,
  generals: General[],
  params: PersonalityParams,
): StrategicCommand[] {
  const cmds: StrategicCommand[] = [];
  const owned = citiesOf(state, factionId);

  if (strategy.posture === 'expand' && strategy.stagingCityId) {
    const staging = state.cities[strategy.stagingCityId];
    if (staging) {
      for (const city of owned) {
        if (city.id === staging.id) continue;
        // Only drain "interior" cities — those with no enemy/neutral neighbor.
        if (enemyNeighbors(state, city.id, factionId).length > 0) continue;
        const spare = Math.floor(city.garrison * params.reinforceAggressiveness);
        if (spare < 1000) continue;
        const escort = topGeneralsIn(generals, city.id, 1).map((g) => g.id);
        cmds.push({
          kind: 'move',
          fromCityId: city.id,
          toCityId: staging.id,
          generalIds: escort,
          troops: spare,
        });
      }
    }
  }

  for (const city of owned) {
    if (city.garrison < 3000) continue;
    const neutral = enemyNeighbors(state, city.id, factionId).find(
      (n) => n.factionId === null,
    );
    if (!neutral) continue;
    const led = topGeneralsIn(generals, city.id, 1);
    if (led.length === 0) continue;
    cmds.push({
      kind: 'attack',
      fromCityId: city.id,
      toCityId: neutral.id,
      generalIds: led.map((g) => g.id),
      troops: Math.min(city.garrison - 1000, 4000),
    });
    break; // one opportunistic grab per month
  }

  return cmds;
}

// defend → reinforce threatened cities from safe neighbors.
// expand → assault the target city once the staging force clears the
// personality's concentrationThreshold advantage ratio.
export function militaryCommands(
  state: GameState,
  factionId: string,
  strategy: FactionStrategy,
  generals: General[],
  params: PersonalityParams,
): StrategicCommand[] {
  const cmds: StrategicCommand[] = [];

  if (strategy.posture === 'defend') {
    const threatened = threatenedCityIds(state, factionId);
    for (const tid of threatened) {
      const donor = adjacentCities(state, tid).find(
        (c) =>
          c.factionId === factionId &&
          c.garrison > 2000 &&
          !threatened.includes(c.id),
      );
      if (!donor) continue;
      const escort = topGeneralsIn(generals, donor.id, 1).map((g) => g.id);
      cmds.push({
        kind: 'move',
        fromCityId: donor.id,
        toCityId: tid,
        generalIds: escort,
        troops: Math.floor(donor.garrison * 0.5),
      });
    }
    return cmds;
  }

  if (strategy.posture === 'expand' && strategy.stagingCityId && strategy.targetCityId) {
    const staging = state.cities[strategy.stagingCityId];
    const target = state.cities[strategy.targetCityId];
    if (!staging || !target) return cmds;
    if (!citiesAdjacent(staging, target)) return cmds;
    const stagingForce = staging.garrison + sumGeneralTroopsIn(state, staging.id);
    const targetForce = target.garrison + sumGeneralTroopsIn(state, target.id);
    if (stagingForce >= Math.max(2000, targetForce * params.concentrationThreshold)) {
      const led = topGeneralsIn(generals, staging.id, 2);
      if (led.length > 0) {
        cmds.push({
          kind: 'attack',
          fromCityId: staging.id,
          toCityId: target.id,
          generalIds: led.map((g) => g.id),
          troops: Math.max(1000, staging.garrison - 1000),
        });
      }
    }
  }

  return cmds;
}
