import type { GameState } from '../types.js';
import type { StoryEvent, StoryMode } from './types.js';

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
  // storyMode will select protagonist-specific events once content exists.
  void storyMode;
  const authored: StoryEvent[] = [];
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
  if (!event) return state;
  const choice = event.choices.find((c) => c.id === choiceId);
  if (!choice) return state;
  const applied = choice.apply(state);
  return { ...applied, pendingStoryEvent: undefined };
}
