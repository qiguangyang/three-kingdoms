// Story-campaign contract types.
//
// All identifiers and comments are English. User-facing strings are referenced
// only by MessageKey so the UI resolves them against the active locale.
//
// NOTE ON THE IMPORT CYCLE: src/engine/types.ts imports ObjectiveState /
// PendingStoryEvent / StoryMode from THIS file, and this file imports GameState
// / FactionId from src/engine/types.ts. Both directions are TYPE-ONLY imports,
// which are fully erased at compile time, so there is no runtime cycle.
import type { GameState, FactionId } from '../types.js';
import type { MessageKey } from '../../i18n/types.js';

export type ObjectiveStatus = 'active' | 'complete' | 'failed';

export interface ObjectiveDef {
  id: string;
  titleKey: MessageKey;
  descKey: MessageKey;
  check: (state: GameState) => boolean; // pure completion predicate
  optional?: boolean; // does not gate chapter/historic victory
  hidden?: boolean; // not shown in HUD until unlocked
}

export interface ObjectiveState {
  id: string;
  status: ObjectiveStatus;
  completedTurn?: number;
}

export interface StoryChoice {
  id: string;
  labelKey: MessageKey;
  descKey: MessageKey; // one-line consequence preview
  apply: (state: GameState) => GameState; // pure branch state-change
}

export interface StoryEvent {
  id: string;
  check: (state: GameState) => boolean;
  titleKey: MessageKey;
  bodyKey: MessageKey;
  choices: StoryChoice[]; // [] => narrative beat (single "continue")
  portrait?: string;
  // Optional pure state-change applied when a BEAT (choices: []) is dismissed.
  // Choice-events carry their effect on each StoryChoice.apply instead; this
  // lets a choiceless beat still mutate state (e.g. inject reinforcements) when
  // it is resolved. Ignored for choice-events. Undefined => the beat is purely
  // narrative and only lifts the pause.
  apply?: (state: GameState) => GameState;
}

export interface PendingStoryEvent {
  eventId: string;
  scenarioId: string;
}

export interface StoryMode {
  protagonistFactionId: FactionId;
  chapter: 1 | 2 | 3 | 4;
}
