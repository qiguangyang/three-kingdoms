# Battle Tactical Depth — Phase 1 (Planner + Doctrine + Maneuver + Harness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the battle's dumb "dripping advance" tactical AI with a pure, deterministic **utility planner** whose behavior is shaped by a **doctrine** derived from the commanding general's stats + faction personality, activating the maneuver levers (hold-the-line, commit-reserves, focus-fire), and add a balance-tuning harness — all headless and fully unit-tested.

**Architecture:** A new pure package `src/engine/ai/tactics/` (doctrine → assessment → plan) that `defaultTacticalCommands` delegates to. On-screen battles and headless resolution both call `defaultTacticalCommands`, so both get smart at once. Off-screen AI-vs-AI sieges use a *separate* path (`resolveQuickBattle`) that is left completely untouched, so the strategic layer and all 204 existing tests stay green. Two small sim additions give `hold` a defensive bonus and make melee honor an explicit `meleeAttack` target (so focus-fire is real).

**Tech Stack:** TypeScript (ESM/NodeNext, explicit `.js` import specifiers), Vitest, no new runtime dependencies. Dev script run via `npx tsx scripts/<name>.ts` (existing pattern).

## Global Constraints

- **English identifiers and comments only.** No user-facing strings are added in this phase (engine/headless only), so no i18n work here.
- **ESM/NodeNext imports:** every relative import uses an explicit `.js` extension (e.g. `import { deriveDoctrine } from './doctrine.js'`), even from `.ts` sources.
- **Determinism:** no `Math.random`, no `Date`, no wall-clock. All battle randomness flows through `battle.rngCursor` inside `stepBattle`. The planner is a pure function of `(battle, factionId, personality)`.
- **Always-green:** after every task, `npm test` (full suite), `npm run typecheck`, and `npm run build` must all pass. The existing 204 tests must stay green; this phase *adds* tests and must not weaken existing assertions.
- **The seam is sacred:** do **not** modify `src/engine/combat.ts` (`resolveQuickBattle`), `src/engine/pendingOp.ts`, or `src/engine/turn.ts`. Off-screen AI-vs-AI resolution must be byte-for-byte unaffected.
- **Keep `src/engine/ai/tactical.ts` (the dumb `tacticalRules`) in place and unmodified.** It is still used by `src/engine/ai/index.ts`. Only `defaultTacticalCommands` re-points to the new planner.
- **New package path is `src/engine/ai/tactics/`** (note: `tactics`, not `tactical`) to avoid colliding with the retained `tactical.ts` file.

**Reference signatures the plan builds on (already in the codebase):**

```ts
// src/engine/types.ts
interface BattleUnit { id: string; generalId: GeneralId; factionId: FactionId; troops: number;
  troopType: TroopType; pos: { x: number; y: number }; morale: number; hasActed: boolean;
  state: BattleUnitState; formationRole: FormationRole; wu?: number; command?: number; /* + zhi? added in Task 1 */ }
interface Battle { cityId; attackerFactionId; defenderFactionId; daysElapsed: number;
  units: BattleUnit[]; field: BattleField; seed: number; rngCursor: number;
  wind?: { dir: { x: number; y: number }; strength: number }; startTroops?; log: LogEntry[]; }
type TacticalCommand =
  | { kind: 'march'; unitId: string; target: { x: number; y: number } }
  | { kind: 'meleeAttack'; unitId: string; targetUnitId: string }
  | { kind: 'rangedAttack'; unitId: string; targetUnitId: string }
  | { kind: 'charge'; unitId: string; targetUnitId: string }
  | { kind: 'stratagem'; unitId: string; targetUnitId: string }
  | { kind: 'challengeDuel'; unitId: string; targetUnitId: string }
  | { kind: 'commitReserves'; factionId: FactionId }
  | { kind: 'gambit'; gambitId: GambitId; unitIds: string[] }
  | { kind: 'hold'; unitId: string }
  | { kind: 'retreat'; unitId: string };
type Personality = 'active' | 'balanced' | 'turtle';
interface Stats { wu: number; zhi: number; tong: number; zheng: number; } // General.stats

// src/engine/battle/outcome.ts (the seam we re-point)
export function defaultTacticalCommands(battle: Battle, factionId: FactionId, personality: Personality): TacticalCommand[]

// src/engine/battle/constants.ts
export const BATTLE_TUNING = { moveRange: Record<TroopType, number>, volleyRange: 3, meleeBaseLoss: 0.18,
  volleyBaseLoss: 0.06, chargeBonus: 1.4, elevationPerLevel: 0.25, moralePer10pctLoss: 8,
  moraleDuelLoss: 15, routMoraleThreshold: 20, duelWuMin: 85, startMorale: 100 } as const;
```

---

## File Structure

**Create:**
- `src/engine/ai/tactics/doctrine.ts` — `Doctrine` type + `deriveDoctrine()` (pure; from unit stat snapshots + personality).
- `src/engine/ai/tactics/assessment.ts` — `Assessment` type + `assessBattle()` (pure battlefield read).
- `src/engine/ai/tactics/plan.ts` — `planTactical()` (enumerate + score maneuver plays → commands).
- `src/engine/ai/tactics/balance.ts` — `simulateHeadless()` + `runBalanceSweep()` (deterministic sweep, pure).
- `src/engine/ai/tactics/index.ts` — barrel re-exporting the four modules' public API.
- `scripts/battle-balance.ts` — CLI wrapper printing a sweep report (run via `npx tsx`).
- `tests/engine/tactics-doctrine.test.ts`
- `tests/engine/tactics-plan.test.ts`
- `tests/engine/tactics-differentiation.test.ts`
- `tests/engine/battle-balance.test.ts`

**Modify:**
- `src/engine/types.ts` — add `zhi?: number` to `BattleUnit`.
- `src/engine/battle/setup.ts` — snapshot `zhi: g.stats.zhi` on attacker + defender general blocks.
- `src/engine/battle/constants.ts` — add `holdBonus` to `BATTLE_TUNING`.
- `src/engine/battle/simulate.ts` — apply `holdBonus` in `meleePower`; honor an explicit `meleeAttack` target in the melee phase.
- `src/engine/battle/outcome.ts` — `defaultTacticalCommands` delegates to `planTactical`.

---

## Task 1: Snapshot `zhi` onto battle units

The doctrine's `guile` axis needs each led block's intellect. Units already snapshot `wu` and `command` (tong) at `createBattle`; add `zhi` the same way.

**Files:**
- Modify: `src/engine/types.ts` (the `BattleUnit` interface, ~line 152-168)
- Modify: `src/engine/battle/setup.ts` (attacker block ~line 72-81, defender block ~line 88-96)
- Test: `tests/engine/battle-setup.test.ts` (add one case; file exists)

**Interfaces:**
- Produces: `BattleUnit.zhi?: number` — intellect snapshot from `general.stats.zhi`, `undefined` for unled garrison blocks (same convention as `wu`/`command`).

- [ ] **Step 1: Write the failing test**

Add to `tests/engine/battle-setup.test.ts` (inside the existing top-level `describe`, or append a new `describe`):

```ts
import { createBattle } from '../../src/engine/battle/setup.js';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';

it('snapshots each led block\'s zhi (intellect) from its general', () => {
  const s = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 7 });
  const target = Object.values(s.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
  const battle = createBattle(s, {
    cityId: target.id, attackerFactionId: 'caocao', defenderFactionId: target.factionId!,
    attackingGeneralIds: ['caocao'], attackingTroops: 6000,
  });
  const led = battle.units.find((u) => u.generalId === 'caocao')!;
  expect(led.zhi).toBe(s.generals['caocao']!.stats.zhi);
  // Unled garrison blocks carry no zhi (same as wu/command).
  const garrison = battle.units.find((u) => u.generalId === '' && u.factionId === target.factionId);
  if (garrison) expect(garrison.zhi).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/battle-setup.test.ts -t "snapshots each led block"`
