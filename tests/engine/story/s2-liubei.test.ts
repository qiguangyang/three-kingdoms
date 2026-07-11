import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/engine/types.js';
import type { StoryMode } from '../../../src/engine/story/types.js';
import { objectivesFor, seedObjectives } from '../../../src/engine/story/objectives.js';
import { applyStoryChoice, storyEventsFor } from '../../../src/engine/story/events.js';
import { buildInitialState } from '../../../src/engine/scenario.js';
import { SCENARIO_JUNXIONG } from '../../../src/data/scenarios/s2-junxiong.js';
import { REF_DATA } from '../../../src/data/index.js';

const LIUBEI_CH2: StoryMode = { protagonistFactionId: 'liubei', chapter: 2 };

function baseState(): GameState {
  // s2-junxiong (196 CE): Liu Bei holds only xiaopei; Lü Bu (alive) holds
  // xiapi + pengcheng; Cao Cao holds xuchang. turn starts at 0.
  return {
    ...buildInitialState({
      scenario: SCENARIO_JUNXIONG,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 1,
    }),
    storyMode: LIUBEI_CH2,
  };
}

// Helper: append a fired-event record (as runScenarioEvents would).
function withEvent(state: GameState, id: string): GameState {
  return { ...state, events: [...state.events, { id, turn: state.turn, year: state.year, month: state.month }] };
}

