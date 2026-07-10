# Battle Tactical Depth — Phase 2 (Heroes: Duel / Rally / Charge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make individual generals decisive — a `rally` that steadies a wavering block, a `charge` that shocks the target's morale, and duels the player can *choose* to pick (the sim already resolves them) — all driven by the commander's doctrine and offered as hero levers.

**Architecture:** Two small pure-sim additions (a new `rally` command + phase, and a charge morale-shock rider in the melee phase), wired into the Phase-1 utility planner (aggressive doctrines seek duels/charges; disciplined ones rally) and the Phase-1b decision detector (Challenge Duel / Rally / Hero Charge levers). No renderer rework — the existing `duel` caption/reveal path and audio cues already exist; we add a `rally` cue/narration line. Off-screen `resolveQuickBattle` stays untouched.

**Tech Stack:** TypeScript (ESM/NodeNext, explicit `.js` specifiers), React 19 + Zustand, Vitest + Testing Library (jsdom). No new dependencies.

## Global Constraints

- **English identifiers/comments only.** User-facing strings via i18n with **both zh + en** from the first commit.
- **ESM/NodeNext imports:** explicit `.js` extensions on every relative import.
- **Determinism:** all sim/planner/detector additions are pure and seeded via `battle.rngCursor`; no `Math.random`/`Date`.
- **Always-green:** after every task, `npm test` (currently **246**), `npm run typecheck`, and `npm run build` all pass. Add tests; don't weaken existing ones.
- **The seam is sacred:** do not modify `src/engine/combat.ts`, `src/engine/pendingOp.ts`, or `src/engine/turn.ts`.
- **Reuse, don't rebuild:** duels already resolve in `simulate.ts` (explicit `challengeDuel` + auto-trigger when two adjacent generals both have `wu ≥ BATTLE_TUNING.duelWuMin`); charge already multiplies melee power via `BATTLE_TUNING.chargeBonus`. Phase 2 ADDS a morale shock + a rally mechanic and the AI/player surfacing — it does not re-implement duels or charge movement.

**Reference signatures this phase builds on (current code):**

```ts
// src/engine/types.ts — TacticalCommand union (add 'rally')
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

// src/engine/battle/types.ts — BattleEvent union (has 'charge' already; add 'rally')
//   | { kind: 'charge'; unitId: string; targetUnitId: string }
//   | { kind: 'duel'; a: GeneralId; b: GeneralId; winner: GeneralId }

// src/engine/battle/constants.ts — BATTLE_TUNING (add chargeMoraleShock, rallyBaseMorale)
//   chargeBonus: 1.4, moraleDuelLoss: 15, routMoraleThreshold: 20, duelWuMin: 85, holdBonus: 1.3

// src/engine/battle/simulate.ts — inside stepBattle:
//   unitLeadership(u): (wu*0.45 + command*0.55)/50, or 0.6 for an unled mob
//   byId(id), isActive(u) = state==='fielded' && troops>0, chebyshev(a,b), rint(min,max)
//   Phase order: reserve → move → ranged → MELEE → DUEL → fire → flood → morale/rout → end
//   The melee loop reads `const order = orders.get(u.id)` and pushes a 'clash' event.

// src/engine/ai/tactics/plan.ts — planTactical(battle, factionId, personality): TacticalCommand[]
//   deriveDoctrine → { aggression, guile, discipline, caution }; assessBattle → { advantage, priorityTargetId, reserveUnitIds, ... }
// src/engine/ai/tactics/decisions.ts — offerPlayerDecisions(battle, factionId): OfferedDecision[]
//   OfferedDecision = { id, family: 'maneuver', labelKey, salient, commands }  // widen `family` to include 'hero'
```

---

## File Structure

**Modify:**
- `src/engine/types.ts` — add `rally` to `TacticalCommand`.
- `src/engine/battle/types.ts` — add `rally` to `BattleEvent`.
- `src/engine/battle/constants.ts` — add `chargeMoraleShock`, `rallyBaseMorale` to `BATTLE_TUNING`.
- `src/engine/battle/simulate.ts` — charge morale shock in the melee phase; a new rally phase before morale/rout.
- `src/engine/ai/tactics/plan.ts` — emit `challengeDuel` (aggressive, general-vs-general) and `rally` (a general near a wavering ally).
- `src/engine/ai/tactics/decisions.ts` — widen `OfferedDecision.family` to `'maneuver' | 'hero'`; add Challenge Duel / Rally / Hero Charge.
- `src/engine/ai/tactics/balance.ts` — make the harness able to exercise duel/rally/charge (see Task 6).
- `src/i18n/types.ts`, `src/i18n/catalog/en.ts`, `src/i18n/catalog/zh.ts`, `tests/i18n/battle-keys.test.ts` — hero-lever + rally-narration keys.
- `src/web/battle/BattleScreen.tsx` — add a `rally` audio cue + narration line (the tray already renders hero levers).

