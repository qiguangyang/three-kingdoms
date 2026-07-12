import type { DuelInput, Vec2 } from '../../duel/types.js';

export interface KeyState {
  held: Set<string>; // keys currently down (lowercased)
  pressed: Set<string>; // keys that transitioned down THIS frame; caller clears each frame
}

// WASD → world-space XZ (the scene rotates this by camera yaw for camera-relative
// movement). Attacks/dodge are edge-triggered so a held key fires once.
export function inputFromKeys(k: KeyState): DuelInput {
  let x = 0;
  let z = 0;
  if (k.held.has('w')) z -= 1;
  if (k.held.has('s')) z += 1;
  if (k.held.has('a')) x -= 1;
  if (k.held.has('d')) x += 1;
  const move: Vec2 = { x, z };
  return {
    move,
    light: k.pressed.has('j'),
    heavy: k.pressed.has('k'),
    dodge: k.pressed.has(' '),
    guard: k.held.has('l') || k.held.has('shift'),
  };
}
