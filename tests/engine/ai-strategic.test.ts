import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { strategicRules } from '../../src/engine/ai/strategic.js';

describe('strategic AI', () => {
  it('always emits an endTurn command at the end', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 5,
    });
    const cmds = strategicRules({ state, factionId: 'dongzhuo' }, 'active');
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds[cmds.length - 1]!.kind).toBe('endTurn');
  });

  it('prioritizes governance when loyalty is below 30', () => {
    const baseState = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 6,
    });
    const broken = {
      ...baseState,
      cities: {
        ...baseState.cities,
        luoyang: { ...baseState.cities['luoyang']!, loyalty: 15 },
      },
    };
    const cmds = strategicRules({ state: broken, factionId: 'dongzhuo' }, 'balanced');
    expect(cmds.some((c) => c.kind === 'govern' && c.cityId === 'luoyang')).toBe(true);
  });
});
