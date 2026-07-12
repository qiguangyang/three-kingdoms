# Liu Bei Duel RPG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a third-person, souls-lite, real-time **duel** (play as Liu Bei vs Lü Bu at 虎牢关) and fold it into the existing Story-Mode campaign as the Chapter 1 climax, via a `pendingDuel` pause that mirrors `pendingBattle`/`pendingStoryEvent`.

**Architecture:** A **pure fixed-timestep simulation** in `src/duel/` (`stepDuel(state, input, dt)`), driven by a Three.js renderer in `src/web/duel/` that reuses the battle renderer's presentation pipeline. The campaign integrates the duel through a `pendingDuel` seam in the strategy engine/store; `resolveDuel(outcome)` branches the story so win *or* lose continues Chapter 1. The off-screen `resolveQuickBattle` (THE SEAM) is never touched.

**Tech Stack:** TypeScript (ESM/NodeNext, explicit `.js` specifiers), React 19 DOM, Zustand, Three.js, Vitest + Testing-Library/jsdom, Vite.

**Spec:** `docs/superpowers/specs/2026-07-12-liubei-duel-rpg-design.md`

## Global Constraints

- **English identifiers + comments; user-facing strings bilingual zh+en** via `MessageKey` + both catalogs (`src/i18n/catalog/{en,zh}.ts`); the i18n parity test must stay green.
- **THE SEAM is sacred:** no behavior change to `resolveQuickBattle`, `src/engine/combat`, `src/engine/pendingOp.ts`, or turn resolution.
- **No regression:** the full existing suite (currently **600 tests / 71 files**) + `npx tsc --noEmit` + `npm run build` stay green after **every** task.
- **Pure engine discipline:** no `Date.now()` / `Math.random()` in `src/duel/` logic or `src/engine/`. Fixed timesteps + a seeded PRNG. `requestAnimationFrame` and wall-clock live ONLY in `src/web/duel/` renderer files.
- **Isolation:** `src/duel/` must not import from `src/engine/` or `src/state/`; the strategy engine reaches the duel only through the `pendingDuel` field + `resolveDuel`. The renderer (`src/web/duel/`) may import `src/duel/` and shared `src/web/three/` helpers.
- **Determinism at the seam:** `resolveDuel(outcome)` is a pure state transition; the no-WebGL auto-resolve uses a seeded roll (no `Math.random`).
- **Ground-plane convention:** positions are `{x, z}` on the XZ plane (matches `src/web/battle/geometry.ts`); `y` is up.

---

## File Structure

**New — duel simulation (pure, `src/duel/`):**
- `types.ts` — all duel data types + a seeded PRNG helper.
- `config.ts` — `DUEL_CONFIG` tunables (the balance surface).
- `hitbox.ts` — pure overlap math.
- `simulate.ts` — `stepDuel(state, input, dt)`; also `createDuelState(seed)`.
- `boss.ts` — Lü Bu AI: `stepBoss(...)`, action selection, phase flips.

**New — duel renderer (`src/web/duel/`):**
- `input.ts` — keyboard/pointer → `DuelInput`.
- `characterRig.ts` — procedural Liu Bei / Lü Bu rigs with pose states.
- `DuelScene.ts` — Three.js scene, follow-cam, RAF loop, mesh sync, FX.
- `DuelCanvas.tsx` — React↔DuelScene lifecycle bridge.
- `DuelScreen.tsx` — HUD + result overlay + input wiring + store callback.

**New — shared Three.js helpers (`src/web/three/`):** extracted, cleanly-standalone presentation utilities (particles, camera shake) reused by both battle and duel renderers.

**New — campaign seam:**
- `src/engine/duel/setpieces.ts` — the duel set-piece registry.

**Modified:**
- `src/engine/types.ts` — add `pendingDuel?`, `duelResults` to `GameState`; `PendingDuel` type.
- `src/state/store.ts` — freeze tick on `pendingDuel`, route `screen:'duel'`, `resolveDuel`, restore-on-load.
- `src/state/store.ts` `Screen` union — add `{ kind: 'duel' }`.
- `src/data/story/s1-liubei.ts` — lead-in trigger event + win/lose aftermath events.
- `src/web/App.tsx` — `case 'duel'`.
- `src/i18n/types.ts` + `src/i18n/catalog/{en,zh}.ts` — `duel.*` and Ch1 aftermath keys.

---

## PHASE A — Duel simulation core (pure)

### Task 1: Duel types, seeded PRNG, and config

**Files:**
- Create: `src/duel/types.ts`
- Create: `src/duel/config.ts`
- Test: `tests/duel/config.test.ts`

**Interfaces:**
- Produces: all types below; `nextRng(state: number): { value: number; state: number }` (value in [0,1)); `DUEL_CONFIG`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/duel/config.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/duel/config.test.ts`
Expected: FAIL — cannot resolve `src/duel/config.js` / `src/duel/types.js`.

- [ ] **Step 3: Write `src/duel/types.ts`**

```ts
// Pure duel data model. No Three.js, no engine, no wall-clock — this file is
// imported by both the simulation and (its types only) the renderer. Positions
// are on the XZ ground plane; y is up and not modeled here.

export type DuelOutcome = 'win' | 'lose';

export interface Vec2 {
  x: number;
  z: number;
}

export type PlayerAction =
  | 'idle'
  | 'move'
  | 'lightAttack'
  | 'heavyAttack'
  | 'dodge'
  | 'guard'
  | 'stagger';

export type BossAction =
  | 'idle'
  | 'reposition'
  | 'sweep'
  | 'smash'
  | 'lunge'
  | 'combo'
  | 'charge'
  | 'stagger';

// Sub-phase of an in-progress attack (whichever fighter is attacking).
export type AttackPhase = 'windup' | 'active' | 'recovery';

export interface PlayerState {
  pos: Vec2;
  facing: number; // yaw radians
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  action: PlayerAction;
  actionTimer: number; // ms elapsed in the current action
  attackPhase: AttackPhase | null;
  comboIndex: number; // 0-based hit of the light combo
  comboWindow: number; // ms remaining to chain the next light hit
  iframes: number; // ms of invulnerability remaining (>0 during a dodge)
  staminaIdle: number; // ms since stamina was last spent (regen delay)
  hitThisSwing: boolean; // has the current active swing already landed
}

export interface BossState {
  pos: Vec2;
  facing: number;
  hp: number;
  maxHp: number;
  action: BossAction;
  actionTimer: number;
  attackPhase: AttackPhase | null;
  phase: 1 | 2;
  hitThisSwing: boolean;
  nextDecisionIn: number; // ms until it picks an action while idle
  rngState: number; // seeded PRNG state
}

export interface DuelState {
  player: PlayerState;
  boss: BossState;
  elapsed: number; // total simulated ms
  outcome: DuelOutcome | null;
  hitStop: number; // ms of freeze remaining (juice; sim ignores input while >0)
  slowMo: number; // ms of slow-mo remaining (renderer scales dt; sim records it)
}

export interface DuelInput {
  move: Vec2; // desired move direction (need not be normalized); {0,0} = none
  light: boolean; // edge-triggered: true only on the frame the key went down
  heavy: boolean;
  dodge: boolean;
  guard: boolean; // held (level-triggered)
}

export type DuelEventKind =
  | 'playerSwing'
  | 'bossTell'
  | 'playerHit' // boss took damage
  | 'bossHitPlayer' // player took damage
  | 'dodge'
  | 'guardDeflect'
  | 'staminaEmpty'
  | 'phaseChange'
  | 'win'
  | 'lose';

export interface DuelEvent {
  kind: DuelEventKind;
  at: Vec2;
  amount?: number;
}

// Deterministic PRNG (Math.imul hash, same family used elsewhere in the engine).
// Returns a value in [0,1) plus the next state; callers thread `state` through
// so the whole simulation stays reproducible from a single seed.
export function nextRng(state: number): { value: number; state: number } {
  let s = state | 0;
  s = Math.imul(s ^ (s >>> 15), s | 1);
  s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
  const out = ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  return { value: out, state: (s >>> 0) || 1 };
}
```

- [ ] **Step 4: Write `src/duel/config.ts`**

```ts
// The balance surface for the duel. All timings in milliseconds, distances in
// world units (same scale as the battle geometry), speeds in units/second.
// Tuned so a patient dodge-and-punish player wins in ~60-120s and a passive
// player loses (see the balance harness in Task 7).

