import { describe, expect, it } from 'vitest';
import { inputFromKeys } from '../../../src/web/duel/input.js';

const keys = (held: string[], pressed: string[] = []) => ({ held: new Set(held), pressed: new Set(pressed) });

describe('inputFromKeys', () => {
  it('maps WASD to a world-XZ move direction', () => {
    expect(inputFromKeys(keys(['w'])).move).toEqual({ x: 0, z: -1 });
    expect(inputFromKeys(keys(['d'])).move).toEqual({ x: 1, z: 0 });
    expect(inputFromKeys(keys(['w', 'a'])).move).toEqual({ x: -1, z: -1 });
  });
  it('treats attacks and dodge as edge-triggered (from pressed)', () => {
    expect(inputFromKeys(keys([], ['j'])).light).toBe(true);
    expect(inputFromKeys(keys(['j'], [])).light).toBe(false); // held but not pressed this frame
    expect(inputFromKeys(keys([], ['k'])).heavy).toBe(true);
    expect(inputFromKeys(keys([], [' '])).dodge).toBe(true);
  });
  it('treats guard as held (L or Shift)', () => {
    expect(inputFromKeys(keys(['l'])).guard).toBe(true);
    expect(inputFromKeys(keys(['shift'])).guard).toBe(true);
    expect(inputFromKeys(keys([])).guard).toBe(false);
  });
});
