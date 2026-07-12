// tests/duel/balance.test.ts
import { describe, expect, it } from 'vitest';
import { createDuelState, stepDuel } from '../../src/duel/simulate.js';
import { DUEL_CONFIG } from '../../src/duel/config.js';
import type { DuelInput, DuelState } from '../../src/duel/types.js';

const dt = DUEL_CONFIG.fixedDtMs;
const NONE: DuelInput = { move: { x: 0, z: 0 }, light: false, heavy: false, dodge: false, guard: false };
const MAX_FRAMES = Math.ceil((180 * 1000) / dt); // 180s ceiling

function run(policy: (s: DuelState, frame: number) => DuelInput): DuelState {
  let s = createDuelState(1);
  for (let f = 0; f < MAX_FRAMES && !s.outcome; f++) s = stepDuel(s, policy(s, f), dt).state;
  return s;
}

// The boss's windup duration for its current attack, accounting for the phase-2
// speed-up. Used by the patient policy to time its pre-dodge.
function bossWindupMs(b: DuelState['boss']): number {
  const atk = DUEL_CONFIG.boss.attacks[b.action as keyof typeof DUEL_CONFIG.boss.attacks];
  if (!atk) return Infinity;
  const mul = b.phase === 2 ? 1 / DUEL_CONFIG.boss.phase2SpeedMul : 1;
  return atk.windupMs * mul;
}

describe('duel balance', () => {
  it('a passive player loses (the boss is a real threat)', () => {
    const s = run(() => NONE);
    expect(s.outcome).toBe('lose');
  });

  it('a patient dodge-and-punish player wins within 180s', () => {
    const s = run((st) => {
      const b = st.boss;
      const p = st.player;
      const dodge = DUEL_CONFIG.player.dodge;
      const heavy = DUEL_CONFIG.player.heavy;

      const dx = b.pos.x - p.pos.x;
      const dz = b.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const towardBoss = { x: dx / d, z: dz / d };

      const canDodge = p.iframes <= 0 && p.action !== 'dodge' && p.stamina >= dodge.stamina;

      // Pre-dodge near the end of the boss's windup: the active hitbox resolves
      // on the very frame the boss enters 'active', so a purely reactive dodge is
      // too late. Dodging while <= half an i-frame window of windup remains keeps
      // the i-frames live through the hit, and dodging TOWARD the boss leaves us
      // inside heavy range to punish the recovery.
      if (b.attackPhase === 'windup' && canDodge) {
        const remaining = bossWindupMs(b) - b.actionTimer;
        if (remaining <= dodge.iframeMs * 0.5) {
          return { ...NONE, dodge: true, move: towardBoss };
        }
      }

      // Safety net: if a swing is already active and we somehow have no i-frames,
      // dodge clear.
      if (b.attackPhase === 'active' && canDodge) {
        return { ...NONE, dodge: true, move: { x: 0, z: 1 } };
      }

      // Punish during the boss's recovery, but only while a dodge stays in
      // reserve so the next tell is always answerable.
      if (b.attackPhase === 'recovery' && p.stamina >= heavy.stamina + dodge.stamina) {
        if (d <= heavy.range) return { ...NONE, heavy: true };
        return { ...NONE, move: towardBoss }; // close into heavy range first
      }

      // Otherwise close to contact range.
      if (d > 2) return { ...NONE, move: towardBoss };
      return NONE;
    });
    expect(s.outcome).toBe('win');
  });
});