export const DUEL_CONFIG = {
  player: {
    maxHp: 100,
    maxStamina: 100,
    staminaRegenPerSec: 24,
    staminaRegenDelayMs: 450, // no regen until this long after spending
    moveSpeed: 4.4,
    light: { dmg: 7, stamina: 12, windupMs: 90, activeMs: 90, recoveryMs: 170, range: 1.9, arc: 1.2 },
    heavy: { dmg: 19, stamina: 30, windupMs: 300, activeMs: 120, recoveryMs: 360, range: 2.2, arc: 1.4 },
    dodge: { stamina: 20, iframeMs: 300, durationMs: 400, distance: 3.2 },
    guard: { chipMul: 0.25, staminaPerHit: 18 },
    comboWindowMs: 420,
    comboHits: 3,
    staggerMs: 320,
  },
  boss: {
    maxHp: 220,
    phase2Threshold: 0.5, // fraction of maxHp
    phase2SpeedMul: 1.35,
    moveSpeed: 3.4,
    contactRange: 2.4, // how close it wants to be before attacking
    staggerMs: 260,
    idleMinMs: 260,
    idleMaxMs: 820,
    attacks: {
      sweep: { dmg: 20, windupMs: 620, activeMs: 160, recoveryMs: 640, range: 3.0, arc: 2.4 },
      smash: { dmg: 28, windupMs: 720, activeMs: 140, recoveryMs: 720, range: 2.6, arc: 1.0 },
      lunge: { dmg: 22, windupMs: 520, activeMs: 180, recoveryMs: 560, range: 4.6, arc: 0.8 },
      combo: { dmg: 16, windupMs: 440, activeMs: 140, recoveryMs: 300, range: 3.0, arc: 2.0 },
      charge: { dmg: 26, windupMs: 560, activeMs: 220, recoveryMs: 640, range: 6.5, arc: 1.0 },
    },
  },
  arena: { radius: 12 },
  fixedDtMs: 1000 / 60,
  juice: { hitStopMs: 90, slowMoMs: 700, slowMoScale: 0.35 },
  seed: 1,
} as const;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/duel/config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/duel/types.ts src/duel/config.ts tests/duel/config.test.ts
git commit -m "duel: pure types, seeded PRNG, and config tunables"
```

---

### Task 2: Hitbox overlap math

**Files:**
- Create: `src/duel/hitbox.ts`
- Test: `tests/duel/hitbox.test.ts`

**Interfaces:**
- Consumes: `Vec2` from `src/duel/types.js`.
- Produces:
  - `dist(a: Vec2, b: Vec2): number`
  - `inAttackArc(attacker: Vec2, facing: number, target: Vec2, range: number, arc: number): boolean` — true when `target` is within `range` and within `±arc/2` radians of `facing`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/duel/hitbox.test.ts
import { describe, expect, it } from 'vitest';
import { dist, inAttackArc } from '../../src/duel/hitbox.js';

describe('dist', () => {
  it('is the planar distance', () => {
    expect(dist({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5);
  });
});

describe('inAttackArc', () => {
  const origin = { x: 0, z: 0 };
  it('hits a target dead ahead within range', () => {
    // facing +x; target 2 units along +x.
    expect(inAttackArc(origin, 0, { x: 2, z: 0 }, 3, 1.2)).toBe(true);
  });
  it('misses a target beyond range', () => {
    expect(inAttackArc(origin, 0, { x: 5, z: 0 }, 3, 1.2)).toBe(false);
  });
  it('misses a target behind the attacker', () => {
    expect(inAttackArc(origin, 0, { x: -2, z: 0 }, 3, 1.2)).toBe(false);
  });
  it('misses a target outside the arc half-angle', () => {
    // target at 90° to the side; arc 1.2 rad => half-angle 0.6 rad (~34°) excludes it.
    expect(inAttackArc(origin, 0, { x: 0, z: 2 }, 3, 1.2)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/duel/hitbox.test.ts`
Expected: FAIL — `src/duel/hitbox.js` not found.

- [ ] **Step 3: Write `src/duel/hitbox.ts`**

```ts
import type { Vec2 } from './types.js';

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

// True when `target` lies within `range` of `attacker` AND within ±arc/2 of the
// attacker's `facing` yaw. Facing 0 points along +x; +z is 90° (Math.atan2(z, x)).
export function inAttackArc(
  attacker: Vec2,
  facing: number,
  target: Vec2,
  range: number,
  arc: number,
): boolean {
  const dx = target.x - attacker.x;
  const dz = target.z - attacker.z;
  const d = Math.hypot(dx, dz);
  if (d > range || d === 0) return d === 0; // point-blank always connects
  const angleTo = Math.atan2(dz, dx);
  let delta = angleTo - facing;
  // Normalize to [-π, π].
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return Math.abs(delta) <= arc / 2;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/duel/hitbox.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/duel/hitbox.ts tests/duel/hitbox.test.ts
git commit -m "duel: pure hitbox arc/overlap math"
```

---

### Task 3: `createDuelState` + player movement & stamina in `stepDuel`

**Files:**
- Create: `src/duel/simulate.ts`
- Test: `tests/duel/simulate-movement.test.ts`

**Interfaces:**
- Consumes: `DUEL_CONFIG`, all types, `nextRng`.
- Produces:
  - `createDuelState(seed?: number): DuelState` — both fighters at full HP, player at `{x:-3,z:0}` facing +x, boss at `{x:3,z:0}` facing -x (π), boss `action:'idle'`.
  - `stepDuel(state: DuelState, input: DuelInput, dtMs: number): { state: DuelState; events: DuelEvent[] }` — **pure** (returns a new state; does not mutate the argument). This task implements: hit-stop passthrough, player movement (clamped to `arena.radius`), facing toward the boss (soft lock-on), and stamina regen after the delay. Boss stays inert (`idle`, no movement) until Task 5. Attacks/dodge/guard are no-ops until Tasks 4/6.

- [ ] **Step 1: Write the failing test**

```ts
// tests/duel/simulate-movement.test.ts
import { describe, expect, it } from 'vitest';
import { createDuelState, stepDuel } from '../../src/duel/simulate.js';
import { DUEL_CONFIG } from '../../src/duel/config.js';
import type { DuelInput } from '../../src/duel/types.js';

const NO_INPUT: DuelInput = { move: { x: 0, z: 0 }, light: false, heavy: false, dodge: false, guard: false };
const dt = DUEL_CONFIG.fixedDtMs;

describe('createDuelState', () => {
  it('starts both fighters at full HP with the boss idle', () => {
    const s = createDuelState(1);
    expect(s.player.hp).toBe(DUEL_CONFIG.player.maxHp);
    expect(s.boss.hp).toBe(DUEL_CONFIG.boss.maxHp);
    expect(s.boss.action).toBe('idle');
    expect(s.outcome).toBeNull();
  });
});

describe('stepDuel movement', () => {
  it('moves the player toward the input direction', () => {
    const s0 = createDuelState(1);
    const startX = s0.player.pos.x;
    const { state } = stepDuel(s0, { ...NO_INPUT, move: { x: 1, z: 0 } }, dt);
    expect(state.player.pos.x).toBeGreaterThan(startX);
  });
  it('does not mutate the input state (purity)', () => {
    const s0 = createDuelState(1);
    const before = s0.player.pos.x;
    stepDuel(s0, { ...NO_INPUT, move: { x: 1, z: 0 } }, dt);
    expect(s0.player.pos.x).toBe(before);
  });
  it('clamps the player inside the arena radius', () => {
    let s = createDuelState(1);
    for (let i = 0; i < 600; i++) s = stepDuel(s, { ...NO_INPUT, move: { x: -1, z: 0 } }, dt).state;
    expect(Math.hypot(s.player.pos.x, s.player.pos.z)).toBeLessThanOrEqual(DUEL_CONFIG.arena.radius + 1e-6);
  });
  it('regenerates stamina after the regen delay when idle', () => {
    let s = createDuelState(1);
    s = { ...s, player: { ...s.player, stamina: 10, staminaIdle: DUEL_CONFIG.player.staminaRegenDelayMs } };
    const { state } = stepDuel(s, NO_INPUT, dt);
    expect(state.player.stamina).toBeGreaterThan(10);
  });
  it('faces the player toward the boss (soft lock-on)', () => {
    const s0 = createDuelState(1);
    const { state } = stepDuel(s0, NO_INPUT, dt);
    // Boss is at +x from the player, so facing should be near 0 rad.
    expect(Math.abs(state.player.facing)).toBeLessThan(0.2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/duel/simulate-movement.test.ts`
Expected: FAIL — `src/duel/simulate.js` not found.

- [ ] **Step 3: Write `src/duel/simulate.ts` (movement slice)**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/duel/simulate-movement.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/duel/simulate.ts tests/duel/simulate-movement.test.ts
git commit -m "duel: createDuelState + player movement/stamina/lock-on in stepDuel"
```

---

### Task 4: Player attacks → boss damage, combo, stamina gating

**Files:**
- Modify: `src/duel/simulate.ts`
- Test: `tests/duel/simulate-player-attack.test.ts`

**Interfaces:**
- Consumes: `inAttackArc` from `src/duel/hitbox.js`.
- Produces: `stepDuel` now processes `input.light` / `input.heavy`: starting an attack sets `action` to `lightAttack`/`heavyAttack`, enters `attackPhase` windup→active→recovery by config timings, deals damage to the boss **once per swing** when the boss is inside the attack arc during the `active` phase, spends stamina on start, and gates the attack if stamina is insufficient (emits `staminaEmpty`). Light attacks chain up to `comboHits` within `comboWindowMs`. Emits `playerSwing` on start, `playerHit` on a landed hit.

- [ ] **Step 1: Write the failing test**

```ts
// tests/duel/simulate-player-attack.test.ts
import { describe, expect, it } from 'vitest';
import { createDuelState, stepDuel } from '../../src/duel/simulate.js';
import { DUEL_CONFIG } from '../../src/duel/config.js';
import type { DuelInput, DuelState } from '../../src/duel/types.js';

const NONE: DuelInput = { move: { x: 0, z: 0 }, light: false, heavy: false, dodge: false, guard: false };
const dt = DUEL_CONFIG.fixedDtMs;

// Place the player point-blank in front of the boss so swings connect.
function pointBlank(): DuelState {
  const s = createDuelState(1);
  return { ...s, player: { ...s.player, pos: { x: 1.5, z: 0 }, facing: 0 } };
}
function advance(s: DuelState, input: DuelInput, frames: number): DuelState {
  let cur = s;
  for (let i = 0; i < frames; i++) cur = stepDuel(cur, i === 0 ? input : NONE, dt).state;
  return cur;
}

describe('player light attack', () => {
  it('damages the boss when it connects during the active window', () => {
    const s = pointBlank();
    const after = advance(s, { ...NONE, light: true }, 20);
    expect(after.boss.hp).toBeLessThan(DUEL_CONFIG.boss.maxHp);
  });
  it('deals damage at most once per swing', () => {
    const s = pointBlank();
    const after = advance(s, { ...NONE, light: true }, 30);
    const dmg = DUEL_CONFIG.boss.maxHp - after.boss.hp;
    expect(dmg).toBeLessThanOrEqual(DUEL_CONFIG.player.light.dmg + 1e-6);
  });
  it('spends stamina on the swing', () => {
    const s = pointBlank();
    const { state } = stepDuel(s, { ...NONE, light: true }, dt);
    expect(state.player.stamina).toBe(DUEL_CONFIG.player.maxStamina - DUEL_CONFIG.player.light.stamina);
  });
  it('does not start an attack without enough stamina', () => {
    const s0 = pointBlank();
    const s = { ...s0, player: { ...s0.player, stamina: 1 } };
    const { state, events } = stepDuel(s, { ...NONE, light: true }, dt);
    expect(state.player.action).not.toBe('lightAttack');
    expect(events.some((e) => e.kind === 'staminaEmpty')).toBe(true);
  });
});

