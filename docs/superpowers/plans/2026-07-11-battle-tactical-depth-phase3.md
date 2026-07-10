# Battle Tactical Depth — Phase 3 (Stratagems: Wind→Fire / Flood / Ambush / Feign Retreat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light up the 赤壁-style stratagems — a wind model that finally arms Fire Attack (which spreads downwind), a forest Ambush surprise-strike, and a deliberate Feign Retreat — all sprung by guileful commanders (high `zhi`) and offered to the player.

**Architecture:** A seeded wind is set in `createBattle` (unlocking the already-gated fire gambit). The fire phase extends its blaze downwind. A new `ambush` gambit follows the existing fire/flood strike-gambit pattern (detection → compile → a sim AMBUSH phase), so it surfaces in the existing gambit tray with its existing reveal card. A `retreat` command resolves as a deliberate withdrawal toward the home edge (Feign Retreat). The planner springs stratagems when `doctrine.guile` is high; the player gets a Feign Retreat lever (fire/flood/ambush already surface via the gambit tray). No renderer rework — fire/flood FX + reveal cards exist; ambush/feint get a caption/narration. Off-screen `resolveQuickBattle` stays untouched.

**Tech Stack:** TypeScript (ESM/NodeNext, explicit `.js` specifiers), React 19 + Zustand, Vitest + Testing Library. No new dependencies.

## Global Constraints

- **English identifiers/comments only.** User-facing strings via i18n with **both zh + en** from the first commit.
- **ESM/NodeNext imports:** explicit `.js` extensions on every relative import.
- **Determinism:** wind is derived deterministically from the field seed; sim additions are pure and draw no new randomness beyond the existing seeded `rint`. No `Math.random`/`Date`.
- **Always-green:** after every task, `npm test` (currently **261**), `npm run typecheck`, `npm run build` all pass. Add tests; don't weaken existing ones.
- **The seam is sacred:** do not modify `src/engine/combat.ts`, `src/engine/pendingOp.ts`, `src/engine/turn.ts`.
- **Reuse the strike-gambit pattern:** fire (`gambitId:'fireAttack'`) and flood (`gambitId:'floodAttack'`) already have detection (`gambits.ts`), a compile step (`battleSession.ts` `compileGambit`), and a sim phase (`simulate.ts`). Ambush follows the same three-part shape. Do NOT introduce a persistent hidden-unit state.

**Reference (current code):**

```ts
// src/engine/types.ts — Battle.wind already exists (never set): wind?: { dir: {x:number;y:number}; strength: number }
//   TacticalCommand includes { kind: 'retreat'; unitId: string } (typed; movement resolution added here)
// src/engine/battle/types.ts
//   BattleUnitState = 'fielded' | 'reserve' | 'routing' | 'gone'   (do NOT add 'hidden')
//   GambitId = 'cavalryCharge'|'fireAttack'|'floodAttack'|'ambush'|'duelChallenge'|'fordCrossing'
//   BattleEvent has fire/flood/rally/... (add 'ambushSprung' and 'feint')
// src/engine/battle/gambits.ts — detectGambits(battle): fireAttack gated on `battle.wind && battle.wind.strength > 0` + unit in/adjacent forest; ambush NOT detected yet
// src/engine/battle/setup.ts — createBattle(state, input): builds the Battle; generateField(city, seed) yields field with `seed`; does NOT set wind
// src/engine/battle/simulate.ts — phases: reserve→move→ranged→melee→CHARGE SHOCK→duel→FIRE→FLOOD→(new AMBUSH)→RALLY→morale/rout→end
//   The FIRE phase: for a `{kind:'gambit',gambitId:'fireAttack'}` command, damages enemies with chebyshev(e,at)<=2 (20% + 20 morale), emits `{kind:'fire',at,spread:2}`.
//   The MOVEMENT phase computes a `target` per unit (march/charge/nearestEnemy) then stepToward; `retreat` currently falls through to nearest-enemy.
// src/state/battleSession.ts — compileGambit(battle, g, playerFactionId): ambush case currently returns []
// src/engine/ai/tactics/plan.ts — planTactical; doc.guile from zhi
// src/engine/ai/tactics/decisions.ts — offerPlayerDecisions; OfferedDecision.family = 'maneuver'|'hero' (widen to add 'stratagem')
```

---

## Task 1: Wind model in `createBattle`

**Files:**
- Modify: `src/engine/battle/setup.ts`
- Test: `tests/engine/battle-setup.test.ts` (append), `tests/engine/battle-gambits.test.ts` (append — fire now reachable)

