import {
  FOOD_PER_AGRICULTURE,
  FOOD_PER_TROOP_MONTH,
  LOYALTY_RECOVERY,
  MONEY_PER_COMMERCE,
  RECRUIT_CAP_PER_MONTH,
  RECRUIT_FOOD_COST_PER_TROOP,
  RECRUIT_GOLD_COST_PER_TROOP,
  SEARCH_BASE_PROB,
  SEARCH_ZHENG_WEIGHT,
} from './constants.js';
import { rollChance, rollInt } from './rng.js';
import type { GameState, GeneralId, LocalizedString, LogEntry } from './types.js';

// Each politics command is a pure (state, args) => state function. It
// records a LogEntry but does not advance the month — the turn loop owns
// time progression.

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function addLog(
  state: GameState,
  key: string,
  vars?: Record<string, string | number | LocalizedString>,
): GameState {
  const entry: LogEntry = {
    turn: state.turn,
    year: state.year,
    month: state.month,
    key,
    vars,
  };
  return { ...state, log: [...state.log, entry] };
}

export interface CommandArgs {
  cityId: string;
  generalId: GeneralId;
}

// Develop (开垦) — improves agriculture. Scales with the executing general's
// zheng stat.
export function develop(state: GameState, args: CommandArgs): GameState {
  const city = state.cities[args.cityId];
  const gen = state.generals[args.generalId];
  if (!city || !gen) return state;
  const gain = Math.max(1, Math.floor(2 + gen.stats.zheng / 12));
  const updated = { ...city, agriculture: clamp(city.agriculture + gain, 0, 100) };
  let next: GameState = { ...state, cities: { ...state.cities, [city.id]: updated } };
  next = addLog(next, 'result.developed', { city: city.name, amount: gain });
  return next;
}

// Commerce (招商) — improves commerce.
export function commerce(state: GameState, args: CommandArgs): GameState {
  const city = state.cities[args.cityId];
  const gen = state.generals[args.generalId];
  if (!city || !gen) return state;
  const gain = Math.max(1, Math.floor(2 + gen.stats.zheng / 12));
  const updated = { ...city, commerce: clamp(city.commerce + gain, 0, 100) };
  let next: GameState = { ...state, cities: { ...state.cities, [city.id]: updated } };
  next = addLog(next, 'result.commerceUp', { city: city.name, amount: gain });
  return next;
}

// Govern (治理) — boosts loyalty.
export function govern(state: GameState, args: CommandArgs): GameState {
  const city = state.cities[args.cityId];
  const gen = state.generals[args.generalId];
  if (!city || !gen) return state;
  const gain = Math.max(1, Math.floor(3 + gen.stats.zheng / 10));
  const updated = { ...city, loyalty: clamp(city.loyalty + gain, 0, 100) };
  let next: GameState = { ...state, cities: { ...state.cities, [city.id]: updated } };
  next = addLog(next, 'result.governed', { city: city.name, amount: gain });
  return next;
}

// Patrol (出巡) — modest boost to all three economic stats.
export function patrol(state: GameState, args: CommandArgs): GameState {
  const city = state.cities[args.cityId];
  const gen = state.generals[args.generalId];
  if (!city || !gen) return state;
  const updated = {
    ...city,
    agriculture: clamp(city.agriculture + 1, 0, 100),
    commerce: clamp(city.commerce + 1, 0, 100),
    loyalty: clamp(city.loyalty + 1, 0, 100),
  };
  let next: GameState = { ...state, cities: { ...state.cities, [city.id]: updated } };
  next = addLog(next, 'result.patrolled', { city: city.name });
  return next;
}

