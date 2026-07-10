# Battle Tactical Depth — Phase 1b (Player Decision Windows + Maneuver Lever HUD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the Phase 1 maneuver brain to the player — offer contextual commander levers (Commit Reserves / Hold the Line / Focus Fire) in the battle HUD, and pause auto-play *only* for pivotal decisions (with a "Continue watching" resume), so the battle stays cinematic but you can seize the decisive moment.

**Architecture:** A pure engine detector `offerPlayerDecisions(battle, factionId)` (in the existing `src/engine/ai/tactics/` package) returns typed `OfferedDecision[]` for the player's side, each carrying compiled `TacticalCommand[]` and a `salient` flag. The session exposes these as `offeredDecisions` (recomputed each day) plus small pure selectors (`pendingPivotalDecision`, `chargeableUnitIds`); a store mutator `chooseBattleDecision` queues a decision's orders. The DOM HUD renders a lever tray and, when a *salient* decision is offered during auto-play, pauses and shows a pivotal prompt — otherwise it keeps flowing and the auto-play force-charge only touches units the player hasn't given an order to (so levers stick).

**Tech Stack:** TypeScript (ESM/NodeNext, explicit `.js` import specifiers), React 19 + Zustand, Vitest + Testing Library (jsdom), Tailwind. No new runtime dependencies.

## Global Constraints

- **English identifiers and comments only.** All user-facing strings go through i18n with **both `zh` and `en`** from the first commit.
- **ESM/NodeNext imports:** every relative import uses an explicit `.js` extension, even from `.ts`/`.tsx` sources.
- **Determinism:** the engine detector is a pure function of `(battle, factionId)` — no `Math.random`, no `Date`, no wall-clock; it reads only battle state. React timers (`setTimeout`) drive *pacing* only, never outcomes.
- **Always-green:** after every task, `npm test` (full suite, currently 232), `npm run typecheck`, and `npm run build` all pass. This phase *adds* tests and must not weaken existing ones.
- **The seam is sacred:** do not modify `src/engine/combat.ts`, `src/engine/pendingOp.ts`, or `src/engine/turn.ts`. Do not change `resolveQuickBattle` behavior.
- **Interruption model (decided with the user): "pivotal-only pause."** Auto-play keeps flowing and surfaces lever buttons for every offered decision; it PAUSES only when a decision is marked `salient` (Phase 1b: a reserve commit that can swing a non-winning battle), showing a "Continue watching" affordance to resume. Non-salient levers never stop the battle.
- **Levers must stick during auto-play:** the HUD auto-play's "press the assault" force-charge must only order units that have **no** queued player command, so a Hold/Focus lever is not overwritten next tick.

**Reference signatures this phase builds on (already in the codebase):**

```ts
// src/state/battleSession.ts
export interface BattleSession {
  battle: Battle; phase: BattlePhase; speed: 1 | 2 | 4; playerFactionId: FactionId;
  playerIsAttacker: boolean; personalities: Record<FactionId, Personality>;
  queuedPlayerCommands: TacticalCommand[];
  lastEvents: ReturnType<typeof stepBattle>['events'];
  gambits: Gambit[]; attackerWon: boolean | null; endReason: 'destroyed' | 'timeout' | null;
}
export function startSession(battle, playerFactionId, personalities): BattleSession
export function queuePlayerCommand(session, cmd: TacticalCommand): BattleSession  // replaces prior order for same unitId
export function chooseGambit(session, gambitId): BattleSession
export function resolveDay(session): BattleSession   // recomputes gambits, resets queuedPlayerCommands

// src/engine/ai/tactics/ (Phase 1)
export function assessBattle(battle, factionId): Assessment
//   Assessment = { myFielded, enemyFielded, advantage, reserveUnitIds: string[], priorityTargetId: string | null }

// src/engine/battle/constants.ts
export const BATTLE_TUNING = { volleyRange: 3, /* … */ } as const;

// src/state/store.ts (existing battle mutators)
export function chooseBattleGambit(gambitId: GambitId): void
export function submitBattleOrders(cmds: TacticalCommand[]): void
export function resolveBattleDay(): void
```

---

## File Structure

**Create:**
- `src/engine/ai/tactics/decisions.ts` — `OfferedDecision` type + `offerPlayerDecisions()` (pure detector).
- `tests/engine/tactics-decisions.test.ts`

**Modify:**
- `src/engine/ai/tactics/index.ts` — re-export `OfferedDecision` + `offerPlayerDecisions`.
- `src/state/battleSession.ts` — add `offeredDecisions` to `BattleSession`; compute it in `startSession`/`resolveDay`; add `chooseDecision`, `pendingPivotalDecision`, `chargeableUnitIds`.
- `tests/state/battle-session.test.ts` — session decision tests (append).
- `src/state/store.ts` — add `chooseBattleDecision(id)` mutator.
- `tests/state/battle-store.test.ts` — store test (append).
- `src/i18n/types.ts` — add the new `battle.decision.*` keys to the `MessageKey` union.
- `src/i18n/catalog/en.ts`, `src/i18n/catalog/zh.ts` — add the new key strings.
- `tests/i18n/battle-keys.test.ts` — add the new keys to `KEYS`.
- `src/web/battle/BattleScreen.tsx` — render the lever tray; wire the pivotal pause + prompt + force-charge fix.
- `tests/web/BattleScreen.test.tsx` — HUD tests (append).

