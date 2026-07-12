import { stepBoss } from './boss.js';
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

  // I-frames tick down every frame (floor at 0). A dodge started this frame
  // re-arms them below, so this decrement only bleeds an in-progress dodge.
  p.iframes = Math.max(0, p.iframes - dtMs);

  // 0) Dodge: highest-priority reaction. Cannot dodge-cancel the active frames
  // of one's own swing; costs stamina; grants i-frames plus a directional lunge
  // (along the move stick, or straight away from the boss when the stick is
  // neutral).
  const dodge = C.player.dodge;
  if (input.dodge && p.attackPhase !== 'active' && p.stamina >= dodge.stamina) {
    const moveMag = Math.hypot(input.move.x, input.move.z);
    let dir: Vec2;
    if (moveMag > 1e-4) {
      dir = { x: input.move.x / moveMag, z: input.move.z / moveMag };
    } else {
      const dx = p.pos.x - boss.pos.x;
      const dz = p.pos.z - boss.pos.z;
      const m = Math.hypot(dx, dz) || 1;
      dir = { x: dx / m, z: dz / m };
    }
    p.action = 'dodge';
    p.attackPhase = null;
    p.iframes = dodge.iframeMs;
    p.actionTimer = 0;
    p.stamina -= dodge.stamina;
    p.staminaIdle = 0;
    p.pos = clampToArena({ x: p.pos.x + dir.x * dodge.distance, z: p.pos.z + dir.z * dodge.distance });
    p.comboWindow = Math.max(0, p.comboWindow - dtMs);
    p.facing = faceToward(p.pos, boss.pos, p.facing);
    events.push({ kind: 'dodge', at: p.pos });
    return { player: p, boss, events };
  }

  // 0b) Advance an in-progress dodge/stagger back toward idle. I-frames were
  // already ticked above, so this only runs the recovery timer + stamina regen.
  if (p.action === 'dodge' || p.action === 'stagger') {
    p.actionTimer += dtMs;
    const durationMs = p.action === 'dodge' ? dodge.durationMs : C.player.staggerMs;
    if (p.actionTimer >= durationMs) {
      p.action = 'idle';
      p.attackPhase = null;
      p.actionTimer = 0;
    }
    p.comboWindow = Math.max(0, p.comboWindow - dtMs);
    p.staminaIdle += dtMs;
    if (p.staminaIdle >= C.player.staminaRegenDelayMs) {
      p.stamina = Math.min(p.maxStamina, p.stamina + C.player.staminaRegenPerSec * dtSec);
    }
    p.facing = faceToward(p.pos, boss.pos, p.facing);
    return { player: p, boss, events };
  }

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

  const { player: pAfter, boss: bMid, events: pEvents } = stepPlayer(state.player, input, state.boss, dtMs);
  const { boss: bAfter, events: bEvents } = stepBoss(bMid, pAfter, dtMs);
  let player = pAfter;
  let boss = bAfter;
  const outEvents: DuelEvent[] = [...pEvents, ...bEvents];

  // Resolve the boss's active hitbox against the player (once per swing): i-frames
  // negate it, a guard chips + spends stamina, otherwise a full hit + stagger.
  if (boss.attackPhase === 'active' && !boss.hitThisSwing) {
    const atk = C.boss.attacks[boss.action as keyof typeof C.boss.attacks];
    if (atk && inAttackArc(boss.pos, boss.facing, player.pos, atk.range, atk.arc)) {
      boss = { ...boss, hitThisSwing: true };
      if (player.iframes > 0) {
        // Avoided by dodge i-frames — no damage (the dodge event already fired).
      } else if (input.guard && player.stamina >= C.player.guard.staminaPerHit) {
        const chip = atk.dmg * C.player.guard.chipMul;
        player = { ...player, hp: Math.max(0, player.hp - chip), stamina: player.stamina - C.player.guard.staminaPerHit, staminaIdle: 0 };
        outEvents.push({ kind: 'guardDeflect', at: player.pos, amount: chip });
      } else {
        player = { ...player, hp: Math.max(0, player.hp - atk.dmg), action: 'stagger', attackPhase: null, actionTimer: 0 };
        outEvents.push({ kind: 'bossHitPlayer', at: player.pos, amount: atk.dmg });
      }
    }
  }

  // Decisive blow: end the duel and arm the slow-mo flourish. `state.outcome`
  // is narrowed to `null` by the guard above, so annotate to keep it assignable.
  let outcome: DuelState['outcome'] = state.outcome;
  let slowMo = Math.max(0, state.slowMo - dtMs);
  if (!outcome && boss.hp <= 0) {
    outcome = 'win';
    slowMo = C.juice.slowMoMs;
    outEvents.push({ kind: 'win', at: boss.pos });
  } else if (!outcome && player.hp <= 0) {
    outcome = 'lose';
    slowMo = C.juice.slowMoMs;
    outEvents.push({ kind: 'lose', at: player.pos });
  }

  return {
    state: { ...state, player, boss, elapsed: state.elapsed + dtMs, outcome, slowMo, hitStop: state.hitStop },
    events: outEvents,
  };
}
