import { describe, expect, it } from 'vitest';
import { framing } from '../../src/web/battle/camera.js';

describe('camera framing', () => {
  it('positions the camera above and offset from the centroid, targeting it', () => {
    const centroid = { x: 2, z: -3 };
    const f = framing(centroid, { w: 20, h: 12 });
    expect(f.position[1]).toBeGreaterThan(0); // above ground
    expect(f.target[0]).toBeCloseTo(2);
    expect(f.target[2]).toBeCloseTo(-3);
    const dx = f.position[0] - f.target[0];
    const dy = f.position[1] - f.target[1];
    const dz = f.position[2] - f.target[2];
    expect(Math.hypot(dx, dy, dz)).toBeGreaterThan(10); // pulled back
  });

  it('scales the pull-back distance with field span', () => {
    const near = framing({ x: 0, z: 0 }, { w: 10, h: 8 });
    const far = framing({ x: 0, z: 0 }, { w: 40, h: 24 });
    expect(far.position[1]).toBeGreaterThan(near.position[1]);
  });
});
