// Shared fixtures for Scenario 1 (Liu Bei, Chapter 1) playthrough tests.
//
// reachedCoalition() builds a deterministic Chapter-1 Liu Bei GameState that has
// reached the point where the Guandong coalition has formed — i.e. the scripted
// `guandong_coalition` event has fired and been recorded in state.events. This
// is the exact condition the 响应义盟 objective and the coalition story beat gate
// on (hasEvent(state, 'guandong_coalition')), and the precondition for the Hulao
// Pass duel trigger. Pure and deterministic: no wall-clock, no RNG stepping —
// the coalition record is injected the same way runScenarioEvents records it.

import { buildInitialState } from '../../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../../src/data/index.js';
import { seedObjectives } from '../../../src/engine/story/objectives.js';
import type { GameState } from '../../../src/engine/types.js';

const SEED = 1;

// A Chapter-1 Liu Bei state with the Guandong coalition already formed.
export function reachedCoalition(): GameState {
  const base = seedObjectives({
    ...buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: SEED,
    }),
    storyMode: { protagonistFactionId: 'liubei', chapter: 1 },
  });
  // Record the coalition exactly as runScenarioEvents / the scripted trigger
  // would: append an EventRecord with id 'guandong_coalition'. hasEvent() then
  // returns true, satisfying the coalition-joined predicate.
  return {
    ...base,
    events: [
      ...base.events,
      { id: 'guandong_coalition', turn: base.turn, year: base.year, month: base.month },
    ],
  };
}
