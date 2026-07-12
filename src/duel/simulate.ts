import { DUEL_CONFIG } from './config.js';
import type { BossState, DuelEvent, DuelInput, DuelState, PlayerState, Vec2 } from './types.js';

const C = DUEL_CONFIG;

export function createDuelState(seed: number = C.seed): DuelState {
  const player: PlayerState = {
    pos: { x: -3, z: 0 },
    facing: 0,
    hp: C.player.maxHp,
    maxHp: C.player.maxHp,
    stamina: C.player.maxStamina,
    maxStamina: C.player.maxStamina,
    action: 'idle',
    actionTimer: 0,
    attackPhase: null,
    comboIndex: 0,
    comboWindow: 0,
    iframes: 0,
    staminaIdle: C.player.staminaRegenDelayMs,
    hitThisSwing: false,
  };
  const boss: BossState = {
    pos: { x: 3, z: 0 },
    facing: Math.PI,
    hp: C.boss.maxHp,
    maxHp: C.boss.maxHp,
    action: 'idle',
    actionTimer: 0,
    attackPhase: null,
    phase: 1,
    hitThisSwing: false,
    nextDecisionIn: C.boss.idleMinMs,
    rngState: seed || 1,
  };
  return { player, boss, elapsed: 0, outcome: null, hitStop: 0, slowMo: 0 };
}

function clampToArena(p: Vec2): Vec2 {
  const d = Math.hypot(p.x, p.z);
  if (d <= C.arena.radius) return p;
  const k = C.arena.radius / d;
  return { x: p.x * k, z: p.z * k };
}

function faceToward(from: Vec2, to: Vec2, fallback: number): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx === 0 && dz === 0) return fallback;
  return Math.atan2(dz, dx);
}

// Advances the player's locomotion + stamina for this tick and returns the new
// player state. Attacks/dodge/guard are handled in later tasks; while the player
// is mid-action (action !== 'idle'/'move') this still lets timers run but that
// is wired in Task 4/6 — here the player is always idle/move.
function stepPlayerMovement(p: PlayerState, input: DuelInput, boss: BossState, dtMs: number): PlayerState {
  const dtSec = dtMs / 1000;
  let pos = p.pos;
  let action: PlayerState['action'] = 'idle';
  const mag = Math.hypot(input.move.x, input.move.z);
  if (mag > 1e-4) {
    const nx = input.move.x / mag;
    const nz = input.move.z / mag;
    pos = clampToArena({ x: p.pos.x + nx * C.player.moveSpeed * dtSec, z: p.pos.z + nz * C.player.moveSpeed * dtSec });
    action = 'move';
  }
  // Stamina: count idle time; regen once past the delay.
  let staminaIdle = p.staminaIdle + dtMs;
  let stamina = p.stamina;
  if (staminaIdle >= C.player.staminaRegenDelayMs) {
    stamina = Math.min(p.maxStamina, stamina + C.player.staminaRegenPerSec * dtSec);
  }
  const facing = faceToward(pos, boss.pos, p.facing);
  return { ...p, pos, action, facing, stamina, staminaIdle };
}

export function stepDuel(state: DuelState, input: DuelInput, dtMs: number): { state: DuelState; events: DuelEvent[] } {
  const events: DuelEvent[] = [];
  if (state.outcome) return { state, events };

  // Hit-stop: freeze the simulation (juice) but bleed the timer down.
  if (state.hitStop > 0) {
    return { state: { ...state, hitStop: Math.max(0, state.hitStop - dtMs) }, events };
  }

  const player = stepPlayerMovement(state.player, input, state.boss, dtMs);
  // Boss is inert until Task 5.
  const boss = state.boss;

  return {
    state: { ...state, player, boss, elapsed: state.elapsed + dtMs },
    events,
  };
}