**Test files (create/append):** `tests/engine/battle-sim.test.ts` (append), `tests/engine/tactics-plan.test.ts` (append), `tests/engine/tactics-decisions.test.ts` (append), `tests/engine/battle-balance.test.ts` (append), `tests/engine/tactics-differentiation.test.ts` (append), `tests/web/BattleScreen.test.tsx` (append).

---

## Task 1: Sim — `rally` command + phase, and a charge morale shock

**Files:**
- Modify: `src/engine/types.ts`, `src/engine/battle/types.ts`, `src/engine/battle/constants.ts`, `src/engine/battle/simulate.ts`
- Test: `tests/engine/battle-sim.test.ts` (append)

**Interfaces:**
- Produces:
  - `TacticalCommand` gains `{ kind: 'rally'; unitId: string; targetUnitId: string }` — `unitId` is the rallying (led) unit; `targetUnitId` the friendly unit it steadies.
  - `BattleEvent` gains `{ kind: 'rally'; unitId: string; targetUnitId: string; morale: number }` (`morale` = points restored).
  - `BATTLE_TUNING.chargeMoraleShock: number` (12) and `BATTLE_TUNING.rallyBaseMorale: number` (25).
  - Sim behavior: a `charge` order that results in a clash also drops the target's morale by `chargeMoraleShock` and emits a `charge` event; a `rally` command restores `round(rallyBaseMorale * leadership)` morale to a fielded same-faction target within Chebyshev range 3 (clamped to 100) and emits a `rally` event. The rally phase runs AFTER flood and BEFORE morale/rout.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/battle-sim.test.ts` (first `describe`, reusing its `battle`/`unit` helpers):

```ts
it('a charge order shocks the target morale and emits a charge event', () => {
  const b = battle([
    unit({ id: 'a', factionId: 'A', pos: { x: 4, y: 4 }, troopType: 'cavalry', wu: 90, command: 80 }),
    unit({ id: 'e', factionId: 'B', pos: { x: 5, y: 4 }, morale: 100 }),
  ]);
  const { battle: next, events } = stepBattle({ battle: b, commands: [{ kind: 'charge', unitId: 'a', targetUnitId: 'e' }] });
  const e = next.units.find((x) => x.id === 'e')!;
  expect(e.morale).toBeLessThan(100); // took a morale shock beyond casualties alone
  expect(events.some((ev) => ev.kind === 'charge' && ev.unitId === 'a')).toBe(true);
});

it('a rally command restores a wavering ally\'s morale and emits a rally event', () => {
  const b = battle([
    unit({ id: 'gen', factionId: 'A', pos: { x: 4, y: 4 }, wu: 90, command: 95 }),
    unit({ id: 'weak', factionId: 'A', pos: { x: 5, y: 4 }, morale: 30 }),
    unit({ id: 'e', factionId: 'B', pos: { x: 9, y: 0 } }), // far, so no combat morale drop this day
  ]);
  const { battle: next, events } = stepBattle({ battle: b, commands: [{ kind: 'rally', unitId: 'gen', targetUnitId: 'weak' }] });
  const weak = next.units.find((x) => x.id === 'weak')!;
  expect(weak.morale).toBeGreaterThan(30);
  expect(events.some((ev) => ev.kind === 'rally' && ev.targetUnitId === 'weak')).toBe(true);
});

it('rally cannot exceed 100 morale and only targets same-faction fielded units', () => {
  // `foe` is placed far away so no combat touches its morale — isolating the
  // "rally ignores enemies" behavior from casualty-driven morale changes.
  const b = battle([
    unit({ id: 'gen', factionId: 'A', pos: { x: 4, y: 4 }, wu: 90, command: 95 }),
    unit({ id: 'ally', factionId: 'A', pos: { x: 5, y: 4 }, morale: 95 }),
    unit({ id: 'foe', factionId: 'B', pos: { x: 9, y: 0 }, morale: 40 }),
  ]);
  const { battle: next } = stepBattle({ battle: b, commands: [
    { kind: 'rally', unitId: 'gen', targetUnitId: 'ally' },
    { kind: 'rally', unitId: 'gen', targetUnitId: 'foe' }, // enemy — must be ignored
  ] });
  expect(next.units.find((x) => x.id === 'ally')!.morale).toBe(100); // 95 + gain, clamped to 100
  expect(next.units.find((x) => x.id === 'foe')!.morale).toBe(40); // untouched (enemy, and far from combat)
});

it('rally + charge steps are deterministic', () => {
  const mk = () => battle([
    unit({ id: 'gen', factionId: 'A', pos: { x: 4, y: 4 }, wu: 90, command: 95 }),
    unit({ id: 'weak', factionId: 'A', pos: { x: 5, y: 4 }, morale: 30 }),
    unit({ id: 'e', factionId: 'B', pos: { x: 6, y: 4 }, troopType: 'cavalry', wu: 88, command: 80 }),
  ]);
  const cmds = [{ kind: 'rally', unitId: 'gen', targetUnitId: 'weak' }, { kind: 'charge', unitId: 'e', targetUnitId: 'weak' }] as const;
  expect(stepBattle({ battle: mk(), commands: [...cmds] })).toEqual(stepBattle({ battle: mk(), commands: [...cmds] }));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/battle-sim.test.ts -t "rally"` and `... -t "charge order shocks"`