**Interfaces:**
- Produces: every `createBattle` result carries `wind: { dir: {x:number;y:number}; strength: number }`, derived deterministically from the field seed. `strength` ∈ [0.3, 0.9] (always > 0, so the fire gambit can surface near forest); `dir` is one of 8 unit-ish directions.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/battle-setup.test.ts`:

```ts
it('sets a deterministic wind on the battle (same seed -> same wind)', () => {
  const s = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 12 });
  const target = Object.values(s.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
  const mk = () => createBattle(s, { cityId: target.id, attackerFactionId: 'caocao', defenderFactionId: target.factionId!, attackingGeneralIds: ['caocao'], attackingTroops: 6000 });
  const w = mk().wind!;
  expect(w).toBeDefined();
  expect(w.strength).toBeGreaterThan(0);
  expect(w.strength).toBeLessThanOrEqual(0.9);
  expect(Math.abs(w.dir.x) + Math.abs(w.dir.y)).toBeGreaterThan(0); // a real direction
  expect(mk().wind).toEqual(w); // deterministic
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/battle-setup.test.ts -t "wind"`
Expected: FAIL — `wind` is `undefined`.

- [ ] **Step 3: Implement in `setup.ts`**

At the top of `createBattle`, right after `const field = generateField(city, state.rngState >>> 0);`, add:

```ts
  // Deterministic battlefield wind derived from the field seed. Always > 0 so a
  // unit beside a forest can call the fire gambit; direction is one of 8.
  const windDirs: { x: number; y: number }[] = [
    { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
    { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 },
  ];
  const windSeed = (field.seed * 2654435761) >>> 0;
  const wind = { dir: windDirs[windSeed % 8]!, strength: 0.3 + (windSeed % 61) / 100 }; // 0.3..0.9
```

Add `wind,` to the returned `Battle` object literal (e.g. right after `seed: field.seed,`).

- [ ] **Step 4: Add a fire-reachability test**

Append to `tests/engine/battle-gambits.test.ts` (reuse its helpers; if it builds a `Battle` directly, add `wind` to the fixture — otherwise use `createBattle`). A minimal direct-fixture version:

```ts
it('offers fireAttack when a unit stands by forest with wind up', () => {
  // Build (or reuse the file's builder for) a battle with wind and a forest cell
  // adjacent to a unit that has an enemy nearby, then assert detectGambits emits fireAttack.
  // (Follow this file's existing fixture style; the key additions are `wind` on the
  //  battle and a `forest` cell next to the acting unit.)
});
```

(Read `tests/engine/battle-gambits.test.ts` first and mirror its exact fixture builder; the assertion is `detectGambits(b).some((g) => g.id === 'fireAttack')` for a windy, forest-adjacent setup.)

- [ ] **Step 5: Run + full green + commit**

Run: `npx vitest run tests/engine/battle-setup.test.ts tests/engine/battle-gambits.test.ts && npm test && npm run typecheck`
Expected: PASS. If adding wind makes the headless planner (once Task 5 lands) spring fire in an outcome test, that is fine as long as the behavioral assertions hold — but at THIS task the planner doesn't spring fire yet, so no outcome test moves.

```bash
git add src/engine/battle/setup.ts tests/engine/battle-setup.test.ts tests/engine/battle-gambits.test.ts
git commit -m "battle/sim: set a deterministic wind on every battle (arms the fire gambit)"
```

---

## Task 2: Fire spreads downwind

**Files:**
- Modify: `src/engine/battle/simulate.ts` (FIRE PHASE)
- Test: `tests/engine/battle-sim.test.ts` (append)

**Interfaces:**
- Produces: the fire phase damages enemies within the base blaze (Chebyshev ≤ 2) OR downwind within an extended reach `2 + round(wind.strength*3)`; the emitted `fire` event's `spread` reflects that reach.

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/battle-sim.test.ts` (first `describe`; note the `battle()` helper's `flatField` has no wind — set it on the fixture):

```ts
it('fire spreads downwind: it burns an enemy beyond the base radius when the wind blows toward it', () => {
  // All three hold so nobody advances before the fire phase — this isolates the
  // downwind spread (units otherwise close distance in the movement phase first).
  const b = battle([
    unit({ id: 'a', factionId: 'A', pos: { x: 3, y: 4 } }),
    unit({ id: 'down', factionId: 'B', pos: { x: 7, y: 4 }, troops: 8000 }), // 4 cells east (downwind)
    unit({ id: 'up', factionId: 'B', pos: { x: 3, y: 0 }, troops: 8000 }),   // 4 cells north (crosswind/upwind)
  ]);
  b.wind = { dir: { x: 1, y: 0 }, strength: 0.9 }; // strong east wind -> reach 2 + round(2.7)=5
  const { battle: next } = stepBattle({ battle: b, commands: [
    { kind: 'gambit', gambitId: 'fireAttack', unitIds: ['a'] },
    { kind: 'hold', unitId: 'a' }, { kind: 'hold', unitId: 'down' }, { kind: 'hold', unitId: 'up' },
  ] });
  const down = next.units.find((x) => x.id === 'down')!;
  const up = next.units.find((x) => x.id === 'up')!;
  expect(down.troops).toBeLessThan(8000); // caught by the downwind spread (dist 4 > base 2)
  expect(up.troops).toBe(8000);           // upwind, beyond the base radius -> untouched
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/battle-sim.test.ts -t "fire spreads downwind"`
Expected: FAIL — the current fire only hits Chebyshev ≤ 2, so `down` (dist 4) is untouched.

- [ ] **Step 3: Implement in the FIRE PHASE**

Replace the FIRE phase's inner emit + loop. Change:

```ts
      const at = { ...src.pos };
      events.push({ kind: 'fire', at, spread: 2 });
      for (const e of units) {
        if (e.factionId === src.factionId || !isActive(e)) continue;
        if (chebyshev(e.pos, at) <= 2) {
          const loss = Math.min(e.troops, Math.floor(e.troops * 0.2));
          e.troops -= loss;
          e.morale = Math.max(0, e.morale - 20);
        }
      }
```

to:

```ts
      const at = { ...src.pos };
      const wind = input.battle.wind;
      const reach = wind ? 2 + Math.round(wind.strength * 3) : 2;
      events.push({ kind: 'fire', at, spread: reach });
      for (const e of units) {
        if (e.factionId === src.factionId || !isActive(e)) continue;
        const dx = e.pos.x - at.x;
        const dy = e.pos.y - at.y;
        const cheb = Math.max(Math.abs(dx), Math.abs(dy));
        // Base blaze, or caught downwind within the extended reach.
        const downwind = wind ? dx * wind.dir.x + dy * wind.dir.y > 0 : false;
        if (cheb <= 2 || (downwind && cheb <= reach)) {
          const loss = Math.min(e.troops, Math.floor(e.troops * 0.2));
          e.troops -= loss;
          e.morale = Math.max(0, e.morale - 20);
        }
      }
```

- [ ] **Step 4: Run + commit**

Run: `npx vitest run tests/engine/battle-sim.test.ts && npm run typecheck`
Expected: PASS (new case + the existing "fireAttack gambit damages nearby enemies" test — its enemy is Chebyshev 1, still within base radius, unaffected).

```bash
git add src/engine/battle/simulate.ts tests/engine/battle-sim.test.ts
git commit -m "battle/sim: fire spreads downwind along the wind"
```

---

## Task 3: Ambush gambit (forest surprise strike)

**Files:**
- Modify: `src/engine/battle/types.ts` (add `ambushSprung` event), `src/engine/battle/gambits.ts` (detect), `src/engine/battle/simulate.ts` (AMBUSH phase), `src/state/battleSession.ts` (compile)
- Test: `tests/engine/battle-gambits.test.ts` (append), `tests/engine/battle-sim.test.ts` (append)

**Interfaces:**
- Produces:
  - `BattleEvent` gains `{ kind: 'ambushSprung'; at: Vec2; unitId: string }`.
  - `detectGambits` emits `{ id: 'ambush', unitIds: [u.id], labelKey: 'battle.gambit.ambush' }` when a unit stands ON a `forest` cell with an enemy at Chebyshev 1–2.
  - `compileGambit` ambush case → `[{ kind: 'gambit', gambitId: 'ambush', unitIds: <player-owned filtered> }]`.
  - Sim AMBUSH phase (after FLOOD, before RALLY): enemies within Chebyshev 2 of the ambusher lose 15% troops + **30 morale** (surprise), emitting `ambushSprung`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/battle-gambits.test.ts` (mirror its fixture builder; set a `forest` cell under the acting unit):

```ts
it('offers ambush when a unit stands in forest with an enemy nearby', () => {
  // Build a battle where unit A sits on a forest cell with enemy B within 2.
  // Assert detectGambits(b).some((g) => g.id === 'ambush').
});
```

Append to `tests/engine/battle-sim.test.ts` (first `describe`):

```ts
it('an ambush gambit deals a heavy morale shock to nearby enemies and emits ambushSprung', () => {
  const b = battle([
    unit({ id: 'a', factionId: 'A', pos: { x: 4, y: 4 } }),
    unit({ id: 'e', factionId: 'B', pos: { x: 5, y: 4 }, troops: 8000, morale: 100 }),
  ]);
  const { battle: next, events } = stepBattle({ battle: b, commands: [{ kind: 'gambit', gambitId: 'ambush', unitIds: ['a'] }] });
  const e = next.units.find((x) => x.id === 'e')!;
  expect(e.troops).toBeLessThan(8000);
  expect(e.morale).toBeLessThan(100 - 20); // heavy surprise morale hit (>= the 30 shock, minus clamps)
  expect(events.some((ev) => ev.kind === 'ambushSprung' && ev.unitId === 'a')).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/battle-sim.test.ts -t "ambush gambit"` and `tests/engine/battle-gambits.test.ts -t "ambush"`
Expected: FAIL — no ambush detection, no AMBUSH phase, `ambushSprung` isn't a valid event kind.

- [ ] **Step 3: Add the event type**

In `src/engine/battle/types.ts`, add to `BattleEvent` (near `fire`/`flood`):

```ts
  | { kind: 'ambushSprung'; at: Vec2; unitId: string }
```

- [ ] **Step 4: Detect the ambush gambit**

In `src/engine/battle/gambits.ts`, add to `detectGambits` (after the floodAttack block, before the return):

```ts
  // ambush: a unit standing in forest with an enemy at striking distance.
  for (const u of units) {
    if (!active(u)) continue;
    if (cellAt(battle, u.pos) !== 'forest') continue;
    const foe = units.find((e) => e.factionId !== u.factionId && active(e) && chebyshev(u.pos, e.pos) <= 2 && chebyshev(u.pos, e.pos) >= 1);
    if (foe) { out.push({ id: 'ambush', unitIds: [u.id], labelKey: 'battle.gambit.ambush' }); break; }
  }
```

- [ ] **Step 5: Compile the ambush gambit**

In `src/state/battleSession.ts` `compileGambit`, replace the `case 'ambush':` (currently falling through to `default: return []`) with:

```ts
    case 'ambush':
      return [{ kind: 'gambit', gambitId: 'ambush', unitIds: g.unitIds.filter((id) => battle.units.find((u) => u.id === id)?.factionId === playerFactionId) }];
```

- [ ] **Step 6: Add the AMBUSH phase**

In `src/engine/battle/simulate.ts`, add after the FLOOD phase block and before the RALLY phase:

```ts
  // ---------------- AMBUSH PHASE ----------------
  // A concealed forest unit springs a surprise strike: modest casualties but a
  // heavy morale shock to nearby enemies (gate-checking is the caller's job).
  for (const c of input.commands) {
    if (c.kind !== 'gambit' || c.gambitId !== 'ambush') continue;
    for (const uid of c.unitIds) {
      const src = byId(uid);
      if (!src || !isActive(src)) continue;
      const at = { ...src.pos };
      events.push({ kind: 'ambushSprung', at, unitId: src.id });
      for (const e of units) {
        if (e.factionId === src.factionId || !isActive(e)) continue;
        if (chebyshev(e.pos, at) <= 2) {
          e.troops -= Math.min(e.troops, Math.floor(e.troops * 0.15));
          e.morale = Math.max(0, e.morale - 30);
        }
      }
    }
  }
```

- [ ] **Step 7: Run + full green + commit**

Run: `npx vitest run tests/engine/battle-sim.test.ts tests/engine/battle-gambits.test.ts && npm test && npm run typecheck`
Expected: PASS.

```bash
git add src/engine/battle/types.ts src/engine/battle/gambits.ts src/engine/battle/simulate.ts src/state/battleSession.ts tests/engine/battle-sim.test.ts tests/engine/battle-gambits.test.ts
git commit -m "battle/sim: ambush gambit — a forest surprise strike (heavy morale shock)"
```

---

## Task 4: Feign Retreat (`retreat` movement resolution)

**Files:**
- Modify: `src/engine/battle/types.ts` (add `feint` event), `src/engine/battle/simulate.ts` (MOVEMENT PHASE)
- Test: `tests/engine/battle-sim.test.ts` (append)

**Interfaces:**
- Produces: `BattleEvent` gains `{ kind: 'feint'; unitId: string }`. A `retreat` command moves the unit toward its home edge (attacker → `y = height-1`, defender → `y = 0`), staying `fielded` (a deliberate withdrawal, not a rout), and emits a `feint` event.

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/battle-sim.test.ts` (first `describe`):

```ts
it('a retreat command withdraws a unit toward its home edge, staying fielded (feint)', () => {
  const b = battle([
    unit({ id: 'a', factionId: 'A', pos: { x: 4, y: 3 } }), // attacker: home edge is high y (h-1)
    unit({ id: 'e', factionId: 'B', pos: { x: 4, y: 1 } }),
  ]);
  const { battle: next, events } = stepBattle({ battle: b, commands: [{ kind: 'retreat', unitId: 'a' }] });
  const a = next.units.find((x) => x.id === 'a')!;
  expect(a.pos.y).toBeGreaterThan(3);          // moved toward home (away from the enemy at y=1)
  expect(a.state).toBe('fielded');             // deliberate, not routed
  expect(events.some((ev) => ev.kind === 'feint' && ev.unitId === 'a')).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/battle-sim.test.ts -t "retreat command withdraws"`
Expected: FAIL — `retreat` currently falls through to advancing on the nearest enemy (a.pos.y would move toward y=1, not away), and no `feint` event.

- [ ] **Step 3: Add the event type**

In `src/engine/battle/types.ts`, add to `BattleEvent`:

```ts
  | { kind: 'feint'; unitId: string }
```

- [ ] **Step 4: Handle `retreat` in the MOVEMENT PHASE**

In `src/engine/battle/simulate.ts`, in the MOVEMENT phase's per-unit block, add a `retreat` branch to the target selection. The current shape is:

```ts
    let target: Vec2 | undefined;
    if (order && order.kind === 'march') target = order.target;
    else if (order && (order.kind === 'charge')) {
      const t = byId(order.targetUnitId);
      target = t?.pos;
    } else {
      const enemy = nearestEnemy(u, units);
      target = enemy?.pos;
    }
```

Change it to add a retreat branch AND record a feint intent:

```ts
    let target: Vec2 | undefined;
    let feinting = false;
    if (order && order.kind === 'march') target = order.target;
    else if (order && order.kind === 'charge') {
      const t = byId(order.targetUnitId);
      target = t?.pos;
    } else if (order && order.kind === 'retreat') {
      const homeY = u.factionId === input.battle.attackerFactionId ? input.battle.field.height - 1 : 0;
      target = { x: u.pos.x, y: homeY };
      feinting = true;
    } else {
      const enemy = nearestEnemy(u, units);
      target = enemy?.pos;
    }
```

Then, after the existing move-emit block (right after `events.push({ kind: 'move', ... })`), emit the feint (it belongs whether or not the unit could step, so place it after the `if (to.x !== from.x ...)` block but still inside the per-unit loop):

```ts
    if (feinting) events.push({ kind: 'feint', unitId: u.id });
```

- [ ] **Step 5: Run + commit**

Run: `npx vitest run tests/engine/battle-sim.test.ts && npm test && npm run typecheck`
Expected: PASS. (The `retreat` command previously had no resolution and no test used it, so nothing regresses.)

```bash
git add src/engine/battle/types.ts src/engine/battle/simulate.ts tests/engine/battle-sim.test.ts
git commit -m "battle/sim: retreat command = deliberate withdrawal toward home (feint)"
```

---

## Task 5: Planner springs stratagems + Feign Retreat lever

**Files:**
- Modify: `src/engine/ai/tactics/plan.ts` (guile doctrines spring gambits), `src/engine/ai/tactics/decisions.ts` (widen family + Feign Retreat lever)
- Test: `tests/engine/tactics-plan.test.ts` (append), `tests/engine/tactics-decisions.test.ts` (append)

**Interfaces:**
- Produces:
  - `planTactical` emits a stratagem gambit command (`fireAttack`/`floodAttack`/`ambush`) for its own units when `doctrine.guile > 0.6` and `detectGambits` surfaces one for this side (at most one per day).
  - `OfferedDecision.family` widened to `'maneuver' | 'hero' | 'stratagem'`; a new `feignRetreat:<unitId>` decision (family `'stratagem'`, `salient: false`, commands `[{ kind: 'retreat', unitId }]`) offered when a player unit has an enemy adjacent (bait it back).

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/tactics-plan.test.ts`:

```ts
it('a guileful commander springs an available stratagem (fire) when wind + forest allow', () => {
  const field = flatField();
  field.cells[4 * 12 + 5] = 'forest'; // forest next to the acting unit
  const b = mkBattle([
    u({ id: 'z', factionId: 'A', pos: { x: 5, y: 5 }, wu: 60, zhi: 98, command: 85, troops: 5000 }),
    u({ id: 'e', factionId: 'B', pos: { x: 6, y: 5 }, troops: 5000 }),
  ], field);
  b.wind = { dir: { x: 0, y: -1 }, strength: 0.8 };
  const cmds = planTactical(b, 'A', 'balanced');
  expect(cmds.some((c) => c.kind === 'gambit' && (c as { gambitId: string }).gambitId === 'fireAttack')).toBe(true);
});

it('a non-guileful commander does not spring stratagems', () => {
  const field = flatField();
  field.cells[4 * 12 + 5] = 'forest';
  const b = mkBattle([
    u({ id: 'brute', factionId: 'A', pos: { x: 5, y: 5 }, wu: 98, zhi: 20, command: 70, troops: 5000 }),
    u({ id: 'e', factionId: 'B', pos: { x: 6, y: 5 }, troops: 5000 }),
  ], field);
  b.wind = { dir: { x: 0, y: -1 }, strength: 0.8 };
  expect(planTactical(b, 'A', 'active').some((c) => c.kind === 'gambit')).toBe(false);
});
```

Append to `tests/engine/tactics-decisions.test.ts`:

```ts
it('offers Feign Retreat for a player unit with an adjacent enemy', () => {
  const b = mk([
    u({ id: 'a', factionId: 'A', pos: { x: 4, y: 6 } }),
    u({ id: 'e', factionId: 'B', pos: { x: 4, y: 5 } }),
  ]);
  const d = find(offerPlayerDecisions(b, 'A'), 'feignRetreat')!;
  expect(d).toBeDefined();
  expect(d.family).toBe('stratagem');
  expect(d.commands).toEqual([{ kind: 'retreat', unitId: 'a' }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/tactics-plan.test.ts -t "stratagem"` and `tests/engine/tactics-decisions.test.ts -t "Feign Retreat"`
Expected: FAIL — planner emits no gambit; no feignRetreat decision.

- [ ] **Step 3: Planner springs a stratagem**

In `src/engine/ai/tactics/plan.ts`, add the import:

```ts
import { detectGambits } from '../../battle/gambits.js';
```

In `planTactical`, after the reserve-commit block and BEFORE the rally block, add:

```ts
  // STRATAGEM: a guileful commander springs an available fire/flood/ambush for
  // one of its own units (at most one per day).
  if (doc.guile > 0.6) {
    const mineIds = new Set(battle.units.filter((u) => u.factionId === factionId).map((u) => u.id));
    const strat = detectGambits(battle).find(
      (g) => (g.id === 'fireAttack' || g.id === 'floodAttack' || g.id === 'ambush') && g.unitIds.some((id) => mineIds.has(id)),
    );
    if (strat) {
      cmds.push({ kind: 'gambit', gambitId: strat.id, unitIds: strat.unitIds.filter((id) => mineIds.has(id)) });
    }
  }
```

- [ ] **Step 4: Feign Retreat decision**

In `src/engine/ai/tactics/decisions.ts`, widen the family:

```ts
  family: 'maneuver' | 'hero' | 'stratagem';
```

Add BEFORE `return out;` (after the hero decisions):

```ts
  // STRATAGEM — Feign Retreat: pull a pressed unit back to bait the enemy on.
  const pressed = mine.find((u) => enemies.some((e) => chebyshev(u.pos, e.pos) <= 1));
  if (pressed) {
    out.push({ id: `feignRetreat:${pressed.id}`, family: 'stratagem', labelKey: 'battle.decision.feignRetreat', salient: false,
      commands: [{ kind: 'retreat', unitId: pressed.id }] });
  }
```

- [ ] **Step 5: Run + full green + commit**

Run: `npx vitest run tests/engine/tactics-plan.test.ts tests/engine/tactics-decisions.test.ts && npm test && npm run typecheck`
Expected: PASS. NOTE: the planner now springing stratagems changes headless (`resolveBattleHeadless`) outcomes for guileful factions — the battle-outcome/session tests are behavioral (win/loss booleans, termination) and should stay green; if a balance number in `battle-balance.test.ts` shifts out of its band, that is real signal — retune only in Task 7, do not weaken a threshold here. If an existing behavioral test flips, STOP and report.

```bash
git add src/engine/ai/tactics/plan.ts src/engine/ai/tactics/decisions.ts tests/engine/tactics-plan.test.ts tests/engine/tactics-decisions.test.ts
git commit -m "battle/ai: guileful commanders spring stratagems; offer a Feign Retreat lever"
```

---

## Task 6: i18n + HUD (Feign Retreat label; ambush/feint captions & narration)

**Files:**
- Modify: `src/i18n/types.ts`, `src/i18n/catalog/en.ts`, `src/i18n/catalog/zh.ts`, `tests/i18n/battle-keys.test.ts`, `src/web/battle/BattleScreen.tsx`
- Test: `tests/web/BattleScreen.test.tsx` (append)

**Interfaces:**
- Produces keys: `battle.decision.feignRetreat`, `battle.caption.ambush`, `battle.narr.ambush`, `battle.narr.feint`. HUD: `ambushSprung` → caption + narration; `feint` → narration. (Fire/flood already caption; the ambush gambit tray button + reveal card already use existing keys `battle.gambit.ambush`/`battle.reveal.ambush`.)

- [ ] **Step 1: Add keys to the test (RED)**

In `tests/i18n/battle-keys.test.ts`, extend `KEYS`:

```ts
  'battle.decision.feignRetreat', 'battle.caption.ambush', 'battle.narr.ambush', 'battle.narr.feint',
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/i18n/battle-keys.test.ts` → FAIL (keys resolve to themselves).

- [ ] **Step 3: Union + catalogs**

`src/i18n/types.ts` (battle section):

```ts
  | 'battle.decision.feignRetreat'
  | 'battle.caption.ambush'
  | 'battle.narr.ambush'
  | 'battle.narr.feint'
```

`src/i18n/catalog/en.ts`:

```ts
  'battle.decision.feignRetreat': 'Feign Retreat',
  'battle.caption.ambush': 'Ambush!',
  'battle.narr.ambush': 'Hidden banners burst from the treeline — an ambush!',
  'battle.narr.feint': 'The line gives ground, drawing the enemy on.',
```

`src/i18n/catalog/zh.ts`:

```ts
  'battle.decision.feignRetreat': '诱敌',
  'battle.caption.ambush': '伏兵！',
  'battle.narr.ambush': '林间旌旗骤起——中伏了！',
  'battle.narr.feint': '阵线佯退，诱敌深入。',
```

- [ ] **Step 4: Wire the HUD captions/narration**

In `src/web/battle/BattleScreen.tsx`, in the per-day `[session]` effect:
- Add ambush to the `CAPTIONS` array:

```ts
      ['ambushSprung', 'battle.caption.ambush'],
```

- Add ambush + feint to the `NARR` array:

```ts
      ['ambushSprung', 'battle.narr.ambush'],
      ['feint', 'battle.narr.feint'],
```

- (Optional) add ambush to the audio-cue line that already plays fire: `if (kinds.has('fire') || kinds.has('ambushSprung')) playFire();` — mirror the existing pattern if the fire cue line is a single `if`.

- [ ] **Step 5: Write + run the HUD test**

Append to `tests/web/BattleScreen.test.tsx` a render/narration test in the file's style (assert the feign-retreat lever label 诱敌 renders when offered, or the ambush caption appears when an `ambushSprung` event is in `lastEvents` — reuse the file's session-injection pattern used by the Phase-2 rally-narration test):

```ts
it('captions an ambush when one is sprung', () => {
  // Inject a session whose lastEvents contains an ambushSprung event (mirror the
  // Phase-2 rally-narration test's setState pattern) and assert 伏兵！ appears.
});
```

Run: `npx vitest run tests/web/BattleScreen.test.tsx tests/i18n/battle-keys.test.ts tests/i18n/parity.test.ts && npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/types.ts src/i18n/catalog/en.ts src/i18n/catalog/zh.ts tests/i18n/battle-keys.test.ts src/web/battle/BattleScreen.tsx tests/web/BattleScreen.test.tsx
git commit -m "i18n + hud: Feign Retreat label; ambush/feint captions & narration"
```

---

## Task 7: Balance + doctrine differentiation for stratagems

Make fire/flood/ambush reachable in the harness (its synthetic field needs forest/river + wind) and prove guile drives stratagem use.

**Files:**
- Modify: `src/engine/ai/tactics/balance.ts`
- Test: `tests/engine/battle-balance.test.ts` (append), `tests/engine/tactics-differentiation.test.ts` (append)

**Interfaces:**
- Consumes: `simulateHeadless`/`runBalanceSweep` (tally `leverCounts` by command kind — a stratagem is a `gambit` command; tally by `gambitId` too if needed, see Step 3).

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/battle-balance.test.ts`:

```ts
it('stratagems are reachable: a guileful commander springs a fire/flood/ambush gambit in a sweep', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const matchups = seeds.map((seed) => ({ seed,
    attacker: { troops: 8000, wu: 55, zhi: 98, command: 85, personality: 'balanced' as const },
    defender: { troops: 8000, wu: 70, zhi: 60, command: 80, personality: 'balanced' as const } }));
  const sweep = runBalanceSweep(matchups);
  expect(sweep.leverTotals.gambit ?? 0).toBeGreaterThan(0);
});
```

Append to `tests/engine/tactics-differentiation.test.ts`:

```ts
it('a guileful commander springs more stratagems than a brute', () => {
  const base = { seed: 4, defender: { troops: 8000, wu: 70, zhi: 60, command: 80, personality: 'balanced' as const } };
  const guileful = simulateHeadless({ ...base, attacker: { troops: 8000, wu: 55, zhi: 98, command: 85, personality: 'balanced' as const } });
  const brute = simulateHeadless({ ...base, attacker: { troops: 8000, wu: 98, zhi: 20, command: 70, personality: 'active' as const } });
  expect(guileful.leverCounts.gambit ?? 0).toBeGreaterThan(brute.leverCounts.gambit ?? 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/battle-balance.test.ts tests/engine/tactics-differentiation.test.ts`
Expected: FAIL — the harness's `openField` has no forest/river and its battles have no wind, so no stratagem gambit ever fires.

- [ ] **Step 3: Add forest + river + wind to the harness**

In `src/engine/ai/tactics/balance.ts`:
- In `openField`, add a small forest patch and a river cell in the middle so fire/flood/ambush can trigger, e.g. after the hill lines:

```ts
  // A forest stand + a river cell so guileful commanders can spring stratagems.
  cells[6 * w + 5] = 'forest';
  cells[6 * w + 6] = 'forest';
  cells[7 * w + 6] = 'river';
```

- In `buildBattle`, add a `wind` to the returned `Battle` so the fire gambit is armed:

```ts
    units, field: openField(m.seed), seed: m.seed, rngCursor: m.seed >>> 0, log: [],
    wind: { dir: { x: 0, y: -1 }, strength: 0.8 },
```

(These are the ONLY harness edits needed. Do NOT change the block start rows or thresholds.)

- [ ] **Step 4: Run to verify it passes (and invariants hold)**

Run: `npx vitest run tests/engine/battle-balance.test.ts tests/engine/tactics-differentiation.test.ts && npm test`
Expected: PASS — `leverTotals.gambit > 0`; guile > brute; and the existing balance invariants (2× advantage ≥ 0.7, even in (0.1, 0.9), all terminate, hold/charge/commitReserves reachable) STILL hold. If adding forest/river/wind pushed an existing balance number out of band, that is real signal from a genuinely different battlefield — retune the harness's forest/river placement (not the thresholds) until both the new stratagem tests and the old invariants pass; if irreconcilable, report DONE_WITH_CONCERNS with the numbers.

- [ ] **Step 5: Full green + commit**

Run: `npm test && npm run typecheck && npm run build`

```bash
git add src/engine/ai/tactics/balance.ts tests/engine/battle-balance.test.ts tests/engine/tactics-differentiation.test.ts
git commit -m "battle/ai: harness exercises stratagems; assert guile drives stratagem use"
```

---

## Self-Review

**1. Spec coverage (Phase 3 = Stratagems):**
- Wind model (arms fire) → Task 1. ✓
- Fire spreads downwind → Task 2. ✓
- Ambush (forest surprise strike, reusing the strike-gambit pattern) → Task 3. ✓
- Feign Retreat (`retreat` resolution) → Task 4. ✓
- Guileful AI springs stratagems + player Feign Retreat lever (fire/flood/ambush via the existing gambit tray) → Task 5. ✓
- Bilingual strings + on-screen ambush/feint reads → Task 6. ✓
- Balance reachability + doctrine differentiation → Task 7. ✓
- Determinism + seam untouched → Global Constraints; wind is seed-derived, sim additions draw no new RNG. ✓

**2. Placeholder scan:** Several tests reference "mirror this file's fixture builder / session-injection pattern" (battle-gambits, BattleScreen) — deliberate instructions to match the real test files (as in Phases 1b/2), not code placeholders. Every production step carries complete code.

**3. Type consistency:** `ambushSprung`/`feint` added once to `BattleEvent` and consumed in the sim + HUD. `OfferedDecision.family` widened once to `'maneuver' | 'hero' | 'stratagem'`. The `ambush` gambit uses the existing `GambitId` value + existing `battle.gambit.ambush`/`battle.reveal.ambush` keys. Four new i18n keys are identical in the union, both catalogs, and the keys test.

**4. Deferred (called out):** multi-day *lingering* fire (persistent burning cells across days) and per-day wind *shift* are deferred — Phase 3 ships a wind that arms fire + a downwind one-shot spread, which delivers the 赤壁 payoff without persistent fire state. A persistent *hidden-unit* ambush (concealed until an enemy passes) is deferred in favor of the forest surprise-strike gambit (same pattern as fire/flood, far lower risk). The first-match hero-lever limitation from Phase 2 is unchanged.

---

## Execution Handoff

**Plan complete. Subagent-Driven execution (Opus implementers) per the established pattern.**
