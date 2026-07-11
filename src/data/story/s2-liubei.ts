// Scenario 2 — Liu Bei, Chapter 2 story content (Appendix C of the Phase-3 plan).
//
// Chapter 2 (群雄逐鹿 / s2-junxiong, 196 CE) casts Liu Bei as a landless guest
// sheltering in Xiaopei under Lü Bu's shadow. Modelled on s1-liubei.ts, this
// module exposes two tables:
//   - S2_LIUBEI_OBJECTIVES: four objectives — outlast Lü Bu, shelter in Xudu,
//     the Plum-Wine reckoning (gating), and (optional) break the leash — each
//     with a pure, deterministic completion predicate over GameState.
//   - S2_LIUBEI_EVENTS: the Xudu shelter beat (which injects Xiaopei
//     reinforcements) and the 青梅煮酒 Plum-Wine choice (break away / bide).
//
// All identifiers and comments are English; every user-facing string is
// referenced by MessageKey and resolved against the active locale.

import type { City, FactionId, GameState, General } from '../../engine/types.js';
import type { ObjectiveDef, StoryEvent } from '../../engine/story/types.js';

function hasEvent(state: GameState, id: string): boolean {
  return state.events.some((e) => e.id === id);
}

// Flip a city to a new owner AND move its stationed generals with it, so the
// state never strands dead-faction officers inside a city they'd otherwise
// still defend. Re-implemented identically to s1-liubei.ts's helper (that module
// keeps it private). Pure: mutates only the FRESH cities/generals maps the
// caller owns (shallow copies of state.cities/state.generals) — the original
// maps are never touched, and each city/general is replaced by a spread copy.
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

// Has the Plum-Wine reckoning already been resolved (either branch taken)?
function plumWineDecided(state: GameState): boolean {
  return hasEvent(state, 'plum_wine_broke') || hasEvent(state, 'plum_wine_bided');
}

// Liu Bei — Chapter 2 objective chain (Appendix C). Every check() is a pure
// predicate over GameState (no wall-clock, no RNG). The three non-optional
// objectives (outlastLvbu + shelter + plumWine) gate the historic victory;
// breakFree is optional and never gates the chapter's completion.
export const S2_LIUBEI_OBJECTIVES: ObjectiveDef[] = [
  {
    id: 'outlastLvbu',
    titleKey: 'objective.s2.outlastLvbu.title',
    descKey: 'objective.s2.outlastLvbu.desc',
    // Survive Lü Bu: he is put down, OR Liu Bei seizes one of his seats.
    check: (state) =>
      state.factions['lvbu']?.alive === false ||
      state.cities['xiapi']?.factionId === 'liubei' ||
      state.cities['pengcheng']?.factionId === 'liubei',
  },
  {
    id: 'shelter',
    titleKey: 'objective.s2.shelter.title',
    descKey: 'objective.s2.shelter.desc',
    // Take refuge with Cao Cao — the shelter_xudu beat has fired.
    check: (state) => hasEvent(state, 'shelter_xudu'),
  },
  {
    id: 'plumWine',
    titleKey: 'objective.s2.plumWine.title',
    descKey: 'objective.s2.plumWine.desc',
    // GATING objective: resolved when either Plum-Wine branch is chosen.
    check: (state) => hasEvent(state, 'plum_wine_broke') || hasEvent(state, 'plum_wine_bided'),
  },
  {
    id: 'breakFree',
    titleKey: 'objective.s2.breakFree.title',
    descKey: 'objective.s2.breakFree.desc',
    optional: true, // does NOT gate the historic victory
    // Only completed by breaking away — biding does not fulfil it.
    check: (state) => hasEvent(state, 'plum_wine_broke'),
  },
];

