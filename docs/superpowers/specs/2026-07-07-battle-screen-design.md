# Battle Screen: 3D Emergent Tactical Battles

**Date:** 2026-07-07
**Status:** Approved design — ready for implementation planning
**Inspiration:** [yazelin/battlefield-editor](https://github.com/yazelin/battlefield-editor) — its core lesson, *"a battle is a data package; the engine only loads and displays it,"* is the architectural spine of this design.

## Problem

Combat in the game is resolved **abstractly and off-screen**. When a siege
lands (a `siege` pendingOp completing in `src/engine/pendingOp.ts`, or the
legacy path in `src/engine/turn.ts`), `resolveQuickBattle()` computes a winner
from power math plus seeded RNG. The player never fights — they watch a
**banner overlay** (`src/web/components/BattleAnimation.tsx`: interpolating
troop counters + a march line on the SVG map + sound) and then read a
**summary modal** (`src/web/components/BattleReport.tsx`).

Meanwhile the codebase already carries **dormant scaffolding** for a real
tactical layer that nothing renders or resolves:

- `Battle`, `BattleUnit`, `GameState.pendingBattle`, `TacticalCommand`
  (`src/engine/types.ts`).
- `tickBattleDay` / `isBattleTimeout` / `BATTLE_DAY_LIMIT`
  (`src/engine/combat.ts`, `constants.ts`).
- A fully-implemented tactical AI — `decideTactical()` → `tacticalRules()`
  (`src/engine/ai/tactical.ts`) — that produces `TacticalCommand[]` for a
  `Battle` but is never called.

There is **no resolver** that applies tactical commands and **no battle
screen** — a comment in `combat.ts` even references a `BattleScreen` that was
never built. This feature completes that architecture and gives the player a
battle worth fighting.

## Goals

- When the **player's faction** is a siege participant (attacker **or**
  defender), drop into a dedicated **3D battle screen**.
- The battle is a **real emergent simulation**: block-based, deterministic,
  per-tick. The winner **emerges** from stats + terrain + troop-type counters +
  the player's decisions. Nothing is predetermined.
- The player shapes the outcome through a **hybrid** loop: the sim auto-plays
  cinematically and pauses for **battle-level calls**, **optional per-unit
  micro**, and **context-triggered gambits**.
- Rendered in **Three.js**, realistic-historical look, achieved with
  **procedural** terrain/materials/lighting (no external asset pipeline in v1).
- Preserve the engine's **deterministic, test-driven, framework-free**
  character: the battle resolves identically with the renderer removed.
- Bilingual **zh + en** for every user-facing string, from the first commit.

## Non-Goals (deferred)

- **Field battles** between two marching armies. No such mechanic exists today
  (armies only fight at cities via `siege`); adding it is out of scope.
- **External 3D model assets** (glTF/GLB). v1 uses procedural primitive
  geometry + billboards. Model substitution is a clean later extension (the
  reference supports it as optional).
- **A battlefield editor / authoring tool.** The reference *is* an editor; we
  build only the runtime that generates battlefields procedurally from existing
  city + terrain data. Hand-authored set-piece battles are a Phase 3 flavor
  layer, not a general authoring surface.
- **LLM-backed tactical AI.** The rule-based `decideTactical` is the opponent;
  the `FactionAgent` interface is unchanged so an LLM agent could slot in later.
- **Changing the strategic layer's combat outcome contract.** The emergent
  battle must produce the **same effect shape** the strategic layer already
  consumes.

## Architecture

Four layers, separated by the reference's hard seam — **the engine produces a
battle and a stream of events; the renderer only plays events back.**

```
 ┌─────────────────────────────────────────────────────────────────┐
 │ src/engine/battle/   PURE · DETERMINISTIC · no React · no Three  │
 │   terrain → setup → simulate (per tick) → events → outcome       │
 └─────────────────────────────────────────────────────────────────┘
                              │ Battle, BattleField, BattleEvent[]
                              ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │ src/state/battleSession.ts   DRIVER · steps sim, pauses for you  │
 └─────────────────────────────────────────────────────────────────┘
                              │ session state + event stream
                              ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │ src/web/battle/   Three.js renderer + React DOM HUD (playback)   │
 └─────────────────────────────────────────────────────────────────┘
```

If `src/web/battle/` is deleted, the battle still resolves headlessly through
`battleSession` + `src/engine/battle/`, and the strategic game is unaffected.

### Layer 1 — Battle engine (`src/engine/battle/`)

Pure, seeded, framework-free. Reuses `GameState.rngState` so a battle is
reproducible and its outcome is unit-testable headless.

