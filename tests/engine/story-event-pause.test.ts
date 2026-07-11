import { afterEach, describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { tickDays } from '../../src/engine/pendingOp.js';
import { runScenarioEvents } from '../../src/engine/events.js';
import { makeDefaultAgent } from '../../src/engine/ai/index.js';
import { setTestStoryEvents, clearTestStoryEvents } from '../../src/engine/story/events.js';
import { evaluateObjectives } from '../../src/engine/story/objectives.js';
import type { FactionAgent, GameState } from '../../src/engine/types.js';
import type { StoryEvent } from '../../src/engine/story/types.js';

// One default agent per faction, matching the pattern in battle-pendingop.test.ts.
function agentsFor(s: GameState): Record<string, FactionAgent> {
  const a: Record<string, FactionAgent> = {};
  for (const f of Object.values(s.factions)) a[f.id] = makeDefaultAgent(f.id, f.personality);
  return a;
}

// A narrative beat whose check always passes: it becomes eligible at the very
// first month rollover. titleKey/bodyKey are valid MessageKeys (values are not
// asserted here — this test only exercises the pause plumbing).
const alwaysBeat: StoryEvent = {
  id: 'test-beat',
  check: () => true,
  titleKey: 'app.title',
  bodyKey: 'app.title',
  choices: [],
};

afterEach(() => {
  clearTestStoryEvents();
});

describe('story-event pause mechanism', () => {
  it('sets pendingStoryEvent at the month tick and freezes time-advance', () => {
    setTestStoryEvents('s1-dongzhuo', [alwaysBeat]);
    const s = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 7,
    });

    // 60 days normally crosses TWO month rollovers (turn 0 -> 2). The story
    // event fires at the FIRST rollover, sets pendingStoryEvent, and the tick
    // loop breaks, so only one rollover happens (turn === 1).
    const next = tickDays(s, 60, agentsFor(s));

    expect(next.pendingStoryEvent).toEqual({ eventId: 'test-beat', scenarioId: 's1-dongzhuo' });
    expect(next.turn).toBe(1);
    // The fired id is recorded exactly once so it can't re-fire.
    expect(next.events.filter((e) => e.id === 'test-beat')).toHaveLength(1);

    // Ticking further does NOT advance time while a story decision is owed.
    const frozen = tickDays(next, 30, agentsFor(next));
    expect(frozen.pendingStoryEvent).toEqual(next.pendingStoryEvent);
    expect(frozen.turn).toBe(next.turn);
    expect(frozen.month).toBe(next.month);
    expect(frozen.day).toBe(next.day);
    expect(frozen.events.filter((e) => e.id === 'test-beat')).toHaveLength(1);
  });

  it('evaluates objectives and advances time normally when no story event fires', () => {
    // No test story table registered -> storyEventsFor returns [].
    const s = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 7,
    });

    const next = tickDays(s, 60, agentsFor(s));

    // Two full month rollovers, no pause.
    expect(next.pendingStoryEvent).toBeUndefined();
    expect(next.turn).toBe(2);

    // The no-story branch delegates to evaluateObjectives. Use a scenarioId
    // with no scripted or story events so runScenarioEvents === evaluateObjectives.
    const bare: GameState = { ...s, scenarioId: 's-no-events' };
    expect(runScenarioEvents(bare)).toEqual(evaluateObjectives(bare));
  });
});
