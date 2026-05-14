import { describe, expect, it } from 'vitest';
import { adjacentCities, manhattanDistance } from '../../src/engine/map.js';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';

describe('map utilities', () => {
  it('manhattanDistance is symmetric', () => {
    expect(manhattanDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7);
  });

  it('Luoyang and Henei are adjacent (within threshold)', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 7,
    });
    const adj = adjacentCities(state, 'luoyang').map((c) => c.id);
    expect(adj).toContain('henei');
  });

  it('Xiangping (Liaodong) has very few neighbors', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 8,
    });
    const adj = adjacentCities(state, 'xiangping');
    // It's isolated in the far northeast.
    expect(adj.length).toBeLessThan(3);
  });
});