---

## Task 1: Engine — `offerPlayerDecisions`

A pure detector that surfaces the player's maneuver levers for the current battle state, each with compiled orders and a salience flag.

**Files:**
- Create: `src/engine/ai/tactics/decisions.ts`
- Modify: `src/engine/ai/tactics/index.ts`
- Test: `tests/engine/tactics-decisions.test.ts`

**Interfaces:**
- Consumes: `assessBattle` (Phase 1), `BATTLE_TUNING.volleyRange`, `Battle`/`BattleUnit`/`TacticalCommand`/`FactionId`.
- Produces:
  - `interface OfferedDecision { id: string; family: 'maneuver'; labelKey: string; salient: boolean; commands: TacticalCommand[] }`
  - `function offerPlayerDecisions(battle: Battle, factionId: FactionId): OfferedDecision[]`
  - Decisions emitted (in this order, only when applicable): `commitReserves` (id `'commitReserves'`, `salient` when `advantage < 1.0`), `holdLine` (id `'holdLine'`), `focusFire` (id `` `focusFire:${targetId}` ``). Returns `[]` when the side has no active enemy.

- [ ] **Step 1: Write the failing test**

Create `tests/engine/tactics-decisions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { offerPlayerDecisions } from '../../src/engine/ai/tactics/decisions.js';
import type { Battle, BattleUnit } from '../../src/engine/types.js';
import type { BattleField } from '../../src/engine/battle/types.js';

function field(over: Partial<BattleField> = {}): BattleField {
  const w = 12, h = 10;
  return { width: w, height: h, heights: new Array(w * h).fill(0), cells: new Array(w * h).fill('plain'), seed: 3, ...over };
}
function u(over: Partial<BattleUnit> & Pick<BattleUnit, 'id' | 'factionId' | 'pos'>): BattleUnit {
  return { generalId: over.id, troops: 5000, troopType: 'infantry', morale: 100, hasActed: false,
    state: 'fielded', formationRole: 'center', ...over } as BattleUnit;
}
function mk(units: BattleUnit[], f: BattleField = field()): Battle {
  return { cityId: 'c', attackerFactionId: 'A', defenderFactionId: 'B', daysElapsed: 0,
    units, field: f, seed: 9, rngCursor: 9, log: [] };
}
const ids = (ds: ReturnType<typeof offerPlayerDecisions>) => ds.map((d) => d.id);
const find = (ds: ReturnType<typeof offerPlayerDecisions>, id: string) => ds.find((d) => d.id === id || d.id.startsWith(id));

describe('offerPlayerDecisions', () => {
  it('returns nothing when the side has no active enemy', () => {
    expect(offerPlayerDecisions(mk([u({ id: 'a', factionId: 'A', pos: { x: 2, y: 8 } })]), 'A')).toEqual([]);
  });

  it('offers Commit Reserves when reserves exist, salient when not already winning', () => {
    const losing = mk([
      u({ id: 'a', factionId: 'A', pos: { x: 6, y: 8 }, troops: 2000 }),
      u({ id: 'r', factionId: 'A', pos: { x: 6, y: 9 }, state: 'reserve', troops: 3000 }),
      u({ id: 'e', factionId: 'B', pos: { x: 6, y: 2 }, troops: 6000 }),
    ]);
    const d = find(offerPlayerDecisions(losing, 'A'), 'commitReserves')!;
    expect(d).toBeDefined();
    expect(d.salient).toBe(true);
    expect(d.commands).toEqual([{ kind: 'commitReserves', factionId: 'A' }]);
  });

  it('offers Commit Reserves NON-salient when already comfortably ahead', () => {
    const winning = mk([
      u({ id: 'a', factionId: 'A', pos: { x: 6, y: 8 }, troops: 9000 }),
      u({ id: 'r', factionId: 'A', pos: { x: 6, y: 9 }, state: 'reserve', troops: 3000 }),
      u({ id: 'e', factionId: 'B', pos: { x: 6, y: 2 }, troops: 2000 }),
    ]);
    expect(find(offerPlayerDecisions(winning, 'A'), 'commitReserves')!.salient).toBe(false);
  });

  it('offers Hold the Line when a fielded unit stands on favorable ground with no adjacent enemy', () => {
    const f = field();
    f.cells[4 * 12 + 6] = 'hill'; f.heights[4 * 12 + 6] = 0.8;
    const b = mk([
      u({ id: 'a', factionId: 'A', pos: { x: 6, y: 4 } }),
      u({ id: 'e', factionId: 'B', pos: { x: 6, y: 8 } }),
    ], f);
    const d = find(offerPlayerDecisions(b, 'A'), 'holdLine')!;
    expect(d).toBeDefined();
    expect(d.commands).toEqual([{ kind: 'hold', unitId: 'a' }]);
    expect(d.salient).toBe(false);
  });

  it('offers Focus Fire on the weakest enemy, compiling per-unit orders by range', () => {
    const b = mk([
      u({ id: 'melee', factionId: 'A', pos: { x: 5, y: 3 } }),            // adjacent to weak
      u({ id: 'arch', factionId: 'A', pos: { x: 4, y: 5 }, troopType: 'archer' }), // within volley range 3
      u({ id: 'far', factionId: 'A', pos: { x: 1, y: 9 } }),              // must march
      u({ id: 'strong', factionId: 'B', pos: { x: 8, y: 3 }, troops: 9000 }),
      u({ id: 'weak', factionId: 'B', pos: { x: 4, y: 3 }, troops: 1000 }),
    ]);
    const d = find(offerPlayerDecisions(b, 'A'), 'focusFire')!;
    expect(d).toBeDefined();
    expect(d.id).toBe('focusFire:weak');
    expect(d.commands).toContainEqual({ kind: 'meleeAttack', unitId: 'melee', targetUnitId: 'weak' });
    expect(d.commands).toContainEqual({ kind: 'rangedAttack', unitId: 'arch', targetUnitId: 'weak' });
    expect(d.commands).toContainEqual({ kind: 'march', unitId: 'far', target: { x: 4, y: 3 } });
  });

  it('is deterministic', () => {
    const build = () => mk([
      u({ id: 'a', factionId: 'A', pos: { x: 6, y: 8 } }),
      u({ id: 'r', factionId: 'A', pos: { x: 6, y: 9 }, state: 'reserve' }),
      u({ id: 'e', factionId: 'B', pos: { x: 6, y: 2 } }),
    ]);
    expect(offerPlayerDecisions(build(), 'A')).toEqual(offerPlayerDecisions(build(), 'A'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/tactics-decisions.test.ts`