// Plunder (掠夺) — Dong-Zhuo-style raid on your own city. Big money/food
// gain, loyalty crashes.
export function plunder(state: GameState, args: { cityId: string }): GameState {
  const city = state.cities[args.cityId];
  if (!city) return state;
  const moneyGain = Math.floor(city.money * 0.3);
  const foodGain = Math.floor(city.food * 0.3);
  const updated = {
    ...city,
    money: city.money - moneyGain,
    food: city.food - foodGain,
    loyalty: Math.max(0, Math.floor(city.loyalty / 2)),
  };
  const faction = city.factionId;
  let next: GameState = { ...state, cities: { ...state.cities, [city.id]: updated } };
  if (faction) {
    // For now treat the plundered resources as personal-hand gold/food held
    // in the next-most-developed friendly city (we don't track per-faction
    // pooled treasury yet).
    const sinkCity = Object.values(next.cities).find(
      (c) => c.factionId === faction && c.id !== city.id,
    );
    if (sinkCity) {
      next = {
        ...next,
        cities: {
          ...next.cities,
          [sinkCity.id]: {
            ...sinkCity,
            money: sinkCity.money + moneyGain,
            food: sinkCity.food + foodGain,
          },
        },
      };
    }
  }
  return next;
}

// Search (搜寻) — try to find an unaligned general hiding in the city.
// Probability scales with the executing general's zheng.
export function search(state: GameState, args: CommandArgs): GameState {
  const city = state.cities[args.cityId];
  const gen = state.generals[args.generalId];
  if (!city || !gen) return state;
  const wild = Object.values(state.generals).find(
    (g) => g.factionId === null && g.locationCityId === city.id && g.status === 'active',
  );
  if (!wild) {
    return addLog(state, 'result.searched', { city: city.name });
  }
  const prob = SEARCH_BASE_PROB + gen.stats.zheng * SEARCH_ZHENG_WEIGHT;
  const { hit, state: rngState } = rollChance(state.rngState, prob);
  if (!hit) {
    return addLog({ ...state, rngState }, 'result.searched', { city: city.name });
  }
  // Tribute Easter eggs only respond to specific searcher/city combinations.
  if (wild.id === 'tongxiao' && (gen.id !== 'mizhu' || city.id !== 'yunnan' || state.month !== 10)) {
    return addLog({ ...state, rngState }, 'result.searched', { city: city.name });
  }
  if (wild.id === 'nanfang' && (gen.id !== 'mizhu' || city.id !== 'yunnan' || state.month !== 10)) {
    return addLog({ ...state, rngState }, 'result.searched', { city: city.name });
  }

  const factionId = gen.factionId;
  if (!factionId) {
    return addLog({ ...state, rngState }, 'result.searched', { city: city.name });
  }
  const updatedWild = { ...wild, factionId, locationCityId: city.id };
  const updatedCity = { ...city, generals: [...city.generals, wild.id] };
  let next: GameState = {
    ...state,
    rngState,
    generals: { ...state.generals, [wild.id]: updatedWild },
    cities: { ...state.cities, [city.id]: updatedCity },
  };
  const eventKey =
    wild.id === 'tongxiao'
      ? 'event.tongxiaoFound'
      : wild.id === 'nanfang'
      ? 'event.nanfangFound'
      : 'event.wildGeneralFound';
  next = addLog(next, eventKey, {
    general: gen.name,
    city: city.name,
    target: wild.name,
  });
  return next;
}

// Recruit (征兵) — conscript troops into the city's garrison.
export function recruit(
  state: GameState,
  args: { cityId: string; count: number },
): GameState {
  const city = state.cities[args.cityId];
  if (!city) return state;
  const requested = Math.min(args.count, RECRUIT_CAP_PER_MONTH);
  const goldCap = Math.floor(city.money / RECRUIT_GOLD_COST_PER_TROOP);
  const foodCap = Math.floor(city.food / RECRUIT_FOOD_COST_PER_TROOP);
  const actual = Math.max(0, Math.min(requested, goldCap, foodCap));
  const updated = {
    ...city,
    money: city.money - actual * RECRUIT_GOLD_COST_PER_TROOP,
    food: city.food - actual * RECRUIT_FOOD_COST_PER_TROOP,
    garrison: city.garrison + actual,
    loyalty: Math.max(0, city.loyalty - Math.floor(actual / 500)),
  };
  let next: GameState = { ...state, cities: { ...state.cities, [city.id]: updated } };
  next = addLog(next, 'result.recruited', {
    city: city.name,
    amount: actual,
    garrison: updated.garrison,
  });
  return next;
}

