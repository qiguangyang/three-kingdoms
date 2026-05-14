import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { advanceMonth } from '../../src/engine/turn.js';
import { makeDefaultAgent } from '../../src/engine/ai/index.js';
import type { FactionAgent } from '../../src/engine/types.js';

function buildAgents(state: ReturnType<typeof buildInitialState>) {
  const agents: Record<string, FactionAgent> = {};
  for (const f of Object.values(state.factions)) {
    if (f.id === state.playerFactionId) continue;
    agents[f.id] = makeDefaultAgent(f.id, f.personality);
  }
  return agents;
}

describe('turn loop', () => {
  it('advances the calendar by one month and increments turn', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 1,
    });
    const s1 = advanceMonth(s0, buildAgents(s0));
    expect(s1.turn).toBe(1);
    expect(s1.year).toBe(189);
    expect(s1.month).toBe(10);
  });

  it('rolls over to the next year after month 12', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 2,
    });
    for (let i = 0; i < 12; i++) {
      state = advanceMonth(state, buildAgents(state));
    }
    expect(state.year).toBe(190);
  });

  it('fires the guandong coalition event in month 2', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 3,
    });
    state = advanceMonth(state, buildAgents(state));
    state = advanceMonth(state, buildAgents(state));
    const fired = state.events.some((e) => e.id === 'guandong_coalition');
    expect(fired).toBe(true);
  });

  it('fires qiandu_changan if Dong Zhuo still holds Luoyang by month 12', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 4,
    });
    for (let i = 0; i < 12; i++) {
      state = advanceMonth(state, buildAgents(state));
    }
    const fired = state.events.some((e) => e.id === 'qiandu_changan');
    expect(fired).toBe(true);
    expect(state.cities['luoyang']!.agriculture).toBe(10);
  });
});
