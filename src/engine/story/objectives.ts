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
import { S1_LIUBEI_OBJECTIVES } from '../../data/story/s1-liubei.js';
import { S2_LIUBEI_OBJECTIVES } from '../../data/story/s2-liubei.js';
import { S3_LIUBEI_OBJECTIVES } from '../../data/story/s3-liubei.js';

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
  if (scenarioId === 's1-dongzhuo' && storyMode?.protagonistFactionId === 'liubei') {
    return S1_LIUBEI_OBJECTIVES;
  }
  if (scenarioId === 's2-junxiong' && storyMode?.protagonistFactionId === 'liubei') {
    return S2_LIUBEI_OBJECTIVES;
  }
  if (scenarioId === 's3-chibi' && storyMode?.protagonistFactionId === 'liubei') {
    return S3_LIUBEI_OBJECTIVES;
  }
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
