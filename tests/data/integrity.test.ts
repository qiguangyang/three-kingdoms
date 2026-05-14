import { describe, expect, it } from 'vitest';
import { CITIES } from '../../src/data/cities.js';
import { GENERALS } from '../../src/data/generals/index.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';

describe('data integrity (scenario 1)', () => {
  it('every faction\'s cityIds resolve to a known city', () => {
    for (const f of SCENARIO_DONGZHUO.factions) {
      for (const id of f.cityIds) {
        expect(CITIES[id], `Missing city ${id} for faction ${f.id}`).toBeDefined();
      }
    }
  });

  it('every faction\'s generalIds resolve to a known general', () => {
    for (const f of SCENARIO_DONGZHUO.factions) {
      for (const id of f.generalIds) {
        expect(GENERALS[id], `Missing general ${id} for faction ${f.id}`).toBeDefined();
      }
    }
  });

  it('scenario has 15 factions and at least 40 cities total in the world', () => {
    expect(SCENARIO_DONGZHUO.factions.length).toBe(15);
    expect(Object.keys(CITIES).length).toBeGreaterThanOrEqual(40);
  });

  it('every general has bilingual names', () => {
    for (const g of Object.values(GENERALS)) {
      expect(typeof g.name.zh).toBe('string');
      expect(typeof g.name.en).toBe('string');
      expect(g.name.zh.length).toBeGreaterThan(0);
      expect(g.name.en.length).toBeGreaterThan(0);
    }
  });
});
