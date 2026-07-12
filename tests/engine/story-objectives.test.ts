import { afterEach, describe, expect, it } from 'vitest';
import type { GameState } from '../../src/engine/types.js';
import type { ObjectiveDef } from '../../src/engine/story/types.js';
import {
  setTestObjectives,
  clearTestObjectives,
  objectivesFor,
  seedObjectives,
  evaluateObjectives,
} from '../../src/engine/story/objectives.js';

// Minimal GameState fixture carrying only the fields the objective engine reads.
function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    scenarioId: 'test-story',
    year: 189,
    month: 9,
    day: 1,
    turn: 0,
    playerFactionId: 'p',
    factions: {},
    cities: {},
    generals: {},
    items: {},
    ownedItems: {},
    events: [],
    log: [],
    rngState: 1,
    actionLog: [],
    pendingOps: [],
    nextOpId: 1,
    aiStrategies: {},
    objectives: [],
    ...overrides,
  };
}

describe('objective engine', () => {
  // Injected test tables leak across tests unless cleared, exactly like Task 4's
  // afterEach(clearTestStoryEvents).
  afterEach(clearTestObjectives);

  it('objectivesFor returns [] for a scenario with no objective table', () => {
    expect(objectivesFor('no-such-scenario')).toEqual([]);
  });

  it('seedObjectives sets every objective active from the scenario table', () => {
    const defs: ObjectiveDef[] = [
      { id: 'take-luoyang', titleKey: 'app.title', descKey: 'app.subtitle', check: () => false },
      {
        id: 'hold-changan',
        titleKey: 'app.title',
        descKey: 'app.subtitle',
        check: () => false,
        optional: true,
      },
    ];
    setTestObjectives('test-story', defs);
    const seeded = seedObjectives(makeState());
    expect(seeded.objectives).toEqual([
      { id: 'take-luoyang', status: 'active' },
      { id: 'hold-changan', status: 'active' },
    ]);
  });

  it('flips an active objective to complete exactly when its predicate holds, logging once', () => {
    const defs: ObjectiveDef[] = [
      {
        id: 'survive-two-turns',
        titleKey: 'app.title',
        descKey: 'app.subtitle',
        check: (s) => s.turn >= 2,
      },
    ];
    setTestObjectives('test-story', defs);

    // Predicate false: stays active, nothing logged.
    const early = evaluateObjectives(seedObjectives(makeState({ turn: 1 })));
    expect(early.objectives[0]!.status).toBe('active');
    expect(early.log.filter((e) => e.key === 'objective.completed')).toHaveLength(0);

    // Predicate true: completes, records the turn, logs exactly one entry.
    const done = evaluateObjectives(seedObjectives(makeState({ turn: 2 })));
    expect(done.objectives[0]!.status).toBe('complete');
    expect(done.objectives[0]!.completedTurn).toBe(2);
    const logs = done.log.filter((e) => e.key === 'objective.completed');
    expect(logs).toHaveLength(1);
    expect(logs[0]!.vars).toEqual({ title: 'app.title' });

    // Re-evaluating an already-complete objective does not log again.
    const again = evaluateObjectives(done);
    expect(again.log.filter((e) => e.key === 'objective.completed')).toHaveLength(1);
  });

  it('completes an optional objective while its def stays flagged optional', () => {
    const defs: ObjectiveDef[] = [
      {
        id: 'bonus-capture',
        titleKey: 'app.title',
        descKey: 'app.subtitle',
        check: () => true,
        optional: true,
      },
    ];
    setTestObjectives('test-story', defs);
    const done = evaluateObjectives(seedObjectives(makeState()));
    expect(done.objectives[0]!.status).toBe('complete');
    // ObjectiveState carries no `optional`; the flag lives on the def.
    expect(objectivesFor('test-story')[0]!.optional).toBe(true);
  });

  it('leaves an objective active when its predicate fails', () => {
    const defs: ObjectiveDef[] = [
      { id: 'never', titleKey: 'app.title', descKey: 'app.subtitle', check: () => false },
    ];
    setTestObjectives('test-story', defs);
    const out = evaluateObjectives(seedObjectives(makeState()));
    expect(out.objectives[0]!.status).toBe('active');
    expect(out.log.filter((e) => e.key === 'objective.completed')).toHaveLength(0);
  });

  it('returns the same state reference when no objective changes (pure no-op)', () => {
    const defs: ObjectiveDef[] = [
      { id: 'never', titleKey: 'app.title', descKey: 'app.subtitle', check: () => false },
    ];
    setTestObjectives('test-story', defs);
    const seeded = seedObjectives(makeState());
    expect(evaluateObjectives(seeded)).toBe(seeded);
  });
});
