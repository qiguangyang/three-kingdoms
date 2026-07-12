import { afterEach, describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/engine/types.js';
import type { StoryMode } from '../../../src/engine/story/types.js';
import type { ObjectiveDef } from '../../../src/engine/story/types.js';
import {
  clearTestObjectives,
  objectivesFor,
  seedObjectives,
  setTestObjectives,
} from '../../../src/engine/story/objectives.js';
import {
  applyStoryChoice,
  clearTestStoryEvents,
  setTestStoryEvents,
  storyEventsFor,
} from '../../../src/engine/story/events.js';
import { buildInitialState } from '../../../src/engine/scenario.js';
import { SCENARIO_DINGLI } from '../../../src/data/scenarios/s4-dingli.js';
import { REF_DATA } from '../../../src/data/index.js';

const LIUBEI_CH4: StoryMode = { protagonistFactionId: 'liubei', chapter: 4 };

function baseState(): GameState {
  // s4-dingli (220 CE): Liu Bei holds chengdu, mianzhu, zitong, bajun, hanzhong,
  // jianning, yunnan (7 cities); Sun Quan holds the Jing river-line including
  // jiangling; Cao Pi holds the north; every city is owned (zero neutral). turn 0.
  return {
    ...buildInitialState({
      scenario: SCENARIO_DINGLI,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 1,
    }),
    storyMode: LIUBEI_CH4,
  };
}

// Append a fired-event record (as runScenarioEvents would).
function withEvent(state: GameState, id: string): GameState {
  return {
    ...state,
    events: [...state.events, { id, turn: state.turn, year: state.year, month: state.month }],
  };
}

afterEach(() => {
  clearTestObjectives();
  clearTestStoryEvents();
});

describe('Scenario 4 — Liu Bei Chapter 4 finale content', () => {
  it('objectivesFor returns the four Chapter 4 objectives, in order; unify is optional', () => {
    const defs = objectivesFor('s4-dingli', LIUBEI_CH4);
    expect(defs.map((d) => d.id)).toEqual(['proclaim', 'yiling', 'northern', 'unify']);
    const byId = Object.fromEntries(defs.map((d) => [d.id, d]));
    expect(byId['proclaim'].optional).toBeFalsy();
    expect(byId['yiling'].optional).toBeFalsy();
    expect(byId['northern'].optional).toBeFalsy();
    expect(byId['unify'].optional).toBe(true);
    for (const d of defs) {
      expect(typeof d.titleKey).toBe('string');
      expect(typeof d.descKey).toBe('string');
    }
  });

  it('at least one mandatory objective exists (the three gate the historic victory)', () => {
    const defs = objectivesFor('s4-dingli', LIUBEI_CH4);
    const gating = defs.filter((d) => !d.optional).map((d) => d.id);
    expect(gating).toEqual(['proclaim', 'yiling', 'northern']);
    expect(gating.length).toBeGreaterThan(0);
  });

  it('returns no story objectives for Free Play or a non-protagonist faction', () => {
    expect(objectivesFor('s4-dingli', undefined)).toEqual([]);
    expect(objectivesFor('s4-dingli', { protagonistFactionId: 'caopi', chapter: 4 })).toEqual([]);
  });

  it('test-overlay precedence: a registered overlay wins over the s4 table', () => {
    const overlay: ObjectiveDef[] = [
      { id: 'ov', titleKey: 'objective.s4.proclaim.title', descKey: 'objective.s4.proclaim.desc', check: () => false },
    ];
    setTestObjectives('s4-dingli', overlay);
    expect(objectivesFor('s4-dingli', LIUBEI_CH4)).toBe(overlay);
  });

  it('seedObjectives seeds four active objective states', () => {
    const seeded = seedObjectives(baseState());
    expect(seeded.objectives.map((o) => o.id)).toEqual(['proclaim', 'yiling', 'northern', 'unify']);
    expect(seeded.objectives.every((o) => o.status === 'active')).toBe(true);
  });

  it('proclaim flips when the proclaim_han beat has fired', () => {
    const proclaim = objectivesFor('s4-dingli', LIUBEI_CH4).find((d) => d.id === 'proclaim')!;
    const base = baseState();
    expect(proclaim.check(base)).toBe(false);
    expect(proclaim.check(withEvent(base, 'proclaim_han'))).toBe(true);
  });

  it('yiling (GATING) flips on EITHER Yiling-decision flag', () => {
    const yiling = objectivesFor('s4-dingli', LIUBEI_CH4).find((d) => d.id === 'yiling')!;
    const base = baseState();
    expect(yiling.check(base)).toBe(false);
    expect(yiling.check(withEvent(base, 'yiling_launched'))).toBe(true);
    expect(yiling.check(withEvent(base, 'yiling_restrained'))).toBe(true);
  });

  it('northern (capstone) flips when the northern_expedition beat has fired', () => {
    const northern = objectivesFor('s4-dingli', LIUBEI_CH4).find((d) => d.id === 'northern')!;
    const base = baseState();
    expect(northern.check(base)).toBe(false);
    expect(northern.check(withEvent(base, 'northern_expedition'))).toBe(true);
  });

  it('unify (OPTIONAL) checks that every city is Liu Bei-held, and does not gate', () => {
    const unify = objectivesFor('s4-dingli', LIUBEI_CH4).find((d) => d.id === 'unify')!;
    const base = baseState();
    expect(unify.optional).toBe(true);
    expect(unify.check(base)).toBe(false);
    // Flip every city to liubei -> the optional objective completes.
    const allMine: GameState = {
      ...base,
      cities: Object.fromEntries(
        Object.entries(base.cities).map(([id, c]) => [id, { ...c, factionId: 'liubei' as const }]),
      ),
    };
    expect(unify.check(allMine)).toBe(true);
  });

  it('storyEventsFor exposes the two beats and the yiling_march choice, in order', () => {
    const events = storyEventsFor('s4-dingli', LIUBEI_CH4);
    const ids = events.map((e) => e.id);
    expect(ids).toEqual(['proclaim_han', 'yiling_march', 'northern_expedition']);
    const byId = Object.fromEntries(events.map((e) => [e.id, e]));
    expect(byId['proclaim_han'].choices.length).toBe(0);
    expect(byId['northern_expedition'].choices.length).toBe(0);
    expect(byId['yiling_march'].choices.map((c) => c.id)).toEqual(['launch', 'restraint']);
    expect(byId['proclaim_han'].portrait).toBe('liubei');
    expect(byId['yiling_march'].portrait).toBe('guanyu');
    expect(byId['northern_expedition'].portrait).toBe('zhugeliang');
  });

  it('returns no story events for Free Play / a non-protagonist faction', () => {
    expect(storyEventsFor('s4-dingli', undefined)).toEqual([]);
    expect(storyEventsFor('s4-dingli', { protagonistFactionId: 'caopi', chapter: 4 })).toEqual([]);
  });

  it('proclaim_han beat fires from turn 1, has no apply', () => {
    const beat = storyEventsFor('s4-dingli', LIUBEI_CH4).find((e) => e.id === 'proclaim_han')!;
    const base = baseState(); // turn 0
    expect(beat.check(base)).toBe(false);
    expect(beat.check({ ...base, turn: 1 })).toBe(true);
    expect(beat.apply).toBeUndefined();
  });

  it('northern_expedition beat checks on a Yiling decision + not-yet-fired, has no apply', () => {
    const beat = storyEventsFor('s4-dingli', LIUBEI_CH4).find((e) => e.id === 'northern_expedition')!;
    const base = baseState();
    expect(beat.check(base)).toBe(false);
    const launched = withEvent(base, 'yiling_launched');
    expect(beat.check(launched)).toBe(true);
    const restrained = withEvent(base, 'yiling_restrained');
    expect(beat.check(restrained)).toBe(true);
    // once fired, does not re-fire
    expect(beat.check(withEvent(launched, 'northern_expedition'))).toBe(false);
    expect(beat.apply).toBeUndefined();
  });

  it('yiling_march checks true once proclaim_han fired and not yet decided', () => {
    const beat = storyEventsFor('s4-dingli', LIUBEI_CH4).find((e) => e.id === 'yiling_march')!;
    const base = baseState();
    expect(beat.check(base)).toBe(false);
    const ready = withEvent(base, 'proclaim_han');
    expect(beat.check(ready)).toBe(true);
    expect(beat.check(withEvent(ready, 'yiling_launched'))).toBe(false);
    expect(beat.check(withEvent(ready, 'yiling_restrained'))).toBe(false);
  });

  it('launch: seizes Sun Quan Jiangling (guarded), Lu Xun fire guts it, bleeds Bajun + halves Chengdu, records yiling_launched', () => {
    const yilingMarch = storyEventsFor('s4-dingli', LIUBEI_CH4).find((e) => e.id === 'yiling_march')!;
    const launch = yilingMarch.choices.find((c) => c.id === 'launch')!;
    const base = baseState();
    expect(base.cities['jiangling'].factionId).toBe('sunquan');
    const beforeJiangling = base.cities['jiangling'];
    const beforeBajun = base.cities['bajun'];
    const beforeChengdu = base.cities['chengdu'];
    const next = launch.apply(base);
    // Jiangling seized then gutted by the fire
    expect(next.cities['jiangling'].factionId).toBe('liubei');
    expect(next.cities['jiangling'].garrison).toBe(Math.floor(beforeJiangling.garrison * 0.25));
    expect(next.cities['jiangling'].defense).toBe(Math.max(0, beforeJiangling.defense - 30));
    // Bajun bled
    expect(next.cities['bajun'].garrison).toBe(Math.floor(beforeBajun.garrison * 0.3));
    // Chengdu treasury halved
    expect(next.cities['chengdu'].money).toBe(Math.floor(beforeChengdu.money * 0.5));
    expect(next.cities['chengdu'].food).toBe(Math.floor(beforeChengdu.food * 0.5));
    expect(next.events.some((e) => e.id === 'yiling_launched')).toBe(true);
    // purity: base untouched
    expect(base.cities['jiangling'].factionId).toBe('sunquan');
    expect(base.cities['bajun'].garrison).toBe(beforeBajun.garrison);
  });

  it('launch: reassigns generals stationed in the seized Jiangling (none stranded)', () => {
    const yilingMarch = storyEventsFor('s4-dingli', LIUBEI_CH4).find((e) => e.id === 'yiling_march')!;
    const launch = yilingMarch.choices.find((c) => c.id === 'launch')!;
    const base = baseState();
    // Station a Wu general at jiangling.
    const staged: GameState = {
      ...base,
      cities: { ...base.cities, jiangling: { ...base.cities['jiangling'], generals: ['luxun'] } },
      generals: { ...base.generals, luxun: { ...base.generals['luxun'], factionId: 'sunquan' } },
    };
    const next = launch.apply(staged);
    expect(next.cities['jiangling'].factionId).toBe('liubei');
    expect(next.generals['luxun'].factionId).toBe('liubei');
  });

  it('launch: does NOT seize Jiangling if it is not Sun Quan-held (guarded — never Wei/unowned)', () => {
    const yilingMarch = storyEventsFor('s4-dingli', LIUBEI_CH4).find((e) => e.id === 'yiling_march')!;
    const launch = yilingMarch.choices.find((c) => c.id === 'launch')!;
    const base = baseState();
    const staged: GameState = {
      ...base,
      cities: { ...base.cities, jiangling: { ...base.cities['jiangling'], factionId: 'caopi' } },
    };
    const before = staged.cities['jiangling'];
    const next = launch.apply(staged);
    // Untouched: still Cao Pi's, garrison/defense unchanged
    expect(next.cities['jiangling'].factionId).toBe('caopi');
    expect(next.cities['jiangling'].garrison).toBe(before.garrison);
    expect(next.cities['jiangling'].defense).toBe(before.defense);
    // The rest of the campaign's cost still lands + the decision is recorded
    expect(next.cities['bajun'].garrison).toBe(Math.floor(staged.cities['bajun'].garrison * 0.3));
    expect(next.events.some((e) => e.id === 'yiling_launched')).toBe(true);
  });

  it('restraint: lifts loyalty on all Shu cities, boosts Chengdu economy + Hanzhong garrison, records yiling_restrained', () => {
    const yilingMarch = storyEventsFor('s4-dingli', LIUBEI_CH4).find((e) => e.id === 'yiling_march')!;
    const restraint = yilingMarch.choices.find((c) => c.id === 'restraint')!;
    const base = baseState();
    const beforeChengdu = base.cities['chengdu'];
    const beforeHanzhong = base.cities['hanzhong'];
    const next = restraint.apply(base);
    // every liubei city gets loyalty +10 (clamped at 100)
    for (const [, c] of Object.entries(next.cities)) {
      if (c.factionId === 'liubei') {
        expect(c.loyalty).toBeLessThanOrEqual(100);
      }
    }
    const beforeChengduLoyalty = beforeChengdu.loyalty;
    expect(next.cities['chengdu'].loyalty).toBe(Math.min(100, beforeChengduLoyalty + 10));
    expect(next.cities['chengdu'].money).toBe(beforeChengdu.money + 15000);
    expect(next.cities['chengdu'].food).toBe(beforeChengdu.food + 25000);
    expect(next.cities['hanzhong'].garrison).toBe(beforeHanzhong.garrison + 15000);
    expect(next.cities['hanzhong'].food).toBe(beforeHanzhong.food + 15000);
    expect(next.events.some((e) => e.id === 'yiling_restrained')).toBe(true);
    // purity
    expect(base.cities['chengdu'].money).toBe(beforeChengdu.money);
  });

  it('restraint: clamps loyalty at 100', () => {
    const yilingMarch = storyEventsFor('s4-dingli', LIUBEI_CH4).find((e) => e.id === 'yiling_march')!;
    const restraint = yilingMarch.choices.find((c) => c.id === 'restraint')!;
    const base = baseState();
    const staged: GameState = {
      ...base,
      cities: { ...base.cities, chengdu: { ...base.cities['chengdu'], loyalty: 95 } },
    };
    const next = restraint.apply(staged);
    expect(next.cities['chengdu'].loyalty).toBe(100);
  });

  it('restraint: leaves non-Liu-Bei cities loyalty untouched', () => {
    const yilingMarch = storyEventsFor('s4-dingli', LIUBEI_CH4).find((e) => e.id === 'yiling_march')!;
    const restraint = yilingMarch.choices.find((c) => c.id === 'restraint')!;
    const base = baseState();
    const beforeJiangling = base.cities['jiangling']; // sunquan
    const next = restraint.apply(base);
    expect(next.cities['jiangling'].loyalty).toBe(beforeJiangling.loyalty);
  });

  it('applyStoryChoice runs the proclaim_han beat (no apply) and lifts the pause', () => {
    const base = baseState();
    const staged: GameState = {
      ...base,
      pendingStoryEvent: { eventId: 'proclaim_han', scenarioId: 's4-dingli' },
    };
    const next = applyStoryChoice(staged, 'proclaim_han', '');
    expect(next.pendingStoryEvent).toBeUndefined();
    expect(next.events.some((e) => e.id === 'yiling_launched')).toBe(false);
  });

  it('story-event overlay is appended after the authored s4 table (overlay precedence preserved)', () => {
    setTestStoryEvents('s4-dingli', [
      { id: 'ov', check: () => true, titleKey: 'story.s4.proclaim.title', bodyKey: 'story.s4.proclaim.body', choices: [] },
    ]);
    const ids = storyEventsFor('s4-dingli', LIUBEI_CH4).map((e) => e.id);
    expect(ids).toEqual(['proclaim_han', 'yiling_march', 'northern_expedition', 'ov']);
  });
});
