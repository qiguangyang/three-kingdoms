import { describe, expect, it } from 'vitest';
import { stepBoss } from '../../src/duel/boss.js';
import { createDuelState } from '../../src/duel/simulate.js';
import { DUEL_CONFIG } from '../../src/duel/config.js';
import type { BossState, PlayerState } from '../../src/duel/types.js';

function boss(overrides: Partial<BossState> = {}): BossState {
  return { ...createDuelState(1).boss, ...overrides };
}
function playerAt(x: number, z = 0): PlayerState {
  return { ...createDuelState(1).player, pos: { x, z } };
}
const dt = DUEL_CONFIG.fixedDtMs;

describe('stepBoss', () => {
  it('moves toward a distant player instead of attacking', () => {
    let b = boss({ pos: { x: 8, z: 0 }, nextDecisionIn: 0 });
    const p = playerAt(0);
    const before = b.pos.x;
    b = stepBoss(b, p, dt).boss;
    expect(b.pos.x).toBeLessThan(before); // stepped toward x=0
  });
  it('commits to a telegraphed attack when the player is in range', () => {
    let b = boss({ pos: { x: 1.5, z: 0 }, nextDecisionIn: 0 });
    const p = playerAt(0);
    const { boss: nb, events } = stepBoss(b, p, dt);
    expect(nb.attackPhase).toBe('windup');
    expect(['sweep', 'smash', 'lunge']).toContain(nb.action);
    expect(events.some((e) => e.kind === 'bossTell')).toBe(true);
  });
  it('is deterministic for a given rngState', () => {
    const b = boss({ pos: { x: 1.5, z: 0 }, nextDecisionIn: 0, rngState: 42 });
    const p = playerAt(0);
    expect(stepBoss(b, p, dt).boss.action).toBe(stepBoss(b, p, dt).boss.action);
  });
  it('flips to phase 2 when HP crosses the threshold', () => {
    const thresh = DUEL_CONFIG.boss.maxHp * DUEL_CONFIG.boss.phase2Threshold;
    let b = boss({ hp: thresh - 1, phase: 1 });
    const { boss: nb, events } = stepBoss(b, playerAt(0), dt);
    expect(nb.phase).toBe(2);
    expect(events.some((e) => e.kind === 'phaseChange')).toBe(true);
  });
  it('can pick a phase-2-only attack (combo/charge) in phase 2', () => {
    // Drive many decisions and confirm the phase-2 move set is reachable. Each
    // attack spans its full windup->active->recovery cycle (~60 ticks in phase
    // 2), so the loop is long enough to sample dozens of independent decisions.
    let b = boss({ pos: { x: 1.5, z: 0 }, phase: 2, hp: 60, nextDecisionIn: 0, rngState: 7 });
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      b = stepBoss(b, playerAt(1.5), dt).boss;
      seen.add(b.action);
      if (b.attackPhase === null) b = { ...b, nextDecisionIn: 0 };
    }
    expect(seen.has('combo') || seen.has('charge')).toBe(true);
  });
});