**`terrain.ts` — `BattleField`.** A battlefield-local terrain model generated
deterministically from the besieged city's `terrain: Terrain[]` + a battle
seed. Echoes the reference's parametric approach:

```ts
export type BattleCell =
  | 'plain' | 'hill' | 'forest' | 'river' | 'ford' | 'wall' | 'gate' | 'ramp';

export interface BattleField {
  width: number;               // battlefield-local grid, e.g. 24×16
  height: number;
  heights: Float32Array;       // per-cell elevation (gaussian hills)
  cells: BattleCell[];         // per-cell terrain class (row-major)
  river?: { spline: Array<{ x: number; y: number }>; fords: Array<{ x: number; y: number }> };
  wall?: { cells: Array<{ x: number; y: number }>; gate: { x: number; y: number } };
  seed: number;
}
export function generateField(city: City, seed: number): BattleField;
```

Elevation from summed 2-D gaussians; rivers as a Catmull-Rom spline rasterized
to `river`/`ford` cells; the defender city contributes a `wall` arc with a
`gate`. `generateField` is the **single source of truth** for terrain — it
feeds both the sim (movement cost, combat modifiers, line-of-sight,
ford-only river crossing) and the 3D mesh. Same seed → identical field.

**`setup.ts` — `createBattle`.**

```ts
export interface BattleSetupInput {
  state: GameState;
  attackerFactionId: FactionId;
  defenderFactionId: FactionId;
  attackingGeneralIds: GeneralId[];
  attackingTroops: number;
  cityId: CityId;
  seed: number;
}
export function createBattle(input: BattleSetupInput): Battle;
```

Splits each side's troop pool into `BattleUnit` blocks — one per committed
general (troop type from the general), plus garrison blocks and a **reserve**
pool (held off-field until committed). Places attackers along the field edge
opposite the city, defenders around the wall/gate, by a simple formation rule
(cavalry forward-flank, archers behind, infantry center). Activates the dormant
`Battle` / `BattleUnit` types; `Battle` is extended (see below).

**`simulate.ts` — `stepBattle`.** The per-tick resolver, the heart of the
emergent sim.

```ts
export interface StepInput {
  battle: Battle;
  commands: TacticalCommand[];  // player + AI (decideTactical), merged this tick
}
export interface StepResult {
  battle: Battle;
  events: BattleEvent[];        // the timeline fragment the renderer plays
}
export function stepBattle(input: StepInput): StepResult;
```

One tick advances in fixed sub-phases so results are order-independent and
testable: **resolve orders → move → ranged (volley) → melee (clash) →
stratagem/duel → morale → rout/removal**. Combat uses the existing
`combatModifier(troopType, terrain)` plus general stats (`wu`/`tong`/`zhi`) and
elevation/flank bonuses read from the `BattleField`. Morale erodes from
casualties, flanking, and general loss; a unit whose morale breaks routs toward
its edge and is removed if it exits. All randomness flows through the battle's
own seeded RNG cursor (carried on `Battle`).

**`events.ts` — `BattleEvent`.** The typed timeline, the "data package" the
renderer consumes and the DOM HUD narrates:

```ts
export type BattleEvent =
  | { kind: 'move'; unitId: string; from: Vec2; to: Vec2 }
  | { kind: 'volley'; unitId: string; targetUnitId: string; casualties: number }
  | { kind: 'clash'; unitId: string; targetUnitId: string; casualties: number; defCasualties: number }
  | { kind: 'charge'; unitId: string; targetUnitId: string }
  | { kind: 'duel'; a: GeneralId; b: GeneralId; winner: GeneralId }
  | { kind: 'fire'; at: Vec2; spread: number }
  | { kind: 'moraleBreak'; unitId: string }
  | { kind: 'rout'; unitId: string }
  | { kind: 'reserveCommitted'; factionId: FactionId; unitIds: string[] }
  | { kind: 'gambitOffer'; gambit: GambitId; unitIds: string[] }
  | { kind: 'decisionWindow'; day: number }
  | { kind: 'log'; entry: LogEntry }
  | { kind: 'end'; attackerWon: boolean };
```

**`gambits.ts` — context-triggered specials.** Pure predicates over battle
state that surface opportunities the player (or active-personality AI) may take
for a bonus:

```ts
export type GambitId = 'cavalryCharge' | 'fireAttack' | 'ambush' | 'duelChallenge' | 'fordCrossing';
export interface Gambit { id: GambitId; unitIds: string[]; label: string /* i18n key */ }
export function detectGambits(battle: Battle): Gambit[];
```