Expected: FAIL — cannot resolve `../../src/engine/ai/tactics/decisions.js`.

- [ ] **Step 3: Implement `decisions.ts`**

Create `src/engine/ai/tactics/decisions.ts`:

```ts
// Pure detector: surfaces the player's contextual maneuver levers for the
// current battle state, each with compiled orders and a salience flag (whether
// it is pivotal enough to pause auto-play). Reads only battle state.
import { BATTLE_TUNING } from '../../battle/constants.js';
import type { Battle, BattleUnit, FactionId, TacticalCommand } from '../../types.js';
import type { BattleCell, Vec2 } from '../../battle/types.js';
import { assessBattle } from './assessment.js';

export interface OfferedDecision {
  id: string; // 'commitReserves' | 'holdLine' | `focusFire:${targetUnitId}`
  family: 'maneuver';
  labelKey: string; // i18n MessageKey
  salient: boolean; // pause auto-play for this decision
  commands: TacticalCommand[];
}

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
function isFavorableGround(battle: Battle, p: Vec2): boolean {
  const cell = cellAt(battle, p);
  if (cell === 'ford' || cell === 'gate' || cell === 'hill' || cell === 'wall' || cell === 'ramp') return true;
  return heightAt(battle, p) >= 0.4;
}

export function offerPlayerDecisions(battle: Battle, factionId: FactionId): OfferedDecision[] {
  const enemies = battle.units.filter((e) => e.factionId !== factionId && isFielded(e));
  if (enemies.length === 0) return [];
  const a = assessBattle(battle, factionId);
  const mine = battle.units.filter((u) => u.factionId === factionId && isFielded(u));
  const out: OfferedDecision[] = [];

  // Commit Reserves — pivotal (pause-worthy) when you are not already winning.
  if (a.reserveUnitIds.length > 0) {
    out.push({
      id: 'commitReserves', family: 'maneuver', labelKey: 'battle.commitReserves',
      salient: a.advantage < 1.0, commands: [{ kind: 'commitReserves', factionId }],
    });
  }

  // Hold the Line — units on favorable ground with no adjacent enemy dig in.
  const holdUnits = mine.filter(
    (u) => isFavorableGround(battle, u.pos) && !enemies.some((e) => chebyshev(u.pos, e.pos) <= 1),
  );
  if (holdUnits.length > 0) {
    out.push({
      id: 'holdLine', family: 'maneuver', labelKey: 'battle.decision.holdLine',
      salient: false, commands: holdUnits.map((u) => ({ kind: 'hold', unitId: u.id })),
    });
  }

  // Focus Fire — concentrate the whole force on the weakest enemy block.
  if (a.priorityTargetId) {
    const target = battle.units.find((x) => x.id === a.priorityTargetId);
    if (target) {
      const commands: TacticalCommand[] = mine.map((u) => {
        const dist = chebyshev(u.pos, target.pos);
        if (dist <= 1) return { kind: 'meleeAttack', unitId: u.id, targetUnitId: target.id };
        if (u.troopType === 'archer' && dist <= BATTLE_TUNING.volleyRange) {
          return { kind: 'rangedAttack', unitId: u.id, targetUnitId: target.id };
        }
        return { kind: 'march', unitId: u.id, target: { x: target.pos.x, y: target.pos.y } };
      });
      out.push({ id: `focusFire:${target.id}`, family: 'maneuver', labelKey: 'battle.decision.focusFire', salient: false, commands });
    }
  }

  return out;
}
```

