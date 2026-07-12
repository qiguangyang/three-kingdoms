import { describe, expect, it } from 'vitest';
import { followCamTarget } from '../../../src/web/duel/DuelScene.js';

describe('followCamTarget', () => {
  it('yaw points from the player toward the boss', () => {
    // player at origin, boss along +x => yaw ~ 0
    const { camOffsetYaw } = followCamTarget({ x: 0, z: 0 }, { x: 5, z: 0 });
    expect(Math.abs(camOffsetYaw)).toBeLessThan(0.01);
  });
  it('looks at a point between player and boss, biased to the player', () => {
    const { look } = followCamTarget({ x: 0, z: 0 }, { x: 10, z: 0 });
    expect(look.x).toBeGreaterThan(0);
    expect(look.x).toBeLessThan(5); // biased toward the player side of the midpoint
  });
});