Expected: FAIL — `led.zhi` is `undefined` (property not set yet), so `expect(undefined).toBe(<number>)` fails.

- [ ] **Step 3: Add the type field**

In `src/engine/types.ts`, in the `BattleUnit` interface, add `zhi` next to the existing `wu`/`command` snapshot fields:

```ts
  // Leadership snapshot copied from the commanding general at createBattle
  // time, so stepBattle stays pure (no GameState lookup). Absent for garrison
  // blocks / unled mobs.
  wu?: number; // martial (wu)
  command?: number; // command (tong)
  zhi?: number; // intellect (zhi) — used by the tactical planner's doctrine
```

- [ ] **Step 4: Snapshot it in setup**

In `src/engine/battle/setup.ts`, add `zhi: g.stats.zhi,` to BOTH general-block pushes (attacker and defender). Attacker block (currently `wu: g.stats.wu, command: g.stats.tong,`):

```ts
        wu: g.stats.wu, command: g.stats.tong, zhi: g.stats.zhi,
```

Defender block (same edit):

```ts
        wu: g.stats.wu, command: g.stats.tong, zhi: g.stats.zhi,
```

(Leave the two unled garrison-block pushes — the ones with `generalId: ''` — unchanged; they carry no stats.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/engine/battle-setup.test.ts`
Expected: PASS (new case + all existing setup cases).

- [ ] **Step 6: Full green check + commit**

Run: `npm test && npm run typecheck`
Expected: all pass (204 + 1 new).

```bash
git add src/engine/types.ts src/engine/battle/setup.ts tests/engine/battle-setup.test.ts
git commit -m "battle: snapshot general zhi onto battle units for the tactical planner"
```

---

## Task 2: Doctrine model

Derive a `Doctrine` (four 0..1 weights) from the commanding general's stat snapshots + faction personality. This is where per-commander personality comes from.

**Files:**
- Create: `src/engine/ai/tactics/doctrine.ts`
- Test: `tests/engine/tactics-doctrine.test.ts`

**Interfaces:**
- Consumes: `BattleUnit.{wu,command,zhi}` (Task 1), `Battle`, `FactionId`, `Personality`.
- Produces:
  - `interface Doctrine { aggression: number; guile: number; discipline: number; caution: number }` (each 0..1)
  - `function deriveDoctrine(battle: Battle, factionId: FactionId, personality: Personality): Doctrine`

- [ ] **Step 1: Write the failing test**

Create `tests/engine/tactics-doctrine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveDoctrine } from '../../src/engine/ai/tactics/doctrine.js';
import type { Battle, BattleUnit } from '../../src/engine/types.js';
import type { BattleField } from '../../src/engine/battle/types.js';

function field(): BattleField {
  return { width: 10, height: 8, heights: new Array(80).fill(0), cells: new Array(80).fill('plain'), seed: 1 };
}
function unit(over: Partial<BattleUnit> & Pick<BattleUnit, 'id' | 'factionId'>): BattleUnit {
  return {
    generalId: over.id, troops: 5000, troopType: 'infantry', pos: { x: 0, y: 0 }, morale: 100,
    hasActed: false, state: 'fielded', formationRole: 'center', ...over,
  } as BattleUnit;
}
function battle(units: BattleUnit[]): Battle {
  return { cityId: 'c', attackerFactionId: 'A', defenderFactionId: 'B', daysElapsed: 0,
    units, field: field(), seed: 1, rngCursor: 1, log: [] };
}

