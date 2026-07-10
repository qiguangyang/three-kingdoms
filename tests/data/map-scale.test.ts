import { describe, expect, it } from 'vitest';
import { scalePath, scalePoints } from '../../src/data/map/scale.js';

describe('geography scaling', () => {
  it('scales every number in an SVG path, preserving commands', () => {
    expect(scalePath('M 10 20 C 30 40 50 60 70 80 L 5 5 Z', 5))
      .toBe('M 50 100 C 150 200 250 300 350 400 L 25 25 Z');
  });

  it('leaves non-coordinate letters intact and handles decimals/negatives', () => {
    expect(scalePath('M -1.5 2 L 3.25 -4', 2)).toBe('M -3 4 L 6.5 -8');
  });

  it('scales point arrays', () => {
    expect(scalePoints([[1, 2], [3, 4]], 5)).toEqual([[5, 10], [15, 20]]);
  });

  // Additional edge cases (not over-engineered, just the ones that matter for SVG data).

  it('is identity when k = 1', () => {
    const d = 'M 10 20 C 30 40 50 60 70 80 L 5 5 Z';
    expect(scalePath(d, 1)).toBe(d);
  });

  it('preserves comma separators and mixed whitespace between numbers', () => {
    expect(scalePath('M10,20 L30,40', 2)).toBe('M20,40 L60,80');
  });

  it('handles lowercase (relative) path commands like any other letter', () => {
    expect(scalePath('m 1 1 l 2 2 z', 3)).toBe('m 3 3 l 6 6 z');
  });

  it('does not introduce float noise from repeated decimals', () => {
    // 0.1 * 3 must render as 0.3, not 0.30000000000000004
    expect(scalePath('M 0.1 0.2', 3)).toBe('M 0.3 0.6');
  });

  it('rounds to ~6 decimals to avoid trailing float dust', () => {
    // 1/3-ish inputs still produce clean, bounded output
    expect(scalePath('M 0.123456789 0', 1)).toBe('M 0.123457 0');
  });

  it('scales fractional point pairs deterministically', () => {
    expect(scalePoints([[1.5, -2.5], [0, 0]], 4)).toEqual([[6, -10], [0, 0]]);
  });

  it('returns a fresh array without mutating the input points', () => {
    const input: [number, number][] = [[1, 2]];
    const out = scalePoints(input, 2);
    expect(out).not.toBe(input);
    expect(input).toEqual([[1, 2]]);
  });
});
