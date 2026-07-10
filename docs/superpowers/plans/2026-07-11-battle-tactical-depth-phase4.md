# Battle Tactical Depth — Phase 4 (Balance Tuning + Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop — make the levers reliable (best-match hero picks; per-faction stratagem detection), fix the known mid-battle save/restore day-0 regression, tighten the balance invariants, and lock in the emergent "commander falls → doctrine shifts" behavior with a guard.

**Architecture:** Small, surgical fixes to already-shipped code: `decisions.ts` iterates for a valid hero pairing instead of giving up on the first candidate; `gambits.ts` drops its per-type `break` so detection is per-unit (each faction reliably surfaces its own stratagem); `store.ts` writes the live battle back into `game.pendingBattle` each day so a refresh resumes at the current day; the balance harness gains tighter invariants; and audit tests lock in dynamic doctrine + player-as-defender symmetry + timeout. No new mechanics, no new dependencies. Off-screen `resolveQuickBattle` stays untouched.

**Tech Stack:** TypeScript (ESM/NodeNext, explicit `.js` specifiers), React 19 + Zustand, Vitest. No new dependencies.

## Global Constraints

- **English identifiers/comments only.** No new user-facing strings this phase (unless a gap is found — then zh + en).
- **ESM/NodeNext imports:** explicit `.js` extensions.
- **Determinism:** all changes pure/seeded; no `Math.random`/`Date`.
- **Always-green:** after every task, `npm test` (currently **274**), `npm run typecheck`, `npm run build` all pass. Add tests; don't weaken existing ones. Do NOT weaken any balance threshold — tune `BATTLE_TUNING` constants instead, keeping the full suite green.
- **The seam is sacred:** do not modify `src/engine/combat.ts`, `src/engine/pendingOp.ts`, `src/engine/turn.ts`.

**Reference (current code):**

```ts
// src/engine/ai/tactics/decisions.ts — hero levers use `.find()` first-match then give up:
//   const myGeneral = mine.find(wu>=duelWuMin); if (myGeneral) { const foe = enemies.find(adjacent general); if (foe) push; }
//   const wavering = mine.find(morale<=thr); if (wavering) { const gen = mine.find(command && in range); if (gen) push; }
// src/engine/battle/gambits.ts — fireAttack/floodAttack/ambush/duelChallenge/fordCrossing each `break` after the FIRST qualifying unit (global, across both factions). cavalryCharge does NOT break (per-unit).
// src/state/store.ts — resolveBattleDay/quickResolveBattle update s.battle (session) only; s.game.pendingBattle is NOT updated, so an autosaved mid-battle reloads at day 0. enterPendingBattle()/sessionFromGame() restart a session from game.pendingBattle.
// src/engine/ai/tactics/doctrine.ts — deriveDoctrine's leadStats already excludes `state==='gone'`, so it recomputes to the surviving highest-command general when the lead falls (dynamic doctrine is emergent).
// src/engine/ai/tactics/balance.ts — runBalanceSweep/simulateHeadless; existing invariants: 2x>=0.7, even in (0.1,0.9), terminate, hold/charge/commitReserves reachable, duels reachable, stratagem gambit>0.
```

---

## Task 1: Best-match hero levers (reliable in multi-general battles)

`decisions.ts` currently offers Challenge Duel / Rally only if the *first* qualifying unit has a valid partner; in multi-general battles a valid pairing on a later unit is missed. Iterate for the first *valid pair* instead.

**Files:**
- Modify: `src/engine/ai/tactics/decisions.ts`
- Test: `tests/engine/tactics-decisions.test.ts` (append)

