import type { GameState, ScenarioEvent } from '../../engine/types.js';

// Scripted events for scenario 1. Each event fires at most once and records
// itself in state.events to prevent re-firing.

function hasFired(state: GameState, id: string): boolean {
  return state.events.some((e) => e.id === id);
}

function recordEvent(state: GameState, id: string): GameState {
  return {
    ...state,
    events: [...state.events, { id, turn: state.turn, year: state.year, month: state.month }],
  };
}

function log(state: GameState, key: string, vars?: Record<string, string | number>): GameState {
  return {
    ...state,
    log: [
      ...state.log,
      { turn: state.turn, year: state.year, month: state.month, key, vars },
    ],
  };
}

// Month 2: Guandong coalition forms. All non-Dong factions gain a small troop
// boost as militias rally to the cause.
export const guandongCoalition: ScenarioEvent = {
  id: 'guandong_coalition',
  check: (s) => !hasFired(s, 'guandong_coalition') && s.turn >= 1,
  apply: (s) => {
    let next = s;
    const newCities = { ...next.cities };
    for (const city of Object.values(newCities)) {
      if (city.factionId && city.factionId !== 'dongzhuo') {
        newCities[city.id] = { ...city, garrison: city.garrison + 1000 };
      }
    }
    next = { ...next, cities: newCities };
    next = log(next, 'event.guandongCoalition');
    return recordEvent(next, 'guandong_coalition');
  },
};

// Month 12 (turn >= 11): if Dong Zhuo still holds Luoyang, the city is razed
// and the capital is moved to Chang-an. Luoyang's stats are gutted.
export const qianduChangan: ScenarioEvent = {
  id: 'qiandu_changan',
  check: (s) =>
    !hasFired(s, 'qiandu_changan') &&
    s.turn >= 11 &&
    s.cities['luoyang']?.factionId === 'dongzhuo',
  apply: (s) => {
    const luoyang = s.cities['luoyang'];
    if (!luoyang) return s;
    const burned = {
      ...luoyang,
      agriculture: 10,
      commerce: 10,
      defense: 30,
      loyalty: 0,
      money: 0,
      food: 0,
    };
    const nextCities = { ...s.cities, luoyang: burned };
    let next: GameState = { ...s, cities: nextCities };
    next = log(next, 'event.qianduChangan');
    return recordEvent(next, 'qiandu_changan');
  },
};

// Xun Yu, once recruited by Cao Cao, can find Guo Jia via a search in
// Yecheng. This trigger is checked after the search command and is wired in
// politics.ts; here we keep its check + apply minimal.
export const xunRecommendsGuo: ScenarioEvent = {
  id: 'xun_recommends_guo',
  check: (s) => {
    if (hasFired(s, 'xun_recommends_guo')) return false;
    const xun = s.generals['xunyu'];
    const guo = s.generals['guojia'];
    return Boolean(xun && xun.factionId === 'caocao' && guo && guo.factionId === null);
  },
  apply: (s) => {
    const guo = s.generals['guojia'];
    if (!guo) return s;
    const updated = { ...guo, factionId: 'caocao', locationCityId: 'chenliu' };
    const nextGenerals = { ...s.generals, guojia: updated };
    let next: GameState = { ...s, generals: nextGenerals };
    next = log(next, 'event.xunRecommendsGuo');
    return recordEvent(next, 'xun_recommends_guo');
  },
};

export const S1_EVENTS: ScenarioEvent[] = [
  guandongCoalition,
  qianduChangan,
  xunRecommendsGuo,
];
