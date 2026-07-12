// Scenario 4 — Liu Bei, Chapter 4 story content (Appendix C of the Phase-5 plan).
//
// Chapter 4 (三国鼎立 / s4-dingli, 220 CE) is the FINALE. Cao Pi has deposed the
// last Han emperor and proclaimed the Wei; Liu Bei holds Yi Province from Chengdu
// (seven cities) and Sun Quan the Jing river-line. Modelled on s3-liubei.ts, this
// module exposes two tables:
//   - S4_LIUBEI_OBJECTIVES: four objectives — proclaim Shu-Han, the Yiling
//     decision (the GATING objective), the Northern Expeditions (the terminal
//     capstone), and — OPTIONAL — unifying the realm. Completing the three
//     MANDATORY objectives triggers the historic victory and the grand finale.
//   - S4_LIUBEI_EVENTS: two SCRIPTED narrative beats (proclaim_han,
//     northern_expedition) framing the arc, with the 夷陵 Yiling choice
//     (launch the campaign / show restraint) fired between them.
//
// The finale arc is scripted narrative — there is no reliable tactical signal to
// key off — so each beat's check is a simple hasEvent/turn predicate and the arc
// auto-progresses without soft-stalling.
//
// All identifiers and comments are English; every user-facing string is
// referenced by MessageKey and resolved against the active locale.

import type { GameState } from '../../engine/types.js';
import type { ObjectiveDef, StoryEvent } from '../../engine/story/types.js';
import { hasEvent, transferCityWithGenerals } from './helpers.js';

// Has the Yiling decision already been resolved (either branch taken)? Shared by
// the yiling gating objective and the yiling_march choice's check, so the
// objective and the choice can never disagree. Pure predicate.
const yilingDecided = (state: GameState): boolean =>
  hasEvent(state, 'yiling_launched') || hasEvent(state, 'yiling_restrained');

// Liu Bei — Chapter 4 objective chain (Appendix C). Every check() is a pure
// predicate over GameState (no wall-clock, no RNG). proclaim / yiling / northern
// are MANDATORY and gate the historic victory (yiling is the gating capstone,
// completed by either Yiling branch; northern is the terminal capstone). unify is
// OPTIONAL — a stretch goal that never gates the finale.
export const S4_LIUBEI_OBJECTIVES: ObjectiveDef[] = [
  {
    id: 'proclaim',
    titleKey: 'objective.s4.proclaim.title',
    descKey: 'objective.s4.proclaim.desc',
    // Take the throne at Chengdu — the proclaim_han beat has fired.
    check: (state) => hasEvent(state, 'proclaim_han'),
  },
  {
    id: 'yiling',
    titleKey: 'objective.s4.yiling.title',
    descKey: 'objective.s4.yiling.desc',
    // GATING objective: resolved when either Yiling branch is chosen.
    check: (state) => yilingDecided(state),
  },
  {
    id: 'northern',
    titleKey: 'objective.s4.northern.title',
    descKey: 'objective.s4.northern.desc',
    // Terminal capstone: entrust Zhuge Liang's campaigns — the
    // northern_expedition beat has fired. Completing this (with the other two
    // mandatory objectives) triggers the historic victory and the finale.
    check: (state) => hasEvent(state, 'northern_expedition'),
  },
  {
    id: 'unify',
    titleKey: 'objective.s4.unify.title',
    descKey: 'objective.s4.unify.desc',
    // OPTIONAL stretch goal: hold every city on the map. Never gates the finale.
    optional: true,
    check: (state) => Object.values(state.cities).every((c) => c.factionId === 'liubei'),
  },
];

// The Ascension at Chengdu (登基称帝) — a purely narrative beat (choices: [],
// NO apply) that opens the finale. Fires from turn 1 onward; the framework
// records the id at fire time so it fires exactly once.
const proclaimBeat: StoryEvent = {
  id: 'proclaim_han',
  check: (state) => state.turn >= 1,
  titleKey: 'story.s4.proclaim.title',
  bodyKey: 'story.s4.proclaim.body',
  portrait: 'liubei',
  choices: [],
};

