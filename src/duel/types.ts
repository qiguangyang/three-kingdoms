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
