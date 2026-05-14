import { describe, expect, it } from 'vitest';
import { createSeed, roll, rollChance, rollInt, shuffle } from '../../src/engine/rng.js';

describe('rng', () => {
  it('produces deterministic floats for a given seed', () => {
    const s = createSeed(42);
    const a = roll(s);
    const b = roll(s);
    expect(a.value).toBeCloseTo(b.value, 12);
    expect(a.state).toBe(b.state);
  });

  it('rollInt is inclusive on both ends', () => {
    let s = createSeed(123);
    for (let i = 0; i < 200; i++) {
      const r = rollInt(s, 1, 6);
      expect(r.value).toBeGreaterThanOrEqual(1);
      expect(r.value).toBeLessThanOrEqual(6);
      s = r.state;
    }
  });

  it('rollChance distributes near the requested probability', () => {
    let s = createSeed(7);
    let hits = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const r = rollChance(s, 0.3);
      if (r.hit) hits++;
      s = r.state;
    }
    expect(hits / N).toBeGreaterThan(0.25);
    expect(hits / N).toBeLessThan(0.35);
  });

  it('shuffle is deterministic for the same seed', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = shuffle(arr, createSeed(99)).value;
    const b = shuffle(arr, createSeed(99)).value;
    expect(a).toEqual(b);
  });
});