- [ ] **Step 4: Re-export from the barrel**

In `src/engine/ai/tactics/index.ts`, add:

```ts
export type { OfferedDecision } from './decisions.js';
export { offerPlayerDecisions } from './decisions.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/engine/tactics-decisions.test.ts && npm run typecheck`
Expected: PASS (6 cases; types clean).

- [ ] **Step 6: Commit**

```bash
git add src/engine/ai/tactics/decisions.ts src/engine/ai/tactics/index.ts tests/engine/tactics-decisions.test.ts
git commit -m "battle/ai: add offerPlayerDecisions (contextual maneuver levers)"
```

---

## Task 2: Session — offeredDecisions, chooseDecision, and pure HUD selectors

Expose the detector's output on the session, let the player pick a decision, and add the two pure selectors the HUD needs (which decision is pivotal; which units the auto-play may force-charge).

**Files:**
- Modify: `src/state/battleSession.ts`
- Test: `tests/state/battle-session.test.ts` (append)

**Interfaces:**
- Consumes: `offerPlayerDecisions`, `OfferedDecision` (Task 1); existing `queuePlayerCommand`.
- Produces:
  - `BattleSession.offeredDecisions: OfferedDecision[]` (recomputed on `startSession` + `resolveDay`, player side).
  - `function chooseDecision(session: BattleSession, id: string): BattleSession` — queues the chosen decision's commands (each via the same replace-per-unit logic).
  - `function pendingPivotalDecision(session: BattleSession): OfferedDecision | null` — the first `salient` offered decision, else null.
  - `function chargeableUnitIds(session: BattleSession): string[]` — fielded player unit ids with **no** queued player command (the set the HUD auto-play may force-charge).

- [ ] **Step 1: Write the failing tests**

Append to `tests/state/battle-session.test.ts`:

```ts
import {
  chooseDecision, pendingPivotalDecision, chargeableUnitIds,
} from '../../src/state/battleSession.js';

describe('battle session — player decisions', () => {
  it('startSession computes offeredDecisions for the player side', () => {
    const { battle, personalities } = setup();
    const sess = startSession(battle, 'caocao', personalities);
    expect(Array.isArray(sess.offeredDecisions)).toBe(true);
    // The setup attacker has multiple blocks vs a weak garrison, so a focus-fire
    // decision on the weakest enemy is always available.
    expect(sess.offeredDecisions.some((d) => d.id.startsWith('focusFire'))).toBe(true);
  });

  it('chooseDecision queues the decision\'s commands (replacing per-unit orders)', () => {
    const { battle, personalities } = setup();
    let sess = startSession(battle, 'caocao', personalities);
    const focus = sess.offeredDecisions.find((d) => d.id.startsWith('focusFire'))!;
    sess = chooseDecision(sess, focus.id);
    // Every command in the chosen decision is now queued.
    for (const c of focus.commands) {
      expect(sess.queuedPlayerCommands).toContainEqual(c);
    }
  });

  it('chooseDecision is a no-op for an unknown id', () => {
    const { battle, personalities } = setup();
    const sess = startSession(battle, 'caocao', personalities);
    expect(chooseDecision(sess, 'nope').queuedPlayerCommands).toEqual(sess.queuedPlayerCommands);
  });

  it('pendingPivotalDecision returns a salient decision or null', () => {
    const { battle, personalities } = setup();
    const sess = startSession(battle, 'caocao', personalities);
    const pivotal = pendingPivotalDecision(sess);
    expect(pivotal === null || pivotal.salient === true).toBe(true);
  });

  it('chargeableUnitIds excludes units that already have a queued order', () => {
    const { battle, personalities } = setup();
    let sess = startSession(battle, 'caocao', personalities);
    const all = chargeableUnitIds(sess);
    expect(all.length).toBeGreaterThan(0);
    const held = all[0]!;
    sess = queuePlayerCommand(sess, { kind: 'hold', unitId: held });
    expect(chargeableUnitIds(sess)).not.toContain(held);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/state/battle-session.test.ts`
Expected: FAIL — `chooseDecision`/`pendingPivotalDecision`/`chargeableUnitIds` are not exported (and `offeredDecisions` is undefined).

- [ ] **Step 3: Implement in `battleSession.ts`**

Add the import near the top (alongside the existing engine imports):

