import { describe, expect, it } from 'vitest';
import { autoResolveDuel } from '../../../src/web/duel/autoResolve.js';

describe('autoResolveDuel', () => {
  it('is deterministic for a given seed', () => {
    expect(autoResolveDuel('hulaoguan', 5)).toBe(autoResolveDuel('hulaoguan', 5));
  });
  it('returns a valid outcome for the real set-piece', () => {
    expect(['win', 'lose']).toContain(autoResolveDuel('hulaoguan', 1));
  });
  it('loses on an unknown duel id', () => {
    expect(autoResolveDuel('nope', 1)).toBe('lose');
  });
  it('the brothers bias makes a win reachable across seeds', () => {
    const outcomes = new Set(Array.from({ length: 20 }, (_, i) => autoResolveDuel('hulaoguan', i + 1)));
    expect(outcomes.has('win')).toBe(true);
  });
});