// The Xudu shelter — a narrative beat (choices: []) that also injects Xiaopei
// reinforcements. Fires from turn 2 onward; runScenarioEvents records the id at
// fire time so it fires exactly once (no separate seen-flag), and applyStoryChoice
// runs this apply when the beat is dismissed. The apply does NOT re-record the id
// (the framework already did) — it only grants the soldiers and grain Cao Cao
// sends back to Xiaopei to bar Lü Bu's road.
const shelterBeat: StoryEvent = {
  id: 'shelter_xudu',
  check: (state) => state.turn >= 2,
  titleKey: 'story.s2.shelter.title',
  bodyKey: 'story.s2.shelter.body',
  choices: [],
  apply: (state) => {
    const cities = { ...state.cities };
    const xiaopei = cities['xiaopei'];
    if (xiaopei) {
      cities['xiaopei'] = {
        ...xiaopei,
        garrison: xiaopei.garrison + 3000,
        food: xiaopei.food + 6000,
        money: xiaopei.money + 3000,
      };
    }
    return { ...state, cities };
  },
};

// The Plum-Wine reckoning (青梅煮酒论英雄). Fires once Lü Bu is dead and Liu Bei
// has sheltered, and only while the choice is still open. Each branch records its
// decision flag in state.events, so the event cannot re-fire after a choice.
const plumWineEvent: StoryEvent = {
  id: 'plum_wine',
  check: (state) =>
    state.factions['lvbu']?.alive === false &&
    hasEvent(state, 'shelter_xudu') &&
    !plumWineDecided(state),
  titleKey: 'story.s2.plumwine.title',
  bodyKey: 'story.s2.plumwine.body',
  portrait: 'caocao',
  choices: [
    {
      id: 'break',
      labelKey: 'choice.s2.plumwine.break.label',
      descKey: 'choice.s2.plumwine.break.desc',
      // Break with Cao Cao: reclaim your own troops (Xiaopei reinforced) and
      // snatch Xuzhou's seat — but only if xiapi is Cao Cao's, Lü Bu's, or
      // unowned. Never seize a third party's city.
      apply: (state) => {
        const cities = { ...state.cities };
        const generals = { ...state.generals };
        const xiaopei = cities['xiaopei'];
        if (xiaopei) {
          cities['xiaopei'] = {
            ...xiaopei,
            garrison: xiaopei.garrison + 6000,
            money: xiaopei.money + 5000,
            food: xiaopei.food + 8000,
          };
        }
        const xiapi = cities['xiapi'];
        if (
          xiapi &&
          (xiapi.factionId === 'caocao' ||
            xiapi.factionId === 'lvbu' ||
            xiapi.factionId === null)
        ) {
          transferCityWithGenerals(cities, generals, 'xiapi', 'liubei');
        }
        return {
          ...state,
          cities,
          generals,
          events: [
            ...state.events,
            { id: 'plum_wine_broke', turn: state.turn, year: state.year, month: state.month },
          ],
        };
      },
    },
    {
      id: 'bide',
      labelKey: 'choice.s2.plumwine.bide.label',
      descKey: 'choice.s2.plumwine.bide.desc',
      // Bide your time: Cao Cao's grain and gold let Xiaopei grow in safety.
      apply: (state) => {
        const cities = { ...state.cities };
        const xiaopei = cities['xiaopei'];
        if (xiaopei) {
          cities['xiaopei'] = {
            ...xiaopei,
            money: xiaopei.money + 12000,
            food: xiaopei.food + 20000,
            garrison: xiaopei.garrison + 8000,
            agriculture: Math.min(100, xiaopei.agriculture + 12),
            commerce: Math.min(100, xiaopei.commerce + 12),
          };
        }
        return {
          ...state,
          cities,
          events: [
            ...state.events,
            { id: 'plum_wine_bided', turn: state.turn, year: state.year, month: state.month },
          ],
        };
      },
    },
  ],
};

// Liu Bei — Chapter 2 story events (Appendix C). The shelter beat precedes the
// Plum-Wine choice in array order; the first eligible event per tick fires.
export const S2_LIUBEI_EVENTS: StoryEvent[] = [shelterBeat, plumWineEvent];