// The March to Yiling (夷陵之征). Fires once you have proclaimed Shu-Han and only
// while the decision is still open. Each branch records its decision flag in
// state.events so the choice cannot re-fire.
const yilingMarch: StoryEvent = {
  id: 'yiling_march',
  check: (state) => hasEvent(state, 'proclaim_han') && !yilingDecided(state),
  titleKey: 'story.s4.yiling.title',
  bodyKey: 'story.s4.yiling.body',
  portrait: 'guanyu',
  choices: [
    {
      id: 'launch',
      labelKey: 'choice.s4.yiling.launch.label',
      descKey: 'choice.s4.yiling.launch.desc',
      // Launch the Yiling campaign: seize Jiangling, the gate of Jing (GUARDED —
      // only ever Sun Quan's Jiangling, never Wei's or unowned), moving its
      // stationed generals with it; then Lu Xun's fire at Xiaoting guts the
      // forward army (garrison to a quarter, defense broken); the strung-out
      // campaign bleeds Bajun's garrison and halves Chengdu's treasury.
      apply: (state) => {
        const cities = { ...state.cities };
        const generals = { ...state.generals };
        const jiangling = cities['jiangling'];
        if (jiangling && jiangling.factionId === 'sunquan') {
          transferCityWithGenerals(cities, generals, 'jiangling', 'liubei');
          const seized = cities['jiangling'];
          if (seized) {
            cities['jiangling'] = {
              ...seized,
              garrison: Math.floor(seized.garrison * 0.25),
              defense: Math.max(0, seized.defense - 30),
            };
          }
        }
        const bajun = cities['bajun'];
        if (bajun) {
          cities['bajun'] = { ...bajun, garrison: Math.floor(bajun.garrison * 0.3) };
        }
        const chengdu = cities['chengdu'];
        if (chengdu) {
          cities['chengdu'] = {
            ...chengdu,
            money: Math.floor(chengdu.money * 0.5),
            food: Math.floor(chengdu.food * 0.5),
          };
        }
        return {
          ...state,
          cities,
          generals,
          events: [
            ...state.events,
            { id: 'yiling_launched', turn: state.turn, year: state.year, month: state.month },
          ],
        };
      },
    },
    {
      id: 'restraint',
      labelKey: 'choice.s4.yiling.restraint.label',
      descKey: 'choice.s4.yiling.restraint.desc',
      // Restraint: stand the army down and turn north. Loyalty rises across every
      // Shu city, Chengdu's economy is replenished, and Hanzhong's garrison is
      // reinforced for the coming campaigns — but Lord Guan goes unavenged.
      apply: (state) => {
        const cities = { ...state.cities };
        // Raise loyalty on every Liu Bei city.
        for (const [id, city] of Object.entries(cities)) {
          if (city.factionId === 'liubei') {
            cities[id] = { ...city, loyalty: Math.min(100, city.loyalty + 10) };
          }
        }
        const chengdu = cities['chengdu'];
        if (chengdu) {
          cities['chengdu'] = {
            ...chengdu,
            money: chengdu.money + 15000,
            food: chengdu.food + 25000,
          };
        }
        const hanzhong = cities['hanzhong'];
        if (hanzhong) {
          cities['hanzhong'] = {
            ...hanzhong,
            garrison: hanzhong.garrison + 15000,
            food: hanzhong.food + 15000,
          };
        }
        return {
          ...state,
          cities,
          events: [
            ...state.events,
            { id: 'yiling_restrained', turn: state.turn, year: state.year, month: state.month },
          ],
        };
      },
    },
  ],
};

// The Northern Expeditions (六出祁山) — the terminal capstone, a purely narrative
// beat (choices: [], NO apply). Fires once the Yiling decision is made and only
// while it has not yet fired. Completing it makes all three mandatory objectives
// complete → the historic victory → the grand finale.
const northernBeat: StoryEvent = {
  id: 'northern_expedition',
  check: (state) => yilingDecided(state) && !hasEvent(state, 'northern_expedition'),
  titleKey: 'story.s4.northern.title',
  bodyKey: 'story.s4.northern.body',
  portrait: 'zhugeliang',
  choices: [],
};

// Liu Bei — Chapter 4 story events (Appendix C). The proclaim beat opens the
// finale, the Yiling choice fires between the beats, and the Northern Expeditions
// beat is the terminal capstone. The first eligible event per tick fires, so the
// arc plays out proclaim → yiling → northern.
export const S4_LIUBEI_EVENTS: StoryEvent[] = [
  proclaimBeat,
  yilingMarch,
  northernBeat,
];
