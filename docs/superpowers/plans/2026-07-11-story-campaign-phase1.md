# Story Campaign — Phase 1: Story & Objective Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the reusable story/objective machinery and prove it on Scenario 1 — a tracked objective chain plus one branching choice-event for Liu Bei, save/load-safe and always green — as the foundation for the four-chapter campaign.

**Architecture:** New `src/engine/story/` module (pure types + objective engine + story-event system) layered onto the existing `runScenarioEvents` pipeline; a `pendingStoryEvent` pause on `GameState` that freezes time-advance for a player decision, modeled exactly on the existing `pendingBattle` flow; `hasVictory` extended to honor `dominate`/`historic`; new `story`/`briefing`/`chapterTransition` screens + a `StoryEventModal`; an Objectives HUD on the campaign map; a Title Story/Free-Play split that launches Liu Bei's Chapter 1.

**Tech Stack:** Vite + React 19 (DOM) + Zustand + TypeScript (ESM/NodeNext, explicit `.js` specifiers) + Vitest (+ Testing-Library/jsdom for UI).

**Design spec:** `docs/superpowers/specs/2026-07-11-story-campaign-design.md` (read §4 architecture, §5 determinism, §7 testing, Appendix A content).

## Global Constraints

- **English identifiers + comments; bilingual UI.** Every user-facing string adds a `MessageKey` to `src/i18n/types.ts` **and** an entry to **both** `catalog/en.ts` and `catalog/zh.ts` (enforced by `tests/i18n/parity.test.ts`). Use the exact Appendix A bilingual text for Ch.1 content.
- **Always green.** At every task's final step, the full Vitest suite + `npx tsc --noEmit` + `npm run build` must pass. Baseline before Phase 1: **285 tests**.
- **THE SEAM is sacred.** Do not change off-screen AI-vs-AI resolution (`resolveQuickBattle`, and the untouched parts of `pendingOp.ts`/`turn.ts`). Story logic hooks into `runScenarioEvents` and the month-tick only.
- **Determinism + save/load.** New `GameState` fields (`objectives`, `pendingStoryEvent?`, `storyMode?`) round-trip through the whole-`game` autosave; `loadGame` resumes a pending story event like a mid-battle. Engine code is pure — no `Date.now`/`Math.random`.
- **Fixed contracts.** The type/function names below are contracts shared across tasks — use them verbatim; never rename or redefine.

## Shared contracts (authored once in Task 1; consumed by all)

```ts
// src/engine/story/types.ts
export type ObjectiveStatus = 'active' | 'complete' | 'failed';
export interface ObjectiveDef { id: string; titleKey: MessageKey; descKey: MessageKey; check: (s: GameState) => boolean; optional?: boolean; hidden?: boolean; }
export interface ObjectiveState { id: string; status: ObjectiveStatus; completedTurn?: number; }
export interface StoryChoice { id: string; labelKey: MessageKey; descKey: MessageKey; apply: (s: GameState) => GameState; }
export interface StoryEvent { id: string; check: (s: GameState) => boolean; titleKey: MessageKey; bodyKey: MessageKey; choices: StoryChoice[]; portrait?: string; }
export interface PendingStoryEvent { eventId: string; scenarioId: string; }
export interface StoryMode { protagonistFactionId: FactionId; chapter: 1 | 2 | 3 | 4; }

// GameState additions: objectives: ObjectiveState[]; pendingStoryEvent?: PendingStoryEvent; storyMode?: StoryMode;
// StrategicCommand addition: | { kind: 'storyChoice'; eventId: string; choiceId: string }  (applied immediately, never scheduled)

// src/engine/story/objectives.ts
export function objectivesFor(scenarioId: string, storyMode?: StoryMode): ObjectiveDef[];
export function seedObjectives(state: GameState): GameState;
export function evaluateObjectives(state: GameState): GameState;
// src/engine/story/events.ts
export function storyEventsFor(scenarioId: string, storyMode?: StoryMode): StoryEvent[];
export function findStoryEvent(scenarioId: string, storyMode: StoryMode | undefined, eventId: string): StoryEvent | undefined;
export function applyStoryChoice(state: GameState, eventId: string, choiceId: string): GameState;
// src/state/store.ts
export function resolveStoryChoice(eventId: string, choiceId: string): void;
// Screen additions: | { kind: 'story'; eventId: string } | { kind: 'briefing' } | { kind: 'chapterTransition' }
```

## File Structure

- **Create:** `src/engine/story/types.ts` (contracts), `src/engine/story/objectives.ts` (objective engine), `src/engine/story/events.ts` (story-event system + choice application), `src/data/story/s1-liubei.ts` (Ch.1 objective + choice content), `src/web/screens/StoryEventModal.tsx` (decision/beat modal).
- **Modify:** `src/engine/types.ts` (GameState + StrategicCommand), `src/engine/scenario.ts` (init `objectives`), `src/engine/events.ts` (story-event firing + objective eval in `runScenarioEvents`), `src/engine/pendingOp.ts` (freeze tick on `pendingStoryEvent`), `src/engine/selectors.ts` (`hasVictory` dominate/historic), `src/engine/turn.ts` (`storyChoice` in `applyCommand`), `src/state/store.ts` (screens, routing, `resolveStoryChoice`, resume, digest), `src/web/App.tsx` (routes), `src/web/screens/MainScreen.tsx` (Objectives HUD), `src/web/screens/TitleScreen.tsx` (mode split), `src/web/screens/FactionSelectScreen.tsx` (name fix), `src/web/screens/GeneralsScreen.tsx` (exhaustive switch), `src/i18n/types.ts` + `src/i18n/catalog/{en,zh}.ts` (new keys).

## Pre-flight note (dependency ordering)

Task 1 authors the shared types and adds a **temporary** no-op `storyChoice` case to `applyCommand`; Task 5 replaces it with the real `applyStoryChoice` delegation. Task 4 adds the `pendingStoryEvent` tick-freeze; Task 6 adds the store routing that consumes it. Recommended execution order: **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11** (Task 11 polish is independent and may land anytime). Tasks 2 and 4 use small injectable/test-only tables; Task 10 supplies the real Scenario-1 content those lookups return.

---

### Task 1: Story core types + GameState fields + StrategicCommand member

**Files:**
- Create `src/engine/story/types.ts` (all shared story contract types).
- Modify `src/engine/types.ts` — add type-only import at top (after the `./battle/types.js` import block, lines 7-13); add `storyChoice` arm to `StrategicCommand` (union `@186-209`, insert before the `endTurn` arm `@209`); add three fields to `interface GameState` (after `aiStrategies` `@317`).
- Modify `src/engine/scenario.ts` — add `objectives: []` to the `buildInitialState` return object (`@132-151`, after `aiStrategies: {}` on line 150).
- Modify `src/engine/turn.ts` — add a no-op `storyChoice` case to the `applyCommand` switch (`@31-63`, before `case 'endTurn':` on line 61) so the exhaustive switch still compiles (real logic lands in Task 5).
- Modify `src/web/screens/GeneralsScreen.tsx` — add `storyChoice` to the null-returning group of the `summarizeForGeneral` switch (`@219-222`) so that exhaustive switch still compiles.
- Test: create `tests/engine/story-types.test.ts`.

**Interfaces:**
- Consumes: nothing (first task). Reads existing `GameState`, `FactionId`, `StrategicCommand` from `src/engine/types.ts`; `MessageKey` from `src/i18n/types.ts`.
- Produces (every later task relies on these EXACT names/shapes):
  - Types in `src/engine/story/types.ts`: `ObjectiveStatus`, `ObjectiveDef`, `ObjectiveState`, `StoryChoice`, `StoryEvent`, `PendingStoryEvent`, `StoryMode`.
  - `GameState.objectives: ObjectiveState[]` (always present, `[]` at build), `GameState.pendingStoryEvent?: PendingStoryEvent`, `GameState.storyMode?: StoryMode`.
  - `StrategicCommand` arm `{ kind: 'storyChoice'; eventId: string; choiceId: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/engine/story-types.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/engine/story-types.test.ts
```

Expected failure: the module `../../src/engine/story/types.js` does not exist yet, so Vitest fails at collection with an error like `Error: Failed to load url ../../src/engine/story/types.js (resolved id: .../src/engine/story/types.js). Does the file exist?` (and, once that resolves, `state.objectives` would be `undefined`, failing `expect(state.objectives).toEqual([])`).

- [ ] **Step 3: Implement**

Create `src/engine/story/types.ts`:

```ts
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
}

export interface PendingStoryEvent {
  eventId: string;
  scenarioId: string;
}

export interface StoryMode {
  protagonistFactionId: FactionId;
  chapter: 1 | 2 | 3 | 4;
}
```

Modify `src/engine/types.ts` — add a type-only import immediately after the existing `./battle/types.js` import block (currently lines 7-13):

```ts
import type {
  BattleCell,
  BattleField,
  BattleUnitState,
  FormationRole,
  GambitId,
} from './battle/types.js';
import type { ObjectiveState, PendingStoryEvent, StoryMode } from './story/types.js';
```

In the same file, add the `storyChoice` arm to `StrategicCommand`. Change the tail of the union (currently `@203-209`) from:

```ts
  | {
      kind: 'defect';
      fromCityId: CityId; // player-owned city paying the bribe (must be adjacent to target)
      targetGeneralId: GeneralId;
      gold: number; // amount offered; must be >= defectionCost(target)
    }
  | { kind: 'endTurn' };
```

to:

```ts
  | {
      kind: 'defect';
      fromCityId: CityId; // player-owned city paying the bribe (must be adjacent to target)
      targetGeneralId: GeneralId;
      gold: number; // amount offered; must be >= defectionCost(target)
    }
  // Story-mode branch pick. Applied IMMEDIATELY (never scheduled as a
  // PendingOp) — see turn.ts applyCommand / applyStoryChoice (Task 5).
  | { kind: 'storyChoice'; eventId: string; choiceId: string }
  | { kind: 'endTurn' };
```

In the same file, add three fields to `interface GameState`, immediately after `aiStrategies` (currently `@317`). Change:

```ts
  aiStrategies: Record<FactionId, FactionStrategy>;
}
```

to:

```ts
  aiStrategies: Record<FactionId, FactionStrategy>;
  // Story campaign: active objectives. Always present ([] in Free Play and
  // until seedObjectives() runs). Populated in Task 2.
  objectives: ObjectiveState[];
  // When set, time-advance is frozen until the player resolves the story
  // event (mirrors pendingBattle). Absent outside Story-Mode beats.
  pendingStoryEvent?: PendingStoryEvent;
  // Present => Story Mode (protagonist arc); absent => Free Play.
  storyMode?: StoryMode;
}
```

Modify `src/engine/scenario.ts` — in the `buildInitialState` return object, add `objectives: []` after `aiStrategies: {}` (currently line 150). Change:

```ts
    aiStrategies: {},
  };
}
```

to:

```ts
    aiStrategies: {},
    // Story campaign objectives; seeded later by seedObjectives() (Task 2).
    objectives: [],
  };
}
```

Modify `src/engine/turn.ts` — in the `applyCommand` switch, add a no-op `storyChoice` case before `case 'endTurn':` (currently line 61). Change:

```ts
    case 'endTurn':
      return state;
  }
}
```

to:

```ts
    case 'storyChoice':
      // Story choices are applied on the store's immediate command path (see
      // applyStoryChoice, Task 5); they are never scheduled through here. This
      // no-op keeps the switch exhaustive.
      // TODO(Task 5): delegate to applyStoryChoice(state, cmd.eventId, cmd.choiceId).
      return state;
    case 'endTurn':
      return state;
  }
}
```

Modify `src/web/screens/GeneralsScreen.tsx` — add `storyChoice` to the null-returning group of `summarizeForGeneral` (currently `@219-222`). Change:

```ts
    case 'plunder':
    case 'hireWild':
    case 'endTurn':
      return null;
  }
}
```

to:

```ts
    case 'plunder':
    case 'hireWild':
    case 'storyChoice':
    case 'endTurn':
      return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/engine/story-types.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Run full gate + commit**

```bash
npm test
npx tsc --noEmit
npm run build
git checkout -b story-campaign-phase1
git add src/engine/story/types.ts src/engine/types.ts src/engine/scenario.ts src/engine/turn.ts src/web/screens/GeneralsScreen.tsx tests/engine/story-types.test.ts
git commit -m "$(cat <<'EOF'
Story campaign Task 1: core types + GameState story fields

Add src/engine/story/types.ts (ObjectiveDef/ObjectiveState/StoryChoice/
StoryEvent/PendingStoryEvent/StoryMode), the objectives/pendingStoryEvent/
storyMode fields on GameState (objectives:[] at build), and the storyChoice
StrategicCommand arm (no-op in applyCommand/summarizeForGeneral for now;
real logic in Task 5).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AQWRraNb7H8x364cBoskEU
EOF
)"
```

---

### Task 2: Objective engine (objectivesFor / seedObjectives / evaluateObjectives)

**Files:**
- Create `src/engine/story/objectives.ts` (new)
- Modify `src/i18n/types.ts` (add `'objective.completed'` to the `MessageKey` union, before the `// Between-turn digest` block at line 360–362)
- Modify `src/i18n/catalog/en.ts` (add `'objective.completed'` entry before `'digest.heading'` at the tail)
- Modify `src/i18n/catalog/zh.ts` (add `'objective.completed'` entry before `'digest.heading'` at the tail)
- Test `tests/engine/story-objectives.test.ts` (new)

