// Scenario 1 — Liu Bei, Chapter 1 story content (Appendix A of the design spec).
//
// This is the authored vertical-slice content that brings Story Mode Chapter 1
// alive on the Phase-1 engine. It exposes two tables:
//   - S1_LIUBEI_OBJECTIVES: the four Chapter 1 objectives, each with a pure,
//     deterministic completion predicate over GameState (no wall-clock, no RNG).
//   - S1_LIUBEI_EVENTS: the single fateful choice of the slice — Tao Qian's
//     bequest of Xuzhou — with Accept / Decline branches.
//
// All identifiers and comments are English; every user-facing string is
// referenced by MessageKey and resolved against the active locale.

import type { City, FactionId, GameState, General } from '../../engine/types.js';
import type { ObjectiveDef, StoryEvent } from '../../engine/story/types.js';

// The three commanderies that make up Xuzhou in Scenario 1 (Tao Qian's seat).
const XUZHOU_CITY_IDS = ['xiapi', 'pengcheng', 'xiaopei'] as const;

function hasEvent(state: GameState, id: string): boolean {
  return state.events.some((e) => e.id === id);
}

// Flip a city to a new owner AND move its stationed generals with it, so the
// state never strands dead-faction officers inside a city they'd otherwise
// still defend (resolveQuickBattle reads defenders from city.generals). Pure:
// mutates only the FRESH cities/generals maps the caller owns (shallow copies
// of state.cities/state.generals) — the original maps are never touched, and
// each city/general is replaced by a spread copy. Historically apt: Xuzhou's
// officers (Mi Zhu, Chen Deng, ...) threw in with whoever held the province.
function transferCityWithGenerals(
  cities: Record<string, City>,
  generals: Record<string, General>,
  cityId: string,
  newOwner: FactionId,
): void {
  const city = cities[cityId];
  if (!city) return;
  cities[cityId] = { ...city, factionId: newOwner };
  for (const generalId of city.generals) {
    const g = generals[generalId];
    // Keep the general at the same city; only its allegiance changes.
    if (g) generals[generalId] = { ...g, factionId: newOwner };
  }
}

function liubeiOwnsXuzhouCity(state: GameState): boolean {
  return XUZHOU_CITY_IDS.some((id) => state.cities[id]?.factionId === 'liubei');
}

function xuzhouDecided(state: GameState): boolean {
  return hasEvent(state, 'xuzhou_accepted') || hasEvent(state, 'xuzhou_declined');
}

// Liu Bei — Chapter 1 objective chain (Appendix A). Every check() is a pure
// predicate over GameState (no wall-clock, no RNG).
export const S1_LIUBEI_OBJECTIVES: ObjectiveDef[] = [
  {
    id: 'coalition',
    titleKey: 'objective.s1.coalition.title',
    descKey: 'objective.s1.coalition.desc',
    // Answering the call = the Guandong coalition event has fired.
    check: (state) => hasEvent(state, 'guandong_coalition'),
  },
  {
    id: 'zhaoyun',
    titleKey: 'objective.s1.zhaoyun.title',
    descKey: 'objective.s1.zhaoyun.desc',
    // Zhao Yun has joined Liu Bei's faction.
    check: (state) => state.generals['zhaoyun']?.factionId === 'liubei',
  },
  {
    id: 'xuzhouAid',
    titleKey: 'objective.s1.xuzhouAid.title',
    descKey: 'objective.s1.xuzhouAid.desc',
    // Liu Bei has aided Xuzhou and now holds one of its cities.
    check: (state) => liubeiOwnsXuzhouCity(state),
  },
  {
    id: 'foundation',
    titleKey: 'objective.s1.foundation.title',
    descKey: 'objective.s1.foundation.desc',
    // The bequest of Xuzhou has been decided (accepted or declined).
    check: (state) => xuzhouDecided(state),
  },
];

// Liu Bei — Chapter 1 story events (Appendix A). The single fateful choice of
// the vertical slice: Tao Qian's bequest of Xuzhou.
export const S1_LIUBEI_EVENTS: StoryEvent[] = [
  {
    id: 'xuzhou_bequest',
    // Fires once Liu Bei has aided Xuzhou (holds a city there) and has not yet
    // resolved the bequest. Each apply() also records the decision in
    // state.events, so the event cannot re-fire after a choice is made.
    check: (state) => liubeiOwnsXuzhouCity(state) && !xuzhouDecided(state),
    titleKey: 'story.s1.xuzhou.title',
    bodyKey: 'story.s1.xuzhou.body',
    portrait: 'taoqian',
    choices: [
      {
        id: 'accept',
        labelKey: 'choice.s1.xuzhou.accept.label',
        descKey: 'choice.s1.xuzhou.accept.desc',
        // Accept: every Xuzhou city still held by Tao Qian passes to Liu Bei,
        // and its stationed generals defect with the province (Mi Zhu / Chen
        // Deng join Liu Bei). Treasury/grain ride along via city.money/food.
        apply: (state) => {
          const cities = { ...state.cities };
          const generals = { ...state.generals };
          for (const id of XUZHOU_CITY_IDS) {
            if (cities[id]?.factionId === 'taoqian') {
              transferCityWithGenerals(cities, generals, id, 'liubei');
            }
          }
          return {
            ...state,
            cities,
            generals,
            events: [
              ...state.events,
              { id: 'xuzhou_accepted', turn: state.turn, year: state.year, month: state.month },
            ],
          };
        },
      },
      {
        id: 'decline',
        labelKey: 'choice.s1.xuzhou.decline.label',
        descKey: 'choice.s1.xuzhou.decline.desc',
        // Decline: Liu Bei refuses the province and holds only Xiaopei to guard
        // its border. Transfer Xiaopei (and its stationed generals) to Liu Bei
        // ONLY IF it is still Tao Qian's — never seize a third party's city.
        // Xiapi / Pengcheng are deliberately left untouched: declining does not
        // take the main province, and must not revert or strand anything.
        apply: (state) => {
          const cities = { ...state.cities };
          const generals = { ...state.generals };
          if (cities['xiaopei']?.factionId === 'taoqian') {
            transferCityWithGenerals(cities, generals, 'xiaopei', 'liubei');
          }
          return {
            ...state,
            cities,
            generals,
            events: [
              ...state.events,
              { id: 'xuzhou_declined', turn: state.turn, year: state.year, month: state.month },
            ],
          };
        },
      },
    ],
  },
];
