// Scenario 3 — Liu Bei, Chapter 3 story content (Appendix C of the Phase-4 plan).
//
// Chapter 3 (赤壁之战 / s3-chibi, 208 CE) casts Liu Bei cornered at the lone
// river-city of Jiangxia as Cao Cao sweeps south into Jing. Modelled on
// s2-liubei.ts, this module exposes two tables:
//   - S3_LIUBEI_OBJECTIVES: four MANDATORY objectives — the Longzhong plan,
//     forging the Sun-Liu alliance, burning the fleet, and claiming Jing
//     (the GATING objective) — each with a pure completion predicate.
//   - S3_LIUBEI_EVENTS: three SCRIPTED narrative beats (longzhong_plan,
//     sun_liu_alliance, red_cliffs) that auto-progress the Red Cliffs arc, then
//     the 借荆州 Borrow-Jing choice (take Jing / honor the alliance's terms).
//
// The Red Cliffs arc is scripted narrative — there is no reliable
// tactical-fire/war signal to key off — so each beat's check is a simple
// hasEvent/turn predicate and the arc auto-progresses without soft-stalling.
//
// All identifiers and comments are English; every user-facing string is
// referenced by MessageKey and resolved against the active locale.

import type { GameState } from '../../engine/types.js';
import type { ObjectiveDef, StoryEvent } from '../../engine/story/types.js';
import { hasEvent, transferCityWithGenerals } from './helpers.js';

// Has the Borrow-Jing choice already been resolved (either branch taken)?
// Shared by the claimJing gating objective and the jing_borrow choice's check,
// so the objective and the choice can never disagree. Pure predicate.
function jingDecided(state: GameState): boolean {
  return hasEvent(state, 'jing_borrowed') || hasEvent(state, 'jing_honored');
}

// Liu Bei — Chapter 3 objective chain (Appendix C). Every check() is a pure
// predicate over GameState (no wall-clock, no RNG). ALL four objectives are
// mandatory and gate the historic victory; claimJing is the gating capstone,
// completed by either Borrow-Jing branch.
export const S3_LIUBEI_OBJECTIVES: ObjectiveDef[] = [
  {
    id: 'longzhong',
    titleKey: 'objective.s3.longzhong.title',
    descKey: 'objective.s3.longzhong.desc',
    // Embrace Zhuge Liang's grand design — the longzhong_plan beat has fired.
    check: (state) => hasEvent(state, 'longzhong_plan'),
  },
  {
    id: 'alliance',
    titleKey: 'objective.s3.alliance.title',
    descKey: 'objective.s3.alliance.desc',
    // Bind Sun and Liu — the sun_liu_alliance beat has fired.
    check: (state) => hasEvent(state, 'sun_liu_alliance'),
  },
  {
    id: 'burnFleet',
    titleKey: 'objective.s3.burnFleet.title',
    descKey: 'objective.s3.burnFleet.desc',
    // Shatter Cao Cao's fleet with fire — the red_cliffs beat has fired.
    check: (state) => hasEvent(state, 'red_cliffs'),
  },
  {
    id: 'claimJing',
    titleKey: 'objective.s3.claimJing.title',
    descKey: 'objective.s3.claimJing.desc',
    // GATING objective: resolved when either Borrow-Jing branch is chosen.
    check: (state) => jingDecided(state),
  },
];

// The Longzhong Reply (隆中对) — a purely narrative beat (choices: [], NO apply)
// that opens the chapter. Fires from turn 1 onward; the framework records the id
// at fire time so it fires exactly once.
const longzhongBeat: StoryEvent = {
  id: 'longzhong_plan',
  check: (state) => state.turn >= 1,
  titleKey: 'story.s3.longzhong.title',
  bodyKey: 'story.s3.longzhong.body',
  portrait: 'zhugeliang',
  choices: [],
};

// The Southlands Pact (孙刘联盟) — a narrative beat that also injects the marines
// and grain Sun Quan's alliance brings to Jiangxia. Fires once the Longzhong plan
// has been laid. Its apply does NOT re-record the id (the framework already did).
const allianceBeat: StoryEvent = {
  id: 'sun_liu_alliance',
  check: (state) => hasEvent(state, 'longzhong_plan'),
  titleKey: 'story.s3.alliance.title',
  bodyKey: 'story.s3.alliance.body',
  portrait: 'sunquan',
  choices: [],
  apply: (state) => {
    const cities = { ...state.cities };
    const jiangxia = cities['jiangxia'];
    if (jiangxia) {
      cities['jiangxia'] = {
        ...jiangxia,
        garrison: jiangxia.garrison + 8000,
        food: jiangxia.food + 12000,
        money: jiangxia.money + 6000,
      };
    }
    return { ...state, cities };
  },
};