**Interfaces:**
- **Consumes (Task 1):** `ObjectiveDef`, `ObjectiveState`, `StoryMode` from `src/engine/story/types.ts`; `GameState` (with the new `objectives: ObjectiveState[]` field and optional `storyMode?: StoryMode`) from `src/engine/types.ts`.
- **Produces (relied on by later tasks — Task on `events.ts` extension calls `evaluateObjectives`; the newGame/store task calls `seedObjectives`; Task 10 fills in the real s1 branch):**
  - `objectivesFor(scenarioId: string, storyMode?: StoryMode): ObjectiveDef[]` — production lookup is a direct `scenarioId`(+`storyMode`) branch that imports the content tables (identical in shape to `storyEventsFor` in Task 4 and the existing `eventsFor`); it returns `[]` for every scenario until Task 10 fills in the `s1-dongzhuo` case.
  - `seedObjectives(state: GameState): GameState`
  - `evaluateObjectives(state: GameState): GameState`
  - `setTestObjectives(scenarioId: string, defs: ObjectiveDef[]): void` and `clearTestObjectives(): void` — TEST-ONLY injection hooks (exact analogues of Task 4's `setTestStoryEvents`/`clearTestStoryEvents`), consulted ahead of the production branch and never called by production code. Deterministic data only; never derived from clock/random.
  - New `MessageKey`: `'objective.completed'` (var `{title}`).
- **Non-goals here:** do NOT add `'objective.completed'` to `DIGEST_KEYS` in `src/state/store.ts` (that belongs to the store task); do NOT modify `runScenarioEvents` (that belongs to the events-extension task).

---

- [ ] **Step 1: Write the failing test** (COMPLETE test code)

Create `tests/engine/story-objectives.test.ts`:

```ts
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
```

*(Prerequisite: Task 1 must already have created `src/engine/story/types.ts` and added `objectives: ObjectiveState[]` / `storyMode?: StoryMode` to `GameState`, or this test will not type-check.)*

- [ ] **Step 2: Run test to verify it fails** (exact command + expected failure)

```bash
npx vitest run tests/engine/story-objectives.test.ts
```

Expected failure: Vitest reports a module-resolution error such as `Failed to resolve import "../../src/engine/story/objectives.js" from "tests/engine/story-objectives.test.ts"` (the module does not exist yet), so every test in the file errors before running.

- [ ] **Step 3: Implement** (COMPLETE code)

Create `src/engine/story/objectives.ts`:

```ts
// Objective engine: per-scenario objective definitions, seeding them into
// GameState, and evaluating their completion.
//
// The engine stays pure and deterministic: no Date.now / Math.random.
// objectivesFor() is the single lookup, keyed by scenarioId and specialized by
// the optional StoryMode chapter. It is a direct branch that imports the
// content tables — exactly like eventsFor() in src/engine/events.ts and
// storyEventsFor() in src/engine/story/events.ts. The production branch is
// empty for now; Task 10 fills in the real s1-dongzhuo case. A TEST-ONLY
// override table is consulted first so unit tests can drive the pipeline
// deterministically without shipping narrative content.

import type { GameState } from '../types.js';
import type { ObjectiveDef, StoryMode } from './types.js';

// TEST-ONLY objective-table overlay keyed by scenarioId. setTestObjectives /
// clearTestObjectives are TEST ONLY and are never called by production code;
// pair them with clearTestObjectives() in an afterEach to avoid cross-test
// leakage. The overlay is deterministic data — never derived from wall-clock
// time or randomness — so the engine remains pure.
const testObjectiveOverlay = new Map<string, ObjectiveDef[]>();

// TEST ONLY: register an objective table for a scenario so the objective
// pipeline can be exercised. Consulted ahead of the production branch.
export function setTestObjectives(scenarioId: string, defs: ObjectiveDef[]): void {
  testObjectiveOverlay.set(scenarioId, defs);
}

// TEST ONLY: clear all registered test objective tables.
export function clearTestObjectives(): void {
  testObjectiveOverlay.clear();
}

// Look up the objective definitions for a scenario. A TEST-ONLY override is
// consulted first (test-hook precedence); otherwise a direct branch on
// scenarioId (specialized by the active StoryMode) returns the authored table.
// The production branch is empty for now — Task 10 fills in the s1-dongzhuo /
// liubei case. Returns [] for scenarios with no objectives (unknown scenarios /
// Free Play).
export function objectivesFor(scenarioId: string, storyMode?: StoryMode): ObjectiveDef[] {
  const override = testObjectiveOverlay.get(scenarioId);
  if (override) return override;
  // storyMode will select protagonist-specific objectives once content exists.
  void storyMode;
  return [];
}

// Seed state.objectives from the scenario's objective table. Every objective
// starts 'active'. Called once when a new game / story arc begins.
export function seedObjectives(state: GameState): GameState {
  const defs = objectivesFor(state.scenarioId, state.storyMode);
  const objectives = defs.map((def) => ({ id: def.id, status: 'active' as const }));
  return { ...state, objectives };
}

// Evaluate active objectives against the current state. Each active objective
// whose matching def.check(state) passes flips to 'complete' (recording the
// turn) and emits exactly one 'objective.completed' log entry. Because only
// 'active' objectives are processed, every objective logs at most once. When
// nothing changes, the original state reference is returned unchanged.
export function evaluateObjectives(state: GameState): GameState {
  const defs = objectivesFor(state.scenarioId, state.storyMode);
  const defById = new Map(defs.map((def) => [def.id, def]));

  let changed = false;
  const newLog = [...state.log];
  const objectives = state.objectives.map((obj) => {
    if (obj.status !== 'active') return obj;
    const def = defById.get(obj.id);
    if (!def || !def.check(state)) return obj;
    changed = true;
    newLog.push({
      turn: state.turn,
      year: state.year,
      month: state.month,
      key: 'objective.completed',
      vars: { title: def.titleKey },
    });
    return { ...obj, status: 'complete' as const, completedTurn: state.turn };
  });

  if (!changed) return state;
  return { ...state, objectives, log: newLog };
}
```

Modify `src/i18n/types.ts` — add the new key to the `MessageKey` union just before the digest block (current lines 360–362):

```ts
  // Story campaign — objectives
  | 'objective.completed'

  // Between-turn digest
  | 'digest.heading'
  | 'digest.dismiss';
```

(Replace the existing three-line `// Between-turn digest` block with the block above; the only change is the two inserted lines before it.)

Modify `src/i18n/catalog/en.ts` — insert before the `'digest.heading'` entry at the tail:

```ts
  'map.legend.capital': 'Seat',

  // Story campaign — objectives
  'objective.completed': 'Objective complete: {title}',

  'digest.heading': 'While you were occupied…',
```

(The `'map.legend.capital'` and `'digest.heading'` lines already exist; only the commented `'objective.completed'` line and its surrounding blank line are new.)

Modify `src/i18n/catalog/zh.ts` — insert before the `'digest.heading'` entry at the tail:

```ts
  'map.legend.capital': '治所',

  // Story campaign — objectives
  'objective.completed': '目标达成：{title}',

  'digest.heading': '此间天下事…',
```

- [ ] **Step 4: Run test to verify it passes** (exact command)

```bash
npx vitest run tests/engine/story-objectives.test.ts
```

All tests in `tests/engine/story-objectives.test.ts` pass.

- [ ] **Step 5: Run full gate + commit**

```bash
npm test
npx tsc --noEmit
npm run build

git add src/engine/story/objectives.ts src/i18n/types.ts src/i18n/catalog/en.ts src/i18n/catalog/zh.ts tests/engine/story-objectives.test.ts
git commit -m "Add story objective engine (objectivesFor/seedObjectives/evaluateObjectives)

Pure, deterministic objective lookup keyed by scenarioId+storyMode via a direct
branch (empty until Task 10, mirroring eventsFor/storyEventsFor) with a TEST-ONLY
setTestObjectives/clearTestObjectives injection hook; evaluateObjectives flips
active objectives to complete once their predicate holds and logs
objective.completed (bilingual). No off-screen battle code touched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AQWRraNb7H8x364cBoskEU"
```

The `npm test` run must include the i18n parity suite (`tests/i18n/parity.test.ts`) passing green, confirming the new `'objective.completed'` key is present and non-empty in both catalogs.

---

### Task 3: `hasVictory` implements `dominate` + `historic`
**Files:**
- Modify `src/engine/selectors.ts` — imports (lines 1-2) and the `hasVictory` function (lines 54-58).
- Create `tests/engine/victory.test.ts`.

**Interfaces:**
- Consumes (Task 1): `ObjectiveState`/`StoryMode` fields on `GameState` (`state.objectives: ObjectiveState[]`, `state.storyMode?: StoryMode`), `buildInitialState` returning `objectives: []`. Consumes (Task 2): `objectivesFor(scenarioId, storyMode?): ObjectiveDef[]` from `src/engine/story/objectives.ts` (production branch returns `[]` for `s1-dongzhuo` until Task 10 — the `historic` test injects fixtures via `setTestObjectives`). Consumes `VictoryCondition` (`src/engine/types.ts:254-261`, fields `kind: 'unify'|'dominate'|'historic'`, `cityCount?`, `requiredCityIds?`), `SCENARIOS` (`src/data/scenarios/index.ts`), `citiesOf` (`src/engine/map.ts:62`).
- Produces: `hasVictory(state, factionId)` (same signature) now honoring the scenario's `VictoryCondition`. `checkOutcome` (`src/engine/turn.ts:225-230`) is **unchanged** — it keeps calling `hasVictory(state, state.playerFactionId)` and returning `'victory'|'defeat'|null`. No other task changes this function.

Note on the import cycle: `selectors.ts` will import `objectivesFor` from `./story/objectives.js`, and Task 1's `objectives.ts` may import selectors (`citiesOf`/`factionTotals`) inside its objective `check` predicates. This is safe because both directions are **runtime function calls**, never module-init-time evaluation — ESM resolves function-level cycles. Do not move `objectivesFor` to top-level state.

- [ ] **Step 1: Write the failing test** (complete file `tests/engine/victory.test.ts`)

```ts
import { describe, expect, it, afterEach } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { SCENARIOS } from '../../src/data/scenarios/index.js';
import { REF_DATA } from '../../src/data/index.js';
import { hasVictory } from '../../src/engine/selectors.js';
import {
  objectivesFor,
  setTestObjectives,
  clearTestObjectives,
} from '../../src/engine/story/objectives.js';
import type { City, GameState, FactionId } from '../../src/engine/types.js';
import type { ObjectiveDef, StoryMode } from '../../src/engine/story/types.js';

// Reassign every city: those in `ownedIds` go to the player faction, the rest
// to a throwaway rival id, so citiesOf(state, player) counts exactly ownedIds.
function assignOwnership(state: GameState, ownedIds: string[]): GameState {
  const player = state.playerFactionId;
  const cities: Record<string, City> = {};
  for (const [id, c] of Object.entries(state.cities)) {
    cities[id] = { ...c, factionId: ownedIds.includes(id) ? player : '__rival__' };
  }
  return { ...state, cities };
}

function baseState(playerFactionId: FactionId): GameState {
  return buildInitialState({
    scenario: SCENARIO_DONGZHUO,
    playerFactionId,
    refData: REF_DATA,
    seed: 1,
  });
}

describe('hasVictory — victory conditions', () => {
  // s1-dongzhuo, s-test-dominate, and s-test-historic get mutated below;
  // restore / clean up after each test (including injected objective tables).
  const originalS1Victory = SCENARIOS['s1-dongzhuo']!.victory;
  afterEach(() => {
    SCENARIOS['s1-dongzhuo']!.victory = originalS1Victory;
    delete SCENARIOS['s-test-dominate'];
    delete SCENARIOS['s-test-historic'];
    clearTestObjectives();
  });

  it('unify: victory only when the player owns every city', () => {
    const state = baseState('dongzhuo'); // s1 victory is { kind: 'unify' }
    const allIds = Object.keys(state.cities);
    // Own all but one -> no victory.
    expect(hasVictory(assignOwnership(state, allIds.slice(1)), 'dongzhuo')).toBe(false);
    // Own all -> victory.
    expect(hasVictory(assignOwnership(state, allIds), 'dongzhuo')).toBe(true);
  });

  it('dominate: needs the city count AND every required city', () => {
    const state = baseState('dongzhuo');
    const ids = Object.keys(state.cities);
    const required = [ids[0]!, ids[1]!];
    SCENARIOS['s-test-dominate'] = {
      ...SCENARIO_DONGZHUO,
      id: 's-test-dominate',
      victory: { kind: 'dominate', cityCount: 3, requiredCityIds: required },
    };
    const domState: GameState = { ...state, scenarioId: 's-test-dominate' };

    // Count met (3) AND both required held -> victory.
    expect(
      hasVictory(assignOwnership(domState, [ids[0]!, ids[1]!, ids[2]!]), 'dongzhuo'),
    ).toBe(true);
    // Count met (3) but a required city missing -> no victory.
    expect(
      hasVictory(assignOwnership(domState, [ids[2]!, ids[3]!, ids[4]!]), 'dongzhuo'),
    ).toBe(false);
    // Both required held but count short (2 < 3) -> no victory.
    expect(hasVictory(assignOwnership(domState, [ids[0]!, ids[1]!]), 'dongzhuo')).toBe(false);
  });

  it('historic: victory when all non-optional objectives are complete', () => {
    // Production objectivesFor('s1-dongzhuo', ...) returns [] until Task 10, so
    // drive this through an injected table on a dedicated historic-victory
    // scenario. Two required objectives + one optional (which must not gate).
    const defs: ObjectiveDef[] = [
      { id: 'obj-a', titleKey: 'app.title', descKey: 'app.subtitle', check: () => false },
      { id: 'obj-b', titleKey: 'app.title', descKey: 'app.subtitle', check: () => false },
      {
        id: 'obj-c',
        titleKey: 'app.title',
        descKey: 'app.subtitle',
        check: () => false,
        optional: true,
      },
    ];
    setTestObjectives('s-test-historic', defs);
    SCENARIOS['s-test-historic'] = {
      ...SCENARIO_DONGZHUO,
      id: 's-test-historic',
      victory: { kind: 'historic' },
    };
    const storyMode: StoryMode = { protagonistFactionId: 'liubei', chapter: 1 };
    const required = objectivesFor('s-test-historic', storyMode).filter((o) => !o.optional);
    // Precondition: the injected table has at least one terminal objective.
    expect(required.length).toBeGreaterThan(0);

    const base: GameState = { ...baseState('liubei'), scenarioId: 's-test-historic', storyMode };

    // All non-optional objectives complete (optional left active) -> victory.
    const won: GameState = {
      ...base,
      objectives: [
        { id: 'obj-a', status: 'complete' as const },
        { id: 'obj-b', status: 'complete' as const },
        { id: 'obj-c', status: 'active' as const },
      ],
    };
    expect(hasVictory(won, 'liubei')).toBe(true);

    // One non-optional still active -> no victory.
    const pending: GameState = {
      ...base,
      objectives: [
        { id: 'obj-a', status: 'active' as const },
        { id: 'obj-b', status: 'complete' as const },
      ],
    };
    expect(hasVictory(pending, 'liubei')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run tests/engine/victory.test.ts
```
Expected: the `unify` test passes (s1 is already unify), but `dominate` and `historic` FAIL. First failure is in `dominate`: `expect(hasVictory(...)).toBe(true)` receives `false` — the old `hasVictory` (`selectors.ts:54-58`) ignores `VictoryCondition.kind` and only returns `owned === total`, so owning 3 of ~15 cities is never a win. `historic` fails the same way (owning a subset ≠ all cities).

- [ ] **Step 3: Implement**

Edit the import block at the top of `src/engine/selectors.ts`. Replace lines 1-2:

```ts
import type { City, Faction, GameState, General, GeneralId, FactionId, LocalizedString } from './types.js';
import { citiesOf } from './map.js';
```

with:

```ts
import type {
  City,
  Faction,
  GameState,
  General,
  GeneralId,
  FactionId,
  LocalizedString,
  VictoryCondition,
} from './types.js';
import { citiesOf } from './map.js';
import { SCENARIOS } from '../data/scenarios/index.js';
import { objectivesFor } from './story/objectives.js';
```

Replace the `hasVictory` function (`selectors.ts:54-58`):

```ts
export function hasVictory(state: GameState, factionId: FactionId): boolean {
  const owned = citiesOf(state, factionId).length;
  const total = Object.keys(state.cities).length;
  return owned === total;
}
```

with:

```ts
// Victory for `factionId` under the scenario's declared VictoryCondition.
//   unify    — own every city on the map.
//   dominate — own >= cityCount cities AND hold all requiredCityIds.
//   historic — every non-optional objective of the active scenario/storyMode
//              is 'complete' in state.objectives (the story chapter's win).
// A scenario missing from the registry falls back to unify.
export function hasVictory(state: GameState, factionId: FactionId): boolean {
  const scenario = SCENARIOS[state.scenarioId];
  const victory: VictoryCondition = scenario?.victory ?? { kind: 'unify' };
  const ownedCities = citiesOf(state, factionId);
  const ownedCount = ownedCities.length;

  switch (victory.kind) {
    case 'unify': {
      const total = Object.keys(state.cities).length;
      return ownedCount === total;
    }
    case 'dominate': {
      const need = victory.cityCount ?? Object.keys(state.cities).length;
      if (ownedCount < need) return false;
      const requiredIds = victory.requiredCityIds ?? [];
      const ownedIds = new Set(ownedCities.map((c) => c.id));
      return requiredIds.every((id) => ownedIds.has(id));
    }
    case 'historic': {
      // Historic victory is arc-driven, not per-faction: it holds when the
      // story chapter's terminal objectives are done. factionId is unused here.
      const required = objectivesFor(state.scenarioId, state.storyMode).filter(
        (o) => !o.optional,
      );
      if (required.length === 0) return false;
      return required.every((def) =>
        state.objectives.some((o) => o.id === def.id && o.status === 'complete'),
      );
    }
    default:
      return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest run tests/engine/victory.test.ts
```
Expected: all three tests (`unify`, `dominate`, `historic`) pass.

- [ ] **Step 5: Run full gate + commit**

```
npm test
npx tsc --noEmit
npm run build
git add src/engine/selectors.ts tests/engine/victory.test.ts
git commit -m "$(cat <<'EOF'
hasVictory honors dominate + historic victory conditions

Read the scenario's VictoryCondition in selectors.hasVictory: unify unchanged;
dominate = owned>=cityCount AND all requiredCityIds held; historic = all
non-optional objectives for the active scenario/storyMode complete. checkOutcome
shape untouched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AQWRraNb7H8x364cBoskEU
EOF
)"
```
Expected: full suite green (existing suites plus the 3 new victory tests), no type errors, build succeeds.

---

### Task 4: Story-event pause mechanism

**Files:**
- Create `src/engine/story/events.ts` (new — `storyEventsFor`, `findStoryEvent`, plus test-only `setTestStoryEvents`/`clearTestStoryEvents`).
- Modify `src/engine/events.ts` (replace the whole file, extending `runScenarioEvents` — current body @12-21, `eventsFor` @5-8).
- Modify `src/engine/pendingOp.ts` (add the sibling tick-loop guard inside `tickDays`, loop @212-215).
- Create `tests/engine/story-event-pause.test.ts` (new).

**Interfaces:**
- **Consumes (Task 1):** `GameState.pendingStoryEvent?: PendingStoryEvent`, `GameState.storyMode?: StoryMode`, `GameState.objectives: ObjectiveState[]` (all present + initialized in `buildInitialState`); the `StoryEvent`, `StoryMode`, `PendingStoryEvent` types from `src/engine/story/types.ts`; `EventRecord` = `{ id, turn, year, month }`.
- **Consumes (Task 2):** `evaluateObjectives(state: GameState): GameState` from `src/engine/story/objectives.ts`.
- **Produces (later tasks rely on these exact names/signatures):**
  - `storyEventsFor(scenarioId: string, storyMode?: StoryMode): StoryEvent[]`
  - `findStoryEvent(scenarioId: string, storyMode: StoryMode | undefined, eventId: string): StoryEvent | undefined` (used by the store's `resolveStoryChoice` and by `applyStoryChoice`, added to this same file in a later task).
  - `runScenarioEvents` now sets `state.pendingStoryEvent` (freezes time-advance) when a story event fires; `tickDays` breaks on it. The store's `advanceDays`/`loadGame` branches (later task) key off `pendingStoryEvent`.
  - Test-only `setTestStoryEvents` / `clearTestStoryEvents` for driving the pipeline deterministically.

- [ ] **Step 1: Write the failing test**

Create `tests/engine/story-event-pause.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/yangqi/Documents/github/ThreeKingdoms
npx vitest run tests/engine/story-event-pause.test.ts
```

Expected failure: Vitest cannot resolve the import `../../src/engine/story/events.js` (file does not exist yet) — `Error: Failed to resolve import "../../src/engine/story/events.js"`. (If `src/engine/story/events.ts` is created but `runScenarioEvents`/`pendingOp.ts` are not yet wired, the run instead fails on `expect(next.pendingStoryEvent).toEqual(...)` receiving `undefined` and `expect(next.turn).toBe(1)` receiving `2`.)

- [ ] **Step 3: Implement**

Create `src/engine/story/events.ts`:

```ts
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
```

Replace the entire contents of `src/engine/events.ts` with:

```ts
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
```

In `src/engine/pendingOp.ts`, add the sibling guard inside the `tickDays` loop (currently @212-215):

```ts
  for (let i = 0; i < daysToAdvance; i++) {
    if (next.pendingBattle) break; // a player battle is owed; stop advancing
    if (next.pendingStoryEvent) break; // a story decision is owed; stop advancing
    next = tickOneDay(next, agents, options);
  }
```

(Exact edit: find the existing line `if (next.pendingBattle) break; // a player battle is owed; stop advancing` and insert the `pendingStoryEvent` guard line immediately after it, before `next = tickOneDay(...)`.)

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/yangqi/Documents/github/ThreeKingdoms
npx vitest run tests/engine/story-event-pause.test.ts
```

Expected: both tests pass (2 passed).

- [ ] **Step 5: Run full gate + commit**

```bash
cd /Users/yangqi/Documents/github/ThreeKingdoms
npm test
npx tsc --noEmit
npm run build
git add src/engine/story/events.ts src/engine/events.ts src/engine/pendingOp.ts tests/engine/story-event-pause.test.ts
git commit -m "$(cat <<'EOF'
Add story-event pause: freeze the tick when a StoryEvent fires

runScenarioEvents now fires the first eligible story event by setting
pendingStoryEvent + recording its id, mirroring the pendingBattle pause;
tickDays breaks on pendingStoryEvent. Falls through to evaluateObjectives
when no story event fires. Adds storyEventsFor/findStoryEvent lookup.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AQWRraNb7H8x364cBoskEU
EOF
)"
```

Expected: full suite green (prior baseline + 2 new tests), `tsc --noEmit` clean, `vite build` succeeds. THE SEAM (`resolveQuickBattle`, off-screen resolution) is untouched — only `runScenarioEvents` and the `tickDays` loop guard changed.

---

### Task 5: applyStoryChoice + storyChoice command

**Files:**
- Modify `src/engine/story/events.ts` — add the exported `applyStoryChoice` function (this file was created by Task 4 with `storyEventsFor` + `findStoryEvent`; add to it, do not recreate).
- Modify `src/engine/turn.ts` — add `import { applyStoryChoice } from './story/events.js';` after line 2 (`import { runScenarioEvents } from './events.js';`), and replace the Task‑1 `case 'storyChoice'` stub inside `applyCommand` (switch at lines 31‑63) with a delegating call.
- Modify `src/engine/pendingOp.ts` — no code change expected: Task 1 already made `schedulePlayerCommand` (lines 114‑190) exhaustive by adding `case 'storyChoice':` to the `case 'hireWild': case 'endTurn': return state;` no‑op group. Confirm it sits there; if it is missing, add `case 'storyChoice':` to that group so it is never scheduled. A test in this task locks the invariant.
- Test: create `tests/engine/story-choice.test.ts` (matches the `tests/engine/` convention used by `turn.test.ts`).

**Interfaces:**
- **Consumes (Task 1):** `StrategicCommand` member `{ kind:'storyChoice'; eventId; choiceId }`; `GameState.pendingStoryEvent?` and `GameState.storyMode?`; `StoryMode` / `PendingStoryEvent` types in `src/engine/story/types.ts`; the temporary `case 'storyChoice': return state;` stub in `applyCommand`; the `storyChoice` no‑op case in `schedulePlayerCommand`.
- **Consumes (Task 4):** `storyEventsFor(scenarioId, storyMode?): StoryEvent[]` and `findStoryEvent(scenarioId, storyMode, eventId): StoryEvent | undefined` from `src/engine/story/events.ts`; at least one real s1 choice‑event (Phase‑1 deliverable).
- **Produces (for Task 6 `resolveStoryChoice` and any replay):** `applyStoryChoice(state: GameState, eventId: string, choiceId: string): GameState` (runs the matched `StoryChoice.apply`, clears `pendingStoryEvent`; unknown event/choice is an identity no‑op). Also: `applyCommand` now routes the `storyChoice` command to `applyStoryChoice`.

- [ ] **Step 1: Write the failing test** (complete file `tests/engine/story-choice.test.ts`)
```ts
import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { applyStoryChoice, storyEventsFor } from '../../src/engine/story/events.js';
import { applyCommand } from '../../src/engine/turn.js';
import { schedulePlayerCommand } from '../../src/engine/pendingOp.js';
import type { GameState } from '../../src/engine/types.js';
import type { StoryMode } from '../../src/engine/story/types.js';

const STORY_MODE: StoryMode = { protagonistFactionId: 'liubei', chapter: 1 };

// Build an s1 Story-Mode state with a real choice-event queued as pending.
function buildPendingChoiceState(): {
  state: GameState;
  eventId: string;
  choiceId: string;
} {
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
```

- [ ] **Step 2: Run test to verify it fails**
  - Command: `npx vitest run tests/engine/story-choice.test.ts`
  - Expected failure: module load / import error — `src/engine/story/events.ts` has no export named `applyStoryChoice` (Task 4 only exported `storyEventsFor` / `findStoryEvent`). Vitest reports something like `SyntaxError: The requested module '.../src/engine/story/events.ts' does not provide an export named 'applyStoryChoice'` (or `applyStoryChoice is not a function`). Even once the import resolves, the `applyCommand routes storyChoice` test would fail because the Task‑1 stub returns `state` (leaving `pendingStoryEvent` set) instead of delegating.

- [ ] **Step 3: Implement**

  **3a. Add `applyStoryChoice` to `src/engine/story/events.ts`** (append below the existing `findStoryEvent`; `GameState` is already imported in this file and `findStoryEvent` is defined in it, so no new imports are needed):
```ts
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
```

  **3b. Wire `applyCommand` in `src/engine/turn.ts`.** Add the import after the existing `runScenarioEvents` import (line 2):
```ts
import { runScenarioEvents } from './events.js';
import { applyStoryChoice } from './story/events.js';
```
  Then replace Task 1's temporary `storyChoice` stub inside the `applyCommand` switch (the case Task 1 added next to `case 'endTurn':`). The switch tail must read:
```ts
    case 'endTurn':
      return state;
    case 'storyChoice':
      // A story choice is applied immediately (never scheduled as a
      // PendingOp). resolveStoryChoice records it into actionLog, so replay
      // routes it back through here.
      return applyStoryChoice(state, cmd.eventId, cmd.choiceId);
  }
}
```
  (Within `case 'storyChoice'`, `cmd` is narrowed to `{ kind:'storyChoice'; eventId: string; choiceId: string }`, so `cmd.eventId` / `cmd.choiceId` are typed.)

  **3c. `src/engine/pendingOp.ts` — verify only.** Confirm the `schedulePlayerCommand` switch's no‑op group reads:
```ts
    case 'hireWild':
    case 'endTurn':
    case 'storyChoice':
      return state;