Examples: `fireAttack` when a unit sits in `forest` with wind up; `cavalryCharge`
when a cavalry unit has an exposed enemy flank; `duelChallenge` when two enemy
generals are within range and one is isolated; `fordCrossing` when an undefended
ford is reachable. Choosing a gambit compiles to `TacticalCommand`(s).

**`outcome.ts` — the strategic bridge.** Translates the finished `Battle` into
the **exact `QuickBattleResult` shape** (`src/engine/combat.ts`) the strategic
layer already applies — casualties per side, city ownership change, defender
general status (`wounded` / retreat), attacker relocation into a captured city:

```ts
export function battleToResult(state: GameState, battle: Battle): QuickBattleResult;
```

This is what lets the emergent battle slot into siege completion with **zero
change** to the ownership/casualty/relocation logic downstream. Headless
auto-resolve (`resolveBattleHeadless`) loops `stepBattle` with AI-only commands
until end, then calls `battleToResult`.

**Type changes (`src/engine/types.ts`), surgical:**

- Extend `Battle` with: `field: BattleField` (replaces the placeholder
  `field: { width; height }`), `seed`/`rngCursor`, `wind?: { dir: Vec2;
  strength: number }`, `pendingDecision?: { day: number }`.
- Extend `BattleUnit` with: `formationRole` (`van`/`center`/`rear`/`flank`),
  `state` (`fielded`/`reserve`/`routing`/`gone`), and keep `hasActed`.
  **All units — including reserves — live in the single `Battle.units`
  array**; a reserve is simply a unit with `state: 'reserve'` (off-field, not
  yet drawn), which `commitReserves` flips to `'fielded'`. One source of truth,
  no parallel array.
- Extend `TacticalCommand` with: `charge`, `challengeDuel`, `commitReserves`,
  `gambit` (alongside existing `march`/`meleeAttack`/`rangedAttack`/`stratagem`/
  `hold`/`retreat`).
- Add `type Vec2 = { x: number; y: number }`.

### Layer 2 — Battle session driver (`src/state/battleSession.ts`)

Owns a **live** battle and bridges engine ↔ UI. The engine exposes pure step
functions; the *loop* lives here so it can pause for the player.

```ts
export type BattlePhase = 'intro' | 'playing' | 'awaitingDecision' | 'resolved';
export interface BattleSession {
  battle: Battle;
  phase: BattlePhase;
  speed: 1 | 2 | 4;
  eventQueue: BattleEvent[];         // drained by the renderer
  decision?: { day: number; gambits: Gambit[]; canMicro: boolean };
  playerFactionId: FactionId;
  playerIsAttacker: boolean;
}
```

Driver API (called by `BattleScreen`): `start(input)`, `tick()` (advance one
sim tick, enqueue events, flip to `awaitingDecision` on a `decisionWindow`),
`submitOrders(commands)` / `chooseGambit(id)` / `commitReserves()` (resume
`playing`), `setSpeed`, `autoResolve()` (skip → headless), and `finish()` which
calls `battleToResult` and commits it to `GameState` via the existing store
mutators. AI commands each tick come from `decideTactical(battle, ctx)`.

Lives in the Zustand store (a `battle` slice) so it round-trips through the
store like the rest of the game; the battle itself is serializable, so an
in-progress battle survives a refresh (autosave) the same way the strategic
game does.

### Layer 3 — 3D renderer (`src/web/battle/`, Three.js)

Pure playback. Zero game logic; reads `BattleSession` state + drains
`eventQueue`.

| File | Responsibility |
|------|----------------|
| `BattleScreen.tsx` | React screen. Mounts the `<canvas>`, hosts the DOM HUD (troop/morale bars, day/`n`-of-30 counter, decision panel, speed ×1/×2/×4, "quick-resolve", event log), wires input to `battleSession`. |
| `BattleScene.ts` | Three.js scene/render-loop manager: camera, lights, terrain, units, FX. Consumes `BattleEvent`s to animate. |
| `terrainMesh.ts` | Builds ground mesh from `BattleField.heights`/`cells`, animated water plane for `river`, wall/gate geometry. |
| `units.ts` | Per `BattleUnit`: instanced soldier billboards whose count scales with troop size, faction color, a floating general banner, a morale bar. Interpolates position from `move`, plays clash/rout. |
| `fx.ts` | Particle systems driven by events: arrow volleys, fire + spread, cavalry dust, flood. |
| `camera.ts` | Cinematic shots (frame the clash, follow a charge, pull back on rout) + a free-look/orbit toggle. |
| `assets.ts` | Procedurally generates textures/materials on a `<canvas>` (ground, water normal, wood, banners) so the build stays self-contained — **no external files**. Optional GLB hook stubbed for later. |

