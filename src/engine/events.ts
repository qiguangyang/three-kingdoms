import { S1_EVENTS } from '../data/events/s1-triggers.js';
import type { GameState, ScenarioEvent } from './types.js';
import { storyEventsFor } from './story/events.js';
import { evaluateObjectives } from './story/objectives.js';

// Look up the scripted event table for the currently-loaded scenario.
function eventsFor(scenarioId: string): ScenarioEvent[] {
  if (scenarioId === 's1-dongzhuo') return S1_EVENTS;
  return [];
}

// Run the scenario + story pipeline for one month tick.
//
//   1. Scripted scenario events: every event whose `check` passes applies in
//      declaration order and records itself in state.events so it won't refire.
//   2. Interactive story events: the FIRST eligible story event (its `check`
//      passes AND it has not already fired) pauses the tick — set
//      state.pendingStoryEvent, record the id in state.events, and RETURN
//      immediately. Setting pendingStoryEvent freezes time-advance exactly like
//      pendingBattle (the tick loop in pendingOp.ts breaks on it). No
//      objectives and no further events are evaluated on this tick.
//   3. Objective evaluation: if no story event fired, evaluate objectives.
//
// Pure and synchronous.
export function runScenarioEvents(state: GameState): GameState {
  let next = state;

  // (1) Scripted scenario events, exactly as before.
  const events = eventsFor(next.scenarioId);
  for (const ev of events) {
    if (ev.check(next)) {
      next = ev.apply(next);
    }
  }

  // (2) Interactive story events — fire the first eligible one by pausing.
  const storyEvents = storyEventsFor(next.scenarioId, next.storyMode);
  for (const storyEvent of storyEvents) {
    const alreadyFired = next.events.some((e) => e.id === storyEvent.id);
    if (!alreadyFired && storyEvent.check(next)) {
      return {
        ...next,
        pendingStoryEvent: { eventId: storyEvent.id, scenarioId: next.scenarioId },
        events: [
          ...next.events,
          { id: storyEvent.id, turn: next.turn, year: next.year, month: next.month },
        ],
      };
    }
  }

  // (3) No story event fired this tick — evaluate objectives.
  next = evaluateObjectives(next);
  return next;
}