```
  If Task 1's exhaustiveness fix already added `case 'storyChoice':` there (it had to, for the build to be green), leave it. If it is missing, add the `case 'storyChoice':` line to that group. No other pendingOp.ts change.

- [ ] **Step 4: Run test to verify it passes**
  - Command: `npx vitest run tests/engine/story-choice.test.ts`
  - Expect all 5 tests green.

- [ ] **Step 5: Run full gate + commit**
  - `npm test`  (full Vitest suite — must stay green; baseline 285 + new story tests)
  - `npx tsc --noEmit`  (the `storyChoice` case keeps `applyCommand` exhaustive and typed)
  - `npm run build`
  - Commit:
    ```
    git add src/engine/story/events.ts src/engine/turn.ts src/engine/pendingOp.ts tests/engine/story-choice.test.ts
    git commit -m "Story: applyStoryChoice + route storyChoice command immediately

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AQWRraNb7H8x364cBoskEU"
    ```

---

I have everything needed. Here is the Task 6 section.

---

### Task 6: Store wiring — story screens, advanceDays routing, resolveStoryChoice, loadGame resume, digest

**Files:**
- Modify `src/state/store.ts`:
  - Add import of `applyStoryChoice` (new top-level import, near the existing engine imports at lines 8–11).
  - Extend the `Screen` union (lines 25–37) with `story` / `briefing` / `chapterTransition`.
  - Add `'objective.completed'` to `DIGEST_KEYS` (lines 79–87).
  - Add a `pendingStoryEvent` routing branch inside `advanceDays` (after the `pendingBattle` branch, lines 134–144).
  - Add the new `resolveStoryChoice` action (place it right after `advanceDays`, before `dispatchPlayer` at line 160).
  - Add a `pendingStoryEvent` resume branch inside `loadGame` (replacing lines 345–346).
- Create `tests/state/story-store.test.ts` (new).

**Interfaces:**
- **Consumes (from earlier tasks):**
  - Task 1 — `GameState.objectives: ObjectiveState[]`, `GameState.pendingStoryEvent?: PendingStoryEvent`, `GameState.storyMode?: StoryMode`, and the `StrategicCommand` union member `{ kind: 'storyChoice'; eventId: string; choiceId: string }` (added to `src/engine/types.ts`); `buildInitialState` returning `objectives: []`; and the `applyCommand` / `summarizeForGeneral` switch cases for the new command (so `tsc` stays exhaustive — Task 6 never calls `applyCommand` for `storyChoice`, it only records it in `actionLog`).
  - Task 4 — `tickDays` (`src/engine/pendingOp.ts`) breaks its day-loop when `next.pendingStoryEvent` is set (the sibling guard beside `if (next.pendingBattle) break;` at line 213), so a game entering `advanceDays` with a pending story event does not advance a single day.
  - Task 4/5 — `storyEventsFor(scenarioId: string, storyMode?: StoryMode): StoryEvent[]` (created in Task 4) and `applyStoryChoice(state: GameState, eventId: string, choiceId: string): GameState` (added in Task 5), both from `src/engine/story/events.ts`.
- **Produces (later tasks / UI rely on these names verbatim):**
  - `Screen` variants `{ kind: 'story'; eventId: string }`, `{ kind: 'briefing' }`, `{ kind: 'chapterTransition' }` (consumed by `App.tsx` routing + `StoryEventModal`).
  - `resolveStoryChoice(eventId: string, choiceId: string): void` (called by `StoryEventModal` when the player picks a choice).
  - `advanceDays` routing to `{ kind: 'story', eventId }` and `loadGame` resume to the same screen (save/load-safe pause).

---

- [ ] **Step 1: Write the failing test**

Create `tests/state/story-store.test.ts` with the COMPLETE contents:

```ts
import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { storyEventsFor } from '../../src/engine/story/events.js';
import type { StoryMode } from '../../src/engine/story/types.js';
import {
  advanceDays,
  gameStore,
  loadGame,
  newGame,
  resolveStoryChoice,
} from '../../src/state/store.js';