`three` + `@types/three` are added as dependencies. Three.js is imported only
under `src/web/battle/` so nothing else in the bundle pays for it, and the
engine/state layers never import it.

### Layer 4 — App glue

- **Routing:** add a `battle` screen kind. `App.tsx` gains
  `case 'battle': body = <BattleScreen />`. `selectScreen`/`store.ts` gain the
  new kind and the transitions into/out of it.
- **Strategic hand-off:** when a `siege` op involving the player completes in
  `pendingOp.ts`, instead of calling `resolveQuickBattle` it calls
  `createBattle`, stores it on `GameState.pendingBattle`, and signals the store
  to route to `battle`. Day-advancement pauses while `pendingBattle` is set.
  AI-vs-AI sieges keep calling `resolveQuickBattle` (off-screen, unchanged).
- **After-action:** on `finish()`, the result commits, `pendingBattle` clears,
  the store routes back to `main`, and the existing `BattleReport` modal is
  **reused** as the after-action summary. `BattleAnimation` is retired from the
  player siege path (retained only if we keep an AI-flash; otherwise removed).
- **i18n:** extend the existing `battle.*` catalog (zh + en) with every new
  string — decision labels, gambit names, unit/terrain names, event-log lines,
  HUD labels. Covered by the i18n parity test.
- **Audio:** extend `src/web/audio/battle.ts` (already has
  `playMarch`/`playClash`/`playDayTick`/`playGong`/`playRetreat` + mute) with
  `playCharge`/`playVolley`/`playFire`/`playDuel`/`playRout` in the same
  WebAudio style.

## Data Flow

```
strategic layer: player-involved siege op completes (pendingOp.ts)
  └─ createBattle(state, siege, seed) → Battle (with BattleField)
  └─ state.pendingBattle = battle; route → 'battle'; pause day-advance

battle screen (BattleScreen ↔ battleSession):
  loop while phase === 'playing':
      aiCommands   = decideTactical(battle, ctx)              // both AI sides
      playerCmds   = queued from your orders/gambits (or none)
      { battle, events } = stepBattle({ battle, commands: [...aiCommands, ...playerCmds] })
      enqueue events → BattleScene plays them in 3D; HUD narrates
      if a 'decisionWindow' event fired → phase = 'awaitingDecision', pause
  on decision: submitOrders / chooseGambit / commitReserves → resume
  on 'end' or day-30 timeout → phase = 'resolved'

resolve:
  └─ result = battleToResult(state, battle)   // QuickBattleResult shape
  └─ commit result to GameState (SAME code path resolveQuickBattle used)
  └─ pendingBattle = undefined; route → 'main'; resume day-advance
  └─ show BattleReport (after-action)

skip path: 'quick-resolve' → resolveBattleHeadless(battle) → battleToResult → commit
off-screen AI-vs-AI siege: resolveQuickBattle (unchanged)
```

## Edge Cases

- **Player is the defender.** Handled symmetrically: `playerIsAttacker` selects
  which side the HUD commands; the sim and outcome are side-agnostic.
- **Both attacker and defender are AI.** Never opens the screen; stays
  `resolveQuickBattle`. Selecting who "the player" is uses
  `state.playerFactionId`.
- **Day-30 timeout.** `isBattleTimeout` still governs: if the attacker hasn't
  taken the city by `BATTLE_DAY_LIMIT`, the battle ends as an attacker retreat —
  same signature behavior, now driven by the sim clock.
- **No committed generals / unled mob.** `computePower`'s existing unled-mob
  factor is mirrored in unit stats; a general-less block fights at reduced
  effectiveness and low morale ceiling.
- **Refresh mid-battle.** `Battle` (incl. `BattleField` as typed arrays →
  serialized) is in the store; autosave/restore resumes the battle screen.
  If serialization of `Float32Array` is awkward, `heights` persists as a plain
  `number[]` and is the only shape stored.
- **Determinism.** Battle seed derives from `state.rngState` at siege
  completion; the battle advances its own `rngCursor`; identical inputs +
  identical player commands → identical outcome. Headless and on-screen
  resolution of the same battle with the same commands agree exactly (asserted).
- **Old saves.** `pendingBattle` is already an optional field; absent on old
  saves, defaulted to `undefined`. No migration needed.
- **Renderer failure / WebGL unavailable.** `BattleScreen` falls back to
  offering **quick-resolve** (headless) so the strategic game never dead-ends on
  a graphics failure.

## Testing