**Interfaces:**
- Produces: Challenge Duel is offered when ANY of my `wu>=duelWuMin` generals is adjacent to an enemy general (not only if the first-found one is); Rally is offered when ANY wavering ally has a friendly general in range. Command shapes unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/tactics-decisions.test.ts` (reuse `mk`/`u`/`find`):

```ts
it('offers Challenge Duel even when the FIRST general has no adjacent enemy general (best-match)', () => {
  const b = mk([
    u({ id: 'g1', factionId: 'A', pos: { x: 1, y: 8 }, wu: 96 }),   // high-wu, but far from any enemy general
    u({ id: 'g2', factionId: 'A', pos: { x: 5, y: 4 }, wu: 95 }),   // high-wu, adjacent to the enemy general
    u({ id: 'foe', factionId: 'B', pos: { x: 6, y: 4 }, wu: 94 }),
  ]);
  const d = find(offerPlayerDecisions(b, 'A'), 'challengeDuel')!;
  expect(d).toBeDefined();
  expect(d.commands).toEqual([{ kind: 'challengeDuel', unitId: 'g2', targetUnitId: 'foe' }]);
});

it('offers Rally even when the FIRST wavering unit has no general in range (best-match)', () => {
  const b = mk([
    u({ id: 'w1', factionId: 'A', pos: { x: 1, y: 8 }, morale: 15 }),       // wavering, no general near
    u({ id: 'w2', factionId: 'A', pos: { x: 5, y: 4 }, morale: 15 }),       // wavering, general adjacent
    u({ id: 'gen', factionId: 'A', pos: { x: 5, y: 5 }, command: 90 }),
    u({ id: 'e', factionId: 'B', pos: { x: 8, y: 0 } }),
  ]);
  const d = find(offerPlayerDecisions(b, 'A'), 'rally')!;
  expect(d).toBeDefined();
  expect(d.commands).toEqual([{ kind: 'rally', unitId: 'gen', targetUnitId: 'w2' }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/tactics-decisions.test.ts -t "best-match"`
Expected: FAIL — the current `.find()` picks `g1`/`w1` (first qualifying), finds no partner, and gives up.

- [ ] **Step 3: Implement in `decisions.ts`**

Replace the Challenge Duel block:

```ts
  // HERO — Challenge Duel: the first of my high-wu generals that stands beside an
  // enemy general (best-match across all my generals, not just the first one).
  let duelMine: BattleUnit | undefined;
  let duelFoe: BattleUnit | undefined;
  for (const g of mine) {
    if (g.wu === undefined || g.wu < BATTLE_TUNING.duelWuMin) continue;
    const foe = enemies.find((e) => e.wu !== undefined && e.wu >= BATTLE_TUNING.duelWuMin && chebyshev(g.pos, e.pos) <= 1);
    if (foe) { duelMine = g; duelFoe = foe; break; }
  }
  if (duelMine && duelFoe) {
    out.push({ id: `challengeDuel:${duelFoe.id}`, family: 'hero', labelKey: 'battle.decision.challengeDuel', salient: true,
      commands: [{ kind: 'challengeDuel', unitId: duelMine.id, targetUnitId: duelFoe.id }] });
  }
```

Replace the Rally block:

```ts
  // HERO — Rally: the first wavering ally that has a friendly general within reach
  // (best-match across all wavering units).
  let rallyWaver: BattleUnit | undefined;
  let rallyGen: BattleUnit | undefined;
  for (const w of mine) {
    if (w.morale > BATTLE_TUNING.routMoraleThreshold + 10) continue;
    const gen = mine.find((u2) => u2.command !== undefined && u2.id !== w.id && chebyshev(u2.pos, w.pos) <= 3);
    if (gen) { rallyWaver = w; rallyGen = gen; break; }
  }
  if (rallyWaver && rallyGen) {
    out.push({ id: `rally:${rallyWaver.id}`, family: 'hero', labelKey: 'battle.decision.rally', salient: true,
      commands: [{ kind: 'rally', unitId: rallyGen.id, targetUnitId: rallyWaver.id }] });
  }
```

(If `BattleUnit` isn't imported in this file, add it to the existing type import from `'../../types.js'`.)

- [ ] **Step 4: Run + full green + commit**

Run: `npx vitest run tests/engine/tactics-decisions.test.ts && npm test && npm run typecheck`
Expected: PASS (best-match cases + all existing decision cases — the single-pair scenarios still resolve the same way).

```bash
git add src/engine/ai/tactics/decisions.ts tests/engine/tactics-decisions.test.ts
git commit -m "battle/ai: best-match hero levers (surface duel/rally in multi-general battles)"
```

---

## Task 2: Per-unit gambit detection (each faction surfaces its own stratagem)

`detectGambits` `break`s after the first qualifying unit *across both factions*, so a guileful faction (and the player's tray) can be shadowed by an enemy-owned candidate. Drop the `break` so detection is per-unit (like `cavalryCharge` already is).

**Files:**
- Modify: `src/engine/battle/gambits.ts`
- Test: `tests/engine/battle-gambits.test.ts` (append), `tests/engine/tactics-plan.test.ts` (append)

**Interfaces:**
- Produces: `detectGambits` emits a `fireAttack`/`floodAttack`/`ambush`/`duelChallenge`/`fordCrossing` gambit for EACH qualifying unit (both factions), not just the first global one. Downstream filters (session→player, planner→my-units, HUD dedup-by-id) are unaffected.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/tactics-plan.test.ts`:

```ts
it('a guileful commander springs its OWN fire even when the enemy also has a forest unit', () => {
  const field = flatField();
  field.cells[3 * 12 + 5] = 'forest'; // enemy-side forest (listed-first unit will sit by it)
  field.cells[7 * 12 + 5] = 'forest'; // my-side forest
  const b = mkBattle([
    u({ id: 'efoe', factionId: 'B', pos: { x: 5, y: 3 }, troops: 5000 }), // enemy by forest, listed FIRST
    u({ id: 'z', factionId: 'A', pos: { x: 5, y: 7 }, wu: 55, zhi: 98, command: 85, troops: 5000 }), // my guileful unit by forest
  ], field);
  b.wind = { dir: { x: 0, y: -1 }, strength: 0.8 };
  const cmds = planTactical(b, 'A', 'balanced');
  const fire = cmds.find((c) => c.kind === 'gambit' && (c as { gambitId: string }).gambitId === 'fireAttack');
  expect(fire).toBeDefined();
  expect((fire as { unitIds: string[] }).unitIds).toContain('z'); // MY unit, not the enemy's
});
```

Append to `tests/engine/battle-gambits.test.ts` (mirror its builder): a battle where BOTH factions have a unit ON forest with wind → `detectGambits(b).filter((g) => g.id === 'fireAttack').length` is `>= 2` (one per side).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/tactics-plan.test.ts -t "springs its OWN fire"`
Expected: FAIL — the global `break` makes `detectGambits` return only the enemy's (first-listed) fireAttack, so the planner's my-units filter finds nothing.

- [ ] **Step 3: Implement in `gambits.ts`**

Remove the `; break;` (keeping the `out.push(...)`) from the `fireAttack`, `floodAttack`, `ambush`, `duelChallenge`, and `fordCrossing` blocks so each becomes per-unit. For example, `fireAttack` changes from:

```ts
      if (inForest) { out.push({ id: 'fireAttack', unitIds: [u.id], labelKey: 'battle.gambit.fireAttack' }); break; }
```

to:

```ts
      if (inForest) out.push({ id: 'fireAttack', unitIds: [u.id], labelKey: 'battle.gambit.fireAttack' });
```

Apply the same `break`-removal to `floodAttack`, `ambush`, `duelChallenge`, and `fordCrossing`. (`cavalryCharge` already has no break — leave it.)

- [ ] **Step 4: Run + full green + commit**

Run: `npx vitest run tests/engine/tactics-plan.test.ts tests/engine/battle-gambits.test.ts && npm test && npm run typecheck`
Expected: PASS. Existing battle-gambits tests use `.some(...)` (existence), so more entries don't break them; the HUD dedups gambits by id; `filterPlayerGambits`/`compileGambit`/the planner all filter to the correct side. If a test asserting an EXACT gambit count exists and now fails, that count assumption is the thing to update (more per-unit gambits is the intended new behavior) — but only after confirming the extra entries are legitimately per-unit.

```bash
git add src/engine/battle/gambits.ts tests/engine/tactics-plan.test.ts tests/engine/battle-gambits.test.ts
git commit -m "battle/sim: per-unit gambit detection (each faction surfaces its own stratagem)"
```

---

## Task 3: Mid-battle save/restore resumes at the current day

`resolveBattleDay`/`quickResolveBattle` advance the session but never write the live battle back into `game.pendingBattle`, so an autosaved mid-battle reloads at day 0. Sync `pendingBattle` from the session when the battle advances.

**Files:**
- Modify: `src/state/store.ts`
- Test: `tests/state/battle-store.test.ts` (append)

**Interfaces:**
- Produces: after `resolveBattleDay()`/`quickResolveBattle()`, `gameStore.getState().game.pendingBattle` equals the session's current `battle` (same `daysElapsed`, units, `rngCursor`), so a reload (`loadGame` → `enterPendingBattle`) resumes at the current day.

- [ ] **Step 1: Write the failing test**

Append to `tests/state/battle-store.test.ts` (reuse its `seedWithPendingBattle`/`loadGame` pattern):

```ts
it('mid-battle save keeps game.pendingBattle in sync so a reload resumes at the current day', () => {
  seedWithPendingBattle(); // enters a battle via loadGame (day 0)
  resolveBattleDay();
  resolveBattleDay();
  const st = gameStore.getState();
  const sessionDay = st.battle!.battle.daysElapsed;
  expect(sessionDay).toBeGreaterThan(0);
  expect(st.game!.pendingBattle!.daysElapsed).toBe(sessionDay); // pendingBattle tracks the live battle

  // Simulate a reload from the autosaved game: the resumed session is at the same day.
  loadGame({ game: st.game!, locale: 'zh' });
  expect(gameStore.getState().battle!.battle.daysElapsed).toBe(sessionDay);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/state/battle-store.test.ts -t "resumes at the current day"`
Expected: FAIL — `game.pendingBattle.daysElapsed` is still 0 after advancing, and the reload restarts at day 0.

- [ ] **Step 3: Implement in `store.ts`**

Add a small helper near the battle mutators:

```ts
// Keep game.pendingBattle in sync with the live session's battle, so an autosave
// taken mid-battle reloads at the current day (not day 0).
function withPendingBattle(s: SessionState, session: BattleSession): SessionState {
  return { ...s, battle: session, game: s.game ? { ...s.game, pendingBattle: session.battle } : s.game };
}
```

Change `resolveBattleDay` and `quickResolveBattle` to use it:

```ts
export function resolveBattleDay(): void {
  gameStore.setState((s) => (s.battle ? withPendingBattle(s, resolveDay(s.battle)) : s));
}

export function quickResolveBattle(): void {
  gameStore.setState((s) => (s.battle ? withPendingBattle(s, autoResolveSession(s.battle)) : s));
}
```

(Leave `submitBattleOrders`/`chooseBattleGambit`/`chooseBattleDecision`/`setBattleSpeed` as-is — they change only session-side state, not the `Battle`. `finishBattle` already clears `pendingBattle`.)

- [ ] **Step 4: Run + full green + commit**

Run: `npx vitest run tests/state/battle-store.test.ts tests/playthrough/battle-flow.test.ts && npm test && npm run typecheck`
Expected: PASS (the battle-flow integration test still resolves + returns to map; the new sync doesn't change the outcome, only keeps `pendingBattle` current until `finishBattle` clears it).

```bash
git add src/state/store.ts tests/state/battle-store.test.ts
git commit -m "battle/state: sync pendingBattle with the live session so a reload resumes mid-battle"
```

---

## Task 4: Tighten the balance invariants (+ tune only if missed)

Add stronger guards to the balance harness so a future change can't silently unbalance the game, and confirm/tune the numbers.

**Files:**
- Modify: `tests/engine/battle-balance.test.ts` (append); `src/engine/battle/constants.ts` ONLY if a target is missed
- Test: as above

**Interfaces:**
- Consumes: `runBalanceSweep`/`simulateHeadless` (existing).

- [ ] **Step 1: Write the tests**

Append to `tests/engine/battle-balance.test.ts`:

```ts
it('a 1.5x quality advantage wins a clear majority', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const sweep = runBalanceSweep(seeds.map((seed) => ({ seed,
    attacker: { troops: 9000, wu: 88, zhi: 70, command: 82, personality: 'active' as const },
    defender: { troops: 6000, wu: 68, zhi: 60, command: 70, personality: 'balanced' as const } })));
  expect(sweep.attackerWinRate).toBeGreaterThanOrEqual(0.6);
});

it('battles resolve in a sane length band (not instant, not always the day cap)', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const sweep = runBalanceSweep(seeds.map((seed) => ({ seed,
    attacker: { troops: 7000, wu: 80, zhi: 65, command: 78, personality: 'balanced' as const },
    defender: { troops: 7000, wu: 78, zhi: 65, command: 76, personality: 'balanced' as const } })));
  expect(sweep.avgDays).toBeGreaterThan(2);
  expect(sweep.avgDays).toBeLessThan(28);
});
```

- [ ] **Step 2: Run to verify**

Run: `npx vitest run tests/engine/battle-balance.test.ts`
Expected: These are guard/characterization tests — they likely PASS immediately given the healthy current numbers (2x=1.0, even=0.2, avgDays≈5). If EITHER fails, that is real balance signal: adjust a `BATTLE_TUNING` numeric knob (e.g. `meleeBaseLoss`, `holdBonus`, `chargeMoraleShock`) to bring it into band, then re-run the WHOLE `battle-balance.test.ts` so the existing invariants (2x, even, reachability) still hold. Do NOT weaken a threshold. If passing on first run, note in the report that no tuning was required.

- [ ] **Step 3: Run the CLI sweep for the record**

Run: `npx tsx scripts/battle-balance.ts`
Record the printed `SweepReport` (winRate/avgDays/leverTotals) in your task report — this is the documented balance snapshot for Phase 4.

- [ ] **Step 4: Full green + commit**

Run: `npm test && npm run typecheck && npm run build`

```bash
git add tests/engine/battle-balance.test.ts src/engine/battle/constants.ts
git commit -m "battle/ai: tighten balance invariants (advantage-wins + length band)"
```

(If `constants.ts` was not changed, omit it from `git add`.)

---

## Task 5: Audit tests — dynamic doctrine, player-as-defender, timeout

Lock in three behaviors the design cares about with characterization tests (no production change unless a gap is found).

**Files:**
- Test: `tests/engine/tactics-doctrine.test.ts` (append), `tests/state/battle-session.test.ts` (append), `tests/engine/battle-sim.test.ts` (append)

**Interfaces:**
- Consumes: `deriveDoctrine`, `offerPlayerDecisions`/`startSession`, `stepBattle`.

- [ ] **Step 1: Write the tests**

Append to `tests/engine/tactics-doctrine.test.ts` (reuse its helpers) — dynamic doctrine when the lead general falls:

```ts
it('doctrine shifts to the surviving general when the lead commander is gone', () => {
  const b = battle([
    unit({ id: 'lead', factionId: 'A', wu: 100, zhi: 25, command: 95 }), // aggressive lead (highest command)
    unit({ id: 'second', factionId: 'A', wu: 55, zhi: 96, command: 80 }), // guileful backup
  ]);
  const before = deriveDoctrine(b, 'A', 'balanced');
  b.units[0]!.state = 'gone'; // the lead is slain / has left the field
  const after = deriveDoctrine(b, 'A', 'balanced');
  expect(after.aggression).toBeLessThan(before.aggression); // no longer the wu-100 lead
  expect(after.guile).toBeGreaterThan(before.guile);        // the guileful backup now sets the tone
});
```

(If this file's helpers don't expose a `battle()`/`unit()` builder with a `state` field, construct the two units inline with `state: 'fielded'` and flip one to `'gone'`.)

Append to `tests/state/battle-session.test.ts` — player-as-defender still gets levers:

```ts
it('a defending player is offered maneuver levers too (symmetry)', () => {
  const { state, battle, personalities } = setup();
  // Flip: the player defends. (setup builds caocao as attacker; recompute a session
  //  with the DEFENDER faction as the player to prove the levers are side-agnostic.)
  const defender = battle.defenderFactionId;
  const sess = startSession(battle, defender, personalities);
  expect(sess.playerIsAttacker).toBe(false);
  expect(Array.isArray(sess.offeredDecisions)).toBe(true);
  // A focus-fire decision is offered to whichever side has units + an enemy.
  expect(sess.offeredDecisions.some((d) => d.id.startsWith('focusFire'))).toBe(true);
  void state;
});
```

Append to `tests/engine/battle-sim.test.ts` — timeout resolves as attacker retreat (only if not already covered; check first):

```ts
it('a battle that reaches the day limit ends as an attacker timeout', () => {
  // Two evenly-spaced units that never close (both hold) run to the 30-day cap.
  let b = battle([
    unit({ id: 'a', factionId: 'A', pos: { x: 1, y: 4 } }),
    unit({ id: 'e', factionId: 'B', pos: { x: 8, y: 4 } }),
  ]);
  let end;
  for (let day = 0; day < 31 && !end; day++) {
    const r = stepBattle({ battle: b, commands: [{ kind: 'hold', unitId: 'a' }, { kind: 'hold', unitId: 'e' }] });
    b = r.battle;
    end = r.events.find((ev) => ev.kind === 'end');
  }
  expect(end).toBeDefined();
  expect(end!.kind === 'end' && end!.reason).toBe('timeout');
  expect(end!.kind === 'end' && end!.attackerWon).toBe(false);
});
```

- [ ] **Step 2: Run + full green + commit**

Run: `npx vitest run tests/engine/tactics-doctrine.test.ts tests/state/battle-session.test.ts tests/engine/battle-sim.test.ts && npm test && npm run typecheck && npm run build`
Expected: PASS. If the player-as-defender or timeout test reveals a genuine gap (a lever not offered to a defender, or a wrong end reason), STOP and report — that is a real bug to fix, not a test to weaken.

```bash
git add tests/engine/tactics-doctrine.test.ts tests/state/battle-session.test.ts tests/engine/battle-sim.test.ts
git commit -m "battle: audit tests — dynamic doctrine, player-as-defender levers, timeout"
```

---

## Self-Review

**1. Spec coverage (Phase 4 = Balance pass + polish):**
- Tune to balance targets → Task 4 (tighter invariants + sweep; tune only if missed). ✓
- Audit player-as-defender symmetry + timeout → Task 5. ✓
- Mid-battle save/restore across new state → Task 3. ✓
- Optional "dynamic doctrine when a commander falls" → Task 5 guard (it's already emergent via `leadStats` excluding `gone`; the test locks it in). ✓
- Close the deferred fast-follows: best-match hero levers (Phase 2) → Task 1; per-faction stratagem detection (Phase 3) → Task 2. ✓
- Determinism + seam untouched → Global Constraints. ✓

**2. Placeholder scan:** Test-seeding references ("reuse this file's builder/pattern", "check first if covered") are deliberate instructions to match real test files (as in prior phases), not code placeholders. Every production step carries complete code.

**3. Type consistency:** the `decisions.ts` best-match blocks reuse `BattleUnit`, `chebyshev`, `BATTLE_TUNING`, and emit the identical command shapes (`challengeDuel`/`rally`) as before — only the selection loop changes. `withPendingBattle` returns a `SessionState`. No new types or i18n keys are introduced.

**4. Deferred (called out):** the player-as-defender *pivotal pause* still only fires for a defender-with-reserve (only defenders get reserves in `createBattle`) — Task 5 confirms defenders get the maneuver/hero levers, but attacker-side salient decisions remain a design item beyond this phase. `detectGambits` is now per-unit but still doesn't rank candidates; the planner takes the first of its own. Lingering multi-day fire and a persistent hidden-unit ambush remain out of scope (Phase 3 notes).

---

## Execution Handoff

**Plan complete. Subagent-Driven execution (Opus implementers) per the established pattern. This is the final phase of the battle tactical-depth roadmap.**
