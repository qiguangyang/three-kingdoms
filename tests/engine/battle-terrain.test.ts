import { describe, expect, it } from 'vitest';
import { generateField } from '../../src/engine/battle/terrain.js';
import { BATTLE_WIDTH, BATTLE_HEIGHT } from '../../src/engine/constants.js';
import type { City } from '../../src/engine/types.js';

function city(terrain: City['terrain']): City {
  return {
    id: 'c', name: { zh: '城', en: 'City' }, pos: { x: 0, y: 0 },
    terrain, factionId: 'dongzhuo', agriculture: 50, commerce: 50, defense: 50,
    loyalty: 50, money: 0, food: 0, generals: [], garrison: 3000, flags: {},
  };
}

describe('generateField', () => {
  it('is deterministic for a given seed', () => {
    const a = generateField(city(['plain']), 123);
    const b = generateField(city(['plain']), 123);
    expect(a).toEqual(b);
  });

  it('differs across seeds', () => {
    const a = generateField(city(['plain']), 1);
    const b = generateField(city(['plain']), 2);
    expect(a).not.toEqual(b);
  });

  it('sizes arrays to BATTLE_WIDTH*BATTLE_HEIGHT', () => {
    const f = generateField(city(['mountain']), 5);
    expect(f.width).toBe(BATTLE_WIDTH);
    expect(f.height).toBe(BATTLE_HEIGHT);
    expect(f.cells.length).toBe(BATTLE_WIDTH * BATTLE_HEIGHT);
    expect(f.heights.length).toBe(BATTLE_WIDTH * BATTLE_HEIGHT);
  });

  it('carves a connected river with at least one ford when terrain includes river', () => {
    const f = generateField(city(['river']), 9);
    expect(f.river).toBeDefined();
    const riverCells = f.cells.filter((c) => c === 'river' || c === 'ford');
    expect(riverCells.length).toBeGreaterThan(BATTLE_HEIGHT - 1); // spans the field
    expect(f.river!.fords.length).toBeGreaterThanOrEqual(1);
  });

  it('always builds a defender wall arc with exactly one gate', () => {
    const f = generateField(city(['plain']), 3);
    expect(f.wall).toBeDefined();
    expect(f.wall!.cells.length).toBeGreaterThan(0);
    const gateCount = f.cells.filter((c) => c === 'gate').length;
    expect(gateCount).toBe(1);
  });

  it('produces more hills for mountain terrain than plain', () => {
    const hills = (t: City['terrain']) =>
      generateField(city(t), 7).cells.filter((c) => c === 'hill').length;
    expect(hills(['mountain'])).toBeGreaterThan(hills(['plain']));
  });
});
