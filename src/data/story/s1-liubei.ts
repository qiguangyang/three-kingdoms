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

import type { GameState } from '../../engine/types.js';
import type { ObjectiveDef, StoryEvent } from '../../engine/story/types.js';

// The three commanderies that make up Xuzhou in Scenario 1 (Tao Qian's seat).
const XUZHOU_CITY_IDS = ['xiapi', 'pengcheng', 'xiaopei'] as const;

function hasEvent(state: GameState, id: string): boolean {
  return state.events.some((e) => e.id === id);
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
        // Accept: every Xuzhou city still held by Tao Qian passes to Liu Bei.
        apply: (state) => {
          const cities = { ...state.cities };
          for (const id of XUZHOU_CITY_IDS) {
            const city = cities[id];
            if (city && city.factionId === 'taoqian') {
              cities[id] = { ...city, factionId: 'liubei' };
            }
          }
          return {
            ...state,
            cities,
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
        // Decline: Liu Bei keeps only Xiaopei as a base; the rest of Xuzhou
        // stays with (or reverts to) Tao Qian.
        apply: (state) => {
          const cities = { ...state.cities };
          const xiaopei = cities['xiaopei'];
          if (xiaopei) cities['xiaopei'] = { ...xiaopei, factionId: 'liubei' };
          for (const id of ['xiapi', 'pengcheng']) {
            const city = cities[id];
            if (city && city.factionId === 'liubei') {
              cities[id] = { ...city, factionId: 'taoqian' };
            }
          }
          return {
            ...state,
            cities,
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
