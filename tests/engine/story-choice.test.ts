import { afterEach, describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import {
  applyStoryChoice,
  storyEventsFor,
  setTestStoryEvents,
  clearTestStoryEvents,
} from '../../src/engine/story/events.js';
import { applyCommand } from '../../src/engine/turn.js';
import { schedulePlayerCommand } from '../../src/engine/pendingOp.js';
import type { GameState } from '../../src/engine/types.js';
import type { StoryEvent, StoryMode } from '../../src/engine/story/types.js';

const STORY_MODE: StoryMode = { protagonistFactionId: 'liubei', chapter: 1 };

// A test choice-event registered in the story overlay so this task can be
// exercised deterministically before the real s1 narrative content lands
// (Task 10). Its single choice makes an observable, PURE state change: it
// appends a completed objective (no wall-clock, no RNG). titleKey/bodyKey/
// labelKey/descKey are valid MessageKeys; their values are not asserted here.
const CHOICE_EVENT: StoryEvent = {
  id: 'test-choice-event',
  check: () => true,
  titleKey: 'app.title',
  bodyKey: 'app.subtitle',
  choices: [
    {
      id: 'accept',
      labelKey: 'app.confirm',
      descKey: 'app.continue',
      apply: (state) => ({
        ...state,
        objectives: [
          ...state.objectives,
          { id: 'story-choice-taken', status: 'complete' as const },
        ],
      }),
    },
  ],
};

afterEach(() => {
  clearTestStoryEvents();
});

// Build an s1 Story-Mode state with a real choice-event queued as pending.
function buildPendingChoiceState(): {
  state: GameState;
  eventId: string;
  choiceId: string;
} {
  setTestStoryEvents('s1-dongzhuo', [CHOICE_EVENT]);
  const base = buildInitialState({
    scenario: SCENARIO_DONGZHUO,
    playerFactionId: 'liubei',
    refData: REF_DATA,
    seed: 1,
  });
  const events = storyEventsFor('s1-dongzhuo', STORY_MODE);
  const choiceEvent = events.find((e) => e.choices.length > 0);
  if (!choiceEvent) {
    throw new Error('Phase 1 must ship at least one s1 story choice-event');
  }
  const state: GameState = {
    ...base,
    storyMode: STORY_MODE,
    pendingStoryEvent: { eventId: choiceEvent.id, scenarioId: 's1-dongzhuo' },
  };
  return { state, eventId: choiceEvent.id, choiceId: choiceEvent.choices[0].id };
}

describe('applyStoryChoice', () => {
  it('runs the selected branch apply and clears pendingStoryEvent', () => {
    const { state, eventId, choiceId } = buildPendingChoiceState();
    const choice = storyEventsFor('s1-dongzhuo', STORY_MODE)
      .find((e) => e.id === eventId)!
      .choices.find((c) => c.id === choiceId)!;
    // What the branch alone does to the state (pure; safe to call twice).
    const branchApplied = choice.apply(state);

    const result = applyStoryChoice(state, eventId, choiceId);

    // The pause is lifted.
    expect(result.pendingStoryEvent).toBeUndefined();
    // The result equals choice.apply exactly, minus the cleared pending flag.
    // (toEqual ignores keys whose value is undefined.)
    expect({ ...result, pendingStoryEvent: undefined }).toEqual({
      ...branchApplied,
      pendingStoryEvent: undefined,
    });
  });

  it('is a no-op for an unknown eventId (state returned unchanged)', () => {
    const { state, choiceId } = buildPendingChoiceState();
    const result = applyStoryChoice(state, 'no-such-event', choiceId);
    expect(result).toBe(state);
    expect(result.pendingStoryEvent).toEqual(state.pendingStoryEvent);
  });

  it('is a no-op for an unknown choiceId (state returned unchanged)', () => {
    const { state, eventId } = buildPendingChoiceState();
    const result = applyStoryChoice(state, eventId, 'no-such-choice');
    expect(result).toBe(state);
    expect(result.pendingStoryEvent).toEqual(state.pendingStoryEvent);
  });
});

describe('storyChoice strategic command', () => {
  it('applyCommand routes storyChoice to applyStoryChoice', () => {
    const { state, eventId, choiceId } = buildPendingChoiceState();
    const viaCommand = applyCommand(state, 'liubei', {
      kind: 'storyChoice',
      eventId,
      choiceId,
    });
    const viaDirect = applyStoryChoice(state, eventId, choiceId);
    expect(viaCommand).toEqual(viaDirect);
    expect(viaCommand.pendingStoryEvent).toBeUndefined();
  });

  it('schedulePlayerCommand never schedules a storyChoice (applied immediately)', () => {
    const { state, eventId, choiceId } = buildPendingChoiceState();
    const result = schedulePlayerCommand(state, 'liubei', {
      kind: 'storyChoice',
      eventId,
      choiceId,
    });
    // No pending op is queued; storyChoice is handled on the immediate path.
    expect(result.pendingOps).toEqual(state.pendingOps);
    expect(result.nextOpId).toBe(state.nextOpId);
  });
});