Expected: FAIL — `rally` is not a valid command kind (type error in test) / no rally event; charge produces no morale shock beyond casualties and no `charge` event.

- [ ] **Step 3: Extend the types**

In `src/engine/types.ts`, add to the `TacticalCommand` union (after `retreat`):

```ts
  | { kind: 'retreat'; unitId: string }
  | { kind: 'rally'; unitId: string; targetUnitId: string };
```

In `src/engine/battle/types.ts`, add to the `BattleEvent` union (near `duel`):

```ts
  | { kind: 'rally'; unitId: string; targetUnitId: string; morale: number }
```

- [ ] **Step 4: Add the tuning constants**

In `src/engine/battle/constants.ts`, inside `BATTLE_TUNING` (after `moraleDuelLoss`):

```ts
  // Extra morale the target loses when hit by a charge (beyond casualties).
  chargeMoraleShock: 12,
  // Base morale a rally restores, scaled by the rallying general's leadership.
  rallyBaseMorale: 25,
```

- [ ] **Step 5: Charge morale shock in the melee phase**

In `src/engine/battle/simulate.ts`, in the MELEE PHASE, right after the `events.push({ kind: 'clash', ... })` line, add:

```ts
    if (order && order.kind === 'charge') {
      enemy.morale = Math.max(0, enemy.morale - BATTLE_TUNING.chargeMoraleShock);
      events.push({ kind: 'charge', unitId: u.id, targetUnitId: enemy.id });
    }
```

(`order` is already in scope from the focus-fire lookup at the top of the melee loop.)

- [ ] **Step 6: Add the RALLY PHASE**

In `src/engine/battle/simulate.ts`, add a rally phase AFTER the FLOOD PHASE block and BEFORE the `// ---------------- MORALE / ROUT PHASE` comment:

```ts
  // ---------------- RALLY PHASE ----------------
  // A led unit steadies a wavering same-faction ally within range, restoring
  // morale scaled by the rallying general's leadership. Runs before morale/rout
  // so a rallied block can survive the day's casualties instead of breaking.
  for (const c of input.commands) {
    if (c.kind !== 'rally') continue;
    const src = byId(c.unitId);
    const tgt = byId(c.targetUnitId);
    if (!src || !tgt || !isActive(src) || !isActive(tgt)) continue;
    if (src.factionId !== tgt.factionId) continue;
    if (chebyshev(src.pos, tgt.pos) > 3) continue;
    const gain = Math.round(BATTLE_TUNING.rallyBaseMorale * unitLeadership(src));
    if (gain <= 0) continue;
    const before = tgt.morale;
    tgt.morale = Math.min(100, tgt.morale + gain);
    if (tgt.morale !== before) events.push({ kind: 'rally', unitId: src.id, targetUnitId: tgt.id, morale: tgt.morale - before });
  }
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run tests/engine/battle-sim.test.ts && npm run typecheck`
Expected: PASS (new cases + all existing sim cases; the existing charge/melee/determinism tests are unaffected — they pass no `charge`/`rally` orders, or the charge test that exists uses charge only for movement which still works).

- [ ] **Step 8: Full green + commit**