describe('Scenario 2 — Liu Bei Chapter 2 content', () => {
  it('objectivesFor returns the four Chapter 2 objectives, in order, with breakFree optional', () => {
    const defs = objectivesFor('s2-junxiong', LIUBEI_CH2);
    expect(defs.map((d) => d.id)).toEqual(['outlastLvbu', 'shelter', 'plumWine', 'breakFree']);
    const byId = Object.fromEntries(defs.map((d) => [d.id, d]));
    expect(byId['outlastLvbu'].optional).toBeFalsy();
    expect(byId['shelter'].optional).toBeFalsy();
    expect(byId['plumWine'].optional).toBeFalsy();
    expect(byId['breakFree'].optional).toBe(true);
    for (const d of defs) {
      expect(typeof d.titleKey).toBe('string');
      expect(typeof d.descKey).toBe('string');
    }
  });

  it('returns no story objectives for Free Play or a non-protagonist faction', () => {
    expect(objectivesFor('s2-junxiong', undefined)).toEqual([]);
    expect(objectivesFor('s2-junxiong', { protagonistFactionId: 'caocao', chapter: 2 })).toEqual([]);
  });

  it('seedObjectives seeds four active objective states', () => {
    const seeded = seedObjectives(baseState());
    expect(seeded.objectives.map((o) => o.id)).toEqual(['outlastLvbu', 'shelter', 'plumWine', 'breakFree']);
    expect(seeded.objectives.every((o) => o.status === 'active')).toBe(true);
  });

  it('gating: exactly the three non-optional objectives gate the historic victory', () => {
    const defs = objectivesFor('s2-junxiong', LIUBEI_CH2);
    const gating = defs.filter((d) => !d.optional).map((d) => d.id);
    expect(gating).toEqual(['outlastLvbu', 'shelter', 'plumWine']);
  });

  it('outlastLvbu flips when Lü Bu is eliminated OR Liu Bei takes xiapi/pengcheng', () => {
    const defs = objectivesFor('s2-junxiong', LIUBEI_CH2);
    const outlast = defs.find((d) => d.id === 'outlastLvbu')!;
    const base = baseState();
    expect(outlast.check(base)).toBe(false);
    // Lü Bu put down
    expect(outlast.check({ ...base, factions: { ...base.factions, lvbu: { ...base.factions['lvbu'], alive: false } } })).toBe(true);
    // Liu Bei seizes xiapi
    expect(outlast.check({ ...base, cities: { ...base.cities, xiapi: { ...base.cities['xiapi'], factionId: 'liubei' } } })).toBe(true);
    // Liu Bei seizes pengcheng
    expect(outlast.check({ ...base, cities: { ...base.cities, pengcheng: { ...base.cities['pengcheng'], factionId: 'liubei' } } })).toBe(true);
  });

  it('shelter flips when the shelter_xudu beat has fired', () => {
    const defs = objectivesFor('s2-junxiong', LIUBEI_CH2);
    const shelter = defs.find((d) => d.id === 'shelter')!;
    const base = baseState();
    expect(shelter.check(base)).toBe(false);
    expect(shelter.check(withEvent(base, 'shelter_xudu'))).toBe(true);
  });

  it('plumWine (gating) flips on EITHER Plum-Wine branch; breakFree (optional) only on break', () => {
    const defs = objectivesFor('s2-junxiong', LIUBEI_CH2);
    const plumWine = defs.find((d) => d.id === 'plumWine')!;
    const breakFree = defs.find((d) => d.id === 'breakFree')!;
    const base = baseState();
    expect(plumWine.check(base)).toBe(false);
    expect(breakFree.check(base)).toBe(false);
    // break branch → both flip
    expect(plumWine.check(withEvent(base, 'plum_wine_broke'))).toBe(true);
    expect(breakFree.check(withEvent(base, 'plum_wine_broke'))).toBe(true);
    // bide branch → plumWine flips, breakFree does NOT
    expect(plumWine.check(withEvent(base, 'plum_wine_bided'))).toBe(true);
    expect(breakFree.check(withEvent(base, 'plum_wine_bided'))).toBe(false);
  });

  it('storyEventsFor exposes shelter_xudu (beat) then plum_wine (choice) in order', () => {
    const events = storyEventsFor('s2-junxiong', LIUBEI_CH2);
    const ids = events.map((e) => e.id);
    expect(ids.indexOf('shelter_xudu')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf('shelter_xudu')).toBeLessThan(ids.indexOf('plum_wine'));
    const shelter = events.find((e) => e.id === 'shelter_xudu')!;
    const plumWine = events.find((e) => e.id === 'plum_wine')!;
    expect(shelter.choices.length).toBe(0); // beat
    expect(plumWine.choices.map((c) => c.id)).toEqual(['break', 'bide']);
    expect(plumWine.portrait).toBe('caocao');
  });

  it('returns no story events for Free Play / a non-protagonist faction', () => {
    expect(storyEventsFor('s2-junxiong', undefined)).toEqual([]);
    expect(storyEventsFor('s2-junxiong', { protagonistFactionId: 'caocao', chapter: 2 })).toEqual([]);
  });

  it('shelter_xudu beat fires from turn 2 and injects Xiaopei resources', () => {
    const shelter = storyEventsFor('s2-junxiong', LIUBEI_CH2).find((e) => e.id === 'shelter_xudu')!;
    const base = baseState(); // turn 0
    expect(shelter.check(base)).toBe(false);
    expect(shelter.check({ ...base, turn: 1 })).toBe(false);
    expect(shelter.check({ ...base, turn: 2 })).toBe(true);
    // apply injects Xiaopei reinforcements
    const before = base.cities['xiaopei'];
    const next = shelter.apply!(base);
    const after = next.cities['xiaopei'];
    expect(after.garrison).toBe(before.garrison + 3000);
    expect(after.food).toBe(before.food + 6000);
    expect(after.money).toBe(before.money + 3000);
    // no decision flag added by apply (the framework records shelter_xudu at fire time)
    expect(next.events.some((e) => e.id === 'shelter_xudu')).toBe(false);
    // purity: base untouched
    expect(base.cities['xiaopei'].garrison).toBe(before.garrison);
  });

  it('applyStoryChoice runs the shelter_xudu beat apply and lifts the pause', () => {
    const base = baseState();
    const staged: GameState = {
      ...base,
      pendingStoryEvent: { eventId: 'shelter_xudu', scenarioId: 's2-junxiong' },
    };
    const before = base.cities['xiaopei'];
    const next = applyStoryChoice(staged, 'shelter_xudu', '');
    expect(next.pendingStoryEvent).toBeUndefined();
    expect(next.cities['xiaopei'].garrison).toBe(before.garrison + 3000);
    expect(next.cities['xiaopei'].food).toBe(before.food + 6000);
    expect(next.cities['xiaopei'].money).toBe(before.money + 3000);
  });

  it('plum_wine checks true only once Lü Bu is dead, sheltered, and not yet decided', () => {
    const plumWine = storyEventsFor('s2-junxiong', LIUBEI_CH2).find((e) => e.id === 'plum_wine')!;
    const base = baseState();
    expect(plumWine.check(base)).toBe(false);
    const lvbuDead: GameState = {
      ...base,
      factions: { ...base.factions, lvbu: { ...base.factions['lvbu'], alive: false } },
    };
    // dead but not yet sheltered → still false
    expect(plumWine.check(lvbuDead)).toBe(false);
    const ready = withEvent(lvbuDead, 'shelter_xudu');
    expect(plumWine.check(ready)).toBe(true);
    // once decided (either branch) → false
    expect(plumWine.check(withEvent(ready, 'plum_wine_broke'))).toBe(false);
    expect(plumWine.check(withEvent(ready, 'plum_wine_bided'))).toBe(false);
  });

  it('break: reclaims troops, records plum_wine_broke, and seizes xiapi when Cao Cao/Lü Bu/none hold it', () => {
    const plumWine = storyEventsFor('s2-junxiong', LIUBEI_CH2).find((e) => e.id === 'plum_wine')!;
    const breakChoice = plumWine.choices.find((c) => c.id === 'break')!;
    // Model post-Lü-Bu-death: Cao Cao holds xiapi with a stationed general.
    const base = baseState();
    const stagedCity = { ...base.cities['xiapi'], factionId: 'caocao' as const };
    const stationed = stagedCity.generals;
    const staged: GameState = {
      ...base,
      cities: { ...base.cities, xiapi: stagedCity },
      generals: Object.fromEntries(
        Object.entries(base.generals).map(([id, g]) =>
          stationed.includes(id) ? [id, { ...g, factionId: 'caocao' as const }] : [id, g],
        ),
      ),
    };
    const beforeXiaopei = staged.cities['xiaopei'];
    const next = breakChoice.apply(staged);
    // Xiaopei reinforced
    expect(next.cities['xiaopei'].garrison).toBe(beforeXiaopei.garrison + 6000);
    expect(next.cities['xiaopei'].money).toBe(beforeXiaopei.money + 5000);
    expect(next.cities['xiaopei'].food).toBe(beforeXiaopei.food + 8000);
    // Xiapi seized + generals defect (none stranded)
    expect(next.cities['xiapi'].factionId).toBe('liubei');
    for (const gid of stationed) expect(next.generals[gid].factionId).toBe('liubei');
    // decision flag recorded
    expect(next.events.some((e) => e.id === 'plum_wine_broke')).toBe(true);
    // purity
    expect(staged.cities['xiapi'].factionId).toBe('caocao');
  });

  it('break: does NOT seize xiapi when a third party holds it', () => {
    const plumWine = storyEventsFor('s2-junxiong', LIUBEI_CH2).find((e) => e.id === 'plum_wine')!;
    const breakChoice = plumWine.choices.find((c) => c.id === 'break')!;
    const base = baseState();
    const staged: GameState = {
      ...base,
      cities: { ...base.cities, xiapi: { ...base.cities['xiapi'], factionId: 'sunce', generals: [] } },
    };
    const next = breakChoice.apply(staged);
    expect(next.cities['xiapi'].factionId).toBe('sunce');
    // still records the decision + reinforces Xiaopei
    expect(next.events.some((e) => e.id === 'plum_wine_broke')).toBe(true);
  });

  it('break: seizes xiapi when it is unowned (null)', () => {
    const plumWine = storyEventsFor('s2-junxiong', LIUBEI_CH2).find((e) => e.id === 'plum_wine')!;
    const breakChoice = plumWine.choices.find((c) => c.id === 'break')!;
    const base = baseState();
    const staged: GameState = {
      ...base,
      cities: { ...base.cities, xiapi: { ...base.cities['xiapi'], factionId: null, generals: [] } },
    };
    const next = breakChoice.apply(staged);
    expect(next.cities['xiapi'].factionId).toBe('liubei');
  });

  it('bide: grows Xiaopei in safety and records plum_wine_bided (no city seizure)', () => {
    const plumWine = storyEventsFor('s2-junxiong', LIUBEI_CH2).find((e) => e.id === 'plum_wine')!;
    const bide = plumWine.choices.find((c) => c.id === 'bide')!;
    const base = baseState();
    const before = base.cities['xiaopei'];
    const next = bide.apply(base);
    const after = next.cities['xiaopei'];
    expect(after.money).toBe(before.money + 12000);
    expect(after.food).toBe(before.food + 20000);
    expect(after.garrison).toBe(before.garrison + 8000);
    expect(after.agriculture).toBe(Math.min(100, before.agriculture + 12));
    expect(after.commerce).toBe(Math.min(100, before.commerce + 12));
    expect(next.events.some((e) => e.id === 'plum_wine_bided')).toBe(true);
    // bide does not touch xiapi ownership
    expect(next.cities['xiapi'].factionId).toBe(base.cities['xiapi'].factionId);
  });

  it('bide: clamps agriculture/commerce at 100', () => {
    const plumWine = storyEventsFor('s2-junxiong', LIUBEI_CH2).find((e) => e.id === 'plum_wine')!;
    const bide = plumWine.choices.find((c) => c.id === 'bide')!;
    const base = baseState();
    const staged: GameState = {
      ...base,
      cities: { ...base.cities, xiaopei: { ...base.cities['xiaopei'], agriculture: 95, commerce: 92 } },
    };
    const next = bide.apply(staged);
    expect(next.cities['xiaopei'].agriculture).toBe(100);
    expect(next.cities['xiaopei'].commerce).toBe(100);
  });
});