```ts
import { offerPlayerDecisions } from '../engine/ai/tactics/index.js';
import type { OfferedDecision } from '../engine/ai/tactics/index.js';
```

Add `offeredDecisions` to the `BattleSession` interface (after `gambits`):

```ts
  gambits: Gambit[];
  offeredDecisions: OfferedDecision[];
```

In `startSession`, add the field to the returned object (after the `gambits:` line):

```ts
    gambits: filterPlayerGambits(battle, detectGambits(battle), playerFactionId),
    offeredDecisions: offerPlayerDecisions(battle, playerFactionId),
```

In `resolveDay`, add it to BOTH returned session objects. In the non-terminal return (after the `gambits:` line):

```ts
    gambits: filterPlayerGambits(next, detectGambits(next), session.playerFactionId),
    offeredDecisions: offerPlayerDecisions(next, session.playerFactionId),
    phase: 'awaitingOrders',
```

In the terminal (`end`) return, the battle is over — set it empty (it sits next to `gambits: []`):

```ts
    return { ...session, battle: next, lastEvents: events, gambits: [], offeredDecisions: [], phase: 'resolved', attackerWon: end.attackerWon, endReason: end.reason, queuedPlayerCommands: [] };
```

Add the three new exported functions at the end of the file:

```ts
export function chooseDecision(session: BattleSession, id: string): BattleSession {
  const d = session.offeredDecisions.find((x) => x.id === id);
  if (!d) return session;
  let next = session;
  for (const cmd of d.commands) next = queuePlayerCommand(next, cmd);
  return next;
}

export function pendingPivotalDecision(session: BattleSession): OfferedDecision | null {
  return session.offeredDecisions.find((d) => d.salient) ?? null;
}

export function chargeableUnitIds(session: BattleSession): string[] {
  const ordered = new Set(
    session.queuedPlayerCommands.filter((c) => 'unitId' in c).map((c) => (c as { unitId: string }).unitId),
  );
  return session.battle.units
    .filter((u) => u.factionId === session.playerFactionId && u.state === 'fielded' && u.troops > 0 && !ordered.has(u.id))
    .map((u) => u.id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/state/battle-session.test.ts && npm run typecheck`
Expected: PASS (existing session cases + 5 new). Typecheck clean (every `startSession`/`resolveDay` return now includes `offeredDecisions`; if TS reports a missing property, add it to that return object).

- [ ] **Step 5: Commit**

```bash
git add src/state/battleSession.ts tests/state/battle-session.test.ts
git commit -m "battle/state: expose offeredDecisions + chooseDecision + HUD selectors on the session"
```

---

## Task 3: Store — `chooseBattleDecision`

Route a player's decision pick into the session, mirroring `chooseBattleGambit`.

**Files:**
- Modify: `src/state/store.ts`
- Test: `tests/state/battle-store.test.ts` (append)

**Interfaces:**
- Consumes: `chooseDecision` (Task 2).
- Produces: `export function chooseBattleDecision(id: string): void`.

- [ ] **Step 1: Write the failing test**

First look at `tests/state/battle-store.test.ts` to match its existing setup (how it loads a game into a battle). Then append a test that mirrors the existing store-battle pattern:

```ts
import { chooseBattleDecision } from '../../src/state/store.js';

it('chooseBattleDecision queues the chosen decision\'s orders into the live session', () => {
  // (Reuse this file's existing helper that loads a game whose pendingBattle
  //  puts the store into a battle session — see the other tests in this file.)
  enterBattleForTest(); // <- use the existing setup helper/pattern in this file
  const before = gameStore.getState().battle!;
  const focus = before.offeredDecisions.find((d) => d.id.startsWith('focusFire'));
  expect(focus).toBeDefined();
  chooseBattleDecision(focus!.id);
  const after = gameStore.getState().battle!;
  expect(after.queuedPlayerCommands.length).toBeGreaterThan(before.queuedPlayerCommands.length);
});
```