describe('player heavy attack', () => {
  it('hits harder than a light attack', () => {
    const s = pointBlank();
    const after = advance(s, { ...NONE, heavy: true }, 40);
    const dmg = DUEL_CONFIG.boss.maxHp - after.boss.hp;
    expect(dmg).toBeGreaterThan(DUEL_CONFIG.player.light.dmg);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/duel/simulate-player-attack.test.ts`
Expected: FAIL — the player attack isn't implemented; the boss takes no damage.

- [ ] **Step 3: Implement player attacks in `src/duel/simulate.ts`**

Replace `stepPlayerMovement` with an action-aware `stepPlayer` that:
1. If already in an attack (`attackPhase !== null`), advances `actionTimer`, transitions windup→active→recovery→idle by the relevant config timings, and during `active` (with `hitThisSwing===false`) checks `inAttackArc(player.pos, player.facing, boss.pos, atk.range, atk.arc)` → deals `atk.dmg` to the boss, sets `hitThisSwing=true`, emits `playerHit`.
2. If idle/move and `input.light`/`input.heavy`: verify stamina ≥ cost (else emit `staminaEmpty`, ignore); else spend stamina, set `staminaIdle=0`, set action + `attackPhase='windup'`, `actionTimer=0`, `hitThisSwing=false`, emit `playerSwing`. Light attacks that start within `comboWindow>0` increment `comboIndex` (wrapping at `comboHits`) — else `comboIndex=0`. On a light attack landing, set `comboWindow = comboWindowMs`.
3. Else fall through to movement (Task 3 code) and tick `comboWindow` down.

The boss-damage write means `stepPlayer` must return `{ player, boss, events }`. Update `stepDuel` to thread the boss through `stepPlayer` and use the returned boss.

Full replacement code:

```ts
// (imports: add) import { inAttackArc } from './hitbox.js';

type PlayerStep = { player: PlayerState; boss: BossState; events: DuelEvent[] };

function playerAttackDef(action: PlayerState['action']) {
  return action === 'heavyAttack' ? C.player.heavy : C.player.light;
}

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
```

Update `stepDuel` body to:

```ts
  const { player, boss, events: pEvents } = stepPlayer(state.player, input, state.boss, dtMs);
  events.push(...pEvents);
  return { state: { ...state, player, boss, elapsed: state.elapsed + dtMs }, events };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/duel/simulate-player-attack.test.ts`
Expected: PASS. Also run `npx vitest run tests/duel/` — Task 3 movement tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/duel/simulate.ts tests/duel/simulate-player-attack.test.ts
git commit -m "duel: player light/heavy attacks, combo, stamina gating, boss damage"
```

---

### Task 5: Lü Bu boss AI (telegraphed attacks + phase flip)

**Files:**
- Create: `src/duel/boss.ts`
- Test: `tests/duel/boss.test.ts`

**Interfaces:**
- Consumes: `DUEL_CONFIG`, types, `nextRng`, `dist`.
- Produces: `stepBoss(boss: BossState, player: PlayerState, dtMs: number): { boss: BossState; events: DuelEvent[] }` — pure. While idle: counts `nextDecisionIn` down; on 0, moves toward the player if beyond `contactRange`, else picks a phase-appropriate attack (phase 1: sweep/smash/lunge; phase 2: + combo/charge) via `nextRng` (threading `rngState`), emitting `bossTell` on windup start. Advances an in-progress attack windup→active→recovery. Flips to `phase:2` (emit `phaseChange`) when `hp <= maxHp*phase2Threshold`, applying `phase2SpeedMul` to timers. Does NOT apply damage to the player (that is Task 6, which owns i-frames/guard). It only exposes the active hitbox via `attackPhase==='active'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/duel/boss.test.ts
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
    // Drive several decisions and confirm the phase-2 move set is reachable.
    let b = boss({ pos: { x: 1.5, z: 0 }, phase: 2, hp: 60, nextDecisionIn: 0, rngState: 7 });
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      b = stepBoss(b, playerAt(1.5), dt).boss;
      seen.add(b.action);
      if (b.attackPhase === null) b = { ...b, nextDecisionIn: 0 };
    }
    expect(seen.has('combo') || seen.has('charge')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/duel/boss.test.ts`
Expected: FAIL — `src/duel/boss.js` not found.

- [ ] **Step 3: Write `src/duel/boss.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/duel/boss.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/duel/boss.ts tests/duel/boss.test.ts
git commit -m "duel: Lü Bu boss AI — telegraphed attacks, seeded selection, phase flip"
```

---

### Task 6: Integrate boss into `stepDuel` — boss damage, dodge i-frames, guard, outcome

**Files:**
- Modify: `src/duel/simulate.ts`
- Test: `tests/duel/simulate-defense.test.ts`

**Interfaces:**
- Consumes: `stepBoss` from `src/duel/boss.js`, `inAttackArc`.
- Produces: `stepDuel` now (a) calls `stepBoss`, (b) when the boss attack is `active` and hasn't hit this swing and the player is in the boss's attack arc: if the player has `iframes>0` → no damage, emit `dodge`-avoided (no event or a `dodge` marker already emitted at dodge start); if the player is guarding with stamina → chip damage `dmg*chipMul`, spend `staminaPerHit`, emit `guardDeflect`; else full damage + stagger the player (`action:'stagger'`, `staggerMs`), emit `bossHitPlayer`; sets boss `hitThisSwing`. (c) Processes `input.dodge`: if stamina ≥ dodge cost and player not mid-attack-active → set `action:'dodge'`, `iframes=iframeMs`, lunge `distance` along the move dir (or backward from boss if no move), spend stamina, emit `dodge`. (d) Decrements `iframes`; runs the stagger timer. (e) Sets `outcome`: `'win'` when `boss.hp<=0`, `'lose'` when `player.hp<=0`, emitting `win`/`lose` and setting `slowMo` for the decisive blow.

- [ ] **Step 1: Write the failing test**

```ts
// tests/duel/simulate-defense.test.ts
import { describe, expect, it } from 'vitest';
import { createDuelState, stepDuel } from '../../src/duel/simulate.js';
import { DUEL_CONFIG } from '../../src/duel/config.js';
import type { DuelInput, DuelState } from '../../src/duel/types.js';

const NONE: DuelInput = { move: { x: 0, z: 0 }, light: false, heavy: false, dodge: false, guard: false };
const dt = DUEL_CONFIG.fixedDtMs;

// A boss frozen in its active hitbox, point-blank on the player.
function bossActiveOnPlayer(): DuelState {
  const s = createDuelState(1);
  return {
    ...s,
    player: { ...s.player, pos: { x: 0, z: 0 } },
    boss: { ...s.boss, pos: { x: 1, z: 0 }, facing: Math.PI, action: 'sweep', attackPhase: 'active', actionTimer: 0, hitThisSwing: false },
  };
}

describe('boss damage & defense', () => {
  it('damages an unguarded, non-dodging player', () => {
    const s = bossActiveOnPlayer();
    const { state } = stepDuel(s, NONE, dt);
    expect(state.player.hp).toBeLessThan(DUEL_CONFIG.player.maxHp);
    expect(state.player.action).toBe('stagger');
  });
  it('deals no damage while the player has i-frames', () => {
    const s0 = bossActiveOnPlayer();
    const s = { ...s0, player: { ...s0.player, iframes: 200, action: 'dodge' as const } };
    const { state } = stepDuel(s, NONE, dt);
    expect(state.player.hp).toBe(DUEL_CONFIG.player.maxHp);
  });
  it('reduces damage and spends stamina when guarding', () => {
    const s = bossActiveOnPlayer();
    const { state } = stepDuel(s, { ...NONE, guard: true }, dt);
    const dmg = DUEL_CONFIG.player.maxHp - state.player.hp;
    expect(dmg).toBeGreaterThan(0);
    expect(dmg).toBeLessThan(DUEL_CONFIG.boss.attacks.sweep.dmg);
    expect(state.player.stamina).toBeLessThan(DUEL_CONFIG.player.maxStamina);
  });
});

describe('dodge', () => {
  it('grants i-frames and costs stamina', () => {
    const s = createDuelState(1);
    const { state, events } = stepDuel(s, { ...NONE, dodge: true, move: { x: -1, z: 0 } }, dt);
    expect(state.player.iframes).toBeGreaterThan(0);
    expect(state.player.stamina).toBe(DUEL_CONFIG.player.maxStamina - DUEL_CONFIG.player.dodge.stamina);
    expect(events.some((e) => e.kind === 'dodge')).toBe(true);
  });
});

describe('outcome', () => {
  it('is win when the boss reaches 0 HP', () => {
    const s0 = createDuelState(1);
    const s = { ...s0, boss: { ...s0.boss, hp: 1, pos: { x: 1.2, z: 0 } }, player: { ...s0.player, pos: { x: 0, z: 0 }, facing: 0 } };
    let cur = s;
    for (let i = 0; i < 20; i++) cur = stepDuel(cur, i === 0 ? { ...NONE, heavy: true } : NONE, dt).state;
    expect(cur.outcome).toBe('win');
  });
  it('is lose when the player reaches 0 HP', () => {
    const s0 = bossActiveOnPlayer();
    const s = { ...s0, player: { ...s0.player, hp: 1 } };
    const { state } = stepDuel(s, NONE, dt);
    expect(state.outcome).toBe('lose');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/duel/simulate-defense.test.ts`
Expected: FAIL — boss deals no damage / dodge unimplemented / no outcome.

- [ ] **Step 3: Implement in `src/duel/simulate.ts`**

Add (imports) `import { stepBoss } from './boss.js';`. Process dodge inside `stepPlayer` (before attack handling): if `input.dodge` and not in an active attack and `stamina >= dodge.stamina` → set `action:'dodge'`, `attackPhase:null`, `iframes = dodge.iframeMs`, `actionTimer=0`, spend stamina, `staminaIdle=0`, lunge the player `dodge.distance` along `input.move` (normalized) or directly away from the boss if `move` is zero, clamp to arena, emit `dodge`. Add a stagger/dodge timer path: while `action==='dodge'` or `'stagger'`, advance `actionTimer`, decrement `iframes`, and return to `idle` after `dodge.durationMs`/`staggerMs`. Always decrement `iframes` by `dtMs` (floor 0) each tick.

In `stepDuel`, after computing the player step, call `stepBoss` and then resolve the boss's active hitbox against the player:

```ts
  // After: const { player: pAfter, boss: bMid, events: pEvents } = stepPlayer(...)
  const { boss: bAfter, events: bEvents } = stepBoss(bMid, pAfter, dtMs);
  let player = pAfter;
  let boss = bAfter;
  const outEvents: DuelEvent[] = [...pEvents, ...bEvents];

  if (boss.attackPhase === 'active' && !boss.hitThisSwing) {
    const atk = C.boss.attacks[boss.action as keyof typeof C.boss.attacks];
    if (atk && inAttackArc(boss.pos, boss.facing, player.pos, atk.range, atk.arc)) {
      boss = { ...boss, hitThisSwing: true };
      if (player.iframes > 0) {
        // avoided by i-frames — no damage.
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

  let outcome = state.outcome;
  let slowMo = Math.max(0, state.slowMo - dtMs);
  if (!outcome && boss.hp <= 0) { outcome = 'win'; slowMo = C.juice.slowMoMs; outEvents.push({ kind: 'win', at: boss.pos }); }
  else if (!outcome && player.hp <= 0) { outcome = 'lose'; slowMo = C.juice.slowMoMs; outEvents.push({ kind: 'lose', at: player.pos }); }

  return { state: { ...state, player, boss, elapsed: state.elapsed + dtMs, outcome, slowMo, hitStop: state.hitStop }, events: outEvents };
```

(Adjust the destructured names in `stepDuel` accordingly — `stepPlayer` returns `{ player: pAfter, boss: bMid, events: pEvents }`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/duel/` — all duel sim tests green.

- [ ] **Step 5: Commit**

```bash
git add src/duel/simulate.ts src/duel/boss.ts tests/duel/simulate-defense.test.ts
git commit -m "duel: boss damage, dodge i-frames, guard chip, win/lose outcome"
```

---

### Task 7: Balance harness — winnable but not trivial

**Files:**
- Test: `tests/duel/balance.test.ts`

**Interfaces:**
- Consumes: `createDuelState`, `stepDuel`.
- Produces: no new source — a guard test proving (a) a passive player loses, (b) a scripted "patient" strategy (approach → wait out a boss tell → dodge → land a heavy in the recovery → repeat) wins within a bounded number of simulated seconds. This locks the tunables against soft-locks and unwinnable/too-trivial regressions.

- [ ] **Step 1: Write the test**

```ts
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

describe('duel balance', () => {
  it('a passive player loses (the boss is a real threat)', () => {
    const s = run(() => NONE);
    expect(s.outcome).toBe('lose');
  });

  it('a patient dodge-and-punish player wins within 180s', () => {
    const s = run((st) => {
      const b = st.boss;
      const p = st.player;
      // Dodge the instant the boss commits to an active swing.
      if (b.attackPhase === 'windup' && b.actionTimer > 0) {
        // pre-dodge near the end of windup
      }
      if (b.attackPhase === 'active' && p.iframes <= 0 && p.action !== 'dodge') {
        return { ...NONE, dodge: true, move: { x: 0, z: 1 } };
      }
      // Punish during the boss's recovery.
      if (b.attackPhase === 'recovery' && p.stamina >= DUEL_CONFIG.player.heavy.stamina) {
        return { ...NONE, heavy: true };
      }
      // Otherwise close to contact range.
      const dx = b.pos.x - p.pos.x;
      const dz = b.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d > 2) return { ...NONE, move: { x: dx / d, z: dz / d } };
      return NONE;
    });
    expect(s.outcome).toBe('win');
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/duel/balance.test.ts`
Expected: PASS. **If the patient policy loses or times out, tune `DUEL_CONFIG` (Task 1) — do not weaken the test.** Record any tuning in the commit message.

- [ ] **Step 3: Commit**

```bash
git add tests/duel/balance.test.ts
git commit -m "duel: balance harness — passive loses, patient play wins < 180s"
```

---

## PHASE B — Campaign seam

> The three tasks in this phase integrate the duel into the strategy campaign by
> **mirroring the existing `pendingStoryEvent` mechanism**. Before starting, the
> implementer MUST read these existing symbols and copy their patterns exactly:
> `GameState.pendingStoryEvent` and `PendingStoryEvent` in `src/engine/types.ts`;
> the `Screen` union and the `pendingStoryEvent` routing + `resolveStoryChoice` +
> `tryRestoreContinuous` in `src/state/store.ts`; the tick freeze guard in
> `src/engine/pendingOp.ts`; the event/objective tables in
> `src/data/story/s1-liubei.ts` and helpers in `src/data/story/helpers.ts`.

### Task 8: `PendingDuel` type, `GameState` fields, and the set-piece registry

**Files:**
- Modify: `src/engine/types.ts` (add `PendingDuel`, `GameState.pendingDuel?`, `GameState.duelResults`)
- Create: `src/engine/duel/setpieces.ts`
- Modify: `src/engine/state.ts` (or wherever `buildInitialState` lives — initialize `duelResults: {}`)
- Test: `tests/engine/duel-setpieces.test.ts`

**Interfaces:**
- Consumes: `DuelOutcome` (type-only) from `src/duel/types.js`; `GameState`, `MessageKey`.
- Produces:
  - `PendingDuel { duelId: string }` on `GameState.pendingDuel?`.
  - `GameState.duelResults: Record<string, DuelOutcome>` (initialized `{}` in `buildInitialState`).
  - `DuelSetpiece { id; bossId; playerHeroId; arenaKey; briefingKey; onWin(state)→state; onLose(state)→state }`.
  - `DUEL_SETPIECES: Record<string, DuelSetpiece>` with the `hulaoguan` entry; `findSetpiece(id): DuelSetpiece | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/duel-setpieces.test.ts
import { describe, expect, it } from 'vitest';
import { DUEL_SETPIECES, findSetpiece } from '../../src/engine/duel/setpieces.js';
import { GENERALS } from '../../src/data/generals/index.js';

describe('duel set-pieces', () => {
  it('registers the Hulao Pass duel vs Lü Bu', () => {
    const sp = findSetpiece('hulaoguan');
    expect(sp).toBeDefined();
    expect(sp!.bossId).toBe('lubu');
    expect(sp!.playerHeroId).toBe('liubei');
  });
  it('references real generals for boss and hero', () => {
    for (const sp of Object.values(DUEL_SETPIECES)) {
      expect(GENERALS[sp.bossId], `boss ${sp.bossId} must exist`).toBeDefined();
      expect(GENERALS[sp.playerHeroId], `hero ${sp.playerHeroId} must exist`).toBeDefined();
    }
  });
  it('onWin/onLose are pure identity-or-transform functions returning a state', () => {
    const sp = findSetpiece('hulaoguan')!;
    const fake = { duelResults: {} } as never;
    expect(sp.onWin(fake)).toBeDefined();
    expect(sp.onLose(fake)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/duel-setpieces.test.ts`
Expected: FAIL — `src/engine/duel/setpieces.js` not found.

- [ ] **Step 3: Add types to `src/engine/types.ts`**

Add near `PendingStoryEvent`:

```ts
import type { DuelOutcome } from '../duel/types.js'; // type-only; erased at runtime

// Freezes the strategic tick and routes to the real-time duel screen, exactly
// like PendingStoryEvent. duelId indexes DUEL_SETPIECES.
export interface PendingDuel {
  duelId: string;
}
```

On the `GameState` interface, add:

```ts
  pendingDuel?: PendingDuel;
  duelResults: Record<string, DuelOutcome>; // duelId -> outcome, for aftermath branching
```

- [ ] **Step 4: Initialize `duelResults` in `buildInitialState`**

Find `buildInitialState` (grep: `git grep -n 'duelResults\|function buildInitialState'`). Add `duelResults: {},` to the returned initial `GameState` literal, alongside the existing `objectives: []` initialization.

- [ ] **Step 5: Write `src/engine/duel/setpieces.ts`**

```ts
import type { GameState } from '../types.js';
import type { MessageKey } from '../../i18n/types.js';

// A scripted 1v1 duel that punctuates the campaign. onWin/onLose are pure
// state transforms applied by resolveDuel; for the first slice the narrative
// aftermath is carried by story events, so these are identity (kept as hooks
// for future per-duel state effects like reputation or casualties).
export interface DuelSetpiece {
  id: string;
  bossId: string; // GeneralId of the boss
  playerHeroId: string; // GeneralId of the player hero
  arenaKey: MessageKey;
  briefingKey: MessageKey;
  onWin: (state: GameState) => GameState;
  onLose: (state: GameState) => GameState;
}

export const DUEL_SETPIECES: Record<string, DuelSetpiece> = {
  hulaoguan: {
    id: 'hulaoguan',
    bossId: 'lubu',
    playerHeroId: 'liubei',
    arenaKey: 'duel.arena.hulaoguan',
    briefingKey: 'duel.briefing.hulaoguan',
    onWin: (s) => s,
    onLose: (s) => s,
  },
};

export function findSetpiece(id: string): DuelSetpiece | undefined {
  return DUEL_SETPIECES[id];
}
```

> If `GENERALS['lubu']` does not exist under that id, use the actual Lü Bu id
> (grep `git grep -n "吕布" src/data/generals`) and update `bossId` + this note.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/engine/duel-setpieces.test.ts`
Expected: PASS. Then `npx tsc --noEmit` — the new `duelResults` field must compile everywhere `GameState` is constructed (fix any other initializer the compiler flags).

- [ ] **Step 7: Commit**

```bash
git add src/engine/types.ts src/engine/duel/setpieces.ts src/engine/state.ts tests/engine/duel-setpieces.test.ts
git commit -m "duel seam: PendingDuel, duelResults, and the set-piece registry"
```

---

### Task 9: Store integration — freeze tick, route to duel, `resolveDuel`, restore

**Files:**
- Modify: `src/state/store.ts` (Screen union, tick/route, `resolveDuel`, restore)
- Modify: `src/engine/pendingOp.ts` (tick freeze guard — mirror `pendingStoryEvent`)
- Test: `tests/state/duel-store.test.ts`

**Interfaces:**
- Consumes: `findSetpiece`, `DUEL_SETPIECES`, `resolveDuel` callers; `DuelOutcome`.
- Produces:
  - `Screen` union gains `| { kind: 'duel' }`.
  - `resolveDuel(outcome: DuelOutcome): void` — applies the set-piece branch, records `duelResults[duelId]`, clears `pendingDuel`, then runs the **same** post-resolution pipeline as `resolveStoryChoice` (evaluate objectives → route to a newly-pending story event if one fires → else `checkOutcome` → `main`/outcome screen).
  - The shared "what screen next" routing recognizes `pendingDuel` (set by a story event's `apply`) and routes to `{ kind: 'duel' }` **before** defaulting to `main` — so both the tick loop and `resolveStoryChoice` hand off to the duel.
  - `tryRestoreContinuous` resumes a mid-duel: `if (restored?.pendingDuel) setScreen({ kind: 'duel' })` (mirror the `pendingStoryEvent`/`pendingBattle` branches).
  - `pendingOp.ts` tick guard stops advancing while `pendingDuel` is set (mirror `pendingStoryEvent`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/state/duel-store.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { newGame, gameStore, resolveDuel } from '../../src/state/store.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import type { GameState } from '../../src/engine/types.js';

afterEach(() => {
  // reset store to a clean game between tests
  newGame(SCENARIO_DONGZHUO, 'liubei', 1);
});

function setPendingDuel(): void {
  newGame(SCENARIO_DONGZHUO, 'liubei', 1);
  gameStore.setState((s) => ({
    ...s,
    game: { ...(s.game as GameState), pendingDuel: { duelId: 'hulaoguan' } },
    ui: { ...s.ui, screen: { kind: 'duel' } },
  }));
}

describe('resolveDuel', () => {
  it('records a win, clears the pending duel, and leaves the campaign screen', () => {
    setPendingDuel();
    resolveDuel('win');
    const s = gameStore.getState();
    expect((s.game as GameState).duelResults.hulaoguan).toBe('win');
    expect((s.game as GameState).pendingDuel).toBeUndefined();
    expect(s.ui.screen.kind).not.toBe('duel'); // routed back into the campaign
  });
  it('records a loss without dead-ending (still returns to the campaign)', () => {
    setPendingDuel();
    resolveDuel('lose');
    const s = gameStore.getState();
    expect((s.game as GameState).duelResults.hulaoguan).toBe('lose');
    expect((s.game as GameState).pendingDuel).toBeUndefined();
    expect(['main', 'story', 'chapterTransition', 'chapterComplete', 'gameOver']).toContain(s.ui.screen.kind);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/state/duel-store.test.ts`
Expected: FAIL — `resolveDuel` is not exported.

- [ ] **Step 3: Add `{ kind: 'duel' }` to the `Screen` union**

In `src/state/store.ts`, next to `| { kind: 'briefing' }`:

```ts
  | { kind: 'duel' } // real-time duel set-piece (reads game.pendingDuel)
```

- [ ] **Step 4: Freeze the tick on `pendingDuel`**

In `src/engine/pendingOp.ts`, find the guard that halts day-advancement while `state.pendingStoryEvent` (or `pendingBattle`) is set, and add `pendingDuel` to the same condition. In `src/state/store.ts`, wherever the advance loop routes to `{ kind: 'story', ... }` for `next.pendingStoryEvent`, add a sibling branch: `if (next.pendingDuel) screen = { kind: 'duel' }` — placed so `pendingDuel` is honored before defaulting to `main`.

- [ ] **Step 5: Implement `resolveDuel`**

Add to `src/state/store.ts`, modeled on `resolveStoryChoice`. Reuse whatever post-resolution helper `resolveStoryChoice` uses (e.g., `evaluateObjectives`, the pending-event check, `checkOutcome`, `outcomeScreen`); extract a shared `routeAfterResolution(next): Screen` helper if `resolveStoryChoice` inlines it, and call it from both.

```ts
import { findSetpiece } from '../engine/duel/setpieces.js';
import type { DuelOutcome } from '../duel/types.js';

// Resolve a real-time duel back into the campaign. Applies the set-piece's
// win/lose transform, records the result for aftermath branching, clears the
// pause, and routes exactly like resolveStoryChoice (objectives → pending story
// event → outcome). A loss never dead-ends: routing falls through to the
// aftermath story event / main screen, not gameOver (unless the campaign itself
// is already lost by its own rules).
export function resolveDuel(outcome: DuelOutcome): void {
  gameStore.setState((s) => {
    const game = s.game;
    if (!game?.pendingDuel) return s;
    const duelId = game.pendingDuel.duelId;
    const sp = findSetpiece(duelId);
    let next = {
      ...game,
      duelResults: { ...game.duelResults, [duelId]: outcome },
      pendingDuel: undefined,
    };
    if (sp) next = outcome === 'win' ? sp.onWin(next) : sp.onLose(next);
    const screen = routeAfterResolution(next); // shared with resolveStoryChoice
    return { ...s, game: next, ui: { ...s.ui, screen } };
  });
}
```

> `routeAfterResolution` must run the identical pipeline `resolveStoryChoice`
> already performs after applying a choice. If that logic is currently inlined
> in `resolveStoryChoice`, extract it into `routeAfterResolution(next: GameState): Screen`
> and call it from both places (a pure refactor — existing story-store tests must
> stay green, so run `npx vitest run tests/state/` after).

- [ ] **Step 6: Resume a mid-duel on restore**

In `tryRestoreContinuous`, mirror the existing `pendingStoryEvent` branch:

```ts
  } else if (restored?.pendingDuel) {
    setScreen({ kind: 'duel' });
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/state/duel-store.test.ts tests/state/` — new tests pass, all existing story-store/chapter-transition tests still green. Then `npx tsc --noEmit`.

- [ ] **Step 8: Commit**

```bash
git add src/state/store.ts src/engine/pendingOp.ts tests/state/duel-store.test.ts
git commit -m "duel seam: store routing, resolveDuel, tick freeze, restore-on-load"
```

---

### Task 10: Chapter 1 trigger + win/lose aftermath + reachability sim

**Files:**
- Modify: `src/data/story/s1-liubei.ts` (trigger event + two aftermath events)
- Modify: `src/i18n/types.ts`, `src/i18n/catalog/en.ts`, `src/i18n/catalog/zh.ts` (story keys)
- Test: `tests/playthrough/s1-hulaoguan.test.ts`

**Interfaces:**
- Consumes: the existing `StoryEvent` pattern in `s1-liubei.ts`, `hasEvent` from `src/data/story/helpers.js`, the existing 响应义盟 coalition condition.
- Produces:
  - A trigger beat `ch1_hulaoguan_challenge`: fires once the coalition has been joined (reuse the exact predicate the `响应义盟` objective uses); a narrative beat whose `apply` sets `pendingDuel`.
  - Two aftermath beats `ch1_hulaoguan_win` / `ch1_hulaoguan_lose`: `check` = the duel has been resolved with the matching `duelResults.hulaoguan` value AND not already seen; narrative that continues Chapter 1.

- [ ] **Step 1: Read the existing Chapter 1 story file**

Read `src/data/story/s1-liubei.ts` fully and `src/data/story/helpers.ts`. Identify: the coalition-joined predicate (used by the 响应义盟 objective), the `hasEvent(state, id)` seen-guard pattern, and how events are registered in the exported array.

- [ ] **Step 2: Write the failing reachability test**

```ts
// tests/playthrough/s1-hulaoguan.test.ts
import { describe, expect, it } from 'vitest';
import { storyEventsFor } from '../../src/engine/story/events.js';
import { findSetpiece } from '../../src/engine/duel/setpieces.js';
import type { GameState } from '../../src/engine/types.js';
// Build a Chapter-1 Liu Bei state that has satisfied the coalition condition.
// (Use the same helper the other s1 playthrough tests use to reach that point.)
import { reachedCoalition } from './helpers/s1.js'; // create or reuse a fixture

describe('Hulao Pass duel is reachable and branches', () => {
  it('the trigger event fires after joining the coalition and queues the duel', () => {
    const state = reachedCoalition();
    const events = storyEventsFor(state.scenarioId, state.storyMode);
    const trigger = events.find((e) => e.id === 'ch1_hulaoguan_challenge');
    expect(trigger).toBeDefined();
    expect(trigger!.check(state)).toBe(true);
    const after = trigger!.apply!(state);
    expect(after.pendingDuel?.duelId).toBe('hulaoguan');
    expect(findSetpiece('hulaoguan')).toBeDefined();
  });

  it('the WIN aftermath fires only after a recorded duel win', () => {
    const base = reachedCoalition();
    const events = storyEventsFor(base.scenarioId, base.storyMode);
    const win = events.find((e) => e.id === 'ch1_hulaoguan_win')!;
    const lose = events.find((e) => e.id === 'ch1_hulaoguan_lose')!;
    const wonState: GameState = { ...base, duelResults: { hulaoguan: 'win' } };
    expect(win.check(wonState)).toBe(true);
    expect(lose.check(wonState)).toBe(false);
  });

  it('the LOSE aftermath fires after a recorded loss and does not dead-end', () => {
    const base = reachedCoalition();
    const events = storyEventsFor(base.scenarioId, base.storyMode);
    const lose = events.find((e) => e.id === 'ch1_hulaoguan_lose')!;
    const lostState: GameState = { ...base, duelResults: { hulaoguan: 'lose' } };
    expect(lose.check(lostState)).toBe(true);
  });
});
```

> If a `reachedCoalition()` fixture does not already exist, create
> `tests/playthrough/helpers/s1.ts` that builds a Chapter-1 Liu Bei `GameState`
> and drives it (via `startChapter` + `applyStoryChoice`/objective completion) to
> the point where the coalition condition holds — following the pattern in the
> existing `tests/playthrough/s2-*`/`s3-*` reachability tests.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/playthrough/s1-hulaoguan.test.ts`
Expected: FAIL — the three events don't exist yet.

- [ ] **Step 4: Add the three events to `src/data/story/s1-liubei.ts`**

Following the file's existing `StoryEvent` shape (adapt `check`/keys to match the file's conventions):

```ts
{
  id: 'ch1_hulaoguan_challenge',
  // Fires once, after the coalition is joined. Reuse the SAME predicate the
  // 响应义盟 objective uses (import or replicate it) instead of inventing one.
  check: (s) => coalitionJoined(s) && !hasEvent(s, 'ch1_hulaoguan_challenge'),
  titleKey: 'story.s1.hulaoguan.title',
  bodyKey: 'story.s1.hulaoguan.body',
  choices: [],
  // Continuing the beat queues the real-time duel; the store routes to it.
  apply: (s) => ({ ...s, pendingDuel: { duelId: 'hulaoguan' } }),
},
{
  id: 'ch1_hulaoguan_win',
  check: (s) => s.duelResults.hulaoguan === 'win' && !hasEvent(s, 'ch1_hulaoguan_win'),
  titleKey: 'story.s1.hulaoguan.win.title',
  bodyKey: 'story.s1.hulaoguan.win.body',
  choices: [],
},
{
  id: 'ch1_hulaoguan_lose',
  check: (s) => s.duelResults.hulaoguan === 'lose' && !hasEvent(s, 'ch1_hulaoguan_lose'),
  titleKey: 'story.s1.hulaoguan.lose.title',
  bodyKey: 'story.s1.hulaoguan.lose.body',
  choices: [],
},
```

Register all three in the file's exported event array.

- [ ] **Step 5: Add the i18n keys (both catalogs + the union)**

In `src/i18n/types.ts` add to the `MessageKey` union: `story.s1.hulaoguan.title`, `.body`, `.win.title`, `.win.body`, `.lose.title`, `.lose.body`. Add matching zh + en entries in `src/i18n/catalog/{zh,en}.ts` (Hulao Pass challenge; win = Lü Bu driven off, name rings out; lose = brothers wounded but the coalition presses on). Bilingual, parity-tested.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/playthrough/s1-hulaoguan.test.ts tests/i18n/` — reachability + i18n parity green.

- [ ] **Step 7: Commit**

```bash
git add src/data/story/s1-liubei.ts src/i18n tests/playthrough/s1-hulaoguan.test.ts tests/playthrough/helpers
git commit -m "duel seam: Ch1 Hulao Pass trigger + win/lose aftermath beats"
```

---

## PHASE C — Renderer & screen

> Reality note for the implementer: Three.js **object construction** (meshes,
> groups, cameras, vector math) runs fine in jsdom — only `WebGLRenderer` needs a
> real GL context. So rigs, camera-target math, and input mapping are unit-tested
> directly; the GL render loop sits behind a WebGL gate (mirroring
> `src/web/battle/webglSupport.ts`) and is validated by hand + the no-WebGL
> fallback path (Task 16). Do NOT try to pre-write pixel-exact scene code from
> this plan — build the scene, then tune it live against the running dev server.

### Task 11: Shared camera-shake helper (`src/web/three/`)

**Files:**
- Create: `src/web/three/cameraShake.ts`
- Test: `tests/web/three/cameraShake.test.ts`

**Interfaces:**
- Produces: `makeShake()` → `{ add(intensity: number): void; sample(dtMs: number): { x: number; y: number } }` — a decaying positional offset for camera juice. Pure/deterministic (no `Math.random`; uses a fixed dither pattern). New standalone module (does NOT modify `BattleScene`, so zero regression risk); `DuelScene` consumes it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/web/three/cameraShake.test.ts
import { describe, expect, it } from 'vitest';
import { makeShake } from '../../../src/web/three/cameraShake.js';

describe('makeShake', () => {
  it('is zero at rest', () => {
    const s = makeShake();
    expect(s.sample(16)).toEqual({ x: 0, y: 0 });
  });
  it('produces a nonzero offset after add(), then decays back toward zero', () => {
    const s = makeShake();
    s.add(1);
    const first = s.sample(16);
    expect(Math.hypot(first.x, first.y)).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) s.sample(16);
    const later = s.sample(16);
    expect(Math.hypot(later.x, later.y)).toBeLessThan(Math.hypot(first.x, first.y));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/three/cameraShake.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/web/three/cameraShake.ts`**

```ts
// Decaying camera-shake offset for hit juice. Deterministic: a fixed sinusoid
// dither scaled by an energy value that add() bumps and sample() bleeds down.
// No Math.random so it stays reproducible.
export function makeShake() {
  let energy = 0;
  let t = 0;
  return {
    add(intensity: number): void {
      energy = Math.min(1.5, energy + intensity);
    },
    sample(dtMs: number): { x: number; y: number } {
      if (energy <= 1e-4) {
        energy = 0;
        return { x: 0, y: 0 };
      }
      t += dtMs;
      const amp = energy * 0.15;
      const x = Math.sin(t * 0.08) * amp;
      const y = Math.cos(t * 0.11) * amp;
      energy = Math.max(0, energy - dtMs / 260); // ~260ms to settle
      return { x, y };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/web/three/cameraShake.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/three/cameraShake.ts tests/web/three/cameraShake.test.ts
git commit -m "duel render: deterministic camera-shake helper"
```

---

### Task 12: Keyboard → `DuelInput` mapping

**Files:**
- Create: `src/web/duel/input.ts`
- Test: `tests/web/duel/input.test.ts`

**Interfaces:**
- Consumes: `DuelInput`, `Vec2` (types).
- Produces:
  - `interface KeyState { held: Set<string>; pressed: Set<string> }` (`pressed` = keys that went down THIS frame; the caller clears it each frame).
  - `inputFromKeys(k: KeyState): DuelInput` — WASD→move (world XZ, scene rotates by camera yaw), J=light, K=heavy, Space=dodge, L/Shift=guard. Attacks/dodge read from `pressed` (edge); move/guard from `held`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/web/duel/input.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/duel/input.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/web/duel/input.ts`**

```ts
import type { DuelInput, Vec2 } from '../../duel/types.js';

export interface KeyState {
  held: Set<string>; // keys currently down (lowercased)
  pressed: Set<string>; // keys that transitioned down THIS frame; caller clears each frame
}

// WASD → world-space XZ (the scene rotates this by camera yaw for camera-relative
// movement). Attacks/dodge are edge-triggered so a held key fires once.
export function inputFromKeys(k: KeyState): DuelInput {
  let x = 0;
  let z = 0;
  if (k.held.has('w')) z -= 1;
  if (k.held.has('s')) z += 1;
  if (k.held.has('a')) x -= 1;
  if (k.held.has('d')) x += 1;
  const move: Vec2 = { x, z };
  return {
    move,
    light: k.pressed.has('j'),
    heavy: k.pressed.has('k'),
    dodge: k.pressed.has(' '),
    guard: k.held.has('l') || k.held.has('shift'),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/web/duel/input.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/duel/input.ts tests/web/duel/input.test.ts
git commit -m "duel render: keyboard → DuelInput mapping"
```

---

### Task 13: Procedural character rigs

**Files:**
- Create: `src/web/duel/characterRig.ts`
- Test: `tests/web/duel/characterRig.test.ts`

**Interfaces:**
- Consumes: `three`, `PlayerState`/`BossState` types, `DUEL_CONFIG`.
- Produces:
  - `buildHeroRig(): CharacterRig` and `buildBossRig(): CharacterRig` where `interface CharacterRig { group: THREE.Group; applyPose(action: string, phase: string | null, t: number): void; }`.
  - Each rig is a `THREE.Group` of primitive meshes (torso, head, limbs, weapon(s)); Liu Bei carries paired swords, Lü Bu a halberd (longer). `applyPose` rotates limb/weapon joints for idle/walk/attack-windup/attack-active/dodge/hit poses (procedural, no skeletal assets).

- [ ] **Step 1: Write the failing test**

```ts
// tests/web/duel/characterRig.test.ts
import { describe, expect, it } from 'vitest';
import { buildHeroRig, buildBossRig } from '../../../src/web/duel/characterRig.js';

describe('character rigs', () => {
  it('build THREE groups with child meshes (no GL context needed)', () => {
    const hero = buildHeroRig();
    const boss = buildBossRig();
    expect(hero.group.children.length).toBeGreaterThan(3);
    expect(boss.group.children.length).toBeGreaterThan(3);
  });
  it('applyPose runs for every action without throwing', () => {
    const hero = buildHeroRig();
    for (const action of ['idle', 'move', 'lightAttack', 'heavyAttack', 'dodge', 'stagger']) {
      expect(() => hero.applyPose(action, 'active', 0.5)).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/duel/characterRig.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/web/duel/characterRig.ts`**

Build each rig from `THREE.Mesh` primitives parented into a `THREE.Group`, keeping references to the joints you animate (e.g. `rightArm`, `leftArm`, `weapon`). `applyPose` sets joint rotations by a small switch on `action`/`phase`, using `t` (0..1 progress) to interpolate a wind-up→swing arc. Reference `src/web/battle/BattleScene.ts` `buildSoldier` (line ~125) for the primitive-figure idiom (materials, proportions) so the look is consistent. Keep it under ~200 lines; this is stylized, not anatomical.

Skeleton:

```ts
import * as THREE from 'three';

export interface CharacterRig {
  group: THREE.Group;
  applyPose(action: string, phase: string | null, t: number): void;
}

function limb(color: number, w: number, h: number, d: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }));
}

function buildRig(robeColor: number, weapon: THREE.Object3D): CharacterRig {
  const group = new THREE.Group();
  const torso = limb(robeColor, 0.6, 0.9, 0.35);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: 0xead9b0 }));
  head.position.y = 0.75;
  const rightArm = limb(robeColor, 0.18, 0.7, 0.18);
  rightArm.position.set(0.42, 0.25, 0);
  rightArm.add(weapon);
  const leftArm = limb(robeColor, 0.18, 0.7, 0.18);
  leftArm.position.set(-0.42, 0.25, 0);
  const legL = limb(0x2b2b33, 0.2, 0.8, 0.2); legL.position.set(-0.18, -0.85, 0);
  const legR = limb(0x2b2b33, 0.2, 0.8, 0.2); legR.position.set(0.18, -0.85, 0);
  group.add(torso, head, rightArm, leftArm, legL, legR);

  return {
    group,
    applyPose(action, phase, t) {
      // Neutral
      rightArm.rotation.x = 0; leftArm.rotation.x = 0; legL.rotation.x = 0; legR.rotation.x = 0;
      if (action === 'move') { legL.rotation.x = Math.sin(t * Math.PI * 2) * 0.5; legR.rotation.x = -Math.sin(t * Math.PI * 2) * 0.5; }
      else if (action === 'lightAttack' || action === 'heavyAttack') {
        const wind = phase === 'windup' ? -1.2 * t : phase === 'active' ? 1.4 * t : 1.4 - 1.4 * t;
        rightArm.rotation.x = wind;
      } else if (action === 'dodge') { group.rotation.z = Math.sin(t * Math.PI) * 0.6; }
      else if (action === 'stagger') { torso.rotation.x = -0.3 * (1 - t); }
      else { group.rotation.z = 0; }
    },
  };
}

export function buildHeroRig(): CharacterRig {
  const sword = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.06), new THREE.MeshStandardMaterial({ color: 0xcdd3da, metalness: 0.6 }));
  sword.position.y = -0.4;
  return buildRig(0x2f6f4e, sword); // jade-green robe
}

export function buildBossRig(): CharacterRig {
  const halberd = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8), new THREE.MeshStandardMaterial({ color: 0x5a3b22 }));
  const blade = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0xd0d0d8, metalness: 0.7 }));
  blade.position.y = 0.9;
  halberd.add(shaft, blade); halberd.position.y = -0.4;
  const rig = buildRig(0x7a1f1f, halberd); // dark-crimson armor
  rig.group.scale.setScalar(1.2); // Lü Bu looms larger
  return rig;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/web/duel/characterRig.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/duel/characterRig.ts tests/web/duel/characterRig.test.ts
git commit -m "duel render: procedural Liu Bei / Lü Bu rigs with pose states"
```

---

### Task 14: `DuelScene` — scene, follow-cam math, RAF loop, mesh sync

**Files:**
- Create: `src/web/duel/DuelScene.ts`
- Test: `tests/web/duel/duelScene-camera.test.ts`

**Interfaces:**
- Consumes: `three`, `createDuelState`/`stepDuel`, rigs, `makeShake`, `DUEL_CONFIG`, `inputFromKeys`.
- Produces:
  - A pure exported helper `followCamTarget(playerPos: Vec2, bossPos: Vec2): { look: Vec2; camOffsetYaw: number }` — the over-the-shoulder framing: camera looks at the midpoint biased toward the player; yaw points from player to boss. Unit-tested.
  - `class DuelScene { constructor(canvas, { onOutcome }); start(); stop(); setKeyState(k) }` — owns the `WebGLRenderer`, scene graph (reusing lighting/fog idioms from `BattleScene`), both rigs, a `makeShake()`, and a fixed-timestep RAF loop: accumulate real dt → run `stepDuel` at `fixedDtMs` (scaled by `slowMo`) → `applyPose` + position both rigs → update follow-cam (+ shake) → render. On `state.outcome`, calls `onOutcome(outcome)` once and stops.

- [ ] **Step 1: Write the failing test (pure camera math only)**

```ts
// tests/web/duel/duelScene-camera.test.ts
import { describe, expect, it } from 'vitest';
import { followCamTarget } from '../../../src/web/duel/DuelScene.js';

describe('followCamTarget', () => {
  it('yaw points from the player toward the boss', () => {
    // player at origin, boss along +x => yaw ~ 0
    const { camOffsetYaw } = followCamTarget({ x: 0, z: 0 }, { x: 5, z: 0 });
    expect(Math.abs(camOffsetYaw)).toBeLessThan(0.01);
  });
  it('looks at a point between player and boss, biased to the player', () => {
    const { look } = followCamTarget({ x: 0, z: 0 }, { x: 10, z: 0 });
    expect(look.x).toBeGreaterThan(0);
    expect(look.x).toBeLessThan(5); // biased toward the player side of the midpoint
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/duel/duelScene-camera.test.ts`
Expected: FAIL — `followCamTarget` not exported.

- [ ] **Step 3: Write `src/web/duel/DuelScene.ts`**

Export the pure `followCamTarget` first (that's what the test needs):

```ts
import type { Vec2 } from '../../duel/types.js';

// Over-the-shoulder framing: look at a point 35% from player toward boss; the
// camera yaw follows the player→boss vector so the boss stays framed ahead.
export function followCamTarget(playerPos: Vec2, bossPos: Vec2): { look: Vec2; camOffsetYaw: number } {
  const look = { x: playerPos.x + (bossPos.x - playerPos.x) * 0.35, z: playerPos.z + (bossPos.z - playerPos.z) * 0.35 };
  const camOffsetYaw = Math.atan2(bossPos.z - playerPos.z, bossPos.x - playerPos.x);
  return { look, camOffsetYaw };
}
```

Then implement `class DuelScene` beneath it. Build the scene following `BattleScene.ts` idioms (a `PerspectiveCamera`, `DirectionalLight` + `HemisphereLight`, exp `Fog`, ground plane; optionally the bloom/grade `EffectComposer` if straightforward). The RAF loop:

```
loop(now):
  dt = clamp(now - last, 0, 50); last = now
  scale = state.slowMo > 0 ? DUEL_CONFIG.juice.slowMoScale : 1
  acc += dt * scale
  while (acc >= fixedDtMs): { ({state} = stepDuel(state, inputFromKeys(keyState), fixedDtMs)); clearPressed(); acc -= fixedDtMs }
  hero.group.position = (state.player.pos.x, 0, state.player.pos.z); hero.group.rotation.y = -state.player.facing
  boss.group.position = (state.boss.pos.x, 0, state.boss.pos.z); boss.group.rotation.y = -state.boss.facing
  hero.applyPose(state.player.action, state.player.attackPhase, poseT(state.player))
  boss.applyPose(state.boss.action, state.boss.attackPhase, poseT(state.boss))
  {look, camOffsetYaw} = followCamTarget(state.player.pos, state.boss.pos)
  position camera behind player by camOffsetYaw at height ~3, add shake.sample(dt)
  on events: shake.add on playerHit/bossHitPlayer; (audio in Task 17)
  renderer.render(); if (state.outcome && !fired) { fired = true; onOutcome(state.outcome); stop() }
  raf = requestAnimationFrame(loop)
```

`setKeyState(k)` stores the current `KeyState` reference the loop reads. `start()`/`stop()` manage the RAF handle and dispose the renderer.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/web/duel/duelScene-camera.test.ts`
Expected: PASS. (The class itself is exercised manually against the dev server + by Task 15's screen test behind the WebGL gate.)

- [ ] **Step 5: Commit**

```bash
git add src/web/duel/DuelScene.ts tests/web/duel/duelScene-camera.test.ts
git commit -m "duel render: DuelScene follow-cam math + fixed-timestep RAF loop"
```

---

### Task 15: `DuelScreen` + `DuelCanvas` + HUD + result overlay + App route

**Files:**
- Create: `src/web/duel/DuelCanvas.tsx`, `src/web/duel/DuelScreen.tsx`
- Create: `src/web/duel/webglSupport.ts` (or reuse `src/web/battle/webglSupport.ts` if exported)
- Modify: `src/web/App.tsx` (add `case 'duel'`)
- Modify: `src/i18n/types.ts` + catalogs (`duel.*` HUD/result keys)
- Test: `tests/web/duel/DuelScreen.test.tsx`, `tests/web/App.test.tsx` (extend)

**Interfaces:**
- Consumes: `DuelScene`, `useSession`, `resolveDuel`, `useSession(selectGame)` for `pendingDuel`, `DUEL_CONFIG`, `duel.*` i18n keys.
- Produces:
  - `DuelCanvas`: mounts a `<canvas>`, constructs `DuelScene` on mount (only if WebGL is supported), forwards a live `KeyState` (window keydown/keyup → held/pressed sets), and calls `resolveDuel` via `onOutcome`. Cleans up on unmount.
  - `DuelScreen`: reads `game.pendingDuel` for the `duelId`; renders the HUD **from a `DuelState` prop for testability** (HP bar, stamina bar, boss name/HP, control hints), a result overlay on outcome (win/lose text + retry/continue), and — when WebGL is unavailable — the Task 16 auto-resolve path instead of the canvas.
  - `App.tsx`: `case 'duel': body = <DuelScreen />;`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/web/duel/DuelScreen.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DuelHud } from '../../../src/web/duel/DuelScreen.js';
import { createDuelState } from '../../../src/duel/simulate.js';
import { t } from '../../../src/i18n/locale.js';

describe('DuelHud', () => {
  it('renders HP and stamina from a DuelState', () => {
    const s = createDuelState(1);
    render(<DuelHud state={s} bossNameKey="duel.boss.lubu" />);
    expect(screen.getByText(t('duel.hud.hp'))).toBeInTheDocument();
    expect(screen.getByText(t('duel.hud.stamina'))).toBeInTheDocument();
    expect(screen.getByText(t('duel.boss.lubu'))).toBeInTheDocument();
  });
});
```

Extend `tests/web/App.test.tsx` with a case asserting that when `screen.kind === 'duel'` the app renders the duel screen (mock/guard the canvas behind the WebGL gate so jsdom doesn't need GL — the HUD still renders).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/web/duel/DuelScreen.test.tsx`
Expected: FAIL — `DuelHud` not exported.

- [ ] **Step 3: Implement**

- Add `duel.*` keys to `src/i18n/types.ts` + both catalogs: `duel.hud.hp`, `duel.hud.stamina`, `duel.boss.lubu`, `duel.arena.hulaoguan`, `duel.briefing.hulaoguan`, `duel.result.win`, `duel.result.lose`, `duel.retry`, `duel.continue`, `duel.hint.controls`. Bilingual, parity-tested.
- Write `DuelHud` (pure presentational: takes `state: DuelState`, `bossNameKey: MessageKey`; renders bars from `state.player.hp/maxHp`, `state.player.stamina/maxStamina`, `state.boss.hp/maxHp`). Style with the existing panel/parchment classes.
- Write `DuelCanvas` (WebGL branch): on mount, if `webglSupported()`, `new DuelScene(canvasEl, { onOutcome: resolveDuel })`, wire `window` keydown/keyup into a `KeyState`, `scene.start()`; on unmount `scene.stop()` + remove listeners.
- Write `DuelScreen`: read `pendingDuel` from the store; if `!webglSupported()` run the Task 16 auto-resolve (call `resolveDuel(autoResolveDuel(duelId, DUEL_CONFIG.seed))` in an effect) and render a brief "resolved" note; else render `<DuelCanvas/>` + `<DuelHud/>` (the HUD's live `DuelState` is lifted from the scene via a subscription/callback the scene exposes) + result overlay.
- Add `case 'duel'` to `App.tsx`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/web/duel/DuelScreen.test.tsx tests/web/App.test.tsx tests/i18n/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/duel/DuelScreen.tsx src/web/duel/DuelCanvas.tsx src/web/duel/webglSupport.ts src/web/App.tsx src/i18n tests/web/duel/DuelScreen.test.tsx tests/web/App.test.tsx
git commit -m "duel render: DuelScreen + Canvas + HUD + App route + i18n"
```

---

### Task 16: No-WebGL auto-resolve fallback

**Files:**
- Create: `src/web/duel/autoResolve.ts`
- Test: `tests/web/duel/autoResolve.test.ts`

**Interfaces:**
- Consumes: `GENERALS`, `findSetpiece`, `nextRng`, `DuelOutcome`.
- Produces: `autoResolveDuel(duelId: string, seed: number): DuelOutcome` — a seeded, stat-based outcome (hero `wu` + a brothers bias vs boss `wu`) so a GPU-less player still clears the beat. Deterministic; unknown id → `'lose'`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/web/duel/autoResolve.test.ts
import { describe, expect, it } from 'vitest';
import { autoResolveDuel } from '../../../src/web/duel/autoResolve.js';

describe('autoResolveDuel', () => {
  it('is deterministic for a given seed', () => {
    expect(autoResolveDuel('hulaoguan', 5)).toBe(autoResolveDuel('hulaoguan', 5));
  });
  it('returns a valid outcome for the real set-piece', () => {
    expect(['win', 'lose']).toContain(autoResolveDuel('hulaoguan', 1));
  });
  it('loses on an unknown duel id', () => {
    expect(autoResolveDuel('nope', 1)).toBe('lose');
  });
  it('the brothers bias makes a win reachable across seeds', () => {
    const outcomes = new Set(Array.from({ length: 20 }, (_, i) => autoResolveDuel('hulaoguan', i + 1)));
    expect(outcomes.has('win')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/duel/autoResolve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/web/duel/autoResolve.ts`**

```ts
import { GENERALS } from '../../data/generals/index.js';
import { findSetpiece } from '../../engine/duel/setpieces.js';
import { nextRng } from '../../duel/types.js';
import type { DuelOutcome } from '../../duel/types.js';

// Fallback when WebGL is unavailable: compare the hero's martial (wu) — plus a
// "brothers at his side" bias so the canon win is likely — against the boss's
// wu, with a seeded roll. Keeps the campaign playable without a GPU.
export function autoResolveDuel(duelId: string, seed: number): DuelOutcome {
  const sp = findSetpiece(duelId);
  if (!sp) return 'lose';
  const heroWu = GENERALS[sp.playerHeroId]?.stats.wu ?? 50;
  const bossWu = GENERALS[sp.bossId]?.stats.wu ?? 50;
  const heroScore = heroWu + 40; // Guan Yu + Zhang Fei
  const pWin = heroScore / (heroScore + bossWu);
  const { value } = nextRng(seed);
  return value < pWin ? 'win' : 'lose';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/web/duel/autoResolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/duel/autoResolve.ts tests/web/duel/autoResolve.test.ts
git commit -m "duel render: no-WebGL seeded stat-based auto-resolve fallback"
```

---

### Task 17: Juice pass — FX + audio wiring + full-gate verification

**Files:**
- Modify: `src/web/duel/DuelScene.ts` (spawn particles on hit events, trigger audio, slow-mo already in sim)
- Modify: `src/web/audio/battle.ts` (add duel SFX hooks if not reusable as-is) OR create `src/web/duel/audio.ts`
- Test: `tests/web/duel/duelScene-events.test.ts`

**Interfaces:**
- Consumes: `DuelEvent[]` returned from `stepDuel`; the battle audio SFX helpers; the particle idiom from `BattleScene`.
- Produces: `applyDuelEventFx(events: DuelEvent[], sink: { shake(i: number): void; sfx(kind: string): void; spark(at: Vec2): void }): void` — a pure dispatcher (testable with a spy sink) that maps each event kind to shake/sfx/spark calls. `DuelScene` passes a real sink; the sim's `hitStop`/`slowMo` (already set in Task 6) provide hit-stop and the killing-blow slow-mo.

- [ ] **Step 1: Write the failing test**

```ts
// tests/web/duel/duelScene-events.test.ts
import { describe, expect, it, vi } from 'vitest';
import { applyDuelEventFx } from '../../../src/web/duel/DuelScene.js';
import type { DuelEvent } from '../../../src/duel/types.js';

describe('applyDuelEventFx', () => {
  it('maps hit events to shake + sfx + spark', () => {
    const sink = { shake: vi.fn(), sfx: vi.fn(), spark: vi.fn() };
    const events: DuelEvent[] = [
      { kind: 'playerHit', at: { x: 0, z: 0 }, amount: 7 },
      { kind: 'bossHitPlayer', at: { x: 1, z: 0 }, amount: 20 },
      { kind: 'phaseChange', at: { x: 0, z: 0 } },
    ];
    applyDuelEventFx(events, sink);
    expect(sink.shake).toHaveBeenCalled();
    expect(sink.sfx).toHaveBeenCalled();
    expect(sink.spark).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/duel/duelScene-events.test.ts`
Expected: FAIL — `applyDuelEventFx` not exported.

- [ ] **Step 3: Implement `applyDuelEventFx` in `DuelScene.ts`** and call it from the loop with a real sink (shake→`makeShake().add`, sfx→battle audio, spark→particle spawn at the event position). Map: `playerHit`/`bossHitPlayer`→shake+sfx+spark; `dodge`→whoosh sfx; `guardDeflect`→clang sfx+spark; `phaseChange`→roar sfx+big shake; `win`/`lose`→sting.

- [ ] **Step 4: Run the test + FULL GATE**

Run:
```
npx vitest run tests/web/duel/duelScene-events.test.ts
npx vitest run            # entire suite — expect 600 prior + all new duel tests, all green
npx tsc --noEmit
npm run build
```
Expected: all green; tsc + build clean. Then **manually** load the dev server, trigger the Chapter-1 Hulao Pass beat, and play the duel end-to-end (win and lose) to tune feel (`DUEL_CONFIG`) and confirm both aftermath branches continue the campaign.

- [ ] **Step 5: Commit**

```bash
git add src/web/duel/DuelScene.ts src/web/duel/audio.ts tests/web/duel/duelScene-events.test.ts
git commit -m "duel render: hit/dodge/phase FX + audio wiring; full-gate green"
```

---

## Self-Review (author checklist — completed)

**Spec coverage:** camera/POV → Task 14 (over-shoulder follow-cam); souls-lite moveset → Tasks 4/6 (light/heavy/dodge/guard/stamina); boss tells + 2 phases → Task 5; Hulao Pass Ch1 fold-in via `pendingDuel` → Tasks 8–10; stylized 3D + juice → Tasks 13/14/17; graceful win/lose → Tasks 6/10; no-WebGL fallback → Task 16; i18n → Tasks 10/15; testing strategy → every task + Task 7 balance harness. All spec sections map to a task.

**Placeholder scan:** logic tasks (1–10, 12, 16) carry complete code; renderer tasks (13–15, 17) carry skeletons + explicit "tune live" instructions because a Three.js scene cannot be honestly pre-written to the pixel — this is called out, not hidden. Two tasks (8 `bossId`, 10 `check` predicate) instruct the implementer to reconcile against real existing ids/predicates by reading named files — legitimate, since those values live in existing code.

**Type consistency:** `Vec2 {x,z}`, `DuelState`/`DuelInput`/`DuelEvent`, `stepDuel(state,input,dtMs)→{state,events}`, `stepBoss(boss,player,dtMs)→{boss,events}`, `createDuelState(seed)`, `PendingDuel {duelId}`, `duelResults: Record<string,DuelOutcome>`, `resolveDuel(outcome)`, `findSetpiece(id)`, `inputFromKeys(KeyState)→DuelInput`, `followCamTarget(a,b)`, `autoResolveDuel(id,seed)` — used consistently across all tasks.

**Known risk flagged for execution:** Tasks 8–10 depend on the exact shape of existing store/story code (`resolveStoryChoice`, the coalition predicate, `buildInitialState`). The implementer reads those files first (stated in each task). If `resolveStoryChoice`'s post-resolution logic is inlined, Task 9 extracts a shared `routeAfterResolution` (pure refactor, existing tests guard it).

