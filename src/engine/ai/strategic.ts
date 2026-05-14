import { rollChance } from '../rng.js';
import { citiesOf, enemyNeighbors } from '../map.js';
import { factionGenerals, factionTotals } from '../selectors.js';
import type {
  AgentContext,
  StrategicCommand,
  Personality,
  City,
  General,
  GameState,
} from '../types.js';
import { PERSONALITY_PRESETS } from './personality.js';

// Decide one faction's actions for the current month. Returns an ordered
// list of commands the turn loop will execute.
//
// The original game's "two-layer" AI separates national strategy from the
// per-battle tactical layer. This is the national layer.
export function strategicRules(
  ctx: AgentContext,
  personality: Personality,
): StrategicCommand[] {
  const { state, factionId } = ctx;
  const params = PERSONALITY_PRESETS[personality];
  const cities = citiesOf(state, factionId);
  if (cities.length === 0) return [{ kind: 'endTurn' }];
  const generals = factionGenerals(state, factionId);
  if (generals.length === 0) return [{ kind: 'endTurn' }];
  const totals = factionTotals(state, factionId);

  const commands: StrategicCommand[] = [];
  let rng = state.rngState;

  // ----- Per-city internal affairs -----
  for (const city of cities) {
    const general = pickGovernor(generals, city.id);
    if (!general) continue;

    if (city.loyalty < 30) {
      commands.push({ kind: 'govern', cityId: city.id, generalId: general.id });
      continue;
    }
    if (city.food < city.garrison * 2) {
      commands.push({ kind: 'develop', cityId: city.id, generalId: general.id });
      continue;
    }
    if (city.money < city.garrison * 0.5) {
      commands.push({ kind: 'commerce', cityId: city.id, generalId: general.id });
      continue;
    }
    // Search for unaligned generals if we have a politically capable handler.
    if (general.stats.zheng >= 75 && hasWildGeneral(ctx, city.id)) {
      commands.push({ kind: 'search', cityId: city.id, generalId: general.id });
      continue;
    }
    // Default: patrol to slowly improve all metrics.
    const { hit, state: r } = rollChance(rng, params.internalAffairsProb);
    rng = r;
    if (hit) {
      commands.push({ kind: 'patrol', cityId: city.id, generalId: general.id });
    }
  }

  // ----- Recruitment when wealthy and at war footing -----
  for (const city of cities) {
    if (city.money > city.garrison * 2 && city.garrison < 20000) {
      commands.push({ kind: 'recruit', cityId: city.id, count: 1500 });
    }
  }

  // ----- War decisions (month >= 4 to give everyone time to set up) -----
  if (state.turn >= 3) {
    for (const city of cities) {
      const targets = enemyNeighbors(state, city.id, factionId);
      for (const target of targets) {
        const targetTroops = target.garrison + sumGeneralTroopsIn(ctx, target.id);
        const ourTroops = city.garrison + sumGeneralTroopsIn(ctx, city.id);
        if (target.factionId === null && city.garrison > 2000) {
          // Empty city — always grab it.
          const force = Math.min(city.garrison - 1000, 5000);
          const led = topGeneralsIn(generals, city.id, 1);
          if (led.length > 0 && force > 500) {
            commands.push({
              kind: 'attack',
              fromCityId: city.id,
              toCityId: target.id,
              generalIds: led.map((g) => g.id),
              troops: force,
            });
            break;
          }
        } else if (
          ourTroops >= targetTroops * params.minAdvantageRatio &&
          totals.troops > 5000
        ) {
          const { hit, state: r } = rollChance(rng, params.attackHostileProb);
          rng = r;
          if (hit) {
            const force = Math.min(city.garrison - 1000, Math.floor(targetTroops * 1.5));
            const led = topGeneralsIn(generals, city.id, 2);
            if (led.length > 0 && force > 1000) {
              commands.push({
                kind: 'attack',
                fromCityId: city.id,
                toCityId: target.id,
                generalIds: led.map((g) => g.id),
                troops: force,
              });
              break;
            }
          }
        }
      }
    }
  }

  commands.push({ kind: 'endTurn' });
  return commands;
}

// Pick the most politically capable general currently in the city for
// internal-affairs work.
function pickGovernor(generals: General[], cityId: string): General | undefined {
  const inCity = generals.filter((g) => g.locationCityId === cityId && g.status === 'active');
  if (inCity.length === 0) return undefined;
  return [...inCity].sort((a, b) => b.stats.zheng - a.stats.zheng)[0];
}

function topGeneralsIn(generals: General[], cityId: string, count: number): General[] {
  const inCity = generals.filter((g) => g.locationCityId === cityId && g.status === 'active');
  return [...inCity].sort((a, b) => b.stats.wu + b.stats.tong - (a.stats.wu + a.stats.tong)).slice(0, count);
}

function hasWildGeneral(ctx: AgentContext, cityId: string): boolean {
  return Object.values(ctx.state.generals).some(
    (g) => g.factionId === null && g.locationCityId === cityId && g.status === 'active',
  );
}

function sumGeneralTroopsIn(ctx: AgentContext, cityId: string): number {
  return Object.values(ctx.state.generals)
    .filter((g) => g.locationCityId === cityId && g.status === 'active')
    .reduce((s, g) => s + g.troops, 0);
}

// ----- Command helpers (consumed by the rewritten strategicRules) -----

type CityNeed = 'govern' | 'develop' | 'commerce' | 'search' | 'patrol';

function hasWildGeneralIn(state: GameState, cityId: string): boolean {
  return Object.values(state.generals).some(
    (g) => g.factionId === null && g.locationCityId === cityId && g.status === 'active',
  );
}

// Ordered list of what a city most needs, most urgent first. De-duplicated.
function rankCityNeeds(state: GameState, city: City): CityNeed[] {
  const needs: CityNeed[] = [];
  if (city.loyalty < 50) needs.push('govern');
  if (city.food < city.garrison * 3) needs.push('develop');
  if (city.money < city.garrison) needs.push('commerce');
  if (city.agriculture < 70) needs.push('develop');
  if (city.commerce < 70) needs.push('commerce');
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
