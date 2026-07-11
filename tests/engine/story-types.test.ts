import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import type { GameState, StrategicCommand } from '../../src/engine/types.js';
import type {
  ObjectiveDef,
  ObjectiveState,
  ObjectiveStatus,
  PendingStoryEvent,
  StoryChoice,
  StoryEvent,
  StoryMode,
} from '../../src/engine/story/types.js';

describe('story core types + GameState story fields', () => {
  it('initializes objectives to an empty array and leaves story fields unset', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 1,
    });
    expect(state.objectives).toEqual([]);
    expect(state.pendingStoryEvent).toBeUndefined();
    expect(state.storyMode).toBeUndefined();
  });

  it('accepts a storyChoice StrategicCommand shape', () => {
    const cmd: StrategicCommand = { kind: 'storyChoice', eventId: 'e1', choiceId: 'c1' };
    expect(cmd.kind).toBe('storyChoice');
    // Narrow to the union arm to confirm its member fields exist.
    if (cmd.kind === 'storyChoice') {
      expect(cmd.eventId).toBe('e1');
      expect(cmd.choiceId).toBe('c1');
    }
  });

  it('exposes the story contract types with the fixed shapes', () => {
    const status: ObjectiveStatus = 'active';
    const objState: ObjectiveState = { id: 'obj-1', status, completedTurn: 3 };
    expect(objState.status).toBe('active');
    expect(objState.completedTurn).toBe(3);

    const mode: StoryMode = { protagonistFactionId: 'liubei', chapter: 1 };
    expect(mode.chapter).toBe(1);
    expect(mode.protagonistFactionId).toBe('liubei');

    // ObjectiveDef: pure completion predicate + i18n keys.
    const def: ObjectiveDef = {
      id: 'obj-test',
      titleKey: 'app.title',
      descKey: 'app.subtitle',
      check: (s: GameState) => s.turn >= 0,
      optional: false,
      hidden: false,
    };
    const built = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 1,
    });
    expect(def.check(built)).toBe(true);

    // StoryChoice: pure branch state-change.
    const choice: StoryChoice = {
      id: 'choice-a',
      labelKey: 'app.confirm',
      descKey: 'app.subtitle',
      apply: (s: GameState) => s,
    };
    expect(choice.apply(built)).toBe(built);

    // StoryEvent with an empty choices array is a narrative beat.
    const ev: StoryEvent = {
      id: 'ev-test',
      check: (s: GameState) => s.turn > 0,
      titleKey: 'app.title',
      bodyKey: 'app.subtitle',
      choices: [choice],
      portrait: 'liubei',
    };
    expect(ev.choices).toHaveLength(1);
    expect(ev.check(built)).toBe(false);

    const pending: PendingStoryEvent = { eventId: 'ev-test', scenarioId: 's1-dongzhuo' };
    expect(pending.scenarioId).toBe('s1-dongzhuo');
  });
});