Engine + session are the tested surface; the 3D renderer gets a mount smoke
test only.

- `tests/engine/battle-terrain.test.ts` — `generateField` is deterministic for
  a seed; river cells form a connected path with ≥1 ford; a walled city yields a
  wall arc with exactly one gate.
- `tests/engine/battle-sim.test.ts` — `stepBattle` phase order is stable;
  casualties are symmetric to the clash inputs; morale break → rout → removal on
  exit; a superior force reliably wins over many seeds; troop-type/terrain
  counters shift results in the expected direction.
- `tests/engine/battle-gambits.test.ts` — each gambit predicate fires only under
  its precondition; `fireAttack` needs forest + wind; `duelChallenge` needs an
  isolated enemy general.
- `tests/engine/battle-outcome.test.ts` — `battleToResult` matches the
  ownership/casualty/relocation contract of `resolveQuickBattle` for equivalent
  inputs; headless full-battle resolution produces a valid `QuickBattleResult`.
- `tests/state/battle-session.test.ts` — the driver pauses at decision windows,
  applies submitted orders, resumes, and commits an outcome; `autoResolve`
  short-circuits to a committed result.
- `tests/playthrough/combat-flow.test.ts` — **extended**: a player-involved
  siege routes into `pendingBattle`; a headless auto-resolved battle changes
  city ownership and updates general status through the same assertions the
  current quick-battle flow uses.
- `tests/i18n/parity.test.ts` — every new `battle.*` key exists in both
  catalogs.
- `tests/web/BattleScreen.test.tsx` — mounts with a fixture session, shows the
  HUD, renders a decision panel when `phase === 'awaitingDecision'`, and the
  quick-resolve button resolves. (Three.js is mocked/guarded under jsdom.)

All existing engine, playthrough, and web tests stay green. AI-vs-AI sieges are
untouched, so the long-simulation suite is unaffected.

## Phasing

Each phase is independently shippable and tested. Phases 0–1 make the battle
**fully playable before any Three.js**, de-risking the 3D bet.

- **Phase 0 — Engine core (headless).** `terrain.ts`, `setup.ts`,
  `simulate.ts`, `events.ts`, `gambits.ts`, `outcome.ts` + the `types.ts`
  extensions + engine tests. Wire player-siege → `pendingBattle` →
  `resolveBattleHeadless` (temporary auto-resolve) so the strategic loop works
  end-to-end with zero UI.
- **Phase 1 — Session driver + playable 2D-placeholder screen.**
  `battleSession.ts`, a minimal DOM/SVG `BattleScreen` (no Three.js yet):
  decision windows, battle-level calls + per-unit micro + gambits,
  quick-resolve, after-action via `BattleReport`, i18n, audio. A complete,
  playable hybrid battle.
- **Phase 2 — Three.js renderer.** Add `three`; build `BattleScene`,
  `terrainMesh`, `units`, `camera`, and core FX (`volley`, `clash`, `rout`).
  Replace the placeholder view. Realistic palette + lighting.
- **Phase 3 — Spectacle & polish.** Fire/flood/charge particles, cinematic
  camera shots, procedural materials in `assets.ts`, wind + 赤壁-style
  naval/fire flavor on `river`/`navy` fields, instancing/perf, and a
  settings surface (render quality, default-to-quick-resolve).

## Footprint

- **Add deps:** `three`, `@types/three`.
- **New files:** `src/engine/battle/{terrain,setup,simulate,events,gambits,outcome}.ts`,
  `src/state/battleSession.ts`, `src/web/battle/{BattleScreen.tsx,BattleScene,terrainMesh,units,fx,camera,assets}.ts(x)`,
  new `battle.*` i18n keys, new cues in `audio/battle.ts`, the tests above.
- **Touched (surgically):** `src/engine/types.ts` (extend `Battle`/`BattleUnit`/
  `TacticalCommand`, add `Vec2`, `BattleField`, `BattleEvent`, `Gambit`),
  `src/engine/pendingOp.ts` (branch player siege → `pendingBattle`),
  `src/state/store.ts` + `src/state/selectors.ts` (battle slice, `battle`
  screen kind, hand-off/resume), `src/web/App.tsx` (route `battle`),
  `src/web/screens/MainScreen.tsx` (hand off / resume / after-action).
- **Retired:** `BattleAnimation` from the player siege path (kept only if an
  AI-flash is retained).

## Open Questions

None — direction (hybrid), rendering (Three.js 3D), simulation depth (real
emergent), decision model (calls + per-unit + gambits), art (realistic), and
trigger scope (player attacker or defender, with quick-resolve) all settled in
brainstorming.
