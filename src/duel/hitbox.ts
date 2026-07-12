import type { Vec2 } from './types.js';

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

// True when `target` lies within `range` of `attacker` AND within ±arc/2 of the
// attacker's `facing` yaw. Facing 0 points along +x; +z is 90° (Math.atan2(z, x)).
export function inAttackArc(
  attacker: Vec2,
  facing: number,
  target: Vec2,
  range: number,
  arc: number,
): boolean {
  const dx = target.x - attacker.x;
  const dz = target.z - attacker.z;
  const d = Math.hypot(dx, dz);
  if (d > range || d === 0) return d === 0; // point-blank always connects
  const angleTo = Math.atan2(dz, dx);
  let delta = angleTo - facing;
  // Normalize to [-π, π].
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return Math.abs(delta) <= arc / 2;
}