// The East Wind (借东风) — the scripted Red Cliffs fire. Fires once the alliance
// is forged and only while it has not yet fired (its own id guards re-fire, in
// step with runScenarioEvents' fired-id record). Its apply guts Cao Cao's Jing
// garrisons (jiangling + xiangyang) — the fire's off-map effect — and boosts
// Jiangxia's stores. Only Cao-held cities are touched; ownership is unchanged.
const redCliffsBeat: StoryEvent = {
  id: 'red_cliffs',
  check: (state) => hasEvent(state, 'sun_liu_alliance') && !hasEvent(state, 'red_cliffs'),
  titleKey: 'story.s3.eastwind.title',
  bodyKey: 'story.s3.eastwind.body',
  portrait: 'zhugeliang',
  choices: [],
  apply: (state) => {
    const cities = { ...state.cities };
    for (const id of ['jiangling', 'xiangyang']) {
      const city = cities[id];
      if (city && city.factionId === 'caocao') {
        cities[id] = {
          ...city,
          garrison: Math.floor(city.garrison * 0.2),
          defense: Math.max(0, city.defense - 30),
        };
      }
    }
    const jiangxia = cities['jiangxia'];
    if (jiangxia) {
      cities['jiangxia'] = {
        ...jiangxia,
        money: jiangxia.money + 5000,
        food: jiangxia.food + 8000,
      };
    }
    return { ...state, cities };
  },
};

// The Borrowing of Jing (借荆州). Fires once Red Cliffs is won and only while the
// choice is still open. Each branch records its decision flag in state.events so
// the choice cannot re-fire. Both branches GUARD every seizure (only Cao-held or
// unowned Jing land is ever taken — never Sun Quan's Wu territory) and move each
// seized city's stationed generals with it.
const jingBorrow: StoryEvent = {
  id: 'jing_borrow',
  check: (state) => hasEvent(state, 'red_cliffs') && !jingDecided(state),
  titleKey: 'story.s3.borrow.title',
  bodyKey: 'story.s3.borrow.body',
  portrait: 'lusu',
  choices: [
    {
      id: 'take',
      labelKey: 'choice.s3.borrow.take.label',
      descKey: 'choice.s3.borrow.take.desc',
      // Take Jing: seize the several commanderies (Cao-held or unowned) as your
      // long-lacked base, reinforce each, and boost Jiangxia — but plant the
      // seed of the Southlands' resentment.
      apply: (state) => {
        const cities = { ...state.cities };
        const generals = { ...state.generals };
        for (const id of ['jiangling', 'changsha', 'lingling', 'guiyang', 'wuling']) {
          const city = cities[id];
          if (city && (city.factionId === 'caocao' || city.factionId === null)) {
            transferCityWithGenerals(cities, generals, id, 'liubei');
            const seized = cities[id];
            if (seized) cities[id] = { ...seized, garrison: seized.garrison + 2000 };
          }
        }
        const jiangxia = cities['jiangxia'];
        if (jiangxia) {
          cities['jiangxia'] = {
            ...jiangxia,
            money: jiangxia.money + 6000,
            food: jiangxia.food + 10000,
          };
        }
        return {
          ...state,
          cities,
          generals,
          events: [
            ...state.events,
            { id: 'jing_borrowed', turn: state.turn, year: state.year, month: state.month },
          ],
        };
      },
    },
    {
      id: 'honor',
      labelKey: 'choice.s3.borrow.honor.label',
      descKey: 'choice.s3.borrow.honor.desc',
      // Honor the terms: take only two commanderies (Cao-held or unowned), lift
      // loyalty across all your cities, and boost Jiangxia — cementing the
      // alliance at the cost of a smaller foothold.
      apply: (state) => {
        const cities = { ...state.cities };
        const generals = { ...state.generals };
        for (const id of ['lingling', 'guiyang']) {
          const city = cities[id];
          if (city && (city.factionId === 'caocao' || city.factionId === null)) {
            transferCityWithGenerals(cities, generals, id, 'liubei');
          }
        }
        // Raise loyalty on every Liu Bei city (including any just seized).
        for (const [id, city] of Object.entries(cities)) {
          if (city.factionId === 'liubei') {
            cities[id] = { ...city, loyalty: Math.min(100, city.loyalty + 8) };
          }
        }
        const jiangxia = cities['jiangxia'];
        if (jiangxia) {
          cities['jiangxia'] = {
            ...jiangxia,
            money: jiangxia.money + 3000,
            food: jiangxia.food + 5000,
          };
        }
        return {
          ...state,
          cities,
          generals,
          events: [
            ...state.events,
            { id: 'jing_honored', turn: state.turn, year: state.year, month: state.month },
          ],
        };
      },
    },
  ],
};

// Liu Bei — Chapter 3 story events (Appendix C). The three scripted beats
// precede the Borrow-Jing choice in array order; the first eligible event per
// tick fires, so the arc plays out longzhong → alliance → Red Cliffs → borrow.
export const S3_LIUBEI_EVENTS: StoryEvent[] = [
  longzhongBeat,
  allianceBeat,
  redCliffsBeat,
  jingBorrow,
];
