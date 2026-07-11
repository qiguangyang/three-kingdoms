import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/engine/types.js';
import type { StoryMode } from '../../../src/engine/story/types.js';
import { objectivesFor, seedObjectives } from '../../../src/engine/story/objectives.js';
import { storyEventsFor } from '../../../src/engine/story/events.js';
import { buildInitialState } from '../../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../../src/data/index.js';

const LIUBEI_MODE: StoryMode = { protagonistFactionId: 'liubei', chapter: 1 };

function baseState(): GameState {
  // Tao Qian starts holding xiapi, pengcheng, xiaopei (Xuzhou); Liu Bei holds
  // only pingyuan; Zhao Yun starts under Gongsun Zan.
  return buildInitialState({
    scenario: SCENARIO_DONGZHUO,
    playerFactionId: 'liubei',
    refData: REF_DATA,
    seed: 1,
  });
}

describe('Scenario 1 — Liu Bei Chapter 1 content', () => {
  it('objectivesFor returns the four Chapter 1 objectives, in order, all required', () => {
    const defs = objectivesFor('s1-dongzhuo', LIUBEI_MODE);
    expect(defs.map((d) => d.id)).toEqual(['coalition', 'zhaoyun', 'xuzhouAid', 'foundation']);
    for (const d of defs) {
      expect(d.optional).toBeFalsy();
      expect(typeof d.titleKey).toBe('string');
      expect(typeof d.descKey).toBe('string');
    }
  });

  it('returns no story objectives for Free Play or a non-protagonist faction', () => {
    expect(objectivesFor('s1-dongzhuo', undefined)).toEqual([]);
    expect(objectivesFor('s1-dongzhuo', { protagonistFactionId: 'caocao', chapter: 1 })).toEqual([]);
  });

  it('seedObjectives seeds four active objective states', () => {
    const state: GameState = { ...baseState(), storyMode: LIUBEI_MODE };
    const seeded = seedObjectives(state);
    expect(seeded.objectives.map((o) => o.id)).toEqual(['coalition', 'zhaoyun', 'xuzhouAid', 'foundation']);
    expect(seeded.objectives.every((o) => o.status === 'active')).toBe(true);
  });

  it('each objective check flips true only when its condition is met', () => {
    const defs = objectivesFor('s1-dongzhuo', LIUBEI_MODE);
    const byId = Object.fromEntries(defs.map((d) => [d.id, d]));
    const base = baseState();

    // coalition: needs the guandong_coalition event to have fired
    expect(byId['coalition'].check(base)).toBe(false);
    const afterCoalition: GameState = {
      ...base,
      events: [...base.events, { id: 'guandong_coalition', turn: 1, year: 189, month: 10 }],
    };
    expect(byId['coalition'].check(afterCoalition)).toBe(true);

    // zhaoyun: Zhao Yun joins Liu Bei
    expect(byId['zhaoyun'].check(base)).toBe(false);
    const afterZhaoyun: GameState = {
      ...base,
      generals: { ...base.generals, zhaoyun: { ...base.generals['zhaoyun'], factionId: 'liubei' } },
    };
    expect(byId['zhaoyun'].check(afterZhaoyun)).toBe(true);

    // xuzhouAid: Liu Bei holds any Xuzhou city
    expect(byId['xuzhouAid'].check(base)).toBe(false);
    const afterAid: GameState = {
      ...base,
      cities: { ...base.cities, xiapi: { ...base.cities['xiapi'], factionId: 'liubei' } },
    };
    expect(byId['xuzhouAid'].check(afterAid)).toBe(true);

    // foundation: the bequest has been resolved
    expect(byId['foundation'].check(base)).toBe(false);
    const afterDecision: GameState = {
      ...base,
      events: [...base.events, { id: 'xuzhou_accepted', turn: 5, year: 190, month: 4 }],
    };
    expect(byId['foundation'].check(afterDecision)).toBe(true);
  });

  it('the Xuzhou bequest event checks true only once Liu Bei holds a Xuzhou city', () => {
    const bequest = storyEventsFor('s1-dongzhuo', LIUBEI_MODE).find((e) => e.id === 'xuzhou_bequest');
    expect(bequest).toBeDefined();
    expect(bequest!.choices.map((c) => c.id)).toEqual(['accept', 'decline']);

    const base = baseState();
    expect(bequest!.check(base)).toBe(false);
    const aided: GameState = {
      ...base,
      cities: { ...base.cities, xiaopei: { ...base.cities['xiaopei'], factionId: 'liubei' } },
    };
    expect(bequest!.check(aided)).toBe(true);
  });

  it('Accept transfers every Xuzhou city to Liu Bei and records the decision', () => {
    const bequest = storyEventsFor('s1-dongzhuo', LIUBEI_MODE).find((e) => e.id === 'xuzhou_bequest')!;
    const accept = bequest.choices.find((c) => c.id === 'accept')!;
    const next = accept.apply(baseState());
    expect(next.cities['xiapi'].factionId).toBe('liubei');
    expect(next.cities['pengcheng'].factionId).toBe('liubei');
    expect(next.cities['xiaopei'].factionId).toBe('liubei');
    expect(next.events.some((e) => e.id === 'xuzhou_accepted')).toBe(true);
  });

  it('Decline gives Liu Bei only Xiaopei and leaves the rest of Xuzhou to Tao Qian', () => {
    const bequest = storyEventsFor('s1-dongzhuo', LIUBEI_MODE).find((e) => e.id === 'xuzhou_bequest')!;
    const decline = bequest.choices.find((c) => c.id === 'decline')!;
    const next = decline.apply(baseState());
    expect(next.cities['xiaopei'].factionId).toBe('liubei');
    expect(next.cities['xiapi'].factionId).toBe('taoqian');
    expect(next.cities['pengcheng'].factionId).toBe('taoqian');
    expect(next.events.some((e) => e.id === 'xuzhou_declined')).toBe(true);
  });
});