const STORY_MODE: StoryMode = { protagonistFactionId: 'liubei', chapter: 1 };

describe('story store integration', () => {
  it('advanceDays routes to the story screen and freezes time when a story event is pending', () => {
    // Story Mode Chapter 1 game, then inject a pending story event so the
    // very next tick is owed to the player (mirrors how a fired StoryEvent
    // leaves GameState). tickDays must break immediately (Task 4 guard),
    // so no day/turn advances.
    newGame(SCENARIO_DONGZHUO, 'liubei', 1);
    gameStore.setState((s) => ({
      ...s,
      game: {
        ...s.game!,
        storyMode: STORY_MODE,
        pendingStoryEvent: { eventId: 'test-event', scenarioId: 's1-dongzhuo' },
      },
    }));
    const before = gameStore.getState().game!;

    advanceDays(30);

    const after = gameStore.getState();
    expect(after.ui.screen).toEqual({ kind: 'story', eventId: 'test-event' });
    // Time is frozen: the calendar and the pending event are untouched.
    expect(after.game!.turn).toBe(before.turn);
    expect(after.game!.day).toBe(before.day);
    expect(after.game!.pendingStoryEvent).toEqual({ eventId: 'test-event', scenarioId: 's1-dongzhuo' });
  });

  it('resolveStoryChoice applies the branch, records the command, clears the pending event, and returns to main', () => {
    // Use a real authored s1 choice-event so applyStoryChoice's lookup resolves.
    const choiceEvent = storyEventsFor('s1-dongzhuo', STORY_MODE).find((e) => e.choices.length > 0);
    expect(choiceEvent, 's1 must author at least one story choice-event').toBeDefined();
    const choice = choiceEvent!.choices[0];

    newGame(SCENARIO_DONGZHUO, 'liubei', 1);
    gameStore.setState((s) => ({
      ...s,
      game: {
        ...s.game!,
        storyMode: STORY_MODE,
        pendingStoryEvent: { eventId: choiceEvent!.id, scenarioId: 's1-dongzhuo' },
      },
      ui: { ...s.ui, screen: { kind: 'story', eventId: choiceEvent!.id } },
    }));
    const beforeActionLen = gameStore.getState().game!.actionLog.length;

    resolveStoryChoice(choiceEvent!.id, choice.id);

    const st = gameStore.getState();
    expect(st.game!.pendingStoryEvent).toBeUndefined();
    expect(st.ui.screen.kind).toBe('main');
    expect(st.game!.actionLog.length).toBe(beforeActionLen + 1);
    const last = st.game!.actionLog[st.game!.actionLog.length - 1];
    expect(last.command).toEqual({ kind: 'storyChoice', eventId: choiceEvent!.id, choiceId: choice.id });
    expect(last.factionId).toBe('liubei');
  });

  it('loadGame with a pending story event resumes on the story screen', () => {
    const base = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 7,
    });
    const game = {
      ...base,
      storyMode: STORY_MODE,
      pendingStoryEvent: { eventId: 'briefing-beat', scenarioId: 's1-dongzhuo' },
    };
    loadGame({ game, locale: 'zh' });
    expect(gameStore.getState().ui.screen).toEqual({ kind: 'story', eventId: 'briefing-beat' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Command:
```bash
npx vitest run tests/state/story-store.test.ts
```
Expected failure: the module fails to load / the tests error because `resolveStoryChoice` is not exported from `src/state/store.js` (TypeScript/Vitest: `resolveStoryChoice is not a function` / no matching export), and — even once compiled — `advanceDays` has no `pendingStoryEvent` branch so the first test's `ui.screen` stays `{ kind: 'main' }` instead of `{ kind: 'story', eventId: 'test-event' }`, and `loadGame` leaves the screen on `main` instead of `story`.

- [ ] **Step 3: Implement**

Edit `src/state/store.ts` with the following exact changes.

**(a)** Add the engine import. After the existing import block that ends at line 11 (`import { CONTINUOUS_SLOT, loadFromSlot, saveToSlot } from './persistence.js';`), insert a new line:

```ts
import { CONTINUOUS_SLOT, loadFromSlot, saveToSlot } from './persistence.js';
import { applyStoryChoice } from '../engine/story/events.js';
```

**(b)** Extend the `Screen` union (lines 25–37). Replace:

```ts
  | { kind: 'gameOver'; outcome: 'victory' | 'defeat' }
  | { kind: 'about' };
```

with:

```ts
  | { kind: 'gameOver'; outcome: 'victory' | 'defeat' }
  | { kind: 'about' }
  | { kind: 'story'; eventId: string }
  | { kind: 'briefing' } // Story-Mode opening briefing (reuses the StoryEvent modal in beat mode)
  | { kind: 'chapterTransition' }; // "...years pass" interstitial
```

**(c)** Add `'objective.completed'` to `DIGEST_KEYS`. Replace:

```ts
const DIGEST_KEYS = new Set<string>([
  'event.cityFell',
  'event.rebellion',
  'event.attackerRetreated',
  'event.guandongCoalition',
  'event.qianduChangan',
  'event.generalDied',
  'event.defected',
]);
```

with:

```ts
const DIGEST_KEYS = new Set<string>([
  'event.cityFell',
  'event.rebellion',
  'event.attackerRetreated',
  'event.guandongCoalition',
  'event.qianduChangan',
  'event.generalDied',
  'event.defected',
  'objective.completed',
]);
```

**(d)** Add the story-event routing branch in `advanceDays`. Replace this region (lines 134–144):

```ts
  if (next.pendingBattle) {
    const personalities: Record<string, Personality> = {};
    for (const f of Object.values(next.factions)) personalities[f.id] = f.personality;
    gameStore.setState((s) => ({
      ...s,
      game: next,
      battle: startSession(next.pendingBattle!, next.playerFactionId, personalities),
      ui: { ...s.ui, screen: { kind: 'battle' } },
    }));
    return;
  }
```

with:

```ts
  if (next.pendingBattle) {
    const personalities: Record<string, Personality> = {};
    for (const f of Object.values(next.factions)) personalities[f.id] = f.personality;
    gameStore.setState((s) => ({
      ...s,
      game: next,
      battle: startSession(next.pendingBattle!, next.playerFactionId, personalities),
      ui: { ...s.ui, screen: { kind: 'battle' } },
    }));
    return;
  }
  // A story event fired mid-advance and froze the tick (mirrors pendingBattle).
  // Commit the frozen state and route to the StoryEvent modal for a decision.
  if (next.pendingStoryEvent) {
    const eventId = next.pendingStoryEvent.eventId;
    gameStore.setState((s) => ({
      ...s,
      game: next,
      ui: { ...s.ui, screen: { kind: 'story', eventId } },
    }));
    return;
  }
```

**(e)** Add the `resolveStoryChoice` action. Insert it immediately after the closing brace of `advanceDays` (after line 154, before the `dispatchPlayer` comment at line 156):

```ts
// Resolve a pending story-event choice. Runs the branch's pure state change
// via the engine (which also clears pendingStoryEvent), records the decision
// on actionLog as a { kind:'storyChoice' } command so the branch is replayable
// and persisted, then returns to the main screen (or game-over if the branch
// happened to settle the scenario). Called by the StoryEventModal.
export function resolveStoryChoice(eventId: string, choiceId: string): void {
  const { game } = gameStore.getState();
  if (!game) return;
  const applied = applyStoryChoice(game, eventId, choiceId);
  const command: StrategicCommand = { kind: 'storyChoice', eventId, choiceId };
  const next: GameState = {
    ...applied,
    actionLog: [
      ...applied.actionLog,
      { turn: applied.turn, command, factionId: applied.playerFactionId },
    ],
  };
  const outcome = checkOutcome(next);
  gameStore.setState((s) => ({
    ...s,
    game: next,
    ui: outcome
      ? { ...s.ui, screen: { kind: 'gameOver', outcome } }
      : { ...s.ui, screen: { kind: 'main' } },
  }));
}
```

**(f)** Add the `loadGame` resume branch. Replace the tail of `loadGame` (lines 345–346):

```ts
  // If the restored game was mid-battle, resume the battle screen.
  if (gameStore.getState().game?.pendingBattle) enterPendingBattle();
```

with:

```ts
  // If the restored game was mid-battle or mid-story-event, resume that screen.
  const restored = gameStore.getState().game;
  if (restored?.pendingBattle) {
    enterPendingBattle();
  } else if (restored?.pendingStoryEvent) {
    setScreen({ kind: 'story', eventId: restored.pendingStoryEvent.eventId });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Command:
```bash
npx vitest run tests/state/story-store.test.ts
```
Expected: all three tests in `story store integration` pass.

- [ ] **Step 5: Run full gate + commit**

```bash
npm test
npx tsc --noEmit
npm run build
git add src/state/store.ts tests/state/story-store.test.ts
git commit -m "Wire story screens, story-event pause routing, and resolveStoryChoice into the store

Add Screen kinds story/briefing/chapterTransition, route advanceDays to the
StoryEvent modal when a fired story event freezes the tick, add resolveStoryChoice
(applies the branch via engine, records a storyChoice command, resumes),
resume pending story events on loadGame, and surface objective.completed in the digest.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AQWRraNb7H8x364cBoskEU"
```
Expected: full Vitest suite green (baseline 285 + 3 new), `tsc --noEmit` clean, `vite build` succeeds. THE SEAM (`resolveQuickBattle`, off-screen resolution) untouched — this task only adds a store action and UI routing.

---

### Task 7: StoryEventModal + Briefing + ChapterTransition UI + routing

**Files:**
- Create `src/web/screens/StoryEventModal.tsx` (new — exports `StoryEventModal`, `BriefingScreen`, `ChapterTransitionScreen`).
- Create `tests/web/StoryEventModal.test.tsx` (new).
- Modify `src/web/App.tsx` (add import after line 13; add three `case`s inside the `switch (screen.kind)` at lines 28–61).
- Modify `src/i18n/types.ts` (add three keys to the `MessageKey` union, immediately after `| 'app.quitConfirm'` at line 24).
- Modify `src/i18n/catalog/en.ts` and `src/i18n/catalog/zh.ts` (add the same three keys after the `'app.quitConfirm'` entry).

**Interfaces:**
- **Consumes (from Task 5 — `src/engine/story/types.ts` + `src/engine/story/events.ts`):** `findStoryEvent(scenarioId: string, storyMode: StoryMode | undefined, eventId: string): StoryEvent | undefined`; types `StoryEvent`, `StoryChoice`, `StoryMode`. **Consumes (from Task 6 — `src/state/store.ts`):** store action `resolveStoryChoice(eventId: string, choiceId: string): void`; the `Screen` union members `{ kind: 'story'; eventId: string }`, `{ kind: 'briefing' }`, `{ kind: 'chapterTransition' }`; the `GameState.storyMode?: StoryMode` and `GameState.scenarioId` fields. Also consumes existing exports: `setScreen`, `gameStore`, `newGame`, `setInitialLocale`; selectors `selectGame`, `selectScreen`, `selectLocale`; `t` (`src/i18n/locale.ts`); `useSession`, `useMenuKeys`.
- **Produces (later tasks rely on these exact names):** React components `StoryEventModal`, `BriefingScreen`, `ChapterTransitionScreen` (named exports from `src/web/screens/StoryEventModal.tsx`); the wired `App.tsx` routes for screen kinds `story`/`briefing`/`chapterTransition`; the three `MessageKey`s `'story.ch1.title'`, `'story.ch1.briefing'`, `'story.ch1.transition'` in both catalogs. Phase 2's briefing/objective wiring and Phase 3's chapter-transition re-seed build on these.

---

- [ ] **Step 1: Write the failing test** (complete file)

Create `tests/web/StoryEventModal.test.tsx`:

```tsx
import { describe, expect, it, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';

// Hoisted so the vi.mock factories (which hoist above imports) can reference
// them without a temporal-dead-zone error. CHOICE_EVENT is a 2-choice decision;
// BEAT_EVENT is a pure-narrative beat (no choices -> single "continue").
const { CHOICE_EVENT, BEAT_EVENT, resolveMock } = vi.hoisted(() => {
  const identity = (s: unknown): unknown => s;
  const CHOICE_EVENT = {
    id: 'test-choice',
    check: () => true,
    titleKey: 'story.ch1.title',
    bodyKey: 'story.ch1.briefing',
    choices: [
      { id: 'accept', labelKey: 'title.newGame', descKey: 'title.about', apply: identity },
      { id: 'decline', labelKey: 'title.loadGame', descKey: 'app.continue', apply: identity },
    ],
  };
  const BEAT_EVENT = {
    id: 'test-beat',
    check: () => true,
    titleKey: 'story.ch1.title',
    bodyKey: 'story.ch1.transition',
    choices: [],
  };
  return { CHOICE_EVENT, BEAT_EVENT, resolveMock: vi.fn() };
});

// Return a controlled event so this UI test never couples to authored content.
vi.mock('../../src/engine/story/events.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/story/events.js')>();
  return {
    ...actual,
    findStoryEvent: vi.fn((_scenarioId: string, _mode: unknown, eventId: string) =>
      eventId === 'test-beat' ? BEAT_EVENT : CHOICE_EVENT,
    ),
  };
});

// Spy on the store action while keeping gameStore + everything else real.
vi.mock('../../src/state/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state/store.js')>();
  return { ...actual, resolveStoryChoice: resolveMock };
});

import { StoryEventModal } from '../../src/web/screens/StoryEventModal.js';
import { gameStore, newGame, setInitialLocale } from '../../src/state/store.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { t } from '../../src/i18n/locale.js';
import type { StoryMode } from '../../src/engine/story/types.js';

beforeEach(() => {
  resolveMock.mockClear();
  setInitialLocale('zh');
  newGame(SCENARIO_DONGZHUO, 'liubei', 1);
  const storyMode: StoryMode = { protagonistFactionId: 'liubei', chapter: 1 };
  gameStore.setState((s) => ({
    ...s,
    game: s.game ? { ...s.game, storyMode } : s.game,
    ui: { ...s.ui, screen: { kind: 'story', eventId: 'test-choice' }, locale: 'zh' },
  }));
});

describe('StoryEventModal', () => {
  it('renders the event title, body, and both choice labels', () => {
    const { getByText } = render(<StoryEventModal />);
    expect(getByText(t('story.ch1.title'))).toBeInTheDocument();
    expect(getByText(t('story.ch1.briefing'))).toBeInTheDocument();
    expect(getByText(t('title.newGame'))).toBeInTheDocument(); // choice A label
    expect(getByText(t('title.loadGame'))).toBeInTheDocument(); // choice B label
  });

  it('clicking a choice dispatches resolveStoryChoice with the event + choice ids', () => {
    const { getByText } = render(<StoryEventModal />);
    fireEvent.click(getByText(t('title.loadGame'))); // choice B == 'decline'
    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(resolveMock).toHaveBeenCalledWith('test-choice', 'decline');
  });

  it('a narrative beat (no choices) shows a single continue that clears with empty choiceId', () => {
    gameStore.setState((s) => ({
      ...s,
      ui: { ...s.ui, screen: { kind: 'story', eventId: 'test-beat' } },
    }));
    const { getByText } = render(<StoryEventModal />);
    fireEvent.click(getByText(t('app.continue')));
    expect(resolveMock).toHaveBeenCalledWith('test-beat', '');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/web/StoryEventModal.test.tsx
```

Expected failure: the suite fails to collect because the module under test does not exist yet — an error like `Failed to load url ../../src/web/screens/StoryEventModal.js (resolved id: .../src/web/screens/StoryEventModal.js). Does the file exist?` (all three tests report as errored/failed).

- [ ] **Step 3: Implement**

**3a — Create `src/web/screens/StoryEventModal.tsx`** (complete file):

```tsx
import React, { useState } from 'react';
import { useSession } from '../hooks/useSession.js';
import { selectGame, selectScreen, selectLocale } from '../../state/selectors.js';
import { resolveStoryChoice, setScreen } from '../../state/store.js';
import { findStoryEvent } from '../../engine/story/events.js';
import type { StoryChoice } from '../../engine/story/types.js';
import { t } from '../../i18n/locale.js';
import { useMenuKeys } from '../hooks/useMenuKeys.js';

// Full-screen paper card that renders the pending StoryEvent addressed by the
// current { kind: 'story'; eventId } screen. A pure-narrative beat (choices: [])
// shows a single "continue"; a decision shows 1-3 choice buttons, each with a
// label and a one-line consequence preview. Selecting resolves via the store.
export const StoryEventModal: React.FC = () => {
  // Subscribe to locale so the modal re-renders when the language toggles.
  useSession(selectLocale);
  const screen = useSession(selectScreen);
  const game = useSession(selectGame);
  const [active, setActive] = useState(0);

  const eventId = screen.kind === 'story' ? screen.eventId : '';
  const event = game ? findStoryEvent(game.scenarioId, game.storyMode, eventId) : undefined;

  const isBeat = !event || event.choices.length === 0;
  const optionCount = isBeat ? 1 : event.choices.length;

  const select = (index: number): void => {
    if (isBeat) {
      // No branch to apply; resolveStoryChoice clears the pending event.
      resolveStoryChoice(eventId, '');
      return;
    }
    const choice = event.choices[index];
    if (choice) resolveStoryChoice(eventId, choice.id);
  };

  // Hooks must run unconditionally, so wire keyboard nav before any early return.
  useMenuKeys({ count: optionCount, active, setActive, onSelect: select });

  if (!event) return null;

  return (
    <div className="flex h-full w-full items-center justify-center px-6 py-10">
      <div className="panel w-full max-w-2xl p-8">
        <h2 className="font-serif text-3xl font-bold text-seal-700">{t(event.titleKey)}</h2>
        <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-ink-800">
          {t(event.bodyKey)}
        </p>
        <div className="mt-8 flex flex-col gap-3">
          {isBeat ? (
            <button
              className={`btn py-3 ${active === 0 ? 'btn-primary' : ''}`}
              onClick={() => select(0)}
            >
              {t('app.continue')}
            </button>
          ) : (
            event.choices.map((choice: StoryChoice, i: number) => (
              <button
                key={choice.id}
                className={`btn flex flex-col items-start gap-1 py-3 text-left ${
                  i === active ? 'btn-primary' : ''
                }`}
                onClick={() => {
                  setActive(i);
                  select(i);
                }}
              >
                <span className="font-serif text-lg font-semibold">{t(choice.labelKey)}</span>
                <span className="text-sm text-ink-600">{t(choice.descKey)}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// Story-Mode opening briefing — a narrative beat (single "continue") reading the
// protagonist chapter's briefing keys, then returns to the campaign map. Phase 1
// wires Chapter 1 only; later chapters extend the key lookup.
export const BriefingScreen: React.FC = () => {
  useSession(selectLocale);
  const [active, setActive] = useState(0);
  const onContinue = (): void => setScreen({ kind: 'main' });
  useMenuKeys({ count: 1, active, setActive, onSelect: onContinue });
  return (
    <div className="flex h-full w-full items-center justify-center px-6 py-10">
      <div className="panel w-full max-w-2xl p-8">
        <h2 className="font-serif text-3xl font-bold text-seal-700">{t('story.ch1.title')}</h2>
        <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-ink-800">
          {t('story.ch1.briefing')}
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <button className="btn btn-primary py-3" onClick={onContinue}>
            {t('app.continue')}
          </button>
        </div>
      </div>
    </div>
  );
};

// "...years pass" interstitial shown after a Story-Mode historic chapter win.
// Phase 1 wires the minimal version (Continue returns to the campaign map);
// Phase 3 replaces the action with a clean re-seed of the next chapter.
export const ChapterTransitionScreen: React.FC = () => {
  useSession(selectLocale);
  const [active, setActive] = useState(0);
  const onContinue = (): void => setScreen({ kind: 'main' });
  useMenuKeys({ count: 1, active, setActive, onSelect: onContinue });
  return (
    <div className="flex h-full w-full items-center justify-center px-6 py-10">
      <div className="panel w-full max-w-2xl p-8 text-center">
        <p className="whitespace-pre-line text-lg italic leading-relaxed text-ink-700">
          {t('story.ch1.transition')}
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <button className="btn btn-primary py-3" onClick={onContinue}>
            {t('app.continue')}
          </button>
        </div>
      </div>
    </div>
  );
};
```

**3b — Modify `src/web/App.tsx`.** Add the import after the `BattleScreen` import (line 13):

```tsx
import { StoryEventModal, BriefingScreen, ChapterTransitionScreen } from './screens/StoryEventModal.js';
```

Then, inside `switch (screen.kind)`, add three cases immediately after the existing `case 'battle':` block (before `default:`):

```tsx
    case 'story':
      body = <StoryEventModal />;
      break;
    case 'briefing':
      body = <BriefingScreen />;
      break;
    case 'chapterTransition':
      body = <ChapterTransitionScreen />;
      break;
```

**3c — Modify `src/i18n/types.ts`.** In the `MessageKey` union, insert after `| 'app.quitConfirm'` (line 24):

```ts
  // Story campaign — chapter framing (briefing / transition)
  | 'story.ch1.title'
  | 'story.ch1.briefing'
  | 'story.ch1.transition'
```

**3d — Modify `src/i18n/catalog/en.ts`.** After the `'app.quitConfirm': 'Quit the game?',` line, add:

```ts
  'story.ch1.title': 'The Tyrant\'s Shadow',
  'story.ch1.briefing':
    'You are Liu Bei, magistrate of Pingyuan — one city, and two sworn brothers, Guan Yu and Zhang Fei, at your side. The Han crumbles as the tyrant Dong Zhuo holds the boy-emperor hostage and bleeds the realm. You are a man of humble birth but boundless purpose: in a world turned to chaos, a name built on virtue may yet raise a dynasty.',
  'story.ch1.transition':
    'The warlords rise, and the Han\'s mandate flickers low. From a commoner\'s beginnings you have carved a name into a world of chaos. The winds shift, and the years slip swiftly by…',
```

**3e — Modify `src/i18n/catalog/zh.ts`.** After the `'app.quitConfirm': '确认退出?',` line, add:

```ts
  'story.ch1.title': '董卓弄权',
  'story.ch1.briefing':
    '你是平原县令刘备，坐拥一城，身边只有关羽、张飞两位结义兄弟。汉室倾颓，董卓挟天子以令诸侯，暴虐四海。你出身寒微，却胸怀匡扶社稷之志——乱世将起，正是仁义立名之时。',
  'story.ch1.transition':
    '群雄纷起，汉祚将倾。你以一介布衣立身乱世，名已初显。风云变幻，数载春秋倏忽而过……',
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/web/StoryEventModal.test.tsx
```

Expected: all 3 tests pass.

- [ ] **Step 5: Run full gate + commit**

```bash
npm test
npx tsc --noEmit
npm run build
```

All must be green (full suite passes including `tests/i18n/parity.test.ts`, which now sees the three new keys present and non-empty in both catalogs). Then commit:

```bash
git add src/web/screens/StoryEventModal.tsx tests/web/StoryEventModal.test.tsx src/web/App.tsx src/i18n/types.ts src/i18n/catalog/en.ts src/i18n/catalog/zh.ts
git commit -m "$(cat <<'EOF'
Add StoryEventModal + Briefing/ChapterTransition screens and routing

Renders pending story events (title/body + 1-3 choice buttons or a
narrative-beat continue), dispatching resolveStoryChoice; wires briefing
and chapter-transition beats and their App routes; adds Chapter 1 framing
i18n keys (zh + en).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AQWRraNb7H8x364cBoskEU
EOF
)"
```

---

### Task 8: Objectives HUD on the campaign map

**Files:**
- Create `src/web/components/ObjectivesHud.tsx`
- Create (test) `tests/web/ObjectivesHud.test.tsx`
- Modify `src/web/screens/MainScreen.tsx` (add import after line 21 `import { FloatingPanel } ...`; mount the HUD after the `FactionPanel` `FloatingPanel` block that ends at line 348)
- Modify `src/i18n/types.ts` (add one `MessageKey` alongside the `objective.*` keys created in Task 2)
- Modify `src/i18n/catalog/en.ts` and `src/i18n/catalog/zh.ts` (add the matching `objective.heading` entry to each — parity-tested)

**Interfaces:**
- **Consumes** — Task 1 (`src/engine/story/types.ts`): `ObjectiveDef` (`id`, `titleKey`, `descKey`, `hidden?`), `ObjectiveState` (`id`, `status`, `completedTurn?`), `StoryMode`; and the `GameState` fields `objectives: ObjectiveState[]` + `storyMode?: StoryMode` + existing `scenarioId: string`. Task 2 (`src/engine/story/objectives.ts`): `objectivesFor(scenarioId: string, storyMode?: StoryMode): ObjectiveDef[]`, plus the authored `objective.*` title/description `MessageKey`s.
- **Produces** — `ObjectivesHud: React.FC<{ game: GameState }>` (default export path `src/web/components/ObjectivesHud.js`), consumed only by `MainScreen`. New user-facing `MessageKey` `'objective.heading'`. No engine/state contract; nothing downstream depends on it.

---

- [ ] **Step 1: Write the failing test** (complete file `tests/web/ObjectivesHud.test.tsx`)

```tsx
import { describe, expect, it } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ObjectivesHud } from '../../src/web/components/ObjectivesHud.js';
import { objectivesFor } from '../../src/engine/story/objectives.js';
import { newGame, gameStore } from '../../src/state/store.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { t } from '../../src/i18n/locale.js';
import type { GameState } from '../../src/engine/types.js';
import type { ObjectiveState, StoryMode } from '../../src/engine/story/types.js';

describe('ObjectivesHud', () => {
  it('lists active objectives and marks the completed one', () => {
    // A real Liu Bei Chapter 1 game gives us a valid base GameState to clone.
    newGame(SCENARIO_DONGZHUO, 'liubei', 1);
    const base = gameStore.getState().game as GameState;

    // Drive the HUD from the scenario's real objective definitions so the
    // test tracks whatever content Task 2 authored (no hard-coded key names).
    // Filter out hidden defs — the HUD never renders those.
    const storyMode: StoryMode = { protagonistFactionId: 'liubei', chapter: 1 };
    const defs = objectivesFor(SCENARIO_DONGZHUO.id, storyMode).filter((d) => !d.hidden);
    expect(defs.length).toBeGreaterThanOrEqual(3);
    const [first, second, third] = defs;

    // Two active + one complete.
    const objectives: ObjectiveState[] = [
      { id: first.id, status: 'active' },
      { id: second.id, status: 'active' },
      { id: third.id, status: 'complete', completedTurn: 4 },
    ];
    const game: GameState = { ...base, scenarioId: SCENARIO_DONGZHUO.id, storyMode, objectives };

    render(<ObjectivesHud game={game} />);
    // The panel is a collapsed pill (FloatingPanel) — its only button is the
    // toggle. Expand it to reveal the objective list.
    fireEvent.click(screen.getByRole('button'));

    // Both active objectives are listed by title, with no completion check.
    const firstTitle = screen.getByText(t(first.titleKey));
    const secondTitle = screen.getByText(t(second.titleKey));
    expect(firstTitle.closest('li')).not.toHaveTextContent('✓');
    expect(secondTitle.closest('li')).not.toHaveTextContent('✓');

    // The completed objective is listed and marked with a check.
    const thirdTitle = screen.getByText(t(third.titleKey));
    expect(thirdTitle.closest('li')).toHaveTextContent('✓');

    // The pill header shows a 1/3 completed-of-total count.
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Command: `npx vitest run tests/web/ObjectivesHud.test.tsx`

Expected failure: the run errors during module resolution before any assertion — `Failed to resolve import "../../src/web/components/ObjectivesHud.js"` (the component file does not exist yet). The suite reports the file as failed to collect.

- [ ] **Step 3: Implement**

First, add the panel-heading string. In `src/i18n/types.ts`, add `'objective.heading'` to the `MessageKey` union immediately after the last `objective.*` key introduced in Task 2 (keep all `objective.*` keys contiguous):

```ts
  | 'objective.heading'
```

In `src/i18n/catalog/en.ts`, add alongside the other `objective.*` entries:

```ts
  'objective.heading': 'Objectives',
```

In `src/i18n/catalog/zh.ts`, add alongside the other `objective.*` entries:

```ts
  'objective.heading': '目标',
```

Create `src/web/components/ObjectivesHud.tsx` (complete file):

```tsx
import React from 'react';
import { FloatingPanel } from './FloatingPanel.js';
import { objectivesFor } from '../../engine/story/objectives.js';
import type { GameState } from '../../engine/types.js';
import type { ObjectiveDef, ObjectiveState } from '../../engine/story/types.js';
import { t } from '../../i18n/locale.js';

// A resolved objective ready to render: its runtime state joined with its
// static definition (the title/description message keys).
interface ResolvedObjective {
  state: ObjectiveState;
  def: ObjectiveDef;
}

// Compact "story-guided" HUD on the campaign map. Reads the runtime
// game.objectives, joins each against its ObjectiveDef (looked up by the
// active scenario + story mode), and lists the non-hidden ones — active
// objectives plain, completed ones marked with a check. Collapsed to a pill
// by default (FloatingPanel), matching the other floating map HUD badges.
export const ObjectivesHud: React.FC<{ game: GameState }> = ({ game }) => {
  const defs = objectivesFor(game.scenarioId, game.storyMode);
  const byId = new Map<string, ObjectiveDef>(defs.map((d) => [d.id, d]));
  const items: ResolvedObjective[] = [];
  for (const state of game.objectives) {
    const def = byId.get(state.id);
    // Skip objectives with no matching definition, and hidden ones (not
    // surfaced in the HUD until unlocked).
    if (!def || def.hidden) continue;
    items.push({ state, def });
  }
  // Nothing to guide the player with (e.g. Free Play with no objectives).
  if (items.length === 0) return null;
  const done = items.filter((it) => it.state.status === 'complete').length;
  return (
    <FloatingPanel
      position="left-1/2 top-3 -translate-x-1/2"
      bodyClass="w-80 max-h-[46vh]"
      title={
        <span className="flex items-center gap-1.5">
          <span aria-hidden>◈</span>
          <span>{t('objective.heading')}</span>
          <span className="font-mono text-[10px] text-ink-400">
            {done}/{items.length}
          </span>
        </span>
      }
    >
      <ul className="space-y-1 bg-parchment-100/95 p-2 text-sm">
        {items.map(({ state, def }) => {
          const complete = state.status === 'complete';
          return (
            <li key={def.id} className="flex items-start gap-2">
              <span className={complete ? 'text-seal-600' : 'text-ink-400'} aria-hidden>
                {complete ? '✓' : '○'}
              </span>
              <span className="flex flex-col">
                <span
                  className={
                    complete ? 'text-ink-500 line-through' : 'font-semibold text-ink-800'
                  }
                >
                  {t(def.titleKey)}
                </span>
                <span className="text-[11px] text-ink-500">{t(def.descKey)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </FloatingPanel>
  );
};
```

Wire it into the map. In `src/web/screens/MainScreen.tsx`, add the import after the `FloatingPanel` import (line 21):

```tsx
import { ObjectivesHud } from '../components/ObjectivesHud.js';
```

Then mount the HUD immediately after the `FactionPanel` `FloatingPanel` block (which currently ends at line 348, `</FloatingPanel>`):

```tsx
      {/* Story objectives — the "story-guided" surface. Renders nothing in
          Free Play, where no objectives are seeded. */}
      <ObjectivesHud game={game} />
```

- [ ] **Step 4: Run test to verify it passes**

Command: `npx vitest run tests/web/ObjectivesHud.test.tsx`

Expected: 1 passed.

- [ ] **Step 5: Run full gate + commit**

```bash
npm test
npx tsc --noEmit
npm run build
git add src/web/components/ObjectivesHud.tsx tests/web/ObjectivesHud.test.tsx \
        src/web/screens/MainScreen.tsx src/i18n/types.ts \
        src/i18n/catalog/en.ts src/i18n/catalog/zh.ts
git commit -m "$(cat <<'EOF'
Add Objectives HUD to the campaign map

Compact collapsible panel (top-center pill → list) that joins
game.objectives with objectivesFor(scenarioId, storyMode) and shows
active objectives plus a check on completed ones. Renders nothing in
Free Play. New bilingual key objective.heading.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AQWRraNb7H8x364cBoskEU
EOF
)"
```

Expected: full Vitest suite green (baseline + the new `ObjectivesHud` test + i18n parity still passing with the added `objective.heading` in both catalogs), `tsc --noEmit` clean, `vite build` succeeds.

---

### Task 9: Title Story/Free-Play split + launch Liu Bei Ch.1 briefing

**Files:**
- Modify `src/i18n/types.ts` — add `'title.storyMode'` and `'title.freePlay'` to the `MessageKey` union's "Title screen" block (after `'title.newGame'`, line 27).
- Modify `src/i18n/catalog/en.ts` — add the two new keys (after `'title.newGame'`, line 16).
- Modify `src/i18n/catalog/zh.ts` — add the two new keys (after `'title.newGame'`, line 16).
- Modify `src/state/store.ts` — add two imports (after the existing `buildInitialState` import at line 8) and a new `startStoryMode()` export (after `newGame`, line 111).
- Modify `src/web/screens/TitleScreen.tsx` — widen the `Option` union (lines 8-12), rebuild the `options` array (lines 18-22), retarget the primary-button highlight (line 63), and import `startStoryMode` (line 2).
- Modify `tests/web/App.test.tsx` — update the three assertions that reference the old `'新游戏'` / `'New Game'` label (lines 23, 30, 44, 46) to the new Free-Play labels, since Task 9 renames that button.
- Create `tests/web/TitleScreen.test.tsx` — the new failing test.

**Interfaces:**
- **Consumes:**
  - Task 1 — `GameState.storyMode?: StoryMode` and `GameState.objectives: ObjectiveState[]` fields; the `StoryMode = { protagonistFactionId: FactionId; chapter: 1 | 2 | 3 | 4 }` type.
  - Task 2 — `seedObjectives(state: GameState): GameState` exported from `src/engine/story/objectives.js`; `objectivesFor('s1-dongzhuo', storyMode)` returns ≥1 Chapter-1 objective for the Liu Bei arc (so the seeded `objectives` array is non-empty).
  - Task 6/7 — the `Screen` union already contains `{ kind: 'briefing' }` and `{ kind: 'story'; eventId: string }`, and `App.tsx` routes `screen.kind === 'briefing'` to the opening-briefing modal.
- **Produces:**
  - `export function startStoryMode(): void` in `src/state/store.ts` — builds `s1-dongzhuo` with `playerFactionId='liubei'`, sets `game.storyMode={protagonistFactionId:'liubei',chapter:1}`, seeds objectives, registers AI agents for every non-protagonist faction, and routes the UI to `{ kind: 'briefing' }`.
  - `MessageKey`s `'title.storyMode'` and `'title.freePlay'` (present in both catalogs).

- [ ] **Step 1: Write the failing test**

Create `tests/web/TitleScreen.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TitleScreen } from '../../src/web/screens/TitleScreen.js';
import { gameStore, startStoryMode, setInitialLocale } from '../../src/state/store.js';

beforeEach(() => {
  // Reset to a clean title screen (zh locale) before each test.
  gameStore.setState((s) => ({
    ...s,
    game: null,
    agents: {},
    ui: { ...s.ui, screen: { kind: 'title' }, locale: 'zh', selectedCityId: null },
  }));
  setInitialLocale('zh');
});

describe('startStoryMode (store)', () => {
  it('launches Liu Bei Chapter 1: sets storyMode, seeds objectives, routes to briefing', () => {
    startStoryMode();
    const st = gameStore.getState();
    expect(st.game).not.toBeNull();
    expect(st.game!.playerFactionId).toBe('liubei');
    expect(st.game!.storyMode).toEqual({ protagonistFactionId: 'liubei', chapter: 1 });
    // Task 2 seeds at least one active Chapter-1 objective for the Liu Bei arc.
    expect(st.game!.objectives.length).toBeGreaterThan(0);
    expect(st.game!.objectives.every((o) => o.status === 'active')).toBe(true);
    // Opening briefing is shown before the campaign map.
    expect(st.ui.screen).toEqual({ kind: 'briefing' });
  });

  it('registers AI agents for every non-protagonist faction', () => {
    startStoryMode();
    const st = gameStore.getState();
    expect(st.agents['liubei']).toBeUndefined();
    expect(Object.keys(st.agents).length).toBeGreaterThan(0);
  });

  it('is deterministic: two launches produce identical starting state', () => {
    startStoryMode();
    const first = gameStore.getState().game!;
    startStoryMode();
    const second = gameStore.getState().game!;
    expect(second.turn).toBe(first.turn);
    expect(second.objectives).toEqual(first.objectives);
  });
});

describe('TitleScreen story / free-play split', () => {
  it('lists Story Mode as the first entry and Free Play as the second', () => {
    render(<TitleScreen />);
    expect(screen.getByRole('button', { name: '剧情模式' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '自由模式' })).toBeInTheDocument();
    // The old "新游戏" label no longer appears.
    expect(screen.queryByRole('button', { name: '新游戏' })).toBeNull();
  });

  it('clicking Story Mode launches the campaign and routes to the briefing', () => {
    render(<TitleScreen />);
    fireEvent.click(screen.getByRole('button', { name: '剧情模式' }));
    const st = gameStore.getState();
    expect(st.game!.storyMode).toEqual({ protagonistFactionId: 'liubei', chapter: 1 });
    expect(st.ui.screen).toEqual({ kind: 'briefing' });
  });

  it('clicking Free Play routes to scenario select without starting a game', () => {
    render(<TitleScreen />);
    fireEvent.click(screen.getByRole('button', { name: '自由模式' }));
    const st = gameStore.getState();
    expect(st.ui.screen).toEqual({ kind: 'scenarioSelect' });
    expect(st.game).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Command:
```bash
npx vitest run tests/web/TitleScreen.test.tsx
```
Expected failure: the module fails to evaluate because `src/state/store.ts` does not export `startStoryMode` — Vitest reports `SyntaxError: The requested module '../../src/state/store.js' does not provide an export named 'startStoryMode'`, failing the whole suite. (Even once the export exists but before the TitleScreen edit, the `'剧情模式'` / `'自由模式'` button lookups would throw `Unable to find role="button"`.)

- [ ] **Step 3: Implement**

**3a. `src/i18n/types.ts`** — extend the Title-screen block (keep `title.newGame` so nothing else breaks):

```ts
  // Title screen
  | 'title.newGame'
  | 'title.storyMode'
  | 'title.freePlay'
  | 'title.loadGame'
  | 'title.about'
  | 'title.quit'
```

**3b. `src/i18n/catalog/en.ts`** — add after the `'title.newGame'` entry (line 16):

```ts
  'title.storyMode': 'Story Mode',
  'title.freePlay': 'Free Play',
```

**3c. `src/i18n/catalog/zh.ts`** — add after the `'title.newGame'` entry (line 16):

```ts
  'title.storyMode': '剧情模式',
  'title.freePlay': '自由模式',
```

**3d. `src/state/store.ts`** — add two imports directly after the existing `buildInitialState` import (line 8):

```ts
import { SCENARIO_DONGZHUO } from '../data/scenarios/s1-dongzhuo.js';
import { seedObjectives } from '../engine/story/objectives.js';
```

Then add the new export immediately after `newGame` (i.e. after line 111, the closing `}` of `newGame`):

```ts
// Launch the guided Story Mode campaign at Liu Bei's Chapter 1. Builds the
// Chapter-1 scenario (s1-dongzhuo) with Liu Bei as the player faction, tags
// the game with storyMode so objective tables / briefings / choice-events
// become protagonist-specific, seeds the chapter's objectives, wires up AI
// agents for every other faction, and opens the opening briefing before the
// campaign map. A fixed seed keeps the launch deterministic.
export function startStoryMode(): void {
  const scenario = SCENARIO_DONGZHUO;
  const built = buildInitialState({
    scenario,
    playerFactionId: 'liubei',
    refData: REF_DATA,
    seed: 1,
  });
  const withStory: GameState = {
    ...built,
    storyMode: { protagonistFactionId: 'liubei', chapter: 1 },
  };
  const game = seedObjectives(withStory);
  const agents: Record<string, FactionAgent> = {};
  for (const f of scenario.factions) {
    if (f.id === 'liubei') continue;
    agents[f.id] = makeDefaultAgent(f.id, f.personality);
  }
  gameStore.setState((s) => ({
    ...s,
    game,
    agents,
    ui: { ...initialUI, screen: { kind: 'briefing' }, locale: s.ui.locale },
  }));
}
```

**3e. `src/web/screens/TitleScreen.tsx`** — replace the whole file with:

```tsx
import React, { useState } from 'react';
import { setScreen, startStoryMode, toggleLocale } from '../../state/store.js';
import { t } from '../../i18n/locale.js';
import { useSession } from '../hooks/useSession.js';
import { selectLocale } from '../../state/selectors.js';
import { useMenuKeys } from '../hooks/useMenuKeys.js';

interface Option {
  id: 'story' | 'new' | 'load' | 'about';
  key: 'title.storyMode' | 'title.freePlay' | 'title.loadGame' | 'title.about';
  action: () => void;
}

export const TitleScreen: React.FC = () => {
  useSession(selectLocale);
  const [active, setActive] = useState(0);

  const options: Option[] = [
    { id: 'story', key: 'title.storyMode', action: () => startStoryMode() },
    { id: 'new', key: 'title.freePlay', action: () => setScreen({ kind: 'scenarioSelect' }) },
    { id: 'load', key: 'title.loadGame', action: () => setScreen({ kind: 'load' }) },
    { id: 'about', key: 'title.about', action: () => setScreen({ kind: 'about' }) },
  ];

  useMenuKeys({
    count: options.length,
    active,
    setActive,
    onSelect: (i) => options[i]?.action(),
  });

  // Allow 'g' to toggle the locale even before entering a game.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'g') {
        e.preventDefault();
        toggleLocale();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-8 px-6 py-10">
      <div className="relative w-full max-w-xl text-center">
        <div className="font-display text-[10px] uppercase tracking-[0.4em] text-ink-500">
          A Tribute to <em>Three Kingdoms Hegemony</em>
        </div>
        <h1 className="mt-2 font-serif text-6xl font-bold leading-none text-seal-700 drop-shadow-sm">
          三 国
        </h1>
        <div className="mt-2 font-display text-base tracking-[0.3em] text-ink-700">
          THREE KINGDOMS
        </div>
        <div className="mt-3 text-sm italic text-ink-600">{t('app.subtitle')}</div>
      </div>

      <nav className="flex w-64 flex-col gap-3">
        {options.map((opt, i) => (
          <button
            key={opt.id}
            className={`btn py-2 ${
              i === active ? (opt.id === 'story' ? 'btn-primary' : 'ring-2 ring-seal-500/50') : ''
            }`}
            onClick={() => {
              setActive(i);
              opt.action();
            }}
          >
            {t(opt.key)}
          </button>
        ))}
        <button className="btn btn-ghost" onClick={toggleLocale}>
          中 / EN (g)
        </button>
      </nav>

      <div className="font-mono text-[10px] text-ink-500">
        ↑↓ / j k · Enter · g · ?
      </div>
    </div>
  );
};
```

**3f. `tests/web/App.test.tsx`** — the Free-Play rename retires the `'新游戏'` / `'New Game'` label, so update the four affected assertions:

- Line 23: `expect(screen.getByRole('button', { name: '新游戏' })).toBeInTheDocument();` → `expect(screen.getByRole('button', { name: '自由模式' })).toBeInTheDocument();`
- Line 30: `fireEvent.click(screen.getByRole('button', { name: '新游戏' }));` → `fireEvent.click(screen.getByRole('button', { name: '自由模式' }));`
- Line 44: `expect(screen.getByText('新游戏')).toBeInTheDocument();` → `expect(screen.getByText('自由模式')).toBeInTheDocument();`
- Line 46: `expect(screen.getByRole('button', { name: 'New Game' })).toBeInTheDocument();` → `expect(screen.getByRole('button', { name: 'Free Play' })).toBeInTheDocument();`

- [ ] **Step 4: Run test to verify it passes**

Command:
```bash
npx vitest run tests/web/TitleScreen.test.tsx
```
Expected: all cases in both `describe` blocks pass.

- [ ] **Step 5: Run full gate + commit**

```bash
npm test
npx tsc --noEmit
npm run build
```
All three must be green (parity test confirms `title.storyMode` / `title.freePlay` exist in both catalogs; `App.test.tsx` passes with the relabeled buttons). Then commit:

```bash
git add src/i18n/types.ts src/i18n/catalog/en.ts src/i18n/catalog/zh.ts \
        src/state/store.ts src/web/screens/TitleScreen.tsx \
        tests/web/TitleScreen.test.tsx tests/web/App.test.tsx
git commit -m "$(cat <<'EOF'
Add Title Story/Free-Play split + startStoryMode launching Liu Bei Ch.1 briefing

Story Mode is now the first Title entry; it builds s1-dongzhuo as Liu Bei,
tags game.storyMode, seeds Chapter-1 objectives, and opens the opening
briefing. The old "New Game" becomes "Free Play" (unchanged scenario-select
flow). Adds title.storyMode / title.freePlay to both i18n catalogs.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AQWRraNb7H8x364cBoskEU
EOF
)"
```

---

### Task 10: Scenario-1 vertical-slice content — Liu Bei Ch.1 objectives + the Xuzhou choice-event + i18n

**Files:**
- Create `src/data/story/s1-liubei.ts` (the real Ch.1 `ObjectiveDef[]` + `StoryEvent[]`).
- Modify `src/engine/story/objectives.ts` — `objectivesFor(...)` (created as a stub in Task 2): add import + the `s1-dongzhuo`/`liubei` branch, after the TEST-ONLY override check (test-hook precedence stays intact).
- Modify `src/engine/story/events.ts` — `storyEventsFor(...)` (created as a stub in Task 4): add import + the `s1-dongzhuo`/`liubei` branch, keeping the test-overlay merge intact. (`findStoryEvent` already delegates to `storyEventsFor` — no change.)
- Modify `src/i18n/types.ts` — append 14 `MessageKey` union members after the final member `| 'digest.dismiss';` (@362).
- Modify `src/i18n/catalog/en.ts` — add 14 entries after `'digest.dismiss': 'Continue',` (before the closing `};`).
- Modify `src/i18n/catalog/zh.ts` — add 14 entries after `'digest.dismiss': '继续',` (before the closing `};`).
- Create `tests/engine/story/s1-liubei.test.ts`.

**Interfaces:**
- **Consumes** — Task 1 `src/engine/story/types.ts`: `ObjectiveDef`, `StoryEvent`, `StoryChoice`, `StoryMode`; `GameState.objectives: ObjectiveState[]` (+ `buildInitialState` seeding it to `[]`). Task 2 `src/engine/story/objectives.ts`: `objectivesFor(scenarioId, storyMode?)`, `seedObjectives(state)` (reads `state.storyMode`, sets `state.objectives` active). Task 4 `src/engine/story/events.ts`: `storyEventsFor(scenarioId, storyMode?)`, `findStoryEvent`, and the `runScenarioEvents` extension that fires `storyEventsFor(...)` (with `applyStoryChoice` added in Task 5). Existing: `buildInitialState` (`src/engine/scenario.ts`), `REF_DATA` (`src/data/index.ts`), `SCENARIO_DONGZHUO` (`src/data/scenarios/s1-dongzhuo.ts`). Note: `'objective.completed'` MessageKey is added by Task 2; `title.storyMode`/`title.freePlay` by the Title task; briefing/transition/`chapter.*` keys by the briefing/transition tasks — this task must NOT redeclare them.
- **Produces** — `S1_LIUBEI_OBJECTIVES: ObjectiveDef[]` (ids `'coalition'`,`'zhaoyun'`,`'xuzhouAid'`,`'foundation'`) and `S1_LIUBEI_EVENTS: StoryEvent[]` (event id `'xuzhou_bequest'`, choice ids `'accept'`/`'decline'`). The decision is recorded via `EventRecord` ids `'xuzhou_accepted'` / `'xuzhou_declined'` in `state.events` (consumed by the `foundation` objective, by re-fire guards, and by any `historic`-victory check). 14 new `MessageKey`s: `objective.s1.{coalition,zhaoyun,xuzhouAid,foundation}.{title,desc}`, `story.s1.xuzhou.{title,body}`, `choice.s1.xuzhou.{accept,decline}.{label,desc}`.

- [ ] **Step 1: Write the failing test**

Create `tests/engine/story/s1-liubei.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../../src/engine/types.js';
import type { StoryMode } from '../../../src/engine/story/types.js';
import { objectivesFor, seedObjectives } from '../../../src/engine/story/objectives.js';
import { storyEventsFor } from '../../../src/engine/story/events.js';
import { buildInitialState } from '../../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../../src/data/index.js';

const LIUBEI_MODE: StoryMode = { protagonistFactionId: 'liubei', chapter: 1 };

function baseState(): GameState {
  // Tao Qian starts holding xiapi, pengcheng, xiaopei (Xuzhou); Liu Bei holds
  // only pingyuan; Zhao Yun starts under Gongsun Zan.
  return buildInitialState({
    scenario: SCENARIO_DONGZHUO,
    playerFactionId: 'liubei',
    refData: REF_DATA,
    seed: 1,
  });
}

describe('Scenario 1 — Liu Bei Chapter 1 content', () => {
  it('objectivesFor returns the four Chapter 1 objectives, in order, all required', () => {
    const defs = objectivesFor('s1-dongzhuo', LIUBEI_MODE);
    expect(defs.map((d) => d.id)).toEqual(['coalition', 'zhaoyun', 'xuzhouAid', 'foundation']);
    for (const d of defs) {
      expect(d.optional).toBeFalsy();
      expect(typeof d.titleKey).toBe('string');
      expect(typeof d.descKey).toBe('string');
    }
  });

  it('returns no story objectives for Free Play or a non-protagonist faction', () => {
    expect(objectivesFor('s1-dongzhuo', undefined)).toEqual([]);
    expect(objectivesFor('s1-dongzhuo', { protagonistFactionId: 'caocao', chapter: 1 })).toEqual([]);
  });

  it('seedObjectives seeds four active objective states', () => {
    const state: GameState = { ...baseState(), storyMode: LIUBEI_MODE };
    const seeded = seedObjectives(state);
    expect(seeded.objectives.map((o) => o.id)).toEqual(['coalition', 'zhaoyun', 'xuzhouAid', 'foundation']);
    expect(seeded.objectives.every((o) => o.status === 'active')).toBe(true);
  });

  it('each objective check flips true only when its condition is met', () => {
    const defs = objectivesFor('s1-dongzhuo', LIUBEI_MODE);
    const byId = Object.fromEntries(defs.map((d) => [d.id, d]));
    const base = baseState();

    // coalition: needs the guandong_coalition event to have fired
    expect(byId['coalition'].check(base)).toBe(false);
    const afterCoalition: GameState = {
      ...base,
      events: [...base.events, { id: 'guandong_coalition', turn: 1, year: 189, month: 10 }],
    };
    expect(byId['coalition'].check(afterCoalition)).toBe(true);

    // zhaoyun: Zhao Yun joins Liu Bei
    expect(byId['zhaoyun'].check(base)).toBe(false);
    const afterZhaoyun: GameState = {
      ...base,
      generals: { ...base.generals, zhaoyun: { ...base.generals['zhaoyun'], factionId: 'liubei' } },
    };
    expect(byId['zhaoyun'].check(afterZhaoyun)).toBe(true);

    // xuzhouAid: Liu Bei holds any Xuzhou city
    expect(byId['xuzhouAid'].check(base)).toBe(false);
    const afterAid: GameState = {
      ...base,
      cities: { ...base.cities, xiapi: { ...base.cities['xiapi'], factionId: 'liubei' } },
    };
    expect(byId['xuzhouAid'].check(afterAid)).toBe(true);

    // foundation: the bequest has been resolved
    expect(byId['foundation'].check(base)).toBe(false);
    const afterDecision: GameState = {
      ...base,
      events: [...base.events, { id: 'xuzhou_accepted', turn: 5, year: 190, month: 4 }],
    };
    expect(byId['foundation'].check(afterDecision)).toBe(true);
  });

  it('the Xuzhou bequest event checks true only once Liu Bei holds a Xuzhou city', () => {
    const bequest = storyEventsFor('s1-dongzhuo', LIUBEI_MODE).find((e) => e.id === 'xuzhou_bequest');
    expect(bequest).toBeDefined();
    expect(bequest!.choices.map((c) => c.id)).toEqual(['accept', 'decline']);

    const base = baseState();
    expect(bequest!.check(base)).toBe(false);
    const aided: GameState = {
      ...base,
      cities: { ...base.cities, xiaopei: { ...base.cities['xiaopei'], factionId: 'liubei' } },
    };
    expect(bequest!.check(aided)).toBe(true);
  });

  it('Accept transfers every Xuzhou city to Liu Bei and records the decision', () => {
    const bequest = storyEventsFor('s1-dongzhuo', LIUBEI_MODE).find((e) => e.id === 'xuzhou_bequest')!;
    const accept = bequest.choices.find((c) => c.id === 'accept')!;
    const next = accept.apply(baseState());
    expect(next.cities['xiapi'].factionId).toBe('liubei');
    expect(next.cities['pengcheng'].factionId).toBe('liubei');
    expect(next.cities['xiaopei'].factionId).toBe('liubei');
    expect(next.events.some((e) => e.id === 'xuzhou_accepted')).toBe(true);
  });

  it('Decline gives Liu Bei only Xiaopei and leaves the rest of Xuzhou to Tao Qian', () => {
    const bequest = storyEventsFor('s1-dongzhuo', LIUBEI_MODE).find((e) => e.id === 'xuzhou_bequest')!;
    const decline = bequest.choices.find((c) => c.id === 'decline')!;
    const next = decline.apply(baseState());
    expect(next.cities['xiaopei'].factionId).toBe('liubei');
    expect(next.cities['xiapi'].factionId).toBe('taoqian');
    expect(next.cities['pengcheng'].factionId).toBe('taoqian');
    expect(next.events.some((e) => e.id === 'xuzhou_declined')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/engine/story/s1-liubei.test.ts
```
Expected failure: the file fails to load with `Failed to resolve import "../../../src/data/story/s1-liubei.js"` (the data module does not exist yet), and — even once it resolves — `objectivesFor`/`storyEventsFor` still return the Task 4/5 stub `[]`, so `expect(...).toEqual(['coalition', ...])` and `expect(bequest).toBeDefined()` fail.

- [ ] **Step 3: Implement**

**(3a) Add the 14 MessageKeys.** In `src/i18n/types.ts`, replace the final union member line `  | 'digest.dismiss';` (@362) with the member (semicolon removed) followed by the new block (note the `;` now terminates the last new key):

```ts
  | 'digest.dismiss'

  // Story campaign — Liu Bei Chapter 1 content (Appendix A)
  | 'objective.s1.coalition.title'
  | 'objective.s1.coalition.desc'
  | 'objective.s1.zhaoyun.title'
  | 'objective.s1.zhaoyun.desc'
  | 'objective.s1.xuzhouAid.title'
  | 'objective.s1.xuzhouAid.desc'
  | 'objective.s1.foundation.title'
  | 'objective.s1.foundation.desc'
  | 'story.s1.xuzhou.title'
  | 'story.s1.xuzhou.body'
  | 'choice.s1.xuzhou.accept.label'
  | 'choice.s1.xuzhou.accept.desc'
  | 'choice.s1.xuzhou.decline.label'
  | 'choice.s1.xuzhou.decline.desc';
```

In `src/i18n/catalog/en.ts`, insert after the `'digest.dismiss': 'Continue',` line (before the closing `};`):

```ts

  // Story campaign — Liu Bei Chapter 1 content (Appendix A)
  'objective.s1.coalition.title': 'Answer the Call',
  'objective.s1.coalition.desc':
    'Join the coalition against Dong Zhuo and take your place among the lords of the realm.',
  'objective.s1.zhaoyun.title': 'Find the Dragon of Changshan',
  'objective.s1.zhaoyun.desc': 'Meet Zhao Yun amid the fighting and win a warrior to your cause.',
  'objective.s1.xuzhouAid.title': "Ride to Xuzhou's Aid",
  'objective.s1.xuzhouAid.desc':
    "Answer Tao Qian's plea, break the siege, and let your honor speak for you.",
  'objective.s1.foundation.title': 'A Foundation Offered',
  'objective.s1.foundation.desc': 'Decide your answer when Tao Qian offers you his province.',
  'story.s1.xuzhou.title': 'The Bequest of Xuzhou',
  'story.s1.xuzhou.body':
    'Tao Qian lies dying and three times presses Xuzhou upon you. It is rich country — and country every warlord covets. Take it, and overnight you rise from wandering guest to sovereign lord. Refuse it, and your name for righteousness spreads across the land — but you remain a man without a home. Mi Zhu and Chen Deng wait, needing only your word.',
  'choice.s1.xuzhou.accept.label': 'Accept Xuzhou',
  'choice.s1.xuzhou.accept.desc':
    "Gain Xuzhou's cities plus treasury and grain — a true warlord at once; but a tall tree draws the wind, and Lü Bu and Cao Cao now turn their eyes upon you.",
  'choice.s1.xuzhou.decline.label': 'Decline Xuzhou',
  'choice.s1.xuzhou.decline.desc':
    'Renown soars and hearts turn to you — recruiting worthy men grows far easier hereafter; but you hold only Xiaopei, a slender foundation for a hard road.',
```

In `src/i18n/catalog/zh.ts`, insert after the `'digest.dismiss': '继续',` line (before the closing `};`):

```ts

  // 剧情战役 — 刘备第一章内容（附录 A）
  'objective.s1.coalition.title': '响应义盟',
  'objective.s1.coalition.desc': '加入讨董联军，以微薄之力立于天下诸侯之列。',
  'objective.s1.zhaoyun.title': '三顾常山',
  'objective.s1.zhaoyun.desc': '于乱军之中结识赵云，广纳英才。',
  'objective.s1.xuzhouAid.title': '驰援徐州',
  'objective.s1.xuzhouAid.desc': '应陶谦之请，率军解徐州之围，以信义动人心。',
  'objective.s1.foundation.title': '抉择基业',
  'objective.s1.foundation.desc': '面对陶谦让州之请，决定进退。',
  'story.s1.xuzhou.title': '陶谦让徐州',
  'story.s1.xuzhou.body':
    '陶谦病笃，三让徐州于你。徐州乃四战之地，富庶却众目睽睽。取之，则一夕由客将而为诸侯；辞之，则仁名传遍天下，然基业无着。糜竺、陈登拱手相候，只待你一言。',
  'choice.s1.xuzhou.accept.label': '受徐州',
  'choice.s1.xuzhou.accept.desc': '获徐州六城与钱粮，即刻成为一方诸侯；然树大招风，吕布、曹操皆将侧目而视。',
  'choice.s1.xuzhou.decline.label': '辞徐州',
  'choice.s1.xuzhou.decline.desc': '声望大涨，天下归心，日后招贤纳士事半功倍；然仅得小沛一城，基业微薄，前路艰难。',
```

**(3b) Create the content data file** `src/data/story/s1-liubei.ts`:

```ts
import type { GameState } from '../../engine/types.js';
import type { ObjectiveDef, StoryEvent } from '../../engine/story/types.js';

// The three commanderies that make up Xuzhou in Scenario 1 (Tao Qian's seat).
const XUZHOU_CITY_IDS = ['xiapi', 'pengcheng', 'xiaopei'] as const;

function hasEvent(state: GameState, id: string): boolean {
  return state.events.some((e) => e.id === id);
}

function liubeiOwnsXuzhouCity(state: GameState): boolean {
  return XUZHOU_CITY_IDS.some((id) => state.cities[id]?.factionId === 'liubei');
}

function xuzhouDecided(state: GameState): boolean {
  return hasEvent(state, 'xuzhou_accepted') || hasEvent(state, 'xuzhou_declined');
}

// Liu Bei — Chapter 1 objective chain (Appendix A). Every check() is a pure
// predicate over GameState (no wall-clock, no RNG).
export const S1_LIUBEI_OBJECTIVES: ObjectiveDef[] = [
  {
    id: 'coalition',
    titleKey: 'objective.s1.coalition.title',
    descKey: 'objective.s1.coalition.desc',
    // Answering the call = the Guandong coalition event has fired.
    check: (state) => hasEvent(state, 'guandong_coalition'),
  },
  {
    id: 'zhaoyun',
    titleKey: 'objective.s1.zhaoyun.title',
    descKey: 'objective.s1.zhaoyun.desc',
    // Zhao Yun has joined Liu Bei's faction.
    check: (state) => state.generals['zhaoyun']?.factionId === 'liubei',
  },
  {
    id: 'xuzhouAid',
    titleKey: 'objective.s1.xuzhouAid.title',
    descKey: 'objective.s1.xuzhouAid.desc',
    // Liu Bei has aided Xuzhou and now holds one of its cities.
    check: (state) => liubeiOwnsXuzhouCity(state),
  },
  {
    id: 'foundation',
    titleKey: 'objective.s1.foundation.title',
    descKey: 'objective.s1.foundation.desc',
    // The bequest of Xuzhou has been decided (accepted or declined).
    check: (state) => xuzhouDecided(state),
  },
];

// Liu Bei — Chapter 1 story events (Appendix A). The single fateful choice of
// the vertical slice: Tao Qian's bequest of Xuzhou.
export const S1_LIUBEI_EVENTS: StoryEvent[] = [
  {
    id: 'xuzhou_bequest',
    // Fires once Liu Bei has aided Xuzhou (holds a city there) and has not yet
    // resolved the bequest. runScenarioEvents also records the event id in
    // state.events so it will not re-fire while the decision is pending.
    check: (state) => liubeiOwnsXuzhouCity(state) && !xuzhouDecided(state),
    titleKey: 'story.s1.xuzhou.title',
    bodyKey: 'story.s1.xuzhou.body',
    portrait: 'taoqian',
    choices: [
      {
        id: 'accept',
        labelKey: 'choice.s1.xuzhou.accept.label',
        descKey: 'choice.s1.xuzhou.accept.desc',
        // Accept: every Xuzhou city still held by Tao Qian passes to Liu Bei.
        apply: (state) => {
          const cities = { ...state.cities };
          for (const id of XUZHOU_CITY_IDS) {
            const city = cities[id];
            if (city && city.factionId === 'taoqian') {
              cities[id] = { ...city, factionId: 'liubei' };
            }
          }
          return {
            ...state,
            cities,
            events: [
              ...state.events,
              { id: 'xuzhou_accepted', turn: state.turn, year: state.year, month: state.month },
            ],
          };
        },
      },
      {
        id: 'decline',
        labelKey: 'choice.s1.xuzhou.decline.label',
        descKey: 'choice.s1.xuzhou.decline.desc',
        // Decline: Liu Bei keeps only Xiaopei as a base; the rest of Xuzhou
        // stays with (or reverts to) Tao Qian.
        apply: (state) => {
          const cities = { ...state.cities };
          const xiaopei = cities['xiaopei'];
          if (xiaopei) cities['xiaopei'] = { ...xiaopei, factionId: 'liubei' };
          for (const id of ['xiapi', 'pengcheng']) {
            const city = cities[id];
            if (city && city.factionId === 'liubei') {
              cities[id] = { ...city, factionId: 'taoqian' };
            }
          }
          return {
            ...state,
            cities,
            events: [
              ...state.events,
              { id: 'xuzhou_declined', turn: state.turn, year: state.year, month: state.month },
            ],
          };
        },
      },
    ],
  },
];
```

**(3c) Register the content.** In `src/engine/story/objectives.ts`, add the import at the top and replace the Task 2 stub body of `objectivesFor` with the version below — it ADDS the `s1-dongzhuo`/`liubei` branch *after* the TEST-ONLY override check, so the test-hook precedence Task 2 established is preserved:

```ts
import { S1_LIUBEI_OBJECTIVES } from '../../data/story/s1-liubei.js';
```
```ts
export function objectivesFor(scenarioId: string, storyMode?: StoryMode): ObjectiveDef[] {
  const override = testObjectiveOverlay.get(scenarioId);
  if (override) return override;
  if (scenarioId === 's1-dongzhuo' && storyMode?.protagonistFactionId === 'liubei') {
    return S1_LIUBEI_OBJECTIVES;
  }
  return [];
}
```

In `src/engine/story/events.ts`, add the import and update the Task 4 stub body of `storyEventsFor` to supply the `s1-dongzhuo`/`liubei` branch as the `authored` table, keeping the test-overlay merge intact so `setTestStoryEvents` still drives the pipeline (leave `findStoryEvent`/`applyStoryChoice` untouched — `findStoryEvent` already reads through `storyEventsFor`):

```ts
import { S1_LIUBEI_EVENTS } from '../../data/story/s1-liubei.js';
```
```ts
export function storyEventsFor(scenarioId: string, storyMode?: StoryMode): StoryEvent[] {
  const authored: StoryEvent[] =
    scenarioId === 's1-dongzhuo' && storyMode?.protagonistFactionId === 'liubei'
      ? S1_LIUBEI_EVENTS
      : [];
  const overlay = storyEventOverlay.get(scenarioId) ?? [];
  return [...authored, ...overlay];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/engine/story/s1-liubei.test.ts
```
Expected: all 7 cases pass.

- [ ] **Step 5: Run full gate + commit**

```bash
npm test
npx tsc --noEmit
npm run build
```
All green (parity test in `tests/i18n/parity.test.ts` now covers the 14 new keys in both catalogs; the 285-baseline suite plus this file pass; `resolveQuickBattle` untouched). Then:

```bash
git add src/data/story/s1-liubei.ts src/engine/story/objectives.ts src/engine/story/events.ts \
  src/i18n/types.ts src/i18n/catalog/en.ts src/i18n/catalog/zh.ts \
  tests/engine/story/s1-liubei.test.ts
git commit -m "$(cat <<'EOF'
Add Scenario-1 Liu Bei Ch.1 story content: objectives + Xuzhou choice-event + i18n

Author the vertical-slice content on the Phase-1 engine: 4 Ch.1 objectives
(coalition / Zhao Yun / aid Xuzhou / foundation) with pure GameState checks,
and the 陶谦让徐州 bequest StoryEvent with Accept/Decline branches. Register
in objectivesFor + storyEventsFor for s1-dongzhuo/liubei; add bilingual
objective.s1.* / story.s1.* / choice.s1.* keys to both catalogs.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AQWRraNb7H8x364cBoskEU
EOF
)"
```

---

### Task 11: Polish — faction-select localized general names + web-appropriate title subtitle

**Files:**
- Modify `src/web/screens/FactionSelectScreen.tsx` — add `GENERALS` import (after line 2); replace the raw-`{id}` chip render at line 149 with a `pickName`-localized name.
- Modify `src/i18n/catalog/en.ts` line 6 (`'app.subtitle'`) — replace the leftover "TUI strategy game" copy.
- Modify `src/i18n/catalog/zh.ts` line 6 (`'app.subtitle'`) — replace the leftover "终端战棋策略" copy.
- Create `tests/web/FactionSelectScreen.test.tsx` — the failing test.

No `MessageKey` union change is needed: `app.subtitle` already exists in `src/i18n/types.ts:16` and in both catalogs, so the i18n parity test (`tests/i18n/parity.test.ts`) stays green — this task only edits the two catalog *values*.

**Interfaces:**
- Consumes: `GENERALS: Record<GeneralId, General>` from `src/data/generals/index.ts:198` (each `General.name` is a `LocalizedString {zh,en}`); `pickName(LocalizedString)` and `t(key)` from `src/i18n/locale.ts`; `SCENARIOS` from `src/data/scenarios/index.ts`; existing `app.subtitle` `MessageKey`.
- Produces: nothing new that later tasks depend on (pure UI/copy polish). Independent of all other Phase-1 tasks — can land in any order.

- [ ] **Step 1: Write the failing test** (COMPLETE test code)

Create `tests/web/FactionSelectScreen.test.tsx`:
```tsx
import { describe, expect, it, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { FactionSelectScreen } from '../../src/web/screens/FactionSelectScreen.js';
import { TitleScreen } from '../../src/web/screens/TitleScreen.js';
import { setLocale, t } from '../../src/i18n/locale.js';

beforeEach(() => setLocale('zh'));

describe('FactionSelectScreen general name chips', () => {
  it('renders localized general names, not raw ids, for the selected faction', () => {
    setLocale('zh');
    const { getByText, queryByText } = render(
      <FactionSelectScreen scenarioId="s1-dongzhuo" />,
    );
    // Index 0 (Dong Zhuo) is active on mount; its detail panel does NOT list
    // Cao Cao's generals. Click the "曹操" faction row to select that faction.
    // At this point "曹操" appears exactly once (the faction list item), because
    // the active detail panel is still showing Dong Zhuo.
    fireEvent.click(getByText('曹操'));
    // The general chips must now show each general's localized name. Xiahou Dun
    // is a Cao Cao general whose Chinese name is distinct from the faction name,
    // so it unambiguously proves the chip is localized (not the raw id).
    expect(getByText('夏侯惇')).toBeInTheDocument();
    // ...and the raw general id must no longer leak into the UI.
    expect(queryByText('xiahoudun')).toBeNull();
  });

  it('shows English general names when locale is en', () => {
    setLocale('en');
    const { getByText, queryByText } = render(
      <FactionSelectScreen scenarioId="s1-dongzhuo" />,
    );
    fireEvent.click(getByText('Cao Cao'));
    expect(getByText('Xiahou Dun')).toBeInTheDocument();
    expect(queryByText('xiahoudun')).toBeNull();
  });
});

describe('Title subtitle copy', () => {
  it('app.subtitle drops the terminal/TUI leftover in both locales', () => {
    setLocale('zh');
    expect(t('app.subtitle')).not.toContain('终端');
    setLocale('en');
    expect(t('app.subtitle')).not.toMatch(/TUI/i);
  });

  it('TitleScreen renders the new web-appropriate subtitle', () => {
    setLocale('zh');
    const { getByText } = render(<TitleScreen />);
    expect(getByText('群雄逐鹿 · 谋定天下')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** (exact command + expected failure)

```
npx vitest run tests/web/FactionSelectScreen.test.tsx
```
Expected failure: in the first test, the chips currently render the raw id, so `getByText('夏侯惇')` throws `Unable to find an element with the text: 夏侯惇` (and `xiahoudun` is present). In the Title tests, `t('app.subtitle')` still returns `'终端战棋策略 · 致敬《三国霸业》'` (zh) / `'A TUI strategy game — tribute to Three Kingdoms Hegemony'` (en), so the `not.toContain('终端')` / `not.toMatch(/TUI/i)` assertions fail, and `getByText('群雄逐鹿 · 谋定天下')` is not found.

- [ ] **Step 3: Implement** (COMPLETE code)

**3a. `src/web/screens/FactionSelectScreen.tsx` — add the `GENERALS` import.** After line 2 (`import { SCENARIOS } from '../../data/scenarios/index.js';`) insert:
```tsx
import { GENERALS } from '../../data/generals/index.js';
```
So the top of the file reads:
```tsx
import React, { useState } from 'react';
import { SCENARIOS } from '../../data/scenarios/index.js';
import { GENERALS } from '../../data/generals/index.js';
import { newGame, setScreen, toggleLocale } from '../../state/store.js';
import { pickName, t } from '../../i18n/locale.js';
```

**3b. `src/web/screens/FactionSelectScreen.tsx` — localize the general chips.** Replace the chip block at lines 144-151:
```tsx
                {f.generalIds.slice(0, 8).map((id) => (
                  <span
                    key={id}
                    className="rounded border border-ink-300/40 bg-parchment-50 px-2 py-0.5"
                  >
                    {id}
                  </span>
                ))}
```
with (render the general's localized `LocalizedString` name via `pickName`, falling back to the raw id only if the general is missing from the table):
```tsx
                {f.generalIds.slice(0, 8).map((id) => (
                  <span
                    key={id}
                    className="rounded border border-ink-300/40 bg-parchment-50 px-2 py-0.5"
                  >
                    {pickName(GENERALS[id]?.name ?? { zh: id, en: id })}
                  </span>
                ))}
```

**3c. `src/i18n/catalog/en.ts` line 6 — new subtitle.** Replace:
```ts
  'app.subtitle': 'A TUI strategy game — tribute to Three Kingdoms Hegemony',
```
with:
```ts
  'app.subtitle': 'Warlords clash — strategize to rule the realm',
```

**3d. `src/i18n/catalog/zh.ts` line 6 — new subtitle.** Replace:
```ts
  'app.subtitle': '终端战棋策略 · 致敬《三国霸业》',
```
with:
```ts
  'app.subtitle': '群雄逐鹿 · 谋定天下',
```

- [ ] **Step 4: Run test to verify it passes** (exact command)

```
npx vitest run tests/web/FactionSelectScreen.test.tsx
```
All four assertions pass: chips render `夏侯惇` / `Xiahou Dun` (no `xiahoudun`), and `app.subtitle` resolves to the new bilingual copy with the TitleScreen showing `群雄逐鹿 · 谋定天下`.

- [ ] **Step 5: Run full gate + commit**

```
npm test
npx tsc --noEmit
npm run build
git add src/web/screens/FactionSelectScreen.tsx src/i18n/catalog/en.ts src/i18n/catalog/zh.ts tests/web/FactionSelectScreen.test.tsx
git commit -m "Polish: localize faction-select general names + web-appropriate title subtitle"
```
`npm test` must stay green including `tests/i18n/parity.test.ts` (only catalog values changed, no keys added/removed) and the existing `tests/web/*` suite.