// Monthly economy: cities produce gold and food, troops consume food,
// rebellious cities can flip neutral.
export function applyMonthlySettlement(state: GameState): GameState {
  const newCities: GameState['cities'] = { ...state.cities };
  const log: LogEntry[] = [];
  for (const city of Object.values(newCities)) {
    const moneyYield = Math.floor(city.commerce * MONEY_PER_COMMERCE);
    const foodYield = Math.floor(city.agriculture * FOOD_PER_AGRICULTURE);
    const troopUpkeep = Math.floor(city.garrison * FOOD_PER_TROOP_MONTH);
    let nextFood = city.food + foodYield - troopUpkeep;
    let nextLoyalty = city.loyalty;
    if (nextFood < 0) {
      // Starvation: garrison eats less, loyalty plummets.
      nextLoyalty = Math.max(0, nextLoyalty - 10);
      nextFood = 0;
    }
    const rebellion = nextLoyalty < 20 && city.factionId !== null;
    if (rebellion) {
      newCities[city.id] = {
        ...city,
        money: city.money + moneyYield,
        food: nextFood,
        loyalty: LOYALTY_RECOVERY,
        factionId: null, // city flips neutral
        garrison: Math.floor(city.garrison * 0.5),
        generals: [], // generals scatter
      };
      log.push({
        turn: state.turn,
        year: state.year,
        month: state.month,
        key: 'event.rebellion',
        vars: { city: city.name },
      });
    } else {
      newCities[city.id] = {
        ...city,
        money: city.money + moneyYield,
        food: nextFood,
        loyalty: nextLoyalty,
      };
    }
  }
  return { ...state, cities: newCities, log: [...state.log, ...log] };
}

// Per-month recovery for wounded generals. They drift back to active status
// after a few months out of action and, when their faction still controls a
// city, they get reseated at that city's capital (the first city in their
// faction's roster). This keeps a single bad battle from permanently
// retiring a general.
export function applyWoundedRecovery(state: GameState): GameState {
  let next = state;
  const newGenerals = { ...next.generals };
  let rng = next.rngState;
  for (const gen of Object.values(newGenerals)) {
    if (gen.status !== 'wounded') continue;
    // 35% chance per month to come back to active duty.
    const r = ((rng = (rng + 0x6d2b79f5) >>> 0), rng);
    let t = r;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const prob = (((t ^ (t >>> 14)) >>> 0) % 0x100000000) / 0x100000000;
    if (prob < 0.35) {
      // Find a city to redeploy them to.
      let homeCity: string | null = null;
      if (gen.factionId) {
        const factionCity = Object.values(next.cities).find((c) => c.factionId === gen.factionId);
        if (factionCity) homeCity = factionCity.id;
      }
      newGenerals[gen.id] = {
        ...gen,
        status: 'active',
        locationCityId: homeCity ?? gen.locationCityId,
        troops: Math.floor(gen.troops * 0.5),
      };
      if (homeCity && next.cities[homeCity]) {
        const c = next.cities[homeCity]!;
        if (!c.generals.includes(gen.id)) {
          next = {
            ...next,
            cities: {
              ...next.cities,
              [homeCity]: { ...c, generals: [...c.generals, gen.id] },
            },
          };
        }
      }
    }
  }
  return { ...next, generals: newGenerals, rngState: rng };
}

// Year roll-over (every 12 months): generals age and may die of natural causes.
export function applyYearlyAging(state: GameState): GameState {
  let next = state;
  let rng = next.rngState;
  const newGenerals = { ...next.generals };
  const log: LogEntry[] = [];
  for (const gen of Object.values(newGenerals)) {
    if (gen.status === 'dead') continue;
    const updated = { ...gen, age: gen.age + 1 };
    // Mortality: small chance at 60+, rising sharply after 75.
    if (updated.age >= 60) {
      const baseProb = updated.age >= 75 ? 0.15 : 0.04;
      const { hit, state: r } = rollChance(rng, baseProb);
      rng = r;
      if (hit) {
        updated.status = 'dead';
        log.push({
          turn: next.turn,
          year: next.year,
          month: next.month,
          key: 'event.generalDied',
          vars: { general: updated.name, age: updated.age },
        });
      }
    }
    newGenerals[gen.id] = updated;
  }
  next = { ...next, generals: newGenerals, rngState: rng, log: [...next.log, ...log] };
  // Silence unused-warning for rollInt import; reserved for future enhancement.
  void rollInt;
  return next;
}
