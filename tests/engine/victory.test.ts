import { describe, expect, it, afterEach } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { SCENARIOS } from '../../src/data/scenarios/index.js';
import { REF_DATA } from '../../src/data/index.js';
import { hasVictory } from '../../src/engine/selectors.js';
import {
  objectivesFor,
  setTestObjectives,
  clearTestObjectives,
} from '../../src/engine/story/objectives.js';
import type { City, GameState, FactionId } from '../../src/engine/types.js';
import type { ObjectiveDef, StoryMode } from '../../src/engine/story/types.js';

// Reassign every city: those in `ownedIds` go to the player faction, the rest
// to a throwaway rival id, so citiesOf(state, player) counts exactly ownedIds.
function assignOwnership(state: GameState, ownedIds: string[]): GameState {
  const player = state.playerFactionId;
  const cities: Record<string, City> = {};
  for (const [id, c] of Object.entries(state.cities)) {
    cities[id] = { ...c, factionId: ownedIds.includes(id) ? player : '__rival__' };
  }
  return { ...state, cities };
}

function baseState(playerFactionId: FactionId): GameState {
  return buildInitialState({
    scenario: SCENARIO_DONGZHUO,
    playerFactionId,
    refData: REF_DATA,
    seed: 1,
  });
}

describe('hasVictory — victory conditions', () => {
  // s1-dongzhuo, s-test-dominate, and s-test-historic get mutated below;
  // restore / clean up after each test (including injected objective tables).
  const originalS1Victory = SCENARIOS['s1-dongzhuo']!.victory;
  afterEach(() => {
    SCENARIOS['s1-dongzhuo']!.victory = originalS1Victory;
    delete SCENARIOS['s-test-dominate'];
    delete SCENARIOS['s-test-historic'];
    clearTestObjectives();
  });

  it('unify: victory only when the player owns every city', () => {
    const state = baseState('dongzhuo'); // s1 victory is { kind: 'unify' }
    const allIds = Object.keys(state.cities);
    // Own all but one -> no victory.
    expect(hasVictory(assignOwnership(state, allIds.slice(1)), 'dongzhuo')).toBe(false);
    // Own all -> victory.
    expect(hasVictory(assignOwnership(state, allIds), 'dongzhuo')).toBe(true);
  });

  it('dominate: needs the city count AND every required city', () => {
    const state = baseState('dongzhuo');
    const ids = Object.keys(state.cities);
    const required = [ids[0]!, ids[1]!];
    SCENARIOS['s-test-dominate'] = {
      ...SCENARIO_DONGZHUO,
      id: 's-test-dominate',
      victory: { kind: 'dominate', cityCount: 3, requiredCityIds: required },
    };
    const domState: GameState = { ...state, scenarioId: 's-test-dominate' };

    // Count met (3) AND both required held -> victory.
    expect(
      hasVictory(assignOwnership(domState, [ids[0]!, ids[1]!, ids[2]!]), 'dongzhuo'),
    ).toBe(true);
    // Count met (3) but a required city missing -> no victory.
    expect(
      hasVictory(assignOwnership(domState, [ids[2]!, ids[3]!, ids[4]!]), 'dongzhuo'),
    ).toBe(false);
    // Both required held but count short (2 < 3) -> no victory.
    expect(hasVictory(assignOwnership(domState, [ids[0]!, ids[1]!]), 'dongzhuo')).toBe(false);
  });

  it('historic: victory when all non-optional objectives are complete', () => {
    // Production objectivesFor('s1-dongzhuo', ...) returns [] until Task 10, so
    // drive this through an injected table on a dedicated historic-victory
    // scenario. Two required objectives + one optional (which must not gate).
    const defs: ObjectiveDef[] = [
      { id: 'obj-a', titleKey: 'app.title', descKey: 'app.subtitle', check: () => false },
      { id: 'obj-b', titleKey: 'app.title', descKey: 'app.subtitle', check: () => false },
      {
        id: 'obj-c',
        titleKey: 'app.title',
        descKey: 'app.subtitle',
        check: () => false,
        optional: true,
      },
    ];
    setTestObjectives('s-test-historic', defs);
    SCENARIOS['s-test-historic'] = {
      ...SCENARIO_DONGZHUO,
      id: 's-test-historic',
      victory: { kind: 'historic' },
    };
    const storyMode: StoryMode = { protagonistFactionId: 'liubei', chapter: 1 };
    const required = objectivesFor('s-test-historic', storyMode).filter((o) => !o.optional);
    // Precondition: the injected table has at least one terminal objective.
    expect(required.length).toBeGreaterThan(0);

    const base: GameState = { ...baseState('liubei'), scenarioId: 's-test-historic', storyMode };

    // All non-optional objectives complete (optional left active) -> victory.
    const won: GameState = {
      ...base,
      objectives: [
        { id: 'obj-a', status: 'complete' as const },
        { id: 'obj-b', status: 'complete' as const },
        { id: 'obj-c', status: 'active' as const },
      ],
    };
    expect(hasVictory(won, 'liubei')).toBe(true);

    // One non-optional still active -> no victory.
    const pending: GameState = {
      ...base,
      objectives: [
        { id: 'obj-a', status: 'active' as const },
        { id: 'obj-b', status: 'complete' as const },
      ],
    };
    expect(hasVictory(pending, 'liubei')).toBe(false);
  });

  it('Story Mode wins by completing objectives even when the scenario declares unify', () => {
    // s1-dongzhuo declares victory {kind:'unify'}. A Story-Mode game (storyMode set)
    // with all non-optional objectives complete must win WITHOUT owning every city.
    const defs: ObjectiveDef[] = [
      { id: 'a', titleKey: 'app.title', descKey: 'app.subtitle', check: () => true },
      { id: 'b', titleKey: 'app.title', descKey: 'app.subtitle', check: () => true },
    ];
    setTestObjectives('s1-dongzhuo', defs);
    const base = baseState('liubei');
    const storyGame: GameState = {
      ...base,
      storyMode: { protagonistFactionId: 'liubei', chapter: 1 },
      objectives: [
        { id: 'a', status: 'complete' as const },
        { id: 'b', status: 'complete' as const },
      ],
    };
    expect(hasVictory(storyGame, 'liubei')).toBe(true); // historic, not unify
    // Same board WITHOUT storyMode = Free Play = unify = not won (Liu Bei owns 1 city).
    const freePlay: GameState = { ...storyGame, storyMode: undefined };
    expect(hasVictory(freePlay, 'liubei')).toBe(false);
  });

  it('Story Mode does NOT win while a non-optional objective is still active', () => {
    const defs: ObjectiveDef[] = [
      { id: 'a', titleKey: 'app.title', descKey: 'app.subtitle', check: () => true },
      { id: 'b', titleKey: 'app.title', descKey: 'app.subtitle', check: () => true },
    ];
    setTestObjectives('s1-dongzhuo', defs);
    const base = baseState('liubei');
    const g: GameState = {
      ...base,
      storyMode: { protagonistFactionId: 'liubei', chapter: 1 },
      objectives: [
        { id: 'a', status: 'complete' as const },
        { id: 'b', status: 'active' as const },
      ],
    };
    expect(hasVictory(g, 'liubei')).toBe(false);
  });
});
