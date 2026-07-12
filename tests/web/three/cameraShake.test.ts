import { describe, expect, it } from 'vitest';
import { makeShake } from '../../../src/web/three/cameraShake.js';

describe('makeShake', () => {
  it('is zero at rest', () => {
    const s = makeShake();
    expect(s.sample(16)).toEqual({ x: 0, y: 0 });
  });
  it('produces a nonzero offset after add(), then decays back toward zero', () => {
    const s = makeShake();
    s.add(1);
    const first = s.sample(16);
    expect(Math.hypot(first.x, first.y)).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) s.sample(16);
    const later = s.sample(16);
    expect(Math.hypot(later.x, later.y)).toBeLessThan(Math.hypot(first.x, first.y));
  });
});
