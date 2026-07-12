import { describe, expect, it } from 'vitest';
import { storyEventsFor } from '../../src/engine/story/events.js';
import { findSetpiece } from '../../src/engine/duel/setpieces.js';
import type { GameState } from '../../src/engine/types.js';
// Build a Chapter-1 Liu Bei state that has satisfied the coalition condition.
import { reachedCoalition } from './helpers/s1.js';

describe('Hulao Pass duel is reachable and branches', () => {
  it('the trigger event fires after joining the coalition and queues the duel', () => {
    const state = reachedCoalition();
    const events = storyEventsFor(state.scenarioId, state.storyMode);
    const trigger = events.find((e) => e.id === 'ch1_hulaoguan_challenge');
    expect(trigger).toBeDefined();
    expect(trigger!.check(state)).toBe(true);
    const after = trigger!.apply!(state);
    expect(after.pendingDuel?.duelId).toBe('hulaoguan');
    expect(findSetpiece('hulaoguan')).toBeDefined();
  });

  it('the trigger cannot re-fire once it has been seen', () => {
    const base = reachedCoalition();
    const events = storyEventsFor(base.scenarioId, base.storyMode);
    const trigger = events.find((e) => e.id === 'ch1_hulaoguan_challenge')!;
    const seen: GameState = {
      ...base,
      events: [
        ...base.events,
        { id: 'ch1_hulaoguan_challenge', turn: base.turn, year: base.year, month: base.month },
      ],
    };
    expect(trigger.check(seen)).toBe(false);
  });

  it('the WIN aftermath fires only after a recorded duel win', () => {
    const base = reachedCoalition();
    const events = storyEventsFor(base.scenarioId, base.storyMode);
    const win = events.find((e) => e.id === 'ch1_hulaoguan_win')!;
    const lose = events.find((e) => e.id === 'ch1_hulaoguan_lose')!;
    // Before any duel is resolved neither aftermath is eligible (and the check
    // must not throw when duelResults has no hulaoguan entry).
    expect(win.check(base)).toBe(false);
    expect(lose.check(base)).toBe(false);
    const wonState: GameState = { ...base, duelResults: { hulaoguan: 'win' } };
    expect(win.check(wonState)).toBe(true);
    expect(lose.check(wonState)).toBe(false);
  });

  it('the LOSE aftermath fires after a recorded loss and does not dead-end', () => {
    const base = reachedCoalition();
    const events = storyEventsFor(base.scenarioId, base.storyMode);
    const lose = events.find((e) => e.id === 'ch1_hulaoguan_lose')!;
    const lostState: GameState = { ...base, duelResults: { hulaoguan: 'lose' } };
    expect(lose.check(lostState)).toBe(true);
    // The loss beat is a pure narrative continuation: no choices, no apply that
    // strands the player — Chapter 1 presses on.
    expect(lose.choices).toEqual([]);
  });

  it('aftermath checks tolerate legacy saves with undefined duelResults', () => {
    const base = reachedCoalition();
    const events = storyEventsFor(base.scenarioId, base.storyMode);
    const win = events.find((e) => e.id === 'ch1_hulaoguan_win')!;
    const lose = events.find((e) => e.id === 'ch1_hulaoguan_lose')!;
    // Old hydrated saves have duelResults === undefined; optional chaining must
    // keep the checks from throwing.
    const legacy = { ...base, duelResults: undefined } as unknown as GameState;
    expect(() => win.check(legacy)).not.toThrow();
    expect(() => lose.check(legacy)).not.toThrow();
    expect(win.check(legacy)).toBe(false);
    expect(lose.check(legacy)).toBe(false);
  });
});
