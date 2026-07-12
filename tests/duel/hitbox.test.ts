import { describe, expect, it } from 'vitest';
import { dist, inAttackArc } from '../../src/duel/hitbox.js';

describe('dist', () => {
  it('is the planar distance', () => {
    expect(dist({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5);
  });
});

describe('inAttackArc', () => {
  const origin = { x: 0, z: 0 };
  it('hits a target dead ahead within range', () => {
    // facing +x; target 2 units along +x.
    expect(inAttackArc(origin, 0, { x: 2, z: 0 }, 3, 1.2)).toBe(true);
  });
  it('misses a target beyond range', () => {
    expect(inAttackArc(origin, 0, { x: 5, z: 0 }, 3, 1.2)).toBe(false);
  });
  it('misses a target behind the attacker', () => {
    expect(inAttackArc(origin, 0, { x: -2, z: 0 }, 3, 1.2)).toBe(false);
  });
  it('misses a target outside the arc half-angle', () => {
    // target at 90° to the side; arc 1.2 rad => half-angle 0.6 rad (~34°) excludes it.
    expect(inAttackArc(origin, 0, { x: 0, z: 2 }, 3, 1.2)).toBe(false);
  });
});
