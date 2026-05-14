import { S1_EVENTS } from '../data/events/s1-triggers.js';
import type { GameState, ScenarioEvent } from './types.js';

// Look up the event table for the currently-loaded scenario.
function eventsFor(scenarioId: string): ScenarioEvent[] {
  if (scenarioId === 's1-dongzhuo') return S1_EVENTS;
  return [];
}

// Run every event whose `check` passes, applying them in declaration order.
// Each event records itself in state.events so it won't refire.
export function runScenarioEvents(state: GameState): GameState {
  let next = state;
  const events = eventsFor(next.scenarioId);
  for (const ev of events) {
    if (ev.check(next)) {
      next = ev.apply(next);
    }
  }
  return next;
}