Run: `npm test && npm run typecheck`

```bash
git add src/engine/types.ts src/engine/battle/types.ts src/engine/battle/constants.ts src/engine/battle/simulate.ts tests/engine/battle-sim.test.ts
git commit -m "battle/sim: rally command + phase, and a charge morale shock"
```

---

## Task 2: Planner — emit `challengeDuel` and `rally` by doctrine

Give the AI (and thus the player's auto-line) hero behavior: aggressive commanders challenge adjacent enemy generals to duels; any doctrine rallies a wavering ally when a general is near.

**Files:**
- Modify: `src/engine/ai/tactics/plan.ts`
- Test: `tests/engine/tactics-plan.test.ts` (append)

**Interfaces:**
- Consumes: existing `deriveDoctrine`, unit `wu`/`command`/`morale`, `BATTLE_TUNING.duelWuMin`/`routMoraleThreshold`.
- Produces (added to `planTactical`'s output when applicable, each at most once per unit): a `challengeDuel` from a high-`wu` led unit adjacent to a high-`wu` enemy general when `doc.aggression > 0.6`; a `rally` from a led unit (highest `command` on the side) toward a fielded ally whose `morale <= routMoraleThreshold + 10` within range 3.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/tactics-plan.test.ts` (reuse its `mkBattle`/`u` helpers):

```ts
it('an aggressive commander adjacent to an enemy general challenges a duel', () => {
  const b = mkBattle([
    u({ id: 'lu', factionId: 'A', pos: { x: 4, y: 4 }, wu: 98, command: 70, troops: 5000 }),
    u({ id: 'guan', factionId: 'B', pos: { x: 5, y: 4 }, wu: 96, command: 90, troops: 5000 }),
  ]);
  const cmds = planTactical(b, 'A', 'active');
  expect(cmds.some((c) => c.kind === 'challengeDuel' && c.unitId === 'lu' && c.targetUnitId === 'guan')).toBe(true);
});

it('a cautious commander does NOT go duel-hunting', () => {
  const b = mkBattle([
    u({ id: 'sima', factionId: 'A', pos: { x: 4, y: 4 }, wu: 60, command: 95, zhi: 98, troops: 5000 }),
    u({ id: 'guan', factionId: 'B', pos: { x: 5, y: 4 }, wu: 96, command: 90, troops: 5000 }),
  ]);
  expect(planTactical(b, 'A', 'turtle').some((c) => c.kind === 'challengeDuel')).toBe(false);
});

it('a general near a wavering ally rallies it', () => {
  const b = mkBattle([
    u({ id: 'gen', factionId: 'A', pos: { x: 4, y: 4 }, wu: 80, command: 92, troops: 5000 }),
    u({ id: 'weak', factionId: 'A', pos: { x: 5, y: 4 }, morale: 18, troops: 2000 }),
    u({ id: 'e', factionId: 'B', pos: { x: 6, y: 4 }, troops: 5000 }),
  ]);
  const cmds = planTactical(b, 'A', 'balanced');
  expect(cmds.some((c) => c.kind === 'rally' && c.targetUnitId === 'weak')).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/tactics-plan.test.ts -t "duel"` and `... -t "rally"`
Expected: FAIL — the planner emits neither `challengeDuel` nor `rally` yet.

- [ ] **Step 3: Implement in `plan.ts`**

Add two helpers above `planTactical`:

```ts
function leadGeneralUnit(units: BattleUnit[], factionId: FactionId): BattleUnit | undefined {
  let best: BattleUnit | undefined;
  for (const u of units) {
    if (u.factionId !== factionId || !isFielded(u) || u.command === undefined) continue;
    if (!best || (u.command ?? 0) > (best.command ?? 0)) best = u;
  }
  return best;
}
```

Inside `planTactical`, after the reserve-commit block (before the `for (const u of myUnits)` loop), add the rally play:

```ts
  // RALLY: the lead general steadies a badly-wavering fielded ally within reach.
  const myFieldedAll = battle.units.filter((u) => u.factionId === factionId && isFielded(u));
  const wavering = myFieldedAll.find((u) => u.morale <= BATTLE_TUNING.routMoraleThreshold + 10);
  const rallier = leadGeneralUnit(battle.units, factionId);
  const rallied = new Set<string>();
  if (wavering && rallier && rallier.id !== wavering.id && chebyshev(rallier.pos, wavering.pos) <= 3) {
    cmds.push({ kind: 'rally', unitId: rallier.id, targetUnitId: wavering.id });
    rallied.add(rallier.id);
  }
```

Then, inside the `for (const u of myUnits)` loop, at the very TOP of the loop body (after `const near = nearestEnemy(...)` and `const dist = ...`), add the duel-challenge play — and skip a unit already assigned to rally:

```ts
    if (rallied.has(u.id)) continue;
    // CHALLENGE DUEL: an aggressive high-wu general beside an enemy general.
    if (doc.aggression > 0.6 && u.wu !== undefined && u.wu >= BATTLE_TUNING.duelWuMin && dist <= 1) {
      const enemyGeneral = enemies.find((e) => e.wu !== undefined && e.wu >= BATTLE_TUNING.duelWuMin && chebyshev(u.pos, e.pos) <= 1);
      if (enemyGeneral) { cmds.push({ kind: 'challengeDuel', unitId: u.id, targetUnitId: enemyGeneral.id }); continue; }
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/engine/tactics-plan.test.ts && npm run typecheck`
Expected: PASS (new cases + all existing planner cases; the existing "deterministic" and maneuver cases are unaffected because they use no high-wu generals / wavering allies).

- [ ] **Step 5: Commit**

```bash
git add src/engine/ai/tactics/plan.ts tests/engine/tactics-plan.test.ts
git commit -m "battle/ai: planner seeks duels (aggressive) and rallies wavering allies"
```

---

## Task 3: Decisions — hero levers (Challenge Duel / Rally / Hero Charge)

Surface hero plays to the player, widening the decision family to include `'hero'`.

**Files:**
- Modify: `src/engine/ai/tactics/decisions.ts`
- Test: `tests/engine/tactics-decisions.test.ts` (append)

**Interfaces:**
- Produces (added to `offerPlayerDecisions`): `OfferedDecision.family` widened to `'maneuver' | 'hero'`; new decisions — `challengeDuel:<targetId>` (family `'hero'`, `salient: true`), `rally:<targetId>` (family `'hero'`, `salient: true`), `heroCharge:<targetId>` (family `'hero'`, `salient: false`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/tactics-decisions.test.ts` (reuse `mk`/`u`/`field`/`find`):

```ts
describe('offerPlayerDecisions — hero levers', () => {
  it('offers Challenge Duel when the player has a high-wu general beside an enemy general', () => {
    const b = mk([
      u({ id: 'me', factionId: 'A', pos: { x: 4, y: 4 }, wu: 97, command: 80 }),
      u({ id: 'foe', factionId: 'B', pos: { x: 5, y: 4 }, wu: 95, command: 85 }),
    ]);
    const d = find(offerPlayerDecisions(b, 'A'), 'challengeDuel')!;
    expect(d).toBeDefined();
    expect(d.family).toBe('hero');
    expect(d.salient).toBe(true);
    expect(d.commands).toEqual([{ kind: 'challengeDuel', unitId: 'me', targetUnitId: 'foe' }]);
  });

  it('offers Rally (salient) when a player unit is near rout and a general is close', () => {
    const b = mk([
      u({ id: 'gen', factionId: 'A', pos: { x: 4, y: 4 }, wu: 80, command: 92 }),
      u({ id: 'weak', factionId: 'A', pos: { x: 5, y: 4 }, morale: 16, troops: 1500 }),
      u({ id: 'e', factionId: 'B', pos: { x: 6, y: 4 } }),
    ]);
    const d = find(offerPlayerDecisions(b, 'A'), 'rally')!;
    expect(d).toBeDefined();
    expect(d.family).toBe('hero');
    expect(d.commands).toEqual([{ kind: 'rally', unitId: 'gen', targetUnitId: 'weak' }]);
  });

  it('offers Hero Charge (non-salient) for a cavalry unit that can reach a target', () => {
    const b = mk([
      u({ id: 'cav', factionId: 'A', pos: { x: 4, y: 6 }, troopType: 'cavalry', wu: 88 }),
      u({ id: 'e', factionId: 'B', pos: { x: 4, y: 4 }, troops: 3000 }),
    ]);
    const d = find(offerPlayerDecisions(b, 'A'), 'heroCharge')!;
    expect(d).toBeDefined();
    expect(d.family).toBe('hero');
    expect(d.salient).toBe(false);
    expect(d.commands[0]).toEqual({ kind: 'charge', unitId: 'cav', targetUnitId: 'e' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/tactics-decisions.test.ts -t "hero levers"`
Expected: FAIL — none of the hero decisions are offered yet.

- [ ] **Step 3: Implement in `decisions.ts`**

Widen the type: change `family: 'maneuver'` in the `OfferedDecision` interface to:

```ts
  family: 'maneuver' | 'hero';
```

In `offerPlayerDecisions`, add the hero decisions AFTER the existing maneuver decisions (before `return out;`). Add these helpers near the top of the file (below the existing helpers):

```ts
import { BATTLE_TUNING } from '../../battle/constants.js';
// (BATTLE_TUNING is already imported for volleyRange; do not double-import.)
```

Body additions inside `offerPlayerDecisions`:

```ts
  // HERO — Challenge Duel: a high-wu player general beside a high-wu enemy general.
  const myGeneral = mine.find((u) => u.wu !== undefined && u.wu >= BATTLE_TUNING.duelWuMin);
  if (myGeneral) {
    const foeGeneral = enemies.find((e) => e.wu !== undefined && e.wu >= BATTLE_TUNING.duelWuMin && chebyshev(myGeneral.pos, e.pos) <= 1);
    if (foeGeneral) {
      out.push({ id: `challengeDuel:${foeGeneral.id}`, family: 'hero', labelKey: 'battle.decision.challengeDuel', salient: true,
        commands: [{ kind: 'challengeDuel', unitId: myGeneral.id, targetUnitId: foeGeneral.id }] });
    }
  }

  // HERO — Rally: a wavering ally with a friendly general within reach.
  const wavering = mine.find((u) => u.morale <= BATTLE_TUNING.routMoraleThreshold + 10);
  if (wavering) {
    const gen = mine.find((u) => u.command !== undefined && u.id !== wavering.id && chebyshev(u.pos, wavering.pos) <= 3);
    if (gen) {
      out.push({ id: `rally:${wavering.id}`, family: 'hero', labelKey: 'battle.decision.rally', salient: true,
        commands: [{ kind: 'rally', unitId: gen.id, targetUnitId: wavering.id }] });
    }
  }

  // HERO — Hero Charge: a cavalry unit that can reach an enemy this turn.
  const cav = mine.find((u) => (u.troopType === 'cavalry' || u.troopType === 'heavyCav'));
  if (cav) {
    let target: typeof enemies[number] | undefined;
    let best = Infinity;
    for (const e of enemies) { const d = chebyshev(cav.pos, e.pos); if (d < best) { best = d; target = e; } }
    if (target && best <= (BATTLE_TUNING.moveRange[cav.troopType] ?? 4)) {
      out.push({ id: `heroCharge:${target.id}`, family: 'hero', labelKey: 'battle.decision.heroCharge', salient: false,
        commands: [{ kind: 'charge', unitId: cav.id, targetUnitId: target.id }] });
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/engine/tactics-decisions.test.ts && npm run typecheck`
Expected: PASS (new hero cases + existing maneuver cases; widening `family` keeps existing maneuver decisions valid).

- [ ] **Step 5: Commit**

```bash
git add src/engine/ai/tactics/decisions.ts tests/engine/tactics-decisions.test.ts
git commit -m "battle/ai: offer hero levers (challenge duel / rally / hero charge)"
```

---

## Task 4: i18n — hero-lever + rally-narration keys

**Files:**
- Modify: `src/i18n/types.ts`, `src/i18n/catalog/en.ts`, `src/i18n/catalog/zh.ts`, `tests/i18n/battle-keys.test.ts`

**Interfaces:**
- Produces keys: `battle.decision.challengeDuel`, `battle.decision.rally`, `battle.decision.heroCharge`, `battle.narr.rally`.

- [ ] **Step 1: Add keys to the test (RED)**

In `tests/i18n/battle-keys.test.ts`, extend `KEYS`:

```ts
  'battle.decision.challengeDuel', 'battle.decision.rally', 'battle.decision.heroCharge',
  'battle.narr.rally',
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/i18n/battle-keys.test.ts`
Expected: FAIL — new keys resolve to themselves.

- [ ] **Step 3: Add to the `MessageKey` union**

In `src/i18n/types.ts`, in the battle section:

```ts
  | 'battle.decision.challengeDuel'
  | 'battle.decision.rally'
  | 'battle.decision.heroCharge'
  | 'battle.narr.rally'
```

- [ ] **Step 4: English strings** (`src/i18n/catalog/en.ts`):

```ts
  'battle.decision.challengeDuel': 'Challenge Duel',
  'battle.decision.rally': 'Rally',
  'battle.decision.heroCharge': 'Hero Charge',
  'battle.narr.rally': 'A general rides down the line — the wavering ranks steady.',
```

- [ ] **Step 5: Chinese strings** (`src/i18n/catalog/zh.ts`):

```ts
  'battle.decision.challengeDuel': '单挑',
  'battle.decision.rally': '激励',
  'battle.decision.heroCharge': '陷阵',
  'battle.narr.rally': '大将驰阵，动摇的军心为之一振。',
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run tests/i18n/battle-keys.test.ts tests/i18n/parity.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/i18n/types.ts src/i18n/catalog/en.ts src/i18n/catalog/zh.ts tests/i18n/battle-keys.test.ts
git commit -m "i18n: add hero-lever + rally-narration keys (zh + en)"
```

---

## Task 5: HUD — rally cue + narration

The lever tray already renders hero decisions (they're `OfferedDecision`s). Add a `rally` audio cue and narration line so a rally reads on screen; duels already caption via the existing `duel` path.

**Files:**
- Modify: `src/web/battle/BattleScreen.tsx`
- Test: `tests/web/BattleScreen.test.tsx` (append)

**Interfaces:**
- Consumes: existing per-day `[session]` effect that maps event kinds to cues + narration; existing `playCharge`/`playDuel` cues.

- [ ] **Step 1: Write the failing test**

Append to `tests/web/BattleScreen.test.tsx` a render test that a hero lever surfaces (reuse the file's battle-seeding helper; seed a battle with two adjacent high-wu generals so a Challenge Duel is offered, or assert the label from a hand-built session per the file's pattern):

```ts
it('renders a hero lever (Challenge Duel) when offered', () => {
  const session = seedDuelBattleForTest(); // two adjacent high-wu generals on both sides
  renderBattleForTest(session);
  expect(screen.getByText('单挑')).toBeInTheDocument(); // zh 'Challenge Duel'
});
```

(If seeding two adjacent high-wu generals through the store helper is impractical, hand-build a `BattleSession` whose `offeredDecisions` contains a `challengeDuel` hero decision and assert the label renders — the tray renders any `OfferedDecision`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/web/BattleScreen.test.tsx -t "hero lever"`
Expected: FAIL if the seed doesn't yet produce a duel decision label; PASS-after-implementation once the seed is right. (If the tray already renders it because Task 3 shipped, this test may pass immediately — in that case add the rally-narration assertion below as the RED driver.)

- [ ] **Step 3: Add the rally cue + narration**

In `src/web/battle/BattleScreen.tsx`, in the per-day `[session]` effect:
- In the audio-cue section, add rally to the charge/reserve cue line (a heartening drum):

```ts
    if (kinds.has('charge') || kinds.has('reserveCommitted') || kinds.has('rally')) playCharge();
```

- In the `NARR` array, add a rally entry (near the others):

```ts
      ['rally', 'battle.narr.rally'],
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/web/BattleScreen.test.tsx && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/battle/BattleScreen.tsx tests/web/BattleScreen.test.tsx
git commit -m "battle/hud: rally audio cue + narration; hero levers render in the tray"
```

---

## Task 6: Balance + doctrine differentiation for heroes

Extend the harness so duel/rally/charge are reachable and prove aggression drives duels.

**Files:**
- Modify: `src/engine/ai/tactics/balance.ts`
- Test: `tests/engine/battle-balance.test.ts` (append), `tests/engine/tactics-differentiation.test.ts` (append)

**Interfaces:**
- Consumes: existing `simulateHeadless`/`runBalanceSweep`/`Matchup` (the harness already tallies command kinds via `leverCounts`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/battle-balance.test.ts`:

```ts
it('duels are reachable: two high-wu commanders in a sweep produce at least one duel', () => {
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const matchups = seeds.map((seed) => ({ seed,
    attacker: { troops: 8000, wu: 98, zhi: 40, command: 75, personality: 'active' as const },
    defender: { troops: 8000, wu: 96, zhi: 60, command: 80, personality: 'active' as const } }));
  const sweep = runBalanceSweep(matchups);
  expect(sweep.leverTotals.challengeDuel ?? 0).toBeGreaterThan(0);
});
```

Append to `tests/engine/tactics-differentiation.test.ts`:

```ts
it('an aggressive commander challenges duels where a cautious one does not', () => {
  const base = { seed: 7, defender: { troops: 8000, wu: 96, zhi: 60, command: 85, personality: 'active' as const } };
  const aggressive = simulateHeadless({ ...base, attacker: { troops: 8000, wu: 99, zhi: 30, command: 70, personality: 'active' as const } });
  const cautious = simulateHeadless({ ...base, attacker: { troops: 8000, wu: 62, zhi: 92, command: 88, personality: 'turtle' as const } });
  expect(aggressive.leverCounts.challengeDuel ?? 0).toBeGreaterThan(cautious.leverCounts.challengeDuel ?? 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/battle-balance.test.ts tests/engine/tactics-differentiation.test.ts`
Expected: If the current `buildBattle` positions the two blocks so their generals never stand adjacent, `challengeDuel` totals may be 0 → FAIL. Diagnose from the run.

- [ ] **Step 3: Make duels reachable in the harness**

In `src/engine/ai/tactics/balance.ts`, `buildBattle` places `atk` at `y:10` and `def` at `y:3` on a 12×12 field — with the aggressive planner they should converge and their generals become adjacent within the day limit, triggering `challengeDuel`. If the reachability test fails, it is because neither block is a *led general with wu ≥ duelWuMin adjacency* long enough. Ensure the synthetic blocks carry the `wu`/`command` from `SideSpec` (they already do via `block()`), and confirm the planner's duel branch fires. If blocks pass through each other or stop non-adjacent, nudge the starting rows closer (e.g. `atk` `y: 8`, `def` `y: 4`) so contact happens well before day 30 — change ONLY the two starting `y` values in `block(...)` calls, nothing else. Re-run until `challengeDuel` totals > 0 across the seed set without breaking the existing balance invariants (2× advantage ≥ 0.7, even in (0.1, 0.9), all terminate).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/engine/battle-balance.test.ts tests/engine/tactics-differentiation.test.ts && npm test`
Expected: PASS — duels reachable, aggression differentiates, and the full suite stays green (if a start-row nudge shifted other balance numbers, confirm the 2×/even invariants still hold; if not, revert the nudge and instead add a dedicated duel-reachability matchup with pre-adjacent generals).

- [ ] **Step 5: Full green + commit**

Run: `npm test && npm run typecheck && npm run build`

```bash
git add src/engine/ai/tactics/balance.ts tests/engine/battle-balance.test.ts tests/engine/tactics-differentiation.test.ts
git commit -m "battle/ai: harness exercises duels; assert aggression drives duel-seeking"
```

---

## Self-Review

**1. Spec coverage (Phase 2 = Heroes):**
- Challenge Duel (player lever + AI seeks it) → Task 2 (planner) + Task 3 (decision). Sim already resolves duels. ✓
- Rally (new mechanic + AI + player lever) → Task 1 (sim) + Task 2 (planner) + Task 3 (decision). ✓
- Hero Charge (charge morale shock + player lever) → Task 1 (sim) + Task 3 (decision); planner already charges aggressive cavalry (Phase 1). ✓
- Bilingual strings → Task 4. ✓
- On-screen readability (cue + narration; duels already caption) → Task 5. ✓
- Balance reachability + doctrine differentiation → Task 6. ✓
- Determinism + seam untouched → Global Constraints; sim additions are pure/seeded. ✓

**2. Placeholder scan:** Test-seeding helper names (`seedDuelBattleForTest`, `renderBattleForTest`) are flagged "reuse the file's real helper/pattern," consistent with Phase 1b — a deliberate instruction, not a code placeholder. Every production step carries complete code.

**3. Type consistency:** the new `rally` command shape (`unitId`,`targetUnitId`) is identical across `types.ts`, the sim, the planner, and the detector. `OfferedDecision.family` is widened once (`'maneuver' | 'hero'`) and every hero decision sets `family:'hero'`. The four i18n keys are identical in the union, both catalogs, and the keys test. `BATTLE_TUNING.chargeMoraleShock`/`rallyBaseMorale` are defined in Task 1 and read only there.

**4. Deferred (called out):** accept/decline of *enemy* duel challenges is out of scope — auto-triggered duels already fire when two high-wu generals stand adjacent, and the player-facing lever here is the offensive challenge. Duel *stakes* are left at the existing resolution (loser: half troops + `moraleDuelLoss`); richer stakes (general capture/kill in-battle) can come with Phase 4 tuning. The known defender-only-reserve limitation (Phase 1b) is unchanged.

---

## Execution Handoff

**Plan complete. Subagent-Driven execution (Opus implementers) per the established Phase 1/1b pattern.**
