import { DUEL_CONFIG } from './config.js';
import { inAttackArc } from './hitbox.js';
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

type PlayerStep = { player: PlayerState; boss: BossState; events: DuelEvent[] };

function playerAttackDef(action: PlayerState['action']) {
  return action === 'heavyAttack' ? C.player.heavy : C.player.light;
}

// Advances the player's action for this tick: resolves an in-progress attack
// (windup→active→recovery, dealing boss damage once per swing when the boss is
// inside the arc during `active`), starts a new light/heavy attack on input
// (gated by stamina, chaining the light combo within the combo window), or
// falls through to locomotion + stamina regen (Task 3 behavior). Pure: reads
// the input player/boss, returns fresh state and the events emitted.
function stepPlayer(p0: PlayerState, input: DuelInput, boss0: BossState, dtMs: number): PlayerStep {
  const events: DuelEvent[] = [];
  const dtSec = dtMs / 1000;
  let p = { ...p0 };
  let boss = boss0;

  // 1) Resolve an in-progress attack.
  if (p.attackPhase !== null && (p.action === 'lightAttack' || p.action === 'heavyAttack')) {
    const def = playerAttackDef(p.action);
    p.actionTimer += dtMs;
    p.facing = faceToward(p.pos, boss.pos, p.facing);
    if (p.attackPhase === 'windup' && p.actionTimer >= def.windupMs) {
      p.attackPhase = 'active';
      p.actionTimer = 0;
    } else if (p.attackPhase === 'active') {
      if (!p.hitThisSwing && inAttackArc(p.pos, p.facing, boss.pos, def.range, def.arc)) {
        p.hitThisSwing = true;
        boss = { ...boss, hp: Math.max(0, boss.hp - def.dmg) };
        events.push({ kind: 'playerHit', at: boss.pos, amount: def.dmg });
        if (p.action === 'lightAttack') p.comboWindow = C.player.comboWindowMs;
      }
      if (p.actionTimer >= def.activeMs) {
        p.attackPhase = 'recovery';
        p.actionTimer = 0;
      }
    } else if (p.attackPhase === 'recovery' && p.actionTimer >= def.recoveryMs) {
      p.attackPhase = null;
      p.action = 'idle';
      p.actionTimer = 0;
    }
    p.comboWindow = Math.max(0, p.comboWindow - dtMs);
    p.staminaIdle += dtMs;
    return { player: p, boss, events };
  }

  // 2) Start a new attack.
  const wantHeavy = input.heavy;
  const wantLight = input.light;
  if (wantHeavy || wantLight) {
    const def = wantHeavy ? C.player.heavy : C.player.light;
    if (p.stamina < def.stamina) {
      events.push({ kind: 'staminaEmpty', at: p.pos });
    } else {
      p.stamina -= def.stamina;
      p.staminaIdle = 0;
      p.action = wantHeavy ? 'heavyAttack' : 'lightAttack';
      p.attackPhase = 'windup';
      p.actionTimer = 0;
      p.hitThisSwing = false;
      p.comboIndex = wantLight && p.comboWindow > 0 ? (p.comboIndex + 1) % C.player.comboHits : 0;
      p.facing = faceToward(p.pos, boss.pos, p.facing);
      events.push({ kind: 'playerSwing', at: p.pos });
      return { player: p, boss, events };
    }
  }

  // 3) Locomotion + stamina regen (Task 3 behavior).
  let pos = p.pos;
  let action: PlayerState['action'] = 'idle';
  const mag = Math.hypot(input.move.x, input.move.z);
  if (mag > 1e-4) {
    pos = clampToArena({ x: p.pos.x + (input.move.x / mag) * C.player.moveSpeed * dtSec, z: p.pos.z + (input.move.z / mag) * C.player.moveSpeed * dtSec });
    action = 'move';
  }
  p.staminaIdle += dtMs;
  if (p.staminaIdle >= C.player.staminaRegenDelayMs) {
    p.stamina = Math.min(p.maxStamina, p.stamina + C.player.staminaRegenPerSec * dtSec);
  }
  p.comboWindow = Math.max(0, p.comboWindow - dtMs);
  p.pos = pos;
  p.action = action;
  p.facing = faceToward(pos, boss.pos, p.facing);
  return { player: p, boss, events };
}

export function stepDuel(state: DuelState, input: DuelInput, dtMs: number): { state: DuelState; events: DuelEvent[] } {
  const events: DuelEvent[] = [];
  if (state.outcome) return { state, events };

  // Hit-stop: freeze the simulation (juice) but bleed the timer down.
  if (state.hitStop > 0) {
    return { state: { ...state, hitStop: Math.max(0, state.hitStop - dtMs) }, events };
  }

  const { player, boss, events: pEvents } = stepPlayer(state.player, input, state.boss, dtMs);
  events.push(...pEvents);
  return { state: { ...state, player, boss, elapsed: state.elapsed + dtMs }, events };
}
