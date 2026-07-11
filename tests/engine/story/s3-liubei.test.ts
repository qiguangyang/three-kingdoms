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
import { SCENARIO_CHIBI } from '../../../src/data/scenarios/s3-chibi.js';
import { REF_DATA } from '../../../src/data/index.js';

const LIUBEI_CH3: StoryMode = { protagonistFactionId: 'liubei', chapter: 3 };

function baseState(): GameState {
  // s3-chibi (208 CE): Liu Bei holds only jiangxia; Cao Cao holds
  // jiangling + xiangyang (among 22 cities); the four southern Jing
  // commanderies (changsha, lingling, guiyang, wuling) are NEUTRAL. turn 0.
  return {
    ...buildInitialState({
      scenario: SCENARIO_CHIBI,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 1,
    }),
    storyMode: LIUBEI_CH3,
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

describe('Scenario 3 — Liu Bei Chapter 3 content', () => {
  it('objectivesFor returns the four Chapter 3 objectives, in order, all mandatory', () => {
    const defs = objectivesFor('s3-chibi', LIUBEI_CH3);
    expect(defs.map((d) => d.id)).toEqual(['longzhong', 'alliance', 'burnFleet', 'claimJing']);
    for (const d of defs) {
      expect(d.optional).toBeFalsy();
      expect(typeof d.titleKey).toBe('string');
      expect(typeof d.descKey).toBe('string');
    }
  });

  it('returns no story objectives for Free Play or a non-protagonist faction', () => {
    expect(objectivesFor('s3-chibi', undefined)).toEqual([]);
    expect(objectivesFor('s3-chibi', { protagonistFactionId: 'caocao', chapter: 3 })).toEqual([]);
  });

  it('test-overlay precedence: a registered overlay wins over the s3 table', () => {
    const overlay: ObjectiveDef[] = [
      { id: 'ov', titleKey: 'objective.s3.longzhong.title', descKey: 'objective.s3.longzhong.desc', check: () => false },
    ];
    setTestObjectives('s3-chibi', overlay);
    expect(objectivesFor('s3-chibi', LIUBEI_CH3)).toBe(overlay);
  });

  it('seedObjectives seeds four active objective states', () => {
    const seeded = seedObjectives(baseState());
    expect(seeded.objectives.map((o) => o.id)).toEqual(['longzhong', 'alliance', 'burnFleet', 'claimJing']);
    expect(seeded.objectives.every((o) => o.status === 'active')).toBe(true);
  });

  it('gating: all four objectives gate the historic victory (none optional)', () => {
    const defs = objectivesFor('s3-chibi', LIUBEI_CH3);
    const gating = defs.filter((d) => !d.optional).map((d) => d.id);
    expect(gating).toEqual(['longzhong', 'alliance', 'burnFleet', 'claimJing']);
  });

  it('longzhong flips when the longzhong_plan beat has fired', () => {
    const longzhong = objectivesFor('s3-chibi', LIUBEI_CH3).find((d) => d.id === 'longzhong')!;
    const base = baseState();
    expect(longzhong.check(base)).toBe(false);
    expect(longzhong.check(withEvent(base, 'longzhong_plan'))).toBe(true);
  });

  it('alliance flips when the sun_liu_alliance beat has fired', () => {
    const alliance = objectivesFor('s3-chibi', LIUBEI_CH3).find((d) => d.id === 'alliance')!;
    const base = baseState();
    expect(alliance.check(base)).toBe(false);
    expect(alliance.check(withEvent(base, 'sun_liu_alliance'))).toBe(true);
  });

  it('burnFleet flips when the red_cliffs beat has fired', () => {
    const burnFleet = objectivesFor('s3-chibi', LIUBEI_CH3).find((d) => d.id === 'burnFleet')!;
    const base = baseState();
    expect(burnFleet.check(base)).toBe(false);
    expect(burnFleet.check(withEvent(base, 'red_cliffs'))).toBe(true);
  });

  it('claimJing (GATING) flips on EITHER Borrow-Jing branch', () => {
    const claimJing = objectivesFor('s3-chibi', LIUBEI_CH3).find((d) => d.id === 'claimJing')!;
    const base = baseState();
    expect(claimJing.check(base)).toBe(false);
    expect(claimJing.check(withEvent(base, 'jing_borrowed'))).toBe(true);
    expect(claimJing.check(withEvent(base, 'jing_honored'))).toBe(true);
  });

  it('storyEventsFor exposes the three beats then jing_borrow, in order', () => {
    const events = storyEventsFor('s3-chibi', LIUBEI_CH3);
    const ids = events.map((e) => e.id);
    expect(ids).toEqual(['longzhong_plan', 'sun_liu_alliance', 'red_cliffs', 'jing_borrow']);
    const byId = Object.fromEntries(events.map((e) => [e.id, e]));
    expect(byId['longzhong_plan'].choices.length).toBe(0);
    expect(byId['sun_liu_alliance'].choices.length).toBe(0);
    expect(byId['red_cliffs'].choices.length).toBe(0);
    expect(byId['jing_borrow'].choices.map((c) => c.id)).toEqual(['take', 'honor']);
    expect(byId['jing_borrow'].portrait).toBe('lusu');
    expect(byId['longzhong_plan'].portrait).toBe('zhugeliang');
    expect(byId['sun_liu_alliance'].portrait).toBe('sunquan');
    expect(byId['red_cliffs'].portrait).toBe('zhugeliang');
  });

  it('returns no story events for Free Play / a non-protagonist faction', () => {
    expect(storyEventsFor('s3-chibi', undefined)).toEqual([]);
    expect(storyEventsFor('s3-chibi', { protagonistFactionId: 'caocao', chapter: 3 })).toEqual([]);
  });

  it('longzhong_plan beat fires from turn 1, has no apply', () => {
    const beat = storyEventsFor('s3-chibi', LIUBEI_CH3).find((e) => e.id === 'longzhong_plan')!;
    const base = baseState(); // turn 0
    expect(beat.check(base)).toBe(false);
    expect(beat.check({ ...base, turn: 1 })).toBe(true);
    expect(beat.apply).toBeUndefined();
  });

  it('sun_liu_alliance beat checks on longzhong_plan and injects Jiangxia resources', () => {
    const beat = storyEventsFor('s3-chibi', LIUBEI_CH3).find((e) => e.id === 'sun_liu_alliance')!;
    const base = baseState();
    expect(beat.check(base)).toBe(false);
    expect(beat.check(withEvent(base, 'longzhong_plan'))).toBe(true);
    const before = base.cities['jiangxia'];
    const next = beat.apply!(base);
    const after = next.cities['jiangxia'];
    expect(after.garrison).toBe(before.garrison + 8000);
    expect(after.food).toBe(before.food + 12000);
    expect(after.money).toBe(before.money + 6000);
    // apply does not re-record the beat id (framework records it at fire time)
    expect(next.events.some((e) => e.id === 'sun_liu_alliance')).toBe(false);
    // purity: base untouched
    expect(base.cities['jiangxia'].garrison).toBe(before.garrison);
  });

  it('red_cliffs beat checks on alliance and not-yet-fired; weakens Cao Jing garrisons + boosts Jiangxia', () => {
    const beat = storyEventsFor('s3-chibi', LIUBEI_CH3).find((e) => e.id === 'red_cliffs')!;
    const base = baseState();
    expect(beat.check(base)).toBe(false);
    const ready = withEvent(base, 'sun_liu_alliance');
    expect(beat.check(ready)).toBe(true);
    // once fired, does not re-fire
    expect(beat.check(withEvent(ready, 'red_cliffs'))).toBe(false);
    // apply: jiangling + xiangyang are Cao Cao's -> gutted
    const beforeJiangling = base.cities['jiangling'];
    const beforeXiangyang = base.cities['xiangyang'];
    const beforeJiangxia = base.cities['jiangxia'];
    expect(beforeJiangling.factionId).toBe('caocao');
    expect(beforeXiangyang.factionId).toBe('caocao');
    const next = beat.apply!(base);
    expect(next.cities['jiangling'].garrison).toBe(Math.floor(beforeJiangling.garrison * 0.2));
    expect(next.cities['jiangling'].defense).toBe(Math.max(0, beforeJiangling.defense - 30));
    expect(next.cities['xiangyang'].garrison).toBe(Math.floor(beforeXiangyang.garrison * 0.2));
    expect(next.cities['xiangyang'].defense).toBe(Math.max(0, beforeXiangyang.defense - 30));
    // ownership unchanged by the beat (still Cao's, just weakened)
    expect(next.cities['jiangling'].factionId).toBe('caocao');
    // jiangxia boosted
    expect(next.cities['jiangxia'].money).toBe(beforeJiangxia.money + 5000);
    expect(next.cities['jiangxia'].food).toBe(beforeJiangxia.food + 8000);
    // purity
    expect(base.cities['jiangling'].garrison).toBe(beforeJiangling.garrison);
  });

  it('red_cliffs beat leaves non-Cao Jing cities untouched (guarded)', () => {
    const beat = storyEventsFor('s3-chibi', LIUBEI_CH3).find((e) => e.id === 'red_cliffs')!;
    const base = baseState();
    // Model jiangling already flipped to a third party before the fire.
    const staged: GameState = {
      ...base,
      cities: { ...base.cities, jiangling: { ...base.cities['jiangling'], factionId: 'sunquan' } },
    };
    const before = staged.cities['jiangling'];
    const next = beat.apply!(staged);
    expect(next.cities['jiangling'].garrison).toBe(before.garrison);
    expect(next.cities['jiangling'].defense).toBe(before.defense);
    expect(next.cities['jiangling'].factionId).toBe('sunquan');
  });

  it('applyStoryChoice runs the sun_liu_alliance beat apply and lifts the pause', () => {
    const base = baseState();
    const staged: GameState = {
      ...base,
      pendingStoryEvent: { eventId: 'sun_liu_alliance', scenarioId: 's3-chibi' },
    };
    const before = base.cities['jiangxia'];
    const next = applyStoryChoice(staged, 'sun_liu_alliance', '');
    expect(next.pendingStoryEvent).toBeUndefined();
    expect(next.cities['jiangxia'].garrison).toBe(before.garrison + 8000);
    expect(next.cities['jiangxia'].food).toBe(before.food + 12000);
    expect(next.cities['jiangxia'].money).toBe(before.money + 6000);
  });

  it('jing_borrow checks true once red_cliffs fired and not yet decided', () => {
    const beat = storyEventsFor('s3-chibi', LIUBEI_CH3).find((e) => e.id === 'jing_borrow')!;
    const base = baseState();
    expect(beat.check(base)).toBe(false);
    const ready = withEvent(base, 'red_cliffs');
    expect(beat.check(ready)).toBe(true);
    expect(beat.check(withEvent(ready, 'jing_borrowed'))).toBe(false);
    expect(beat.check(withEvent(ready, 'jing_honored'))).toBe(false);
  });

  it('take: seizes the five Jing commanderies (Cao/neutral), reinforces, boosts Jiangxia, records jing_borrowed', () => {
    const jingBorrow = storyEventsFor('s3-chibi', LIUBEI_CH3).find((e) => e.id === 'jing_borrow')!;
    const take = jingBorrow.choices.find((c) => c.id === 'take')!;
    const base = baseState();
    const targets = ['jiangling', 'changsha', 'lingling', 'guiyang', 'wuling'];
    // jiangling is Cao's; the other four are neutral (null).
    expect(base.cities['jiangling'].factionId).toBe('caocao');
    for (const id of ['changsha', 'lingling', 'guiyang', 'wuling']) {
      expect(base.cities[id].factionId).toBeNull();
    }
    const beforeJiangxia = base.cities['jiangxia'];
    const beforeGarrisons = Object.fromEntries(targets.map((id) => [id, base.cities[id].garrison]));
    const next = take.apply(base);
    for (const id of targets) {
      expect(next.cities[id].factionId).toBe('liubei');
      expect(next.cities[id].garrison).toBe(beforeGarrisons[id] + 2000);
    }
    expect(next.cities['jiangxia'].money).toBe(beforeJiangxia.money + 6000);
    expect(next.cities['jiangxia'].food).toBe(beforeJiangxia.food + 10000);
    expect(next.events.some((e) => e.id === 'jing_borrowed')).toBe(true);
    // purity
    expect(base.cities['jiangling'].factionId).toBe('caocao');
  });

  it('take: reassigns generals stationed in a seized Cao city (none stranded)', () => {
    const jingBorrow = storyEventsFor('s3-chibi', LIUBEI_CH3).find((e) => e.id === 'jing_borrow')!;
    const take = jingBorrow.choices.find((c) => c.id === 'take')!;
    const base = baseState();
    // Station a Cao general at jiangling.
    const staged: GameState = {
      ...base,
      cities: { ...base.cities, jiangling: { ...base.cities['jiangling'], generals: ['caoren'] } },
      generals: { ...base.generals, caoren: { ...base.generals['caoren'], factionId: 'caocao' } },
    };
    const next = take.apply(staged);
    expect(next.cities['jiangling'].factionId).toBe('liubei');
    expect(next.generals['caoren'].factionId).toBe('liubei');
  });

  it('take: does NOT seize a Jing city a third party (Sun Quan) holds', () => {
    const jingBorrow = storyEventsFor('s3-chibi', LIUBEI_CH3).find((e) => e.id === 'jing_borrow')!;
    const take = jingBorrow.choices.find((c) => c.id === 'take')!;
    const base = baseState();
    const staged: GameState = {
      ...base,
      cities: { ...base.cities, changsha: { ...base.cities['changsha'], factionId: 'sunquan' } },
    };
    const next = take.apply(staged);
    expect(next.cities['changsha'].factionId).toBe('sunquan');
    // still records the decision + the other targets flip
    expect(next.events.some((e) => e.id === 'jing_borrowed')).toBe(true);
    expect(next.cities['lingling'].factionId).toBe('liubei');
  });

  it('honor: takes only lingling+guiyang, raises loyalty on all Liu Bei cities, boosts Jiangxia, records jing_honored', () => {
    const jingBorrow = storyEventsFor('s3-chibi', LIUBEI_CH3).find((e) => e.id === 'jing_borrow')!;
    const honor = jingBorrow.choices.find((c) => c.id === 'honor')!;
    const base = baseState();
    const beforeJiangxia = base.cities['jiangxia'];
    const next = honor.apply(base);
    // only lingling + guiyang flip (both neutral)
    expect(next.cities['lingling'].factionId).toBe('liubei');
    expect(next.cities['guiyang'].factionId).toBe('liubei');
    // the other southern commanderies stay neutral
    expect(next.cities['changsha'].factionId).toBeNull();
    expect(next.cities['wuling'].factionId).toBeNull();
    // jiangling stays Cao's (not in honor's list)
    expect(next.cities['jiangling'].factionId).toBe('caocao');
    // every liubei city gets loyalty +8 (jiangxia + the two new ones)
    expect(next.cities['jiangxia'].loyalty).toBe(Math.min(100, beforeJiangxia.loyalty + 8));
    // jiangxia boosted
    expect(next.cities['jiangxia'].money).toBe(beforeJiangxia.money + 3000);
    expect(next.cities['jiangxia'].food).toBe(beforeJiangxia.food + 5000);
    expect(next.events.some((e) => e.id === 'jing_honored')).toBe(true);
    // purity
    expect(base.cities['lingling'].factionId).toBeNull();
  });

  it('honor: does NOT take a Sun-Quan-held Jing city', () => {
    const jingBorrow = storyEventsFor('s3-chibi', LIUBEI_CH3).find((e) => e.id === 'jing_borrow')!;
    const honor = jingBorrow.choices.find((c) => c.id === 'honor')!;
    const base = baseState();
    const staged: GameState = {
      ...base,
      cities: { ...base.cities, lingling: { ...base.cities['lingling'], factionId: 'sunquan' } },
    };
    const next = honor.apply(staged);
    expect(next.cities['lingling'].factionId).toBe('sunquan');
    expect(next.events.some((e) => e.id === 'jing_honored')).toBe(true);
  });

  it('honor: clamps loyalty at 100', () => {
    const jingBorrow = storyEventsFor('s3-chibi', LIUBEI_CH3).find((e) => e.id === 'jing_borrow')!;
    const honor = jingBorrow.choices.find((c) => c.id === 'honor')!;
    const base = baseState();
    const staged: GameState = {
      ...base,
      cities: { ...base.cities, jiangxia: { ...base.cities['jiangxia'], loyalty: 96 } },
    };
    const next = honor.apply(staged);
    expect(next.cities['jiangxia'].loyalty).toBe(100);
  });

  it('story-event overlay is appended after the authored s3 table (overlay precedence preserved)', () => {
    setTestStoryEvents('s3-chibi', [
      { id: 'ov', check: () => true, titleKey: 'story.s3.longzhong.title', bodyKey: 'story.s3.longzhong.body', choices: [] },
    ]);
    const ids = storyEventsFor('s3-chibi', LIUBEI_CH3).map((e) => e.id);
    expect(ids).toEqual(['longzhong_plan', 'sun_liu_alliance', 'red_cliffs', 'jing_borrow', 'ov']);
  });
});
