import { DUEL_CONFIG } from './config.js';
import { dist } from './hitbox.js';
import { nextRng } from './types.js';
import type { BossAction, BossState, DuelEvent, PlayerState, Vec2 } from './types.js';

const C = DUEL_CONFIG;
const PHASE1: BossAction[] = ['sweep', 'smash', 'lunge'];
const PHASE2: BossAction[] = ['sweep', 'smash', 'lunge', 'combo', 'charge'];

function faceToward(from: Vec2, to: Vec2, fallback: number): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx === 0 && dz === 0) return fallback;
  return Math.atan2(dz, dx);
}
function timing(action: BossAction, phase: 1 | 2) {
  const a = C.boss.attacks[action as keyof typeof C.boss.attacks];
  const mul = phase === 2 ? 1 / C.boss.phase2SpeedMul : 1;
  return { windupMs: a.windupMs * mul, activeMs: a.activeMs * mul, recoveryMs: a.recoveryMs * mul };
}

export function stepBoss(boss0: BossState, player: PlayerState, dtMs: number): { boss: BossState; events: DuelEvent[] } {
  const events: DuelEvent[] = [];
  let b: BossState = { ...boss0 };

  // Phase flip (once).
  if (b.phase === 1 && b.hp <= b.maxHp * C.boss.phase2Threshold) {
    b.phase = 2;
    events.push({ kind: 'phaseChange', at: b.pos });
  }

  b.facing = faceToward(b.pos, player.pos, b.facing);

  // Advance an in-progress attack.
  if (b.attackPhase !== null && b.action !== 'idle' && b.action !== 'reposition' && b.action !== 'stagger') {
    const t = timing(b.action, b.phase);
    b.actionTimer += dtMs;
    if (b.attackPhase === 'windup' && b.actionTimer >= t.windupMs) {
      b.attackPhase = 'active';
      b.actionTimer = 0;
      b.hitThisSwing = false;
    } else if (b.attackPhase === 'active' && b.actionTimer >= t.activeMs) {
      b.attackPhase = 'recovery';
      b.actionTimer = 0;
    } else if (b.attackPhase === 'recovery' && b.actionTimer >= t.recoveryMs) {
      b.attackPhase = null;
      b.action = 'idle';
      b.actionTimer = 0;
      const { value, state } = nextRng(b.rngState);
      b.rngState = state;
      b.nextDecisionIn = C.boss.idleMinMs + value * (C.boss.idleMaxMs - C.boss.idleMinMs);
    }
    return { boss: b, events };
  }

  // Idle: decide.
  b.nextDecisionIn -= dtMs;
  const dtSec = dtMs / 1000;
  const speed = C.boss.moveSpeed * (b.phase === 2 ? C.boss.phase2SpeedMul : 1);
  const range = dist(b.pos, player.pos);
  if (range > C.boss.contactRange) {
    // Close the gap.
    const dx = player.pos.x - b.pos.x;
    const dz = player.pos.z - b.pos.z;
    const m = Math.hypot(dx, dz) || 1;
    b.pos = { x: b.pos.x + (dx / m) * speed * dtSec, z: b.pos.z + (dz / m) * speed * dtSec };
    b.action = 'reposition';
    return { boss: b, events };
  }
  if (b.nextDecisionIn <= 0) {
    const pool = b.phase === 2 ? PHASE2 : PHASE1;
    const { value, state } = nextRng(b.rngState);
    b.rngState = state;
    const action = pool[Math.floor(value * pool.length)] ?? 'sweep';
    b.action = action;
    b.attackPhase = 'windup';
    b.actionTimer = 0;
    b.hitThisSwing = false;
    events.push({ kind: 'bossTell', at: b.pos, amount: action === 'smash' ? 2 : 1 });
    return { boss: b, events };
  }
  b.action = 'idle';
  return { boss: b, events };
}
