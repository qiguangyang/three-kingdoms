import type { GameState } from '../types.js';
import type { StoryEvent, StoryMode } from './types.js';
import { S1_LIUBEI_EVENTS } from '../../data/story/s1-liubei.js';
import { S2_LIUBEI_EVENTS } from '../../data/story/s2-liubei.js';

// Story-event overlay keyed by scenarioId. The authored production table is
// empty for now; real narrative content is added in a later content task.
// This overlay lets unit tests drive the story-pause pipeline deterministically
// without shipping narrative prose. setTestStoryEvents / clearTestStoryEvents
// are TEST ONLY and are never called by production code.
const storyEventOverlay = new Map<string, StoryEvent[]>();

// TEST ONLY: register a story-event table for a scenario so the pause pipeline
// can be exercised. Pair with clearTestStoryEvents() in afterEach to avoid
// cross-test leakage.
export function setTestStoryEvents(scenarioId: string, events: StoryEvent[]): void {
  storyEventOverlay.set(scenarioId, events);
}

// TEST ONLY: clear all registered test story-event tables.
export function clearTestStoryEvents(): void {
  storyEventOverlay.clear();
}

// Production lookup: the interactive story events for a scenario (and,
// eventually, the active protagonist). The authored table is empty for now;
// real Liu Bei content is authored in a later task. The test overlay is merged
// in so the tick-pause pipeline is drivable in unit tests.
export function storyEventsFor(scenarioId: string, storyMode?: StoryMode): StoryEvent[] {
  let authored: StoryEvent[] = [];
  if (storyMode?.protagonistFactionId === 'liubei') {
    if (scenarioId === 's1-dongzhuo') authored = S1_LIUBEI_EVENTS;
    else if (scenarioId === 's2-junxiong') authored = S2_LIUBEI_EVENTS;
  }
  const overlay = storyEventOverlay.get(scenarioId) ?? [];
  return [...authored, ...overlay];
}

// Find a single story event by id within a scenario's table. Used by the store
// when resolving a pending story event.
export function findStoryEvent(
  scenarioId: string,
  storyMode: StoryMode | undefined,
  eventId: string,
): StoryEvent | undefined {
  return storyEventsFor(scenarioId, storyMode).find((event) => event.id === eventId);
}

// Apply the chosen branch of a queued story event, then lift the pause.
// The event and choice are looked up by the state's scenario + story mode;
// an unknown event or choice is an identity no-op so a stale/duplicate
// command can never corrupt state. Pure: runs only choice.apply(state) and
// clears pendingStoryEvent — no wall-clock, no RNG.
export function applyStoryChoice(
  state: GameState,
  eventId: string,
  choiceId: string,
): GameState {
  const event = findStoryEvent(state.scenarioId, state.storyMode, eventId);
  if (!event) return state; // unknown event -> identity no-op, keep pending
  // A narrative beat has no choices; the modal dismisses it with choiceId ''.
  // Run its optional apply (e.g. injecting reinforcements) — a purely narrative
  // beat has no apply and only lifts the pause. Either way, clear the pause;
  // otherwise the beat's pendingStoryEvent would never clear and the next
  // advanceDays would immediately re-pause.
  if (event.choices.length === 0) {
    const applied = event.apply ? event.apply(state) : state;
    return { ...applied, pendingStoryEvent: undefined };
  }
  const choice = event.choices.find((c) => c.id === choiceId);
  if (!choice) return state; // invalid choice -> identity no-op, keep pending
  const applied = choice.apply(state);
  return { ...applied, pendingStoryEvent: undefined };
}