describe('deriveDoctrine', () => {
  it('a Lü Bu-type commander (high wu, low zhi, active) is aggressive and low-guile', () => {
    const b = battle([unit({ id: 'lu', factionId: 'A', wu: 100, zhi: 30, command: 65 })]);
    const d = deriveDoctrine(b, 'A', 'active');
    expect(d.aggression).toBeGreaterThan(0.85);
    expect(d.guile).toBeLessThan(0.4);
    expect(d.caution).toBeLessThan(0.2);
  });

  it('a Sima Yi-type commander (high zhi + tong, balanced) is guileful and disciplined', () => {
    const b = battle([unit({ id: 'sima', factionId: 'A', wu: 60, zhi: 98, command: 95 })]);
    const d = deriveDoctrine(b, 'A', 'balanced');
    expect(d.guile).toBeGreaterThan(0.9);
    expect(d.discipline).toBeGreaterThan(0.85);
  });

  it('is comparative: the aggressor out-aggresses the schemer, who out-guiles the aggressor', () => {
    const b = battle([
      unit({ id: 'lu', factionId: 'A', wu: 100, zhi: 30, command: 65 }),
      unit({ id: 'sima', factionId: 'B', wu: 60, zhi: 98, command: 95 }),
    ]);
    const lu = deriveDoctrine(b, 'A', 'active');
    const sima = deriveDoctrine(b, 'B', 'balanced');
    expect(lu.aggression).toBeGreaterThan(sima.aggression);
    expect(sima.guile).toBeGreaterThan(lu.guile);
    expect(sima.discipline).toBeGreaterThan(lu.discipline);
  });

  it('falls back to a personality-only doctrine when a side has no led blocks (garrison only)', () => {
    const b = battle([unit({ id: 'g', factionId: 'A', generalId: '', wu: undefined, zhi: undefined, command: undefined })]);
    const d = deriveDoctrine(b, 'A', 'turtle');
    expect(d.caution).toBeGreaterThan(0.5); // turtle
    expect(Number.isFinite(d.aggression)).toBe(true);
  });

  it('produces deterministic, clamped 0..1 weights', () => {
    const b = battle([unit({ id: 'x', factionId: 'A', wu: 120, zhi: 120, command: 120 })]); // out-of-range guard
    const d1 = deriveDoctrine(b, 'A', 'active');
    const d2 = deriveDoctrine(b, 'A', 'active');
    expect(d1).toEqual(d2);
    for (const v of Object.values(d1)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/tactics-doctrine.test.ts`
Expected: FAIL — cannot resolve `../../src/engine/ai/tactics/doctrine.js` (module missing).

- [ ] **Step 3: Implement `doctrine.ts`**

Create `src/engine/ai/tactics/doctrine.ts`:

```ts
// Derive a tactical Doctrine from the commanding general's stat snapshots plus
// the faction personality. The lead general (highest command among a side's
// led blocks) sets the tone; personality nudges aggression/caution. Pure and
// deterministic — reads only the battle's unit snapshots, never GameState.
import type { Battle, BattleUnit, FactionId, Personality } from '../../types.js';

export interface Doctrine {
  aggression: number; // 0..1 — press, charge, accept melee
  guile: number; // 0..1 — stratagems, feints, target the general (used from Phase 3)
  discipline: number; // 0..1 — hold chokepoints, focus-fire, time reserves
  caution: number; // 0..1 — retreat when losing, avoid overextension
}

const AGGRO_BY_PERSONALITY: Record<Personality, number> = { active: 1, balanced: 0.5, turtle: 0.15 };
const CAUTION_BY_PERSONALITY: Record<Personality, number> = { active: 0.1, balanced: 0.4, turtle: 1 };

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

// Pick the side's lead general block: the led unit (has stat snapshots) with
// the highest command. Returns default mid-stats when a side is unled.
function leadStats(battle: Battle, factionId: FactionId): { wu: number; zhi: number; command: number } {
  let best: BattleUnit | undefined;
  for (const u of battle.units) {
    if (u.factionId !== factionId) continue;
    if (u.state === 'gone') continue;
    if (u.command === undefined || u.wu === undefined) continue; // unled mob
    if (!best || (u.command ?? 0) > (best.command ?? 0)) best = u;
  }
  if (!best) return { wu: 60, zhi: 60, command: 60 };
  return { wu: best.wu ?? 60, zhi: best.zhi ?? 60, command: best.command ?? 60 };
}

export function deriveDoctrine(battle: Battle, factionId: FactionId, personality: Personality): Doctrine {
  const { wu, zhi, command } = leadStats(battle, factionId);
  const aggression = clamp01(0.7 * (wu / 100) + 0.3 * AGGRO_BY_PERSONALITY[personality]);
  const guile = clamp01(zhi / 100);
  const discipline = clamp01(command / 100);
  const caution = clamp01(0.5 * ((100 - wu) / 100) + 0.5 * CAUTION_BY_PERSONALITY[personality]);
  return { aggression, guile, discipline, caution };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/tactics-doctrine.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add src/engine/ai/tactics/doctrine.ts tests/engine/tactics-doctrine.test.ts
git commit -m "battle/ai: add doctrine model (per-commander tactical weights)"
```

---

## Task 3: Battle assessment

A per-day read of the battlefield the planner needs: troop balance, my reserves, and a priority focus-fire target.

**Files:**
- Create: `src/engine/ai/tactics/assessment.ts`
- Test: `tests/engine/tactics-plan.test.ts` (create now; extended in Task 4)

**Interfaces:**
- Consumes: `Battle`, `FactionId`, `BattleUnit`.
- Produces:
  - `interface Assessment { myFielded: number; enemyFielded: number; advantage: number; reserveUnitIds: string[]; priorityTargetId: string | null }`
  - `function assessBattle(battle: Battle, factionId: FactionId): Assessment`
  - `advantage` = `myFielded / max(enemyFielded, 1)`.
  - `priorityTargetId` = the active enemy unit with the fewest troops (finish the weakest); `null` if no active enemy.

- [ ] **Step 1: Write the failing test**

Create `tests/engine/tactics-plan.test.ts` with the assessment cases (planner cases append in Task 4):

```ts
import { describe, expect, it } from 'vitest';
import { assessBattle } from '../../src/engine/ai/tactics/assessment.js';
import type { Battle, BattleUnit } from '../../src/engine/types.js';
import type { BattleField } from '../../src/engine/battle/types.js';

export function flatField(w = 12, h = 10): BattleField {
  return { width: w, height: h, heights: new Array(w * h).fill(0), cells: new Array(w * h).fill('plain'), seed: 3 };
}
export function u(over: Partial<BattleUnit> & Pick<BattleUnit, 'id' | 'factionId' | 'pos'>): BattleUnit {
  return { generalId: over.id, troops: 5000, troopType: 'infantry', morale: 100, hasActed: false,
    state: 'fielded', formationRole: 'center', ...over } as BattleUnit;
}
export function mkBattle(units: BattleUnit[], field: BattleField = flatField()): Battle {
  return { cityId: 'c', attackerFactionId: 'A', defenderFactionId: 'B', daysElapsed: 0,
    units, field, seed: 9, rngCursor: 9, log: [] };
}

describe('assessBattle', () => {
  it('sums fielded troops per side and computes advantage', () => {
    const b = mkBattle([
      u({ id: 'a1', factionId: 'A', pos: { x: 2, y: 8 }, troops: 8000 }),
      u({ id: 'e1', factionId: 'B', pos: { x: 2, y: 2 }, troops: 4000 }),
    ]);
    const a = assessBattle(b, 'A');
    expect(a.myFielded).toBe(8000);
    expect(a.enemyFielded).toBe(4000);
    expect(a.advantage).toBeCloseTo(2, 5);
  });

  it('lists my reserve unit ids', () => {
    const b = mkBattle([
      u({ id: 'a1', factionId: 'A', pos: { x: 2, y: 8 } }),
      u({ id: 'ar', factionId: 'A', pos: { x: 3, y: 9 }, state: 'reserve' }),
      u({ id: 'e1', factionId: 'B', pos: { x: 2, y: 2 } }),
    ]);
    expect(assessBattle(b, 'A').reserveUnitIds).toEqual(['ar']);
  });

  it('picks the weakest active enemy as the priority target', () => {
    const b = mkBattle([
      u({ id: 'a1', factionId: 'A', pos: { x: 2, y: 8 } }),
      u({ id: 'strong', factionId: 'B', pos: { x: 2, y: 2 }, troops: 9000 }),
      u({ id: 'weak', factionId: 'B', pos: { x: 5, y: 2 }, troops: 1200 }),
    ]);
    expect(assessBattle(b, 'A').priorityTargetId).toBe('weak');
  });

  it('has a null priority target when no enemy is active', () => {
    const b = mkBattle([u({ id: 'a1', factionId: 'A', pos: { x: 2, y: 8 } })]);
    const a = assessBattle(b, 'A');
    expect(a.priorityTargetId).toBeNull();
    expect(a.advantage).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/tactics-plan.test.ts`
Expected: FAIL — cannot resolve `assessment.js`.

- [ ] **Step 3: Implement `assessment.ts`**

Create `src/engine/ai/tactics/assessment.ts`:

```ts
// A pure per-day read of the battlefield from one side's perspective. Feeds
// the planner: troop balance, available reserves, and a focus-fire target.
import type { Battle, BattleUnit, FactionId } from '../../types.js';

export interface Assessment {
  myFielded: number; // my total fielded troops
  enemyFielded: number; // enemy total fielded troops
  advantage: number; // myFielded / max(enemyFielded, 1)
  reserveUnitIds: string[]; // my units in state 'reserve'
  priorityTargetId: string | null; // weakest active enemy unit id (finish it)
}

const isFielded = (x: BattleUnit): boolean => x.state === 'fielded' && x.troops > 0;

export function assessBattle(battle: Battle, factionId: FactionId): Assessment {
  let myFielded = 0;
  let enemyFielded = 0;
  const reserveUnitIds: string[] = [];
  let target: BattleUnit | null = null;
  for (const un of battle.units) {
    const mine = un.factionId === factionId;
    if (mine && un.state === 'reserve') reserveUnitIds.push(un.id);
    if (!isFielded(un)) continue;
    if (mine) {
      myFielded += un.troops;
    } else {
      enemyFielded += un.troops;
      if (!target || un.troops < target.troops) target = un;
    }
  }
  return {
    myFielded,
    enemyFielded,
    advantage: myFielded / Math.max(enemyFielded, 1),
    reserveUnitIds,
    priorityTargetId: target ? target.id : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/tactics-plan.test.ts`
Expected: PASS (4 assessment cases).

- [ ] **Step 5: Commit**

```bash
git add src/engine/ai/tactics/assessment.ts tests/engine/tactics-plan.test.ts
git commit -m "battle/ai: add per-day battlefield assessment"
```

---

## Task 4: The tactical planner

Turn doctrine + assessment into a coherent `TacticalCommand[]` for a side, emitting the maneuver plays: hold favorable ground, commit reserves at the right moment, focus-fire the priority target, and press (charge) when aggressive — while guaranteeing an overwhelming attacker keeps pressing (never stalls to a timeout).

**Files:**
- Create: `src/engine/ai/tactics/plan.ts`
- Create: `src/engine/ai/tactics/index.ts`
- Test: `tests/engine/tactics-plan.test.ts` (append)

**Interfaces:**
- Consumes: `deriveDoctrine` (Task 2), `assessBattle` (Task 3), `BATTLE_TUNING.moveRange`.
- Produces:
  - `function planTactical(battle: Battle, factionId: FactionId, personality: Personality): TacticalCommand[]`
  - Guarantees: at most one unit-command per fielded unit; at most one `commitReserves` for the side; deterministic; returns `[]` when the side has no active enemy.
  - `index.ts` re-exports `deriveDoctrine`, `Doctrine`, `assessBattle`, `Assessment`, `planTactical`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/tactics-plan.test.ts`:

```ts
import { planTactical } from '../../src/engine/ai/tactics/plan.js';

const kinds = (cmds: ReturnType<typeof planTactical>) => cmds.map((c) => c.kind);
const forUnit = (cmds: ReturnType<typeof planTactical>, id: string) =>
  cmds.find((c) => 'unitId' in c && (c as { unitId: string }).unitId === id);

describe('planTactical', () => {
  it('returns no commands when there is no active enemy', () => {
    const b = mkBattle([u({ id: 'a1', factionId: 'A', pos: { x: 2, y: 8 } })]);
    expect(planTactical(b, 'A', 'balanced')).toEqual([]);
  });

  it('issues at most one command per fielded unit', () => {
    const b = mkBattle([
      u({ id: 'a1', factionId: 'A', pos: { x: 2, y: 8 } }),
      u({ id: 'a2', factionId: 'A', pos: { x: 5, y: 8 } }),
      u({ id: 'e1', factionId: 'B', pos: { x: 3, y: 2 } }),
    ]);
    const cmds = planTactical(b, 'A', 'active');
    expect(forUnit(cmds, 'a1')).toBeDefined();
    expect(cmds.filter((c) => 'unitId' in c && (c as { unitId: string }).unitId === 'a1')).toHaveLength(1);
  });

  it('an adjacent unit melee-attacks the priority (weakest) enemy — focus fire', () => {
    const b = mkBattle([
      u({ id: 'a1', factionId: 'A', pos: { x: 4, y: 4 } }),
      u({ id: 'strong', factionId: 'B', pos: { x: 5, y: 4 }, troops: 9000 }),
      u({ id: 'weak', factionId: 'B', pos: { x: 3, y: 4 }, troops: 1000 }),
    ]);
    const cmd = forUnit(planTactical(b, 'A', 'balanced'), 'a1');
    expect(cmd?.kind).toBe('meleeAttack');
    expect((cmd as { targetUnitId: string }).targetUnitId).toBe('weak'); // adjacent + weakest
  });

  it('commits reserves when losing badly', () => {
    const b = mkBattle([
      u({ id: 'a1', factionId: 'A', pos: { x: 4, y: 6 }, troops: 1000 }),
      u({ id: 'ar', factionId: 'A', pos: { x: 4, y: 9 }, state: 'reserve', troops: 4000 }),
      u({ id: 'e1', factionId: 'B', pos: { x: 4, y: 3 }, troops: 9000 }),
    ]);
    expect(kinds(planTactical(b, 'A', 'balanced'))).toContain('commitReserves');
  });

  it('a disciplined defender on high ground holds; an aggressor in the same spot does not', () => {
    const field = flatField();
    // Make (4,4) a hill so it is favorable ground; enemy is 3 cells away (not adjacent).
    field.cells[4 * 12 + 4] = 'hill';
    field.heights[4 * 12 + 4] = 0.8;
    const b = mkBattle([
      u({ id: 'd1', factionId: 'A', pos: { x: 4, y: 4 }, wu: 55, zhi: 90, command: 95 }),
      u({ id: 'e1', factionId: 'B', pos: { x: 4, y: 7 }, troops: 5000 }),
    ], field);
    const disciplined = forUnit(planTactical(b, 'A', 'turtle'), 'd1');
    expect(disciplined?.kind).toBe('hold');

    const b2 = mkBattle([
      u({ id: 'd1', factionId: 'A', pos: { x: 4, y: 4 }, wu: 99, zhi: 20, command: 60 }),
      u({ id: 'e1', factionId: 'B', pos: { x: 4, y: 7 }, troops: 5000 }),
    ], field);
    expect(forUnit(planTactical(b2, 'A', 'active'), 'd1')?.kind).not.toBe('hold');
  });

  it('an overwhelming attacker presses (never holds) so it cannot stall into a timeout', () => {
    const field = flatField();
    field.cells[4 * 12 + 4] = 'hill'; // favorable ground that would tempt a hold
    field.heights[4 * 12 + 4] = 0.8;
    const b = mkBattle([
      u({ id: 'a1', factionId: 'A', pos: { x: 4, y: 4 }, wu: 55, zhi: 95, command: 95, troops: 30000 }),
      u({ id: 'e1', factionId: 'B', pos: { x: 4, y: 7 }, troops: 800 }),
    ], field);
    // advantage = 30000/800 >> 1.5, so even a disciplined/cautious doctrine must press.
    expect(forUnit(planTactical(b, 'A', 'turtle'), 'a1')?.kind).not.toBe('hold');
  });

  it('is deterministic', () => {
    const mk = () => mkBattle([
      u({ id: 'a1', factionId: 'A', pos: { x: 4, y: 6 }, troopType: 'cavalry' }),
      u({ id: 'e1', factionId: 'B', pos: { x: 4, y: 4 } }),
    ]);
    expect(planTactical(mk(), 'A', 'active')).toEqual(planTactical(mk(), 'A', 'active'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/tactics-plan.test.ts`
Expected: FAIL — cannot resolve `plan.js`.

- [ ] **Step 3: Implement `plan.ts`**

Create `src/engine/ai/tactics/plan.ts`:

```ts
// The utility planner: turns doctrine + assessment into a coherent set of
// maneuver commands for one side. Pure and deterministic. Consumed by
// defaultTacticalCommands, so it drives the enemy, the player's auto-line, and
// (Phase 1b) the player's offered levers.
import { BATTLE_TUNING } from '../../battle/constants.js';
import type { Battle, BattleUnit, FactionId, Personality, TacticalCommand } from '../../types.js';
import type { BattleCell, Vec2 } from '../../battle/types.js';
import { deriveDoctrine } from './doctrine.js';
import { assessBattle } from './assessment.js';

const chebyshev = (a: Vec2, b: Vec2): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const isFielded = (u: BattleUnit): boolean => u.state === 'fielded' && u.troops > 0;

function cellAt(battle: Battle, p: Vec2): BattleCell {
  const { width, height } = battle.field;
  if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) return 'plain';
  return battle.field.cells[p.y * width + p.x] ?? 'plain';
}
function heightAt(battle: Battle, p: Vec2): number {
  const { width, height } = battle.field;
  if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) return 0;
  return battle.field.heights[p.y * width + p.x] ?? 0;
}
// Chokepoints and high ground worth holding.
function isFavorableGround(battle: Battle, p: Vec2): boolean {
  const cell = cellAt(battle, p);
  if (cell === 'ford' || cell === 'gate' || cell === 'hill' || cell === 'wall' || cell === 'ramp') return true;
  return heightAt(battle, p) >= 0.4;
}
function nearestEnemy(u: BattleUnit, enemies: BattleUnit[]): BattleUnit | undefined {
  let best: BattleUnit | undefined;
  let bestD = Infinity;
  for (const e of enemies) {
    const d = chebyshev(u.pos, e.pos);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

export function planTactical(battle: Battle, factionId: FactionId, personality: Personality): TacticalCommand[] {
  const enemies = battle.units.filter((e) => e.factionId !== factionId && isFielded(e));
  if (enemies.length === 0) return [];

  const doc = deriveDoctrine(battle, factionId, personality);
  const a = assessBattle(battle, factionId);
  const cmds: TacticalCommand[] = [];

  // --- Battle-level: commit reserves when shoring up a losing line OR when an
  // aggressive doctrine presses a clear advantage.
  const losing = a.advantage < 0.85;
  const pressingOpening = a.advantage > 1.3 && doc.aggression > 0.5;
  if (a.reserveUnitIds.length > 0 && (losing || pressingOpening)) {
    cmds.push({ kind: 'commitReserves', factionId });
  }

  const priority = a.priorityTargetId ? battle.units.find((x) => x.id === a.priorityTargetId) : undefined;
  // An overwhelming attacker must always press, or it could hold and time out.
  const mustPress = a.advantage > 1.5;
  // Disciplined/cautious doctrines value holding favorable ground.
  const holdInclination = (doc.discipline + doc.caution) / 2;

  const myUnits = battle.units.filter((u) => u.factionId === factionId && isFielded(u));
  for (const u of myUnits) {
    const near = nearestEnemy(u, enemies);
    if (!near) continue;
    const dist = chebyshev(u.pos, near.pos);

    // HOLD: hang back on favorable ground, letting the enemy come, when the
    // doctrine prefers defense and we are not adjacent and not obliged to press.
    if (!mustPress && dist > 1 && holdInclination > doc.aggression && isFavorableGround(battle, u.pos)) {
      cmds.push({ kind: 'hold', unitId: u.id });
      continue;
    }

    if (dist <= 1) {
      // FOCUS FIRE: prefer the priority (weakest) enemy when it is adjacent.
      const focusAdjacent = priority && isFielded(priority) && chebyshev(u.pos, priority.pos) <= 1;
      const targetId = focusAdjacent ? priority!.id : near.id;
      cmds.push({ kind: 'meleeAttack', unitId: u.id, targetUnitId: targetId });
    } else if (u.troopType === 'archer' && dist <= BATTLE_TUNING.volleyRange) {
      const focusInRange = priority && isFielded(priority) && chebyshev(u.pos, priority.pos) <= BATTLE_TUNING.volleyRange;
      const targetId = focusInRange ? priority!.id : near.id;
      cmds.push({ kind: 'rangedAttack', unitId: u.id, targetUnitId: targetId });
    } else if ((u.troopType === 'cavalry' || u.troopType === 'heavyCav') && doc.aggression > 0.6
      && dist <= (BATTLE_TUNING.moveRange[u.troopType] ?? 4)) {
      // Aggressive cavalry charges into contact (base charge bonus already in the sim).
      cmds.push({ kind: 'charge', unitId: u.id, targetUnitId: near.id });
    } else {
      // MARCH: a disciplined side converges on the priority target; others advance on the nearest.
      const dest = doc.discipline > 0.6 && priority && isFielded(priority) ? priority.pos : near.pos;
      cmds.push({ kind: 'march', unitId: u.id, target: { x: dest.x, y: dest.y } });
    }
  }

  return cmds;
}
```

- [ ] **Step 4: Create the barrel `index.ts`**

Create `src/engine/ai/tactics/index.ts`:

```ts
export type { Doctrine } from './doctrine.js';
export { deriveDoctrine } from './doctrine.js';
export type { Assessment } from './assessment.js';
export { assessBattle } from './assessment.js';
export { planTactical } from './plan.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/engine/tactics-plan.test.ts && npm run typecheck`
Expected: PASS (all assessment + planner cases; types clean).

- [ ] **Step 6: Commit**

```bash
git add src/engine/ai/tactics/plan.ts src/engine/ai/tactics/index.ts tests/engine/tactics-plan.test.ts
git commit -m "battle/ai: add the utility tactical planner (maneuver plays)"
```

---

## Task 5: Re-point `defaultTacticalCommands` to the planner

Flip the on-screen + headless AI seam from the dumb `tacticalRules` to `planTactical`. This is the moment both the enemy and the player's auto-line get smart. The existing behavioral tests must stay green.

**Files:**
- Modify: `src/engine/battle/outcome.ts:8` (import) and `:23-29` (`defaultTacticalCommands`)
- Test: existing `tests/engine/battle-outcome.test.ts`, `tests/state/battle-session.test.ts`, `tests/playthrough/battle-flow.test.ts` must stay green (no new test file; this is a re-wire whose correctness is the whole suite).

**Interfaces:**
- Consumes: `planTactical` (Task 4).
- Produces: `defaultTacticalCommands` now returns `planTactical(battle, factionId, personality)` — same signature, smarter output. `resolveBattleHeadless`, `battleSession.mergeCommands`, and `autoResolveSession` inherit it unchanged.

- [ ] **Step 1: Change the import**

In `src/engine/battle/outcome.ts`, replace the tactical import (line 8):

```ts
import { tacticalRules } from '../ai/tactical.js';
```

with:

```ts
import { planTactical } from '../ai/tactics/index.js';
```

- [ ] **Step 2: Delegate to the planner**

Replace the body of `defaultTacticalCommands` (lines 23-29):

```ts
export function defaultTacticalCommands(
  battle: Battle,
  factionId: FactionId,
  personality: Personality,
): TacticalCommand[] {
  return planTactical(battle, factionId, personality);
}
```

- [ ] **Step 3: Run the previously-affected suites**

Run: `npx vitest run tests/engine/battle-outcome.test.ts tests/state/battle-session.test.ts tests/playthrough/battle-flow.test.ts`
Expected: PASS. In particular `battle-outcome` test "an overwhelming attacker captures the city" must still show `attackerWon === true` — the planner's `mustPress` rule guarantees the 20000-vs-300 attacker advances and destroys rather than holding to a timeout. If this test regresses to `false`, the planner's press logic is wrong — fix `plan.ts` (do not weaken the test).

- [ ] **Step 4: Full green check**

Run: `npm test && npm run typecheck && npm run build`
Expected: all 204+ tests pass; types clean; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/engine/battle/outcome.ts
git commit -m "battle: route on-screen + headless tactical AI through the planner"
```

---

## Task 6: Sim — `hold` gains a defensive bonus

`hold` already means "don't move." Give a holding unit a braced-defense melee multiplier so Hold-the-Line is mechanically meaningful, without changing any existing test (which never combines `hold` with an adjacent enemy).

**Files:**
- Modify: `src/engine/battle/constants.ts` (add `holdBonus` to `BATTLE_TUNING`)
- Modify: `src/engine/battle/simulate.ts` (`meleePower`, ~line 66-72)
- Test: `tests/engine/battle-sim.test.ts` (append)

**Interfaces:**
- Consumes: existing `orders` map in `stepBattle`.
- Produces: `BATTLE_TUNING.holdBonus: number` (1.3); a unit with a `hold` order fights melee at `× holdBonus`.

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/battle-sim.test.ts` (inside the first `describe`, reusing its `battle`/`unit` helpers):

```ts
it('a holding unit brace-defends: it inflicts more and suffers less than when idle', () => {
  const mk = () => battle([
    unit({ id: 'a', factionId: 'A', pos: { x: 4, y: 4 }, troops: 6000 }),
    unit({ id: 'e', factionId: 'B', pos: { x: 5, y: 4 }, troops: 6000 }),
  ]);
  const idle = stepBattle({ battle: mk(), commands: [] });
  const held = stepBattle({ battle: mk(), commands: [{ kind: 'hold', unitId: 'a' }] });
  const eIdle = idle.battle.units.find((x) => x.id === 'e')!;
  const eHeld = held.battle.units.find((x) => x.id === 'e')!;
  const aIdle = idle.battle.units.find((x) => x.id === 'a')!;
  const aHeld = held.battle.units.find((x) => x.id === 'a')!;
  expect(6000 - eHeld.troops).toBeGreaterThan(6000 - eIdle.troops); // held unit inflicts more
  expect(6000 - aHeld.troops).toBeLessThan(6000 - aIdle.troops); // and suffers less
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/battle-sim.test.ts -t "brace-defends"`
Expected: FAIL — with no hold bonus, held and idle casualties are identical, so `toBeGreaterThan`/`toBeLessThan` fail.

- [ ] **Step 3: Add the tuning constant**

In `src/engine/battle/constants.ts`, add inside `BATTLE_TUNING` (after `chargeBonus`):

```ts
  // Extra melee multiplier for a unit that spends the day holding (braced defense).
  holdBonus: 1.3,
```

- [ ] **Step 4: Apply it in `meleePower`**

In `src/engine/battle/simulate.ts`, in `meleePower` (lines 66-72), add a `holding` factor alongside `charging`:

```ts
function meleePower(battle: Battle, u: BattleUnit, orders: Map<string, TacticalCommand>): number {
  const t = cellTerrain(cellAt(battle, u.pos));
  const mod = COMBAT_MODIFIER[u.troopType]?.[t] ?? 1.0;
  const order = orders.get(u.id)?.kind;
  const charging = order === 'charge' ? BATTLE_TUNING.chargeBonus : 1.0;
  const holding = order === 'hold' ? BATTLE_TUNING.holdBonus : 1.0;
  const elev = 1 + heightAt(battle, u.pos) * BATTLE_TUNING.elevationPerLevel;
  return u.troops * mod * unitLeadership(u) * charging * holding * elev;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/engine/battle-sim.test.ts`
Expected: PASS (new case + all existing sim cases, incl. the existing "honors an explicit hold command (no move)" which is unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/engine/battle/constants.ts src/engine/battle/simulate.ts tests/engine/battle-sim.test.ts
git commit -m "battle/sim: holding units get a braced-defense melee bonus"
```

---

## Task 7: Sim — melee honors an explicit `meleeAttack` target (focus fire)

Today the melee phase attacks whatever enemy is adjacent, ignoring order targets. Make a unit prefer its ordered `meleeAttack` target when that target is adjacent, so the planner's focus-fire actually concentrates on one block. Fully backward-compatible: with no `meleeAttack` order the behavior is identical.

**Files:**
- Modify: `src/engine/battle/simulate.ts` (melee phase, ~line 194-210)
- Test: `tests/engine/battle-sim.test.ts` (append)

**Interfaces:**
- Consumes: the existing `orders` map + `byId` helper in `stepBattle`.
- Produces: no new exports; melee target selection now prefers an adjacent ordered target.

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/battle-sim.test.ts` (first `describe`):

```ts
it('honors a meleeAttack order: a unit hits its ordered target, not just the nearest', () => {
  // 'a' is adjacent to BOTH 'weak' (x=3) and 'strong' (x=5). Default melee picks
  // the first adjacent found; an explicit order must direct it at 'strong'.
  const mk = () => battle([
    unit({ id: 'a', factionId: 'A', pos: { x: 4, y: 4 }, troops: 6000 }),
    unit({ id: 'weak', factionId: 'B', pos: { x: 3, y: 4 }, troops: 6000 }),
    unit({ id: 'strong', factionId: 'B', pos: { x: 5, y: 4 }, troops: 6000 }),
  ]);
  const { battle: next } = stepBattle({ battle: mk(), commands: [{ kind: 'meleeAttack', unitId: 'a', targetUnitId: 'strong' }] });
  const strong = next.units.find((x) => x.id === 'strong')!;
  expect(strong.troops).toBeLessThan(6000); // the ordered target took the hit
});

it('melee is unchanged when no meleeAttack order is given (determinism preserved)', () => {
  const mk = () => battle([
    unit({ id: 'a', factionId: 'A', pos: { x: 4, y: 4 } }),
    unit({ id: 'e', factionId: 'B', pos: { x: 5, y: 4 } }),
  ]);
  expect(stepBattle({ battle: mk(), commands: [] })).toEqual(stepBattle({ battle: mk(), commands: [] }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/battle-sim.test.ts -t "honors a meleeAttack order"`
Expected: FAIL — without target-honoring, `a` fights the first adjacent enemy found (`weak` at x=3, iteration order), leaving `strong` at 6000.

- [ ] **Step 3: Implement target preference in the melee phase**

In `src/engine/battle/simulate.ts`, replace the enemy selection at the top of the melee loop. Change:

```ts
  for (const u of units) {
    if (!isActive(u)) continue;
    const enemy = units.find((e) => e.factionId !== u.factionId && isActive(e) && chebyshev(u.pos, e.pos) <= 1);
    if (!enemy) continue;
```

to:

```ts
  for (const u of units) {
    if (!isActive(u)) continue;
    // Prefer an explicitly ordered target when it is adjacent (focus fire);
    // otherwise fall back to the first adjacent enemy (unchanged default).
    const order = orders.get(u.id);
    let enemy: BattleUnit | undefined;
    if (order && order.kind === 'meleeAttack') {
      const t = byId(order.targetUnitId);
      if (t && t.factionId !== u.factionId && isActive(t) && chebyshev(u.pos, t.pos) <= 1) enemy = t;
    }
    if (!enemy) enemy = units.find((e) => e.factionId !== u.factionId && isActive(e) && chebyshev(u.pos, e.pos) <= 1);
    if (!enemy) continue;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/battle-sim.test.ts`
Expected: PASS (new cases + all existing, incl. the existing melee/determinism cases which pass `commands: []`).

- [ ] **Step 5: Full green check + commit**

Run: `npm test && npm run typecheck`
Expected: all pass.

```bash
git add src/engine/battle/simulate.ts tests/engine/battle-sim.test.ts
git commit -m "battle/sim: melee honors an explicit meleeAttack target (focus fire)"
```

---

## Task 8: Balance-tuning harness

A deterministic headless sweep to validate tuning: build synthetic two-block battles, run both sides through the planner to completion, and report win-rate / length / lever usage. A fast Vitest test asserts invariants; a CLI script prints the full report.

**Files:**
- Create: `src/engine/ai/tactics/balance.ts`
- Create: `scripts/battle-balance.ts`
- Test: `tests/engine/battle-balance.test.ts`

**Interfaces:**
- Consumes: `planTactical` (Task 4), `stepBattle` (`src/engine/battle/simulate.js`), `BattleField`/`Battle`/`BattleUnit`.
- Produces:
  - `interface Matchup { seed: number; attacker: SideSpec; defender: SideSpec }` where `interface SideSpec { troops: number; troopType?: TroopType; wu?: number; zhi?: number; command?: number; personality: Personality }`
  - `interface BattleReport { attackerWon: boolean; days: number; leverCounts: Record<string, number> }`
  - `function simulateHeadless(m: Matchup): BattleReport`
  - `interface SweepReport { n: number; attackerWinRate: number; avgDays: number; leverTotals: Record<string, number> }`
  - `function runBalanceSweep(matchups: Matchup[]): SweepReport`

- [ ] **Step 1: Write the failing test**

Create `tests/engine/battle-balance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { simulateHeadless, runBalanceSweep, type Matchup } from '../../src/engine/ai/tactics/balance.js';

const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('battle balance harness', () => {
  it('every battle terminates within the 30-day limit', () => {
    for (const seed of seeds) {
      const r = simulateHeadless({ seed,
        attacker: { troops: 6000, wu: 80, zhi: 60, command: 75, personality: 'balanced' },
        defender: { troops: 6000, wu: 80, zhi: 60, command: 75, personality: 'balanced' } });
      expect(r.days).toBeLessThanOrEqual(30);
    }
  });

  it('a 2x quality+numbers advantage wins the clear majority of seeds', () => {
    const matchups: Matchup[] = seeds.map((seed) => ({ seed,
      attacker: { troops: 12000, wu: 95, zhi: 80, command: 90, personality: 'active' },
      defender: { troops: 6000, wu: 60, zhi: 55, command: 60, personality: 'balanced' } }));
    const sweep = runBalanceSweep(matchups);
    expect(sweep.attackerWinRate).toBeGreaterThanOrEqual(0.7);
  });

  it('an even matchup is not a foregone conclusion (upsets happen both ways)', () => {
    const matchups: Matchup[] = seeds.map((seed) => ({ seed,
      attacker: { troops: 6000, wu: 78, zhi: 60, command: 72, personality: 'balanced' },
      defender: { troops: 6000, wu: 78, zhi: 60, command: 72, personality: 'balanced' } }));
    const sweep = runBalanceSweep(matchups);
    expect(sweep.attackerWinRate).toBeGreaterThan(0.1);
    expect(sweep.attackerWinRate).toBeLessThan(0.9);
  });

  it('the maneuver levers are reachable: hold, commitReserves, and charge each fire somewhere in a sweep', () => {
    // A cautious defender with reserves on a hill vs an aggressive cavalry attacker
    // exercises hold (defender), commitReserves (loser), and charge (attacker).
    const matchups: Matchup[] = seeds.map((seed) => ({ seed,
      attacker: { troops: 14000, troopType: 'cavalry', wu: 96, zhi: 30, command: 70, personality: 'active' },
      defender: { troops: 5000, wu: 55, zhi: 90, command: 92, personality: 'turtle' } }));
    const sweep = runBalanceSweep(matchups);
    expect(sweep.leverTotals.hold ?? 0).toBeGreaterThan(0);
    expect(sweep.leverTotals.charge ?? 0).toBeGreaterThan(0);
    expect(sweep.leverTotals.commitReserves ?? 0).toBeGreaterThan(0);
  });

  it('is deterministic for a given matchup', () => {
    const m: Matchup = { seed: 42,
      attacker: { troops: 8000, wu: 85, zhi: 70, command: 80, personality: 'active' },
      defender: { troops: 7000, wu: 70, zhi: 75, command: 85, personality: 'turtle' } };
    expect(simulateHeadless(m)).toEqual(simulateHeadless(m));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/battle-balance.test.ts`
Expected: FAIL — cannot resolve `balance.js`.

- [ ] **Step 3: Implement `balance.ts`**

Create `src/engine/ai/tactics/balance.ts`:

```ts
// Deterministic headless balance harness. Builds synthetic two-block battles,
// runs both sides through the planner to completion, and reports the outcome,
// length, and how often each command kind was used. Pure — no I/O.
import { BATTLE_DAY_LIMIT } from '../../constants.js';
import { stepBattle } from '../../battle/simulate.js';
import type { Battle, BattleUnit, Personality, TroopType } from '../../types.js';
import type { BattleField } from '../../battle/types.js';
import { planTactical } from './plan.js';

export interface SideSpec {
  troops: number;
  troopType?: TroopType;
  wu?: number;
  zhi?: number;
  command?: number;
  personality: Personality;
}
export interface Matchup {
  seed: number;
  attacker: SideSpec;
  defender: SideSpec;
}
export interface BattleReport {
  attackerWon: boolean;
  days: number;
  leverCounts: Record<string, number>;
}
export interface SweepReport {
  n: number;
  attackerWinRate: number;
  avgDays: number;
  leverTotals: Record<string, number>;
}

const A = 'A';
const B = 'B';

function openField(seed: number): BattleField {
  const w = 12;
  const h = 12;
  const heights = new Array(w * h).fill(0);
  const cells = new Array(w * h).fill('plain');
  // A defensible hill in front of the defender, so the hold lever is reachable.
  cells[3 * w + 6] = 'hill';
  heights[3 * w + 6] = 0.8;
  return { width: w, height: h, heights, cells, seed };
}

function block(id: string, factionId: string, spec: SideSpec, y: number): BattleUnit {
  return {
    id, generalId: id === 'gar' ? '' : id, factionId, troops: spec.troops,
    troopType: spec.troopType ?? 'infantry', pos: { x: 6, y }, morale: 100, hasActed: false,
    state: 'fielded', formationRole: 'center', wu: spec.wu, command: spec.command, zhi: spec.zhi,
  };
}

function buildBattle(m: Matchup): Battle {
  const units: BattleUnit[] = [
    block('atk', A, m.attacker, 10),
    block('def', B, m.defender, 3),
    // A small defender reserve so commitReserves is reachable.
    { id: 'res', generalId: '', factionId: B, troops: Math.round(m.defender.troops * 0.4),
      troopType: 'infantry', pos: { x: 6, y: 1 }, morale: 100, hasActed: false,
      state: 'reserve', formationRole: 'rear' },
  ];
  return { cityId: 'c', attackerFactionId: A, defenderFactionId: B, daysElapsed: 0,
    units, field: openField(m.seed), seed: m.seed, rngCursor: m.seed >>> 0, log: [] };
}

export function simulateHeadless(m: Matchup): BattleReport {
  let cur = buildBattle(m);
  const leverCounts: Record<string, number> = {};
  let attackerWon = false;
  let days = 0;
  for (let day = 0; day < BATTLE_DAY_LIMIT; day++) {
    const atkCmds = planTactical(cur, A, m.attacker.personality);
    const defCmds = planTactical(cur, B, m.defender.personality);
    for (const c of [...atkCmds, ...defCmds]) leverCounts[c.kind] = (leverCounts[c.kind] ?? 0) + 1;
    const stepped = stepBattle({ battle: cur, commands: [...atkCmds, ...defCmds] });
    cur = stepped.battle;
    days = cur.daysElapsed;
    const end = stepped.events.find((e) => e.kind === 'end');
    if (end && end.kind === 'end') { attackerWon = end.attackerWon; break; }
  }
  return { attackerWon, days, leverCounts };
}

export function runBalanceSweep(matchups: Matchup[]): SweepReport {
  let wins = 0;
  let totalDays = 0;
  const leverTotals: Record<string, number> = {};
  for (const m of matchups) {
    const r = simulateHeadless(m);
    if (r.attackerWon) wins++;
    totalDays += r.days;
    for (const [k, v] of Object.entries(r.leverCounts)) leverTotals[k] = (leverTotals[k] ?? 0) + v;
  }
  const n = matchups.length;
  return { n, attackerWinRate: n ? wins / n : 0, avgDays: n ? totalDays / n : 0, leverTotals };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/battle-balance.test.ts`
Expected: PASS (all 5 cases). If the "2x advantage" or "upsets" thresholds fail, that is real balance signal — adjust `BATTLE_TUNING` numbers (e.g. `meleeBaseLoss`, `holdBonus`) rather than the test's intent, and note the change.

- [ ] **Step 5: Add the CLI script**

Create `scripts/battle-balance.ts`:

```ts
// Balance sweep report. Run: npx tsx scripts/battle-balance.ts
// Prints attacker win-rate, average length, and lever usage across a matrix of
// troop ratios, commanders, and personalities. Deterministic (seeded).
import { runBalanceSweep, type Matchup } from '../src/engine/ai/tactics/balance.js';

const personalities = ['active', 'balanced', 'turtle'] as const;
const ratios = [0.6, 0.8, 1, 1.25, 1.6];
const matchups: Matchup[] = [];
let seed = 1;
for (const r of ratios) {
  for (const ap of personalities) {
    for (const dp of personalities) {
      for (let rep = 0; rep < 6; rep++) {
        matchups.push({
          seed: seed++,
          attacker: { troops: Math.round(6000 * r), wu: 85, zhi: 70, command: 80, personality: ap },
          defender: { troops: 6000, wu: 75, zhi: 75, command: 80, personality: dp },
        });
      }
    }
  }
}

const report = runBalanceSweep(matchups);
// eslint-disable-next-line no-console
console.log(JSON.stringify(report, null, 2));
```

- [ ] **Step 6: Run the script to confirm it works**

Run: `npx tsx scripts/battle-balance.ts`
Expected: prints a JSON `SweepReport` (n=270, an `attackerWinRate`, `avgDays`, and `leverTotals` including `hold`, `charge`, `commitReserves`, `meleeAttack`, `march`, `rangedAttack`). No crash.

- [ ] **Step 7: Full green check + commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass.

```bash
git add src/engine/ai/tactics/balance.ts scripts/battle-balance.ts tests/engine/battle-balance.test.ts
git commit -m "battle/ai: add deterministic balance-tuning harness + CLI"
```

---

## Task 9: Doctrine-differentiation test

Prove the central claim — that a commander's personality now measurably changes how the army fights (the direct rebuttal to today's `smartTactics:false`). Run the planner for an aggressive vs a disciplined commander on the same position and assert different lever profiles.

**Files:**
- Test: `tests/engine/tactics-differentiation.test.ts`

**Interfaces:**
- Consumes: `planTactical` (Task 4), `simulateHeadless` (Task 8).

- [ ] **Step 1: Write the test**

Create `tests/engine/tactics-differentiation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { planTactical } from '../../src/engine/ai/tactics/plan.js';
import { simulateHeadless, type Matchup } from '../../src/engine/ai/tactics/balance.js';
import type { Battle, BattleUnit } from '../../src/engine/types.js';
import type { BattleField } from '../../src/engine/battle/types.js';

function fieldWithHill(): BattleField {
  const w = 12, h = 12;
  const heights = new Array(w * h).fill(0);
  const cells = new Array(w * h).fill('plain');
  cells[4 * w + 6] = 'hill';
  heights[4 * w + 6] = 0.8;
  return { width: w, height: h, heights, cells, seed: 2 };
}
function unit(over: Partial<BattleUnit> & Pick<BattleUnit, 'id' | 'factionId' | 'pos'>): BattleUnit {
  return { generalId: over.id, troops: 5000, troopType: 'infantry', morale: 100, hasActed: false,
    state: 'fielded', formationRole: 'center', ...over } as BattleUnit;
}
function battle(units: BattleUnit[]): Battle {
  return { cityId: 'c', attackerFactionId: 'A', defenderFactionId: 'B', daysElapsed: 0,
    units, field: fieldWithHill(), seed: 2, rngCursor: 2, log: [] };
}

describe('doctrine changes how an army fights', () => {
  it('a disciplined defender on the hill holds where an aggressive one presses', () => {
    // Defender block sits on the hill (6,4); enemy is 3 cells south (not adjacent).
    const mk = (wu: number, zhi: number, command: number) => battle([
      unit({ id: 'd', factionId: 'A', pos: { x: 6, y: 4 }, wu, zhi, command, troops: 5000 }),
      unit({ id: 'e', factionId: 'B', pos: { x: 6, y: 7 }, troops: 5000 }),
    ]);
    const disciplined = planTactical(mk(55, 92, 95), 'A', 'turtle');
    const aggressive = planTactical(mk(99, 25, 60), 'A', 'active');
    const holds = (cs: ReturnType<typeof planTactical>) => cs.filter((c) => c.kind === 'hold').length;
    expect(holds(disciplined)).toBeGreaterThan(holds(aggressive));
  });

  it('an aggressive cavalry commander charges more than a cautious one over a full battle', () => {
    const base: Omit<Matchup, 'attacker'> = { seed: 11,
      defender: { troops: 6000, wu: 70, zhi: 70, command: 80, personality: 'balanced' } };
    const aggressive = simulateHeadless({ ...base,
      attacker: { troops: 9000, troopType: 'cavalry', wu: 98, zhi: 25, command: 70, personality: 'active' } });
    const cautious = simulateHeadless({ ...base,
      attacker: { troops: 9000, troopType: 'cavalry', wu: 55, zhi: 80, command: 85, personality: 'turtle' } });
    expect(aggressive.leverCounts.charge ?? 0).toBeGreaterThan(cautious.leverCounts.charge ?? 0);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/engine/tactics-differentiation.test.ts`
Expected: PASS (2 cases). If the charge-count comparison is flaky for a seed, pick a seed where the outcomes clearly differ (the assertion is `>`, and an aggressive cavalry doctrine emits `charge` where a cautious one marches/holds).

- [ ] **Step 3: Final full green check + commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass.

```bash
git add tests/engine/tactics-differentiation.test.ts
git commit -m "battle/ai: assert doctrine measurably changes tactical behavior"
```

---

## Self-Review

**1. Spec coverage (Phase 1 scope):**
- Utility planner with doctrine → Tasks 2, 3, 4. ✓
- Doctrine from commanding general's stats + personality → Task 2. ✓
- Snapshot `zhi` (needed by doctrine) → Task 1. ✓
- Maneuver levers activated in the sim: Commit Reserves (already resolved; planner now issues it — Task 4), Hold the Line (movement already halts; defensive bonus — Task 6; planner issues — Task 4), Focus Fire (melee target honoring — Task 7; planner targets priority — Task 4). ✓
- Re-point `defaultTacticalCommands`; keep off-screen `resolveQuickBattle` untouched → Task 5 + Global Constraints. ✓
- Balance-tuning harness (script + invariant test) → Task 8. ✓
- Doctrine-differentiation test → Task 9. ✓
- Determinism (all planner/sim additions pure, seeded) → asserted in Tasks 2, 4, 7, 8. ✓
- Deferred to a **Phase 1b** plan (called out, not silently dropped): session `offeredDecisions` + `chooseDecision`, salience-gated auto-play pause, the maneuver-lever HUD buttons, and their i18n. These are UI-layer and don't affect the headless brain shipped here.
- Deferred to Phases 2–4 per the spec: hero levers (duel/rally/charge morale-rider), stratagems (wind/fire/flood/ambush/feign-retreat), and the final tuning pass. The planner's `guile` axis is computed now but only bites once stratagems exist.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases/write tests for the above" — every step has concrete code and exact run commands. ✓

**3. Type consistency:** `Doctrine` fields (`aggression`/`guile`/`discipline`/`caution`) match across doctrine.ts, plan.ts, and tests. `Assessment` fields (`myFielded`/`enemyFielded`/`advantage`/`reserveUnitIds`/`priorityTargetId`) match assessment.ts and plan.ts. `planTactical(battle, factionId, personality)` signature matches its call in `defaultTacticalCommands` (Task 5) and the harness (Task 8). `Matchup`/`SideSpec`/`BattleReport`/`SweepReport` are used identically in balance.ts, the CLI, and both test files. `BATTLE_TUNING.holdBonus` added in Task 6 and read in the same task. ✓

**4. Green-safety of the re-wire:** existing battle tests are behavioral, not seed-pinned; the sim changes (Tasks 6, 7) only affect units carrying `hold`/`meleeAttack` orders, which existing sim tests don't use; the planner's `mustPress` rule protects `battle-outcome` test #1. Task 5 explicitly runs the three affected suites, then the full suite. ✓

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-10-battle-tactical-depth-phase1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