(If `battle-store.test.ts` has no reusable "enter battle" helper, construct the session the same way the file's other tests do — via `loadGame` with a `pendingBattle` — and read `gameStore.getState().battle`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/state/battle-store.test.ts`
Expected: FAIL — `chooseBattleDecision` is not exported.

- [ ] **Step 3: Implement in `store.ts`**

Add the import to the existing `./battleSession.js` import block:

```ts
  autoResolveSession, chooseDecision, chooseGambit, queuePlayerCommand, resolveDay, sessionResult, setSpeed, startSession,
```

Add the mutator next to `chooseBattleGambit`:

```ts
export function chooseBattleDecision(id: string): void {
  gameStore.setState((s) => (s.battle ? { ...s, battle: chooseDecision(s.battle, id) } : s));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/state/battle-store.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/store.ts tests/state/battle-store.test.ts
git commit -m "battle/state: add chooseBattleDecision store mutator"
```

---

## Task 4: i18n — decision keys (zh + en)

Add the user-facing strings for the lever tray and the pivotal prompt.

**Files:**
- Modify: `src/i18n/types.ts` (add to the `MessageKey` union), `src/i18n/catalog/en.ts`, `src/i18n/catalog/zh.ts`
- Test: `tests/i18n/battle-keys.test.ts` (add keys to `KEYS`)

**Interfaces:**
- Produces four new `MessageKey`s: `battle.decision.tray`, `battle.decision.holdLine`, `battle.decision.focusFire`, `battle.decision.pivotal`, `battle.decision.continue`.

- [ ] **Step 1: Add the keys to the test first (RED)**

In `tests/i18n/battle-keys.test.ts`, extend the `KEYS` array with:

```ts
  'battle.decision.tray', 'battle.decision.holdLine', 'battle.decision.focusFire',
  'battle.decision.pivotal', 'battle.decision.continue',
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/i18n/battle-keys.test.ts`
Expected: FAIL — the new keys resolve to themselves (not defined) / the values are the key strings.

- [ ] **Step 3: Add to the `MessageKey` union**

In `src/i18n/types.ts`, in the `battle.*` section of the `MessageKey` union, add the five string-literal members (matching the existing formatting):

```ts
  | 'battle.decision.tray'
  | 'battle.decision.holdLine'
  | 'battle.decision.focusFire'
  | 'battle.decision.pivotal'
  | 'battle.decision.continue'
```

- [ ] **Step 4: Add the English strings**

In `src/i18n/catalog/en.ts`, near the other `battle.*` entries:

```ts
  'battle.decision.tray': 'Command',
  'battle.decision.holdLine': 'Hold the Line',
  'battle.decision.focusFire': 'Focus Fire',
  'battle.decision.pivotal': 'A decisive moment',
  'battle.decision.continue': 'Continue watching',
```

- [ ] **Step 5: Add the Chinese strings**

In `src/i18n/catalog/zh.ts`, near the other `battle.*` entries:

```ts
  'battle.decision.tray': '调度',
  'battle.decision.holdLine': '坚守阵线',
  'battle.decision.focusFire': '集火猛攻',
  'battle.decision.pivotal': '决胜时刻',
  'battle.decision.continue': '继续观战',
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/i18n/battle-keys.test.ts tests/i18n/parity.test.ts && npm run typecheck`
Expected: PASS (both locales resolve the new keys; en/zh key sets stay in parity; the `MessageCatalog` type is satisfied).

- [ ] **Step 7: Commit**

```bash
git add src/i18n/types.ts src/i18n/catalog/en.ts src/i18n/catalog/zh.ts tests/i18n/battle-keys.test.ts
git commit -m "i18n: add battle.decision.* keys (zh + en)"
```

---

## Task 5: HUD — render the maneuver lever tray

Show `session.offeredDecisions` as a gold-accented lever tray in the bottom command cluster, styled like the existing gambit tray; clicking a lever queues its orders and advances the day.

**Files:**
- Modify: `src/web/battle/BattleScreen.tsx`
- Test: `tests/web/BattleScreen.test.tsx` (append)

**Interfaces:**
- Consumes: `session.offeredDecisions` (Task 2), `chooseBattleDecision` (Task 3), existing `resolveBattleDay`, `t`, `CinBtn`.

- [ ] **Step 1: Write the failing test**

First read `tests/web/BattleScreen.test.tsx` to reuse its render helper (it renders `<BattleScreen/>` under jsdom with a seeded battle session in the store). Append:

```ts
it('renders the maneuver lever tray for the offered decisions', () => {
  renderBattleForTest(); // <- the existing helper that seeds a battle + renders BattleScreen
  // Focus Fire is always offered when the player has units and an enemy exists.
  expect(screen.getByText('集火猛攻')).toBeInTheDocument(); // zh 'Focus Fire' (default locale is zh)
});
```

(Match the file's existing query style and default locale. If the file renders in `en`, assert `'Focus Fire'` instead. If it has no reusable helper, seed the battle the same way the file's other tests do.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/BattleScreen.test.tsx -t "maneuver lever tray"`
Expected: FAIL — no lever tray rendered yet.

- [ ] **Step 3: Import the store mutator**

In `src/web/battle/BattleScreen.tsx`, add `chooseBattleDecision` to the existing `../../state/store.js` import:

```ts
import {
  chooseBattleDecision, chooseBattleGambit, finishBattle, quickResolveBattle, resolveBattleDay,
  setBattleSpeed, submitBattleOrders,
} from '../../state/store.js';
```

- [ ] **Step 4: Render the tray**

In the "Bottom command cluster" (inside `{!resolved && (...)}`), immediately AFTER the existing gambit-tray block (the `{session.gambits.length > 0 && ( … )}` JSX) and before the "Primary controls" div, add:

```tsx
          {/* Maneuver levers — the commander's contextual moves. */}
          {session.offeredDecisions.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-2" style={PANEL}>
              <span className="font-display text-xs" style={{ letterSpacing: '0.28em', color: GOLD }}>{t('battle.decision.tray')}</span>
              {session.offeredDecisions.map((d) => (
                <CinBtn key={d.id} onClick={() => { chooseBattleDecision(d.id); resolveBattleDay(); }}>
                  {t(d.labelKey as MessageKey)}
                </CinBtn>
              ))}
            </div>
          )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/web/BattleScreen.test.tsx && npm run typecheck`
Expected: PASS (new render case + existing BattleScreen cases).

- [ ] **Step 6: Commit**

```bash
git add src/web/battle/BattleScreen.tsx tests/web/BattleScreen.test.tsx
git commit -m "battle/hud: render the maneuver lever tray"
```

---

## Task 6: HUD — pivotal pause + prompt + force-charge fix

Make auto-play pause on a *salient* decision (showing a "Continue watching" prompt), and stop the auto-play force-charge from overriding the player's lever orders.

**Files:**
- Modify: `src/web/battle/BattleScreen.tsx`
- Test: `tests/web/BattleScreen.test.tsx` (append)

**Interfaces:**
- Consumes: `pendingPivotalDecision`, `chargeableUnitIds` (Task 2), `chooseBattleDecision`.

- [ ] **Step 1: Write the failing test**

Append to `tests/web/BattleScreen.test.tsx` a test that seeds a battle whose session has a *salient* decision and asserts the pivotal prompt appears once auto-play is running. The most robust seam is a small pure check plus a render assertion. Since `pendingPivotalDecision` is already unit-tested (Task 2), assert the HUD wiring: when the player begins the battle (auto-play on) and a salient decision is pending, the "Continue watching" control renders.

```ts
import { pendingPivotalDecision } from '../../src/state/battleSession.js';

it('shows the pivotal prompt (Continue watching) while auto-playing with a salient decision', async () => {
  // Seed a battle where the player is losing but holds a reserve, so
  // pendingPivotalDecision(session) is non-null. (Construct via the file's
  // battle-seeding helper; give the player a small fielded block + a reserve
  // against a larger enemy so advantage < 1.0.)
  const session = seedSalientBattleForTest();
  expect(pendingPivotalDecision(session)).not.toBeNull(); // precondition
  renderBattleForTest(session);
  // Begin the battle to start auto-play.
  await userEvent.click(screen.getByText('开战')); // zh 'Begin' — battle.intro.begin
  expect(await screen.findByText('继续观战')).toBeInTheDocument(); // zh 'Continue watching'
});
```

(Adapt seeding/queries to this file's existing helpers and locale. If seeding a precisely-salient battle through the store is impractical in this file, instead assert the render path directly by constructing a `BattleSession` with a hand-built `offeredDecisions: [{ id:'commitReserves', family:'maneuver', labelKey:'battle.commitReserves', salient:true, commands:[...] }]` and rendering with `playing` started — the key assertion is that a salient pending decision renders the `battle.decision.continue` control.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/BattleScreen.test.tsx -t "pivotal prompt"`
Expected: FAIL — no pivotal prompt / Continue control exists yet.

- [ ] **Step 3: Import the selectors**

In `src/web/battle/BattleScreen.tsx`, extend the `../../state/battleSession.js` type import into a value import for the two selectors (keep the existing `BattleSession` type import):

```ts
import { pendingPivotalDecision, chargeableUnitIds } from '../../state/battleSession.js';
import type { BattleSession } from '../../state/battleSession.js';
```

- [ ] **Step 4: Add a dismissal ref**

Near the other `useRef`s at the top of `BattleScreen`, add a ref tracking which pivotal window the player has waved past (so "Continue watching" resumes and doesn't immediately re-pause on the same decision):

```ts
  // Signature of the pivotal decision the player waved past ("Continue
  // watching"). This is STATE, not a ref, so setting it re-runs the auto-play
  // effect and resumes the battle; a new day changes the signature and can
  // re-pause. (A ref + same-value setState would not re-render, so the effect
  // would never re-run and the battle would stay frozen — use state here.)
  const [dismissedPivotal, setDismissedPivotal] = React.useState<string | null>(null);
```

- [ ] **Step 5: Gate auto-play on the pivotal decision, and fix the force-charge**

Replace the auto-play effect body (the `useEffect` at lines ~79-94) with this version — it (a) holds when a fresh salient decision is pending, and (b) force-charges only un-ordered units:

```tsx
  useEffect(() => {
    if (!session || !playing || session.phase !== 'awaitingOrders') return;
    // Pivotal-only pause: hold auto-play when a salient decision is pending and
    // the player hasn't waved it past yet. The prompt (below) offers the lever
    // or a "Continue watching" resume.
    const pivotal = pendingPivotalDecision(session);
    const sig = pivotal ? `${session.battle.daysElapsed}:${pivotal.id}` : null;
    if (pivotal && dismissedPivotal !== sig) return; // paused, awaiting the player
    const delay = session.gambits.length > 0 ? 2600 : 900 / session.speed;
    const id = setTimeout(() => {
      // Press the assault, but only for units the player has NOT given an order
      // to — so a Hold/Focus lever is not overwritten next tick.
      const chargeable = new Set(chargeableUnitIds(session));
      const mine = session.battle.units.filter((u) => chargeable.has(u.id));
      const foe = session.battle.units.find((e) => e.factionId !== session.playerFactionId && (e.state === 'fielded' || e.state === 'reserve'));
      if (foe && mine.length > 0) {
        submitBattleOrders(mine.map((u) => ({ kind: 'charge', unitId: u.id, targetUnitId: foe.id })));
      }
      resolveBattleDay();
    }, delay);
    return () => clearTimeout(id);
  }, [session, playing, dismissedPivotal]);
```

- [ ] **Step 6: Render the pivotal prompt**

In the "Bottom command cluster" (inside `{!resolved && (...)}`), ABOVE the maneuver lever tray from Task 5, add the prompt. It appears only while auto-playing on an un-dismissed salient decision:

```tsx
          {/* Pivotal decision prompt — the only thing that pauses auto-play. */}
          {playing && (() => {
            const pivotal = pendingPivotalDecision(session);
            const sig = pivotal ? `${session.battle.daysElapsed}:${pivotal.id}` : null;
            if (!pivotal || dismissedPivotal === sig) return null;
            return (
              <div className="flex flex-col items-center gap-2 px-5 py-3" style={{ ...PANEL, borderColor: 'rgba(201,163,92,.6)' }}>
                <span className="font-display text-sm" style={{ letterSpacing: '0.26em', color: GOLD }}>{t('battle.decision.pivotal')}</span>
                <div className="flex items-center gap-2">
                  <CinBtn variant="gold" onClick={() => { chooseBattleDecision(pivotal.id); resolveBattleDay(); }}>
                    {t(pivotal.labelKey as MessageKey)}
                  </CinBtn>
                  <CinBtn onClick={() => setDismissedPivotal(sig)}>
                    {t('battle.decision.continue')}
                  </CinBtn>
                </div>
              </div>
            );
          })()}
```

(The `setPlaying((p) => p)` on Continue is a harmless state nudge that re-runs the auto-play effect now that `dismissedPivotal` is set, so the battle resumes.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/web/BattleScreen.test.tsx && npm run typecheck`
Expected: PASS (pivotal-prompt case + all existing HUD cases).

- [ ] **Step 8: Full green check + commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass.

```bash
git add src/web/battle/BattleScreen.tsx tests/web/BattleScreen.test.tsx
git commit -m "battle/hud: pivotal-only auto-play pause + prompt; levers survive auto-play"
```

---

## Self-Review

**1. Spec coverage (Phase 1b scope):**
- Contextual maneuver levers surfaced to the player (Commit Reserves / Hold the Line / Focus Fire) → Task 1 (detector) + Task 5 (tray). ✓
- Levers compile to real orders and take effect → Task 1 (commands) + Task 2 (chooseDecision) + Task 3 (store). ✓
- "Pivotal-only pause" interruption model (pause only on `salient`; Continue-watching resume) → Task 6. ✓
- Levers stick during auto-play (force-charge only un-ordered units) → Task 2 (`chargeableUnitIds`) + Task 6. ✓
- Bilingual strings from the first commit → Task 4 (zh + en + parity). ✓
- Determinism preserved (detector is pure; timers pace only) → Task 1 + Global Constraints. ✓
- Seam untouched (no combat.ts/pendingOp.ts/turn.ts changes) → Global Constraints; no task touches them. ✓

**2. Placeholder scan:** Test-helper references (`renderBattleForTest`, `enterBattleForTest`, `seedSalientBattleForTest`) are explicitly flagged as "reuse the existing helper/pattern in this file" — the implementer must read the target test file first and match its real seeding style. That is a deliberate instruction, not a code placeholder; every production step contains complete code.

**3. Type consistency:** `OfferedDecision` fields (`id`/`family`/`labelKey`/`salient`/`commands`) are identical across `decisions.ts`, the session, and the HUD. `offerPlayerDecisions(battle, factionId)`, `chooseDecision(session, id)`, `pendingPivotalDecision(session)`, `chargeableUnitIds(session)`, and `chooseBattleDecision(id)` signatures match across their definition and call sites. The five `battle.decision.*` keys are identical in the union, both catalogs, and the keys test.

**4. Deferred (called out, not dropped):** the full "salience = planner utility delta" model from the design spec is approximated here by a simple, testable heuristic (reserves are salient when `advantage < 1.0`); richer salience can arrive when Phase 2/3 add scored candidates. Hero/stratagem decision families are out of scope (Phase 2/3). The known walled-garrison standoff (a pre-existing sim limitation) is unchanged and out of scope.

---

## Execution Handoff

**Plan complete. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.

**2. Inline Execution** — batch execution with checkpoints.

**Which approach?**
