import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { PERSONALITY_PRESETS } from '../../src/engine/ai/personality.js';
import { threatenedCityIds, isFactionThreatened } from '../../src/engine/ai/strategy.js';
import { makeTopology, siegeOp, attackMarchOp } from './_ai-fixtures.js';

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

describe('threat detection', () => {
  it('flags a city that is under siege', () => {
    let state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 8000 },
    ]);
    state = { ...state, pendingOps: [siegeOp('luoyang', 'caocao')] };
    expect(threatenedCityIds(state, 'dongzhuo')).toContain('luoyang');
    expect(isFactionThreatened(state, 'dongzhuo')).toBe(true);
  });

  it('flags a city targeted by an inbound enemy attack-march', () => {
    let state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 8000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 8000 },
    ]);
    state = { ...state, pendingOps: [attackMarchOp('chenliu', 'luoyang', 'caocao')] };
    expect(threatenedCityIds(state, 'dongzhuo')).toContain('luoyang');
  });

  it('flags a city with a hostile neighbor holding a big garrison edge', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 2000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 9000 },
    ]);
    expect(threatenedCityIds(state, 'dongzhuo')).toContain('luoyang');
  });

  it('reports no threat for a quiet faction', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 8000 },
    ]);
    expect(isFactionThreatened(state, 'dongzhuo')).toBe(false);
  });
});
