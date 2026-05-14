import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { PERSONALITY_PRESETS } from '../../src/engine/ai/personality.js';

describe('GameState.aiStrategies', () => {
  it('buildInitialState seeds an empty aiStrategies map', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 1,
    });
    expect(state.aiStrategies).toEqual({});
  });
});

describe('personality presets', () => {
  it('expose the goal-oriented tuning knobs with sane ordering', () => {
    for (const key of ['active', 'balanced', 'turtle'] as const) {
      const p = PERSONALITY_PRESETS[key];
      expect(p.leaderBiasWeight).toBeGreaterThanOrEqual(0);
      expect(p.concentrationThreshold).toBeGreaterThan(1);
      expect(p.reinforceAggressiveness).toBeGreaterThan(0);
    }
    // Aggressive factions attack with less of an edge and gang up on #1 more.
    expect(PERSONALITY_PRESETS.active.concentrationThreshold).toBeLessThan(
      PERSONALITY_PRESETS.turtle.concentrationThreshold,
    );
    expect(PERSONALITY_PRESETS.active.leaderBiasWeight).toBeGreaterThan(
      PERSONALITY_PRESETS.turtle.leaderBiasWeight,
    );
  });
});
