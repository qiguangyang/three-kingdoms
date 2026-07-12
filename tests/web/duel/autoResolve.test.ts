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
  it('produces both wins and losses across seeds (a real roll, not a fixed result)', () => {
    const outcomes = new Set(Array.from({ length: 400 }, (_, i) => autoResolveDuel('hulaoguan', i + 1)));
    expect(outcomes.has('win')).toBe(true);
    expect(outcomes.has('lose')).toBe(true);
  });
  it('is a favorite but not guaranteed (~0.6–0.8 win rate over many seeds)', () => {
    const n = 2000;
    const wins = Array.from({ length: n }, (_, i) => autoResolveDuel('hulaoguan', i + 1)).filter(
      (o) => o === 'win',
    ).length;
    const rate = wins / n;
    expect(rate).toBeGreaterThan(0.55);
    expect(rate).toBeLessThan(0.85);
  });
});
