import { describe, expect, it } from 'vitest';
import { DUEL_CONFIG } from '../../src/duel/config.js';
import { nextRng } from '../../src/duel/types.js';

describe('DUEL_CONFIG', () => {
  it('has a phase-2 threshold strictly between 0 and 1', () => {
    expect(DUEL_CONFIG.boss.phase2Threshold).toBeGreaterThan(0);
    expect(DUEL_CONFIG.boss.phase2Threshold).toBeLessThan(1);
  });
  it('gives the player less HP than the boss (the boss is a wall)', () => {
    expect(DUEL_CONFIG.player.maxHp).toBeLessThan(DUEL_CONFIG.boss.maxHp);
  });
  it('every boss attack has positive windup/active/recovery so tells are dodgeable', () => {
    for (const atk of Object.values(DUEL_CONFIG.boss.attacks)) {
      expect(atk.windupMs).toBeGreaterThan(0);
      expect(atk.activeMs).toBeGreaterThan(0);
      expect(atk.recoveryMs).toBeGreaterThan(0);
    }
  });
});

describe('nextRng', () => {
  it('is deterministic for a given state', () => {
    expect(nextRng(1)).toEqual(nextRng(1));
  });
  it('returns a value in [0,1) and advances state', () => {
    const { value, state } = nextRng(1);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
    expect(state).not.toBe(1);
  });
});
