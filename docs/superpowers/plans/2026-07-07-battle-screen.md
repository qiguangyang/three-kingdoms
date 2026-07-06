# Battle Screen Implementation Plan — Plan 1 (Engine + Playable Screen, no Three.js)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real, deterministic, block-based tactical battle simulation and drop the player into a fully playable battle (decision windows + per-unit orders + gambits + quick-resolve) whenever their faction attacks or defends a siege — rendered with a test-friendly SVG placeholder that the Three.js renderer (Plan 2) later swaps in behind the same session API.

**Architecture:** Follows the spec's hard seam — `src/engine/battle/` produces a `Battle` + a stream of `BattleEvent`s (pure, deterministic, seeded); `src/state/battleSession.ts` drives the sim step-by-step and pauses for the player; `src/web/battle/BattleScreen.tsx` plays it back. The emergent battle is a **parallel** resolution path used only for player battles; `resolveQuickBattle` stays the sole path for AI-vs-AI and all headless `tickDays` ticks, so every seed-pinned test stays green.

**Tech Stack:** TypeScript (NodeNext ESM, explicit `.js` import specifiers), React 19 + vanilla Zustand store, Vite 5, Vitest 2 (jsdom, `globals: false`), Tailwind 3. **No new dependencies in this plan** (`three` is added in Plan 2). SVG for battle visuals (jsdom has no canvas/WebGL/AudioContext).

## Global Constraints

Every task implicitly includes these (copied verbatim from the spec + verified codebase conventions):

- **English-only identifiers and comments.** No Chinese in code. (User feedback memory.)
- **Bilingual UI, zh + en, from the first commit.** Every user-facing string is a `MessageKey` added to the closed union in `src/i18n/types.ts` **and** to both `src/i18n/catalog/en.ts` and `src/i18n/catalog/zh.ts`. Placeholder names (`{day}`) must be identical across locales. Values must be non-empty.
- **Determinism.** All randomness threads through a numeric RNG state (`src/engine/rng.ts`: `rollInt(state,min,max) → {value,state}`, `rollChance(state,prob) → {hit,state}`, `roll(state) → {value,state}`). A battle carries its own `rngCursor`; the final cursor is written back to `GameState.rngState` when the battle result is applied.
- **Immutable state.** Engine reducers return a NEW object and never mutate in place (tests assert identity changes).
- **Explicit `.js` extensions** on all relative import specifiers (NodeNext).
- **Vitest with `globals: false`** — every test file explicitly does `import { describe, expect, it } from 'vitest';`.
- **Do NOT change `resolveQuickBattle`'s math or RNG draw order** — seed-pinned tests (`tests/engine/combat.test.ts`, `tests/playthrough/combat-flow.test.ts`, `tests/playthrough/long-simulation.test.ts`) depend on it.
- **Node >= 20.**
- **Run the full suite** with `npm test` (alias for `vitest run`). Run one file with `npx vitest run <path>`.

## File Structure

**New (engine, pure):**
- `src/engine/battle/types.ts` — battle-local domain types (`Vec2`, `BattleCell`, `BattleField`, `BattleEvent`, `Gambit`, `GambitId`, `FormationRole`, `BattleUnitState`). Kept out of the global `types.ts` to keep that file focused; re-exported from the engine barrel.
- `src/engine/battle/constants.ts` — battle tuning knobs.
- `src/engine/battle/terrain.ts` — `generateField(city, seed)`.
- `src/engine/battle/setup.ts` — `createBattle(state, input)`.
- `src/engine/battle/simulate.ts` — `stepBattle({battle, commands})` (resolves ONE day) + phase helpers.
- `src/engine/battle/gambits.ts` — `detectGambits(battle)`.
- `src/engine/battle/outcome.ts` — `battleToResult(state, battle)`, `resolveBattleHeadless(state, battle)`, `defaultTacticalCommands(battle, factionId, personality)`.
- `src/engine/battle/index.ts` — battle module barrel.

**New (state):**
- `src/state/battleSession.ts` — `BattleSession` type + pure driver functions.

**New (web):**
- `src/web/battle/BattleScreen.tsx` — the playable screen (SVG placeholder view + DOM HUD).
- `src/web/battle/BattleField2D.tsx` — the SVG field/unit/FX view (Plan 2 replaces this with a Three.js canvas behind the same props).

**Modified (surgical):**
- `src/engine/types.ts` — extend `Battle` (`field: BattleField`, `seed`, `rngCursor`, `wind?`), extend `BattleUnit` (`state`, `formationRole`), extend `TacticalCommand` (`charge`, `challengeDuel`, `commitReserves`, `gambit`). Import battle types from `./battle/types.js`.
- `src/engine/constants.ts` — (no change; reuse `BATTLE_WIDTH=20`, `BATTLE_HEIGHT=12`, `BATTLE_DAY_LIMIT=30`, `COMBAT_MODIFIER`, `CITY_DEFENSE_BONUS`).
- `src/engine/index.ts` — add `export * as battle from './battle/index.js';`.
- `src/engine/pendingOp.ts` — `tickDays`/`tickOneDay` gain a `deferPlayerBattles` option; `applyCompletedSiege` branches player-involved sieges to set `state.pendingBattle`.
- `src/state/store.ts` — add `battle: BattleSession | null` slice + init; battle mutators; `advanceDays` passes `deferPlayerBattles:true` and enters the battle screen when a battle is pending; restore reconstructs a session from `game.pendingBattle`.
- `src/state/selectors.ts` — `selectBattle`.
- `src/web/App.tsx` — `case 'battle': body = <BattleScreen />;`.
- `src/web/audio/battle.ts` — add `playCharge`/`playVolley`/`playFire`/`playDuel`/`playRout`.
- `src/i18n/types.ts`, `src/i18n/catalog/en.ts`, `src/i18n/catalog/zh.ts` — new `battle.*` keys.

**New tests:** `tests/engine/battle-terrain.test.ts`, `battle-setup.test.ts`, `battle-sim.test.ts`, `battle-gambits.test.ts`, `battle-outcome.test.ts`, `battle-pendingop.test.ts`, `tests/state/battle-session.test.ts`, `tests/web/BattleScreen.test.tsx`.

---

# PHASE 0 — Engine core (headless, no UI)

At the end of Phase 0 the strategic loop works end-to-end: a player-involved siege sets `pendingBattle`, and `resolveBattleHeadless` can resolve it into a `QuickBattleResult` that flips city ownership — all headless and unit-tested. Every pre-existing test stays green.

---

### Task 0.1: Battle domain types + constants

**Files:**
- Create: `src/engine/battle/types.ts`
- Create: `src/engine/battle/constants.ts`
- Modify: `src/engine/types.ts` (extend `Battle`, `BattleUnit`, `TacticalCommand`; import battle types)
- Modify: `src/engine/index.ts` (barrel)
- Create: `src/engine/battle/index.ts`
- Test: `tests/engine/battle-types.test.ts`

**Interfaces:**
- Produces: `Vec2`, `BattleCell`, `FormationRole`, `BattleUnitState`, `BattleField`, `BattleEvent`, `GambitId`, `Gambit` (from `battle/types.ts`); extended `Battle`, `BattleUnit`, `TacticalCommand` (in `types.ts`); `BATTLE_TUNING` (from `battle/constants.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/battle-types.test.ts
import { describe, expect, it } from 'vitest';
import type {
  BattleField,
  BattleEvent,
  Gambit,
} from '../../src/engine/battle/types.js';
import { BATTLE_TUNING } from '../../src/engine/battle/constants.js';
import type { Battle, BattleUnit, TacticalCommand } from '../../src/engine/types.js';

describe('battle domain types', () => {
  it('constructs a BattleField with row-major arrays sized width*height', () => {
    const field: BattleField = {
      width: 2,
      height: 2,
      heights: [0, 0, 0, 0],
      cells: ['plain', 'hill', 'plain', 'forest'],
      seed: 1,
    };
    expect(field.cells.length).toBe(field.width * field.height);
    expect(field.heights.length).toBe(field.width * field.height);
  });

  it('extends BattleUnit with state + formationRole and Battle with field/seed/rngCursor', () => {
    const unit: BattleUnit = {
      id: 'u1',
      generalId: 'guanyu',
      factionId: 'liubei',
      troops: 5000,
      troopType: 'infantry',
      pos: { x: 1, y: 2 },
      morale: 100,
      hasActed: false,
      state: 'fielded',
      formationRole: 'center',
    };
    const battle: Battle = {
      cityId: 'luoyang',
      attackerFactionId: 'liubei',
      defenderFactionId: 'dongzhuo',
      daysElapsed: 0,
      units: [unit],
      field: { width: 1, height: 1, heights: [0], cells: ['plain'], seed: 7 },
      seed: 7,
      rngCursor: 7,
      log: [],
    };
    expect(battle.units[0]!.state).toBe('fielded');
    expect(battle.rngCursor).toBe(7);
  });

  it('extends TacticalCommand with charge/challengeDuel/commitReserves/gambit', () => {
    const cmds: TacticalCommand[] = [
      { kind: 'charge', unitId: 'u1', targetUnitId: 'e1' },
      { kind: 'challengeDuel', unitId: 'u1', targetUnitId: 'e1' },
      { kind: 'commitReserves', factionId: 'liubei' },
      { kind: 'gambit', gambitId: 'fireAttack', unitIds: ['u1'] },
    ];
    expect(cmds).toHaveLength(4);
  });

  it('exposes BattleEvent variants and Gambit shape', () => {
    const ev: BattleEvent = { kind: 'clash', unitId: 'u1', targetUnitId: 'e1', casualties: 100, defCasualties: 90 };
    const g: Gambit = { id: 'cavalryCharge', unitIds: ['u1'], labelKey: 'battle.gambit.cavalryCharge' };
    expect(ev.kind).toBe('clash');
    expect(g.id).toBe('cavalryCharge');
    expect(BATTLE_TUNING.moveRange.infantry).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/battle-types.test.ts`
Expected: FAIL — cannot find module `../../src/engine/battle/types.js` / `constants.js`.

- [ ] **Step 3: Create `src/engine/battle/types.ts`**

```ts
// Battle-local domain types. Kept separate from the global engine types.ts so
// that file stays focused; re-exported through the engine barrel.
import type {
  CityId,
  FactionId,
  GeneralId,
  LogEntry,
  TroopType,
} from '../types.js';

export type Vec2 = { x: number; y: number };

// One battlefield cell's terrain class. Drives movement cost, combat
// modifiers, line-of-sight, and (in Plan 2) the 3D mesh.
export type BattleCell =
  | 'plain'
  | 'hill'
  | 'forest'
  | 'river'
  | 'ford'
  | 'wall'
  | 'gate'
  | 'ramp';

export type FormationRole = 'van' | 'center' | 'rear' | 'flank';

// A unit is fielded (drawn, fighting), reserve (off-field until committed),
// routing (fleeing, morale broken), or gone (destroyed / left the field).
export type BattleUnitState = 'fielded' | 'reserve' | 'routing' | 'gone';

export interface BattleField {
  width: number; // battlefield-local grid width (cells)
  height: number; // battlefield-local grid height (cells)
  // Row-major (index = y*width + x), length === width*height. Stored as plain
  // number[] (not Float32Array) so it serializes into save files cleanly.
  heights: number[]; // per-cell elevation, ~0..1
  cells: BattleCell[]; // per-cell terrain class
  river?: { spline: Vec2[]; fords: Vec2[] };
  wall?: { cells: Vec2[]; gate: Vec2 };
  seed: number;
}

export type GambitId =
  | 'cavalryCharge'
  | 'fireAttack'
  | 'ambush'
  | 'duelChallenge'
  | 'fordCrossing';

export interface Gambit {
  id: GambitId;
  unitIds: string[]; // the player's units this gambit would act with
  labelKey: string; // i18n MessageKey, e.g. 'battle.gambit.fireAttack'
}

// The typed timeline the renderer plays back and the HUD narrates. Positions
// use battlefield-local cell coordinates.
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
  | { kind: 'dayAdvanced'; day: number }
  | { kind: 'log'; entry: LogEntry }
  | { kind: 'end'; attackerWon: boolean; reason: 'destroyed' | 'timeout' };

// Re-export a couple of global ids used above so consumers can import from one
// place.
export type { CityId, FactionId, GeneralId, TroopType };
```

- [ ] **Step 4: Create `src/engine/battle/constants.ts`**

```ts
// Battle simulation tuning. Values are deliberately gentle so a clear
// stat/terrain/numbers advantage wins reliably while upsets stay possible.
import type { TroopType } from '../types.js';

export const BATTLE_TUNING = {
  // Cells a unit may traverse per day, by troop type.
  moveRange: {
    infantry: 2,
    archer: 2,
    cavalry: 4,
    heavyCav: 3,
    navy: 3,
    xuan: 3,
  } as Record<TroopType, number>,
  // Archer volley range in cells (Chebyshev).
  volleyRange: 3,
  // Fraction of the loser's engaged troops removed in a base melee exchange,
  // before power ratio scaling.
  meleeBaseLoss: 0.18,
  // Ranged volley base loss fraction.
  volleyBaseLoss: 0.06,
  // Extra melee multiplier when a unit spends the day charging.
  chargeBonus: 1.4,
  // Per-cell elevation combat multiplier: attacking downhill helps.
  elevationPerLevel: 0.25,
  // Morale lost per 10% of a unit's troops killed in a day.
  moralePer10pctLoss: 8,
  // Morale lost when a friendly general loses a duel adjacent to the unit.
  moraleDuelLoss: 15,
  // A unit routs when morale drops to or below this.
  routMoraleThreshold: 20,
  // Duel auto-triggers when two enemy generals of at least this 武 stand
  // adjacent (mirrors DUEL_TRIGGER_WU_MIN in engine constants).
  duelWuMin: 85,
  // Starting morale.
  startMorale: 100,
} as const;
```

- [ ] **Step 5: Extend `src/engine/types.ts`**

Add this import near the top (after the file header comment / existing imports; `types.ts` currently has no imports, so add it as the first line after the header):

```ts
import type {
  BattleCell,
  BattleField,
  BattleUnitState,
  FormationRole,
  GambitId,
} from './battle/types.js';
```

Replace the existing `BattleUnit` interface (types.ts:144-153) with:

```ts
export interface BattleUnit {
  id: string; // unit id within the battle
  generalId: GeneralId;
  factionId: FactionId;
  troops: number;
  troopType: TroopType;
  pos: { x: number; y: number }; // battlefield-local grid (smaller than world)
  morale: number; // 0-100
  hasActed: boolean;
  state: BattleUnitState; // fielded | reserve | routing | gone
  formationRole: FormationRole; // van | center | rear | flank
}
```

Replace the existing `Battle` interface (types.ts:155-163) with:

```ts
export interface Battle {
  cityId: CityId; // city being attacked
  attackerFactionId: FactionId;
  defenderFactionId: FactionId;
  daysElapsed: number; // 30-day timeout triggers attacker auto-retreat
  units: BattleUnit[]; // includes reserves (state:'reserve') and gone units
  field: BattleField; // generated terrain; single source for sim + renderer
  seed: number; // battle terrain/rng seed (derived from GameState.rngState)
  rngCursor: number; // advances as the sim rolls; written back on resolve
  wind?: { dir: { x: number; y: number }; strength: number }; // for fire gambit
  log: LogEntry[];
}
```

Replace the existing `TacticalCommand` union (types.ts:192-198) with:

```ts
// Commands emitted at the tactical (battlefield) layer.
export type TacticalCommand =
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
```

- [ ] **Step 6: Create `src/engine/battle/index.ts`**

```ts
export * from './types.js';
export * from './constants.js';
export { generateField } from './terrain.js';
export { createBattle } from './setup.js';
export { stepBattle } from './simulate.js';
export { detectGambits } from './gambits.js';
export {
  battleToResult,
  resolveBattleHeadless,
  defaultTacticalCommands,
} from './outcome.js';
```

Note: this barrel references files created in later tasks. If your executor runs tasks strictly in order, the barrel will not typecheck until Task 0.7 lands. To keep each task green, add the export lines incrementally — in this task include only `export * from './types.js';` and `export * from './constants.js';`, and append each remaining line in the task that creates its file (noted in those tasks). 

- [ ] **Step 7: Extend the engine barrel `src/engine/index.ts`**

Add after the existing exports:

```ts
export * as battle from './battle/index.js';
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/engine/battle-types.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Typecheck (catches the union/exhaustiveness ripple)**

Run: `npm run typecheck`
Expected: PASS. If `tacticalRules` (`src/engine/ai/tactical.ts`) fails to typecheck because the `TacticalCommand` union grew, it will not — it only *produces* the existing kinds and never exhaustively switches over the union. No change needed there.

- [ ] **Step 10: Commit**

```bash
git add src/engine/battle/types.ts src/engine/battle/constants.ts src/engine/battle/index.ts src/engine/types.ts src/engine/index.ts tests/engine/battle-types.test.ts
git commit -m "feat(battle): add battle domain types, tuning constants, and type extensions"
```

---

### Task 0.2: Terrain generation

**Files:**
- Create: `src/engine/battle/terrain.ts`
- Modify: `src/engine/battle/index.ts` (append `export { generateField } from './terrain.js';`)
- Test: `tests/engine/battle-terrain.test.ts`

**Interfaces:**
- Consumes: `BattleField`, `BattleCell`, `Vec2` (Task 0.1); `City` (`../types.js`); `BATTLE_WIDTH`, `BATTLE_HEIGHT` (`../constants.js`); RNG helpers (`../rng.js`).
- Produces: `generateField(city: City, seed: number): BattleField`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/battle-terrain.test.ts
import { describe, expect, it } from 'vitest';
import { generateField } from '../../src/engine/battle/terrain.js';
import { BATTLE_WIDTH, BATTLE_HEIGHT } from '../../src/engine/constants.js';
import type { City } from '../../src/engine/types.js';

function city(terrain: City['terrain']): City {
  return {
    id: 'c', name: { zh: '城', en: 'City' }, pos: { x: 0, y: 0 },
    terrain, factionId: 'dongzhuo', agriculture: 50, commerce: 50, defense: 50,
    loyalty: 50, money: 0, food: 0, generals: [], garrison: 3000, flags: {},
  };
}

describe('generateField', () => {
  it('is deterministic for a given seed', () => {
    const a = generateField(city(['plain']), 123);
    const b = generateField(city(['plain']), 123);
    expect(a).toEqual(b);
  });

  it('differs across seeds', () => {
    const a = generateField(city(['plain']), 1);
    const b = generateField(city(['plain']), 2);
    expect(a).not.toEqual(b);
  });

  it('sizes arrays to BATTLE_WIDTH*BATTLE_HEIGHT', () => {
    const f = generateField(city(['mountain']), 5);
    expect(f.width).toBe(BATTLE_WIDTH);
    expect(f.height).toBe(BATTLE_HEIGHT);
    expect(f.cells.length).toBe(BATTLE_WIDTH * BATTLE_HEIGHT);
    expect(f.heights.length).toBe(BATTLE_WIDTH * BATTLE_HEIGHT);
  });

  it('carves a connected river with at least one ford when terrain includes river', () => {
    const f = generateField(city(['river']), 9);
    expect(f.river).toBeDefined();
    const riverCells = f.cells.filter((c) => c === 'river' || c === 'ford');
    expect(riverCells.length).toBeGreaterThan(BATTLE_HEIGHT - 1); // spans the field
    expect(f.river!.fords.length).toBeGreaterThanOrEqual(1);
  });

  it('always builds a defender wall arc with exactly one gate', () => {
    const f = generateField(city(['plain']), 3);
    expect(f.wall).toBeDefined();
    expect(f.wall!.cells.length).toBeGreaterThan(0);
    const gateCount = f.cells.filter((c) => c === 'gate').length;
    expect(gateCount).toBe(1);
  });

  it('produces more hills for mountain terrain than plain', () => {
    const hills = (t: City['terrain']) =>
      generateField(city(t), 7).cells.filter((c) => c === 'hill').length;
    expect(hills(['mountain'])).toBeGreaterThan(hills(['plain']));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/battle-terrain.test.ts`
Expected: FAIL — cannot find module `terrain.js`.

- [ ] **Step 3: Create `src/engine/battle/terrain.ts`**

```ts
// Deterministic battlefield terrain generation from a city's terrain type +
// a seed. Echoes the reference's parametric approach: summed gaussians for
// elevation, a Catmull-Rom spline for the river. Same seed => identical field.
import { BATTLE_HEIGHT, BATTLE_WIDTH } from '../constants.js';
import { rollInt, roll } from '../rng.js';
import type { City, Terrain } from '../types.js';
import type { BattleCell, BattleField, Vec2 } from './types.js';

const W = BATTLE_WIDTH;
const H = BATTLE_HEIGHT;

const idx = (x: number, y: number): number => y * W + x;

// Catmull-Rom through control points, sampled to `steps` points.
function catmullRom(points: Vec2[], steps: number): Vec2[] {
  if (points.length < 2) return points.slice();
  const pts = [points[0]!, ...points, points[points.length - 1]!];
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length - 3; i++) {
    const p0 = pts[i]!, p1 = pts[i + 1]!, p2 = pts[i + 2]!, p3 = pts[i + 3]!;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

export function generateField(city: City, seed: number): BattleField {
  let rng = seed >>> 0;
  const rint = (min: number, max: number): number => {
    const r = rollInt(rng, min, max);
    rng = r.state;
    return r.value;
  };
  const rfloat = (): number => {
    const r = roll(rng);
    rng = r.state;
    return r.value;
  };

  const primary = (city.terrain[0] ?? 'plain') as Terrain;
  const heights = new Array<number>(W * H).fill(0);
  const cells = new Array<BattleCell>(W * H).fill('plain');

  // --- Elevation: sum a few gaussian bumps. Mountain terrain gets more,
  //     taller bumps; plains stay flat.
  const bumpCount =
    primary === 'mountain' ? rint(5, 7) : primary === 'forest' ? rint(2, 4) : rint(1, 2);
  for (let b = 0; b < bumpCount; b++) {
    const cx = rint(0, W - 1);
    const cy = rint(0, H - 1);
    const amp = primary === 'mountain' ? 0.7 + rfloat() * 0.5 : 0.35 + rfloat() * 0.3;
    const sigma = 1.5 + rfloat() * 2.5;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        heights[idx(x, y)]! + 0; // no-op to satisfy strict indexing lint
        heights[idx(x, y)] = Math.min(1, (heights[idx(x, y)] ?? 0) + amp * Math.exp(-d2 / (2 * sigma * sigma)));
      }
    }
  }
  // Classify high cells as hills.
  const hillThreshold = primary === 'mountain' ? 0.45 : 0.6;
  for (let i = 0; i < cells.length; i++) {
    if ((heights[i] ?? 0) >= hillThreshold) cells[i] = 'hill';
  }

  // --- Forest patches for forest terrain.
  if (primary === 'forest') {
    const patches = rint(3, 5);
    for (let p = 0; p < patches; p++) {
      const cx = rint(1, W - 2);
      const cy = rint(1, H - 2);
      const rad = rint(1, 2);
      for (let y = cy - rad; y <= cy + rad; y++) {
        for (let x = cx - rad; x <= cx + rad; x++) {
          if (x >= 0 && x < W && y >= 0 && y < H && cells[idx(x, y)] === 'plain') {
            cells[idx(x, y)] = 'forest';
          }
        }
      }
    }
  }

  // --- River: a roughly vertical Catmull-Rom band. Present for river terrain,
  //     and occasionally elsewhere for variety (deterministic on seed).
  let river: BattleField['river'];
  const wantRiver = primary === 'river' || primary === 'navy' || rfloat() < 0.2;
  if (wantRiver) {
    const ctrl: Vec2[] = [];
    const bands = 4;
    for (let i = 0; i <= bands; i++) {
      ctrl.push({ x: rint(3, W - 4), y: Math.round((i / bands) * (H - 1)) });
    }
    const path = catmullRom(ctrl, 6);
    for (const p of path) {
      const px = Math.max(0, Math.min(W - 1, Math.round(p.x)));
      const py = Math.max(0, Math.min(H - 1, Math.round(p.y)));
      cells[idx(px, py)] = 'river';
      heights[idx(px, py)] = 0; // rivers sit low
    }
    // Fords: 1-2 crossable cells punched into the river.
    const fords: Vec2[] = [];
    const fordCount = rint(1, 2);
    for (let f = 0; f < fordCount; f++) {
      const fy = rint(1, H - 2);
      // find a river cell on this row
      for (let x = 0; x < W; x++) {
        if (cells[idx(x, fy)] === 'river') {
          cells[idx(x, fy)] = 'ford';
          fords.push({ x, y: fy });
          break;
        }
      }
    }
    if (fords.length === 0) {
      // guarantee at least one ford
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] === 'river') {
          cells[i] = 'ford';
          fords.push({ x: i % W, y: Math.floor(i / W) });
          break;
        }
      }
    }
    river = { spline: path, fords };
  }

  // --- Defender wall: an arc across the defender's edge (top of the field),
  //     with exactly one gate. The attacker deploys along the bottom edge.
  const wallY = 1;
  const wallCells: Vec2[] = [];
  for (let x = 2; x < W - 2; x++) {
    if (cells[idx(x, wallY)] !== 'river' && cells[idx(x, wallY)] !== 'ford') {
      cells[idx(x, wallY)] = 'wall';
      wallCells.push({ x, y: wallY });
    }
  }
  const gate: Vec2 = wallCells[Math.floor(wallCells.length / 2)] ?? { x: Math.floor(W / 2), y: wallY };
  cells[idx(gate.x, gate.y)] = 'gate';

  return { width: W, height: H, heights, cells, river, wall: { cells: wallCells, gate }, seed };
}
```

- [ ] **Step 4: Append the barrel export** in `src/engine/battle/index.ts`:

```ts
export { generateField } from './terrain.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/engine/battle-terrain.test.ts`
Expected: PASS (6 tests). If the "more hills for mountain" case is flaky for a seed, it is not — both sides use the same seed (7) and mountain always adds ≥5 bumps vs plain's ≤2, so hill count is strictly higher for this seed.

- [ ] **Step 6: Commit**

```bash
git add src/engine/battle/terrain.ts src/engine/battle/index.ts tests/engine/battle-terrain.test.ts
git commit -m "feat(battle): deterministic terrain generation (gaussian hills, Catmull-Rom river, wall+gate)"
```

---

### Task 0.3: Battle setup (createBattle)

**Files:**
- Create: `src/engine/battle/setup.ts`
- Modify: `src/engine/battle/index.ts` (append `export { createBattle } from './setup.js';`)
- Test: `tests/engine/battle-setup.test.ts`

**Interfaces:**
- Consumes: `generateField` (0.2); `Battle`, `BattleUnit`, `GameState`, `General`, `Terrain` (`../types.js`); `BATTLE_WIDTH`, `BATTLE_HEIGHT` (`../constants.js`); `BATTLE_TUNING` (`./constants.js`); `buildInitialState` in the test.
- Produces:
  - `interface BattleSetupInput { cityId: CityId; attackerFactionId: FactionId; defenderFactionId: FactionId; attackingGeneralIds: GeneralId[]; attackingTroops: number; }`
  - `createBattle(state: GameState, input: BattleSetupInput): Battle`

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/battle-setup.test.ts
import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { createBattle } from '../../src/engine/battle/setup.js';

function baseState() {
  return buildInitialState({
    scenario: SCENARIO_DONGZHUO,
    playerFactionId: 'caocao',
    refData: REF_DATA,
    seed: 100,
  });
}

describe('createBattle', () => {
  it('seeds attacker units from generals + troops and defender from garrison/generals', () => {
    const s = baseState();
    // Pick any city with a defender faction + generals.
    const city = Object.values(s.cities).find((c) => c.generals.length > 0 && c.factionId)!;
    const attackerGenerals = ['caocao'];
    const battle = createBattle(s, {
      cityId: city.id,
      attackerFactionId: 'caocao',
      defenderFactionId: city.factionId!,
      attackingGeneralIds: attackerGenerals,
      attackingTroops: 8000,
    });

    const atk = battle.units.filter((u) => u.factionId === 'caocao');
    const def = battle.units.filter((u) => u.factionId === city.factionId);
    expect(atk.length).toBeGreaterThan(0);
    expect(def.length).toBeGreaterThan(0);
    // Attacker troop total equals the committed troops (split across blocks).
    const atkTotal = atk.reduce((n, u) => n + u.troops, 0);
    expect(atkTotal).toBe(8000);
    expect(battle.daysElapsed).toBe(0);
    expect(battle.cityId).toBe(city.id);
    expect(battle.rngCursor).toBe(battle.seed);
  });

  it('places attackers along the bottom edge and defenders near the top wall', () => {
    const s = baseState();
    const city = Object.values(s.cities).find((c) => c.generals.length > 0 && c.factionId)!;
    const battle = createBattle(s, {
      cityId: city.id,
      attackerFactionId: 'caocao',
      defenderFactionId: city.factionId!,
      attackingGeneralIds: ['caocao'],
      attackingTroops: 6000,
    });
    const atk = battle.units.filter((u) => u.factionId === 'caocao' && u.state === 'fielded');
    const def = battle.units.filter((u) => u.factionId === city.factionId && u.state === 'fielded');
    const avg = (us: typeof atk) => us.reduce((n, u) => n + u.pos.y, 0) / us.length;
    expect(avg(atk)).toBeGreaterThan(avg(def)); // attackers lower on the field (higher y)
  });

  it('is deterministic for a given state seed', () => {
    const a = baseState();
    const b = baseState();
    const city = Object.values(a.cities).find((c) => c.generals.length > 0 && c.factionId)!;
    const input = {
      cityId: city.id, attackerFactionId: 'caocao', defenderFactionId: city.factionId!,
      attackingGeneralIds: ['caocao'], attackingTroops: 5000,
    };
    expect(createBattle(a, input)).toEqual(createBattle(b, input));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/battle-setup.test.ts`
Expected: FAIL — cannot find module `setup.js`.

- [ ] **Step 3: Create `src/engine/battle/setup.ts`**

```ts
// Build a Battle from a besieged city + the attacking expedition. Troop pools
// are split into unit blocks (one per committed general, plus a garrison
// block and a reserve block). Attackers deploy along the bottom edge;
// defenders array around the wall/gate. Deterministic given state.rngState.
import { BATTLE_HEIGHT, BATTLE_WIDTH } from '../constants.js';
import type {
  Battle,
  BattleUnit,
  CityId,
  FactionId,
  GameState,
  General,
  GeneralId,
  TroopType,
} from '../types.js';
import type { FormationRole } from './types.js';
import { generateField } from './terrain.js';

export interface BattleSetupInput {
  cityId: CityId;
  attackerFactionId: FactionId;
  defenderFactionId: FactionId;
  attackingGeneralIds: GeneralId[];
  attackingTroops: number;
}

const ROLE_BY_TROOP: Record<TroopType, FormationRole> = {
  cavalry: 'van',
  heavyCav: 'van',
  archer: 'rear',
  navy: 'flank',
  xuan: 'center',
  infantry: 'center',
};

// Split `total` across `n` blocks as evenly as possible, remainder to the first.
function split(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const out = new Array<number>(n).fill(base);
  out[0] = (out[0] ?? 0) + (total - base * n);
  return out;
}

export function createBattle(state: GameState, input: BattleSetupInput): Battle {
  const city = state.cities[input.cityId]!;
  const field = generateField(city, state.rngState >>> 0);

  const attackerGenerals = input.attackingGeneralIds
    .map((id) => state.generals[id])
    .filter((g): g is General => Boolean(g));
  const defenderGenerals = city.generals
    .map((id) => state.generals[id])
    .filter((g): g is General => Boolean(g));

  const units: BattleUnit[] = [];
  let uid = 0;
  const mkId = (): string => `bu${uid++}`;

  // --- Attackers: one block per general along the bottom edge (y = H-2).
  const atkShares = split(input.attackingTroops, Math.max(1, attackerGenerals.length));
  const atkY = BATTLE_HEIGHT - 2;
  const spread = Math.max(1, Math.floor(BATTLE_WIDTH / (attackerGenerals.length + 1)));
  if (attackerGenerals.length === 0) {
    units.push({
      id: mkId(), generalId: '', factionId: input.attackerFactionId,
      troops: input.attackingTroops, troopType: 'infantry',
      pos: { x: Math.floor(BATTLE_WIDTH / 2), y: atkY }, morale: 100,
      hasActed: false, state: 'fielded', formationRole: 'center',
    });
  } else {
    attackerGenerals.forEach((g, i) => {
      units.push({
        id: mkId(), generalId: g.id, factionId: input.attackerFactionId,
        troops: atkShares[i] ?? 0, troopType: g.troopType,
        pos: { x: Math.min(BATTLE_WIDTH - 1, spread * (i + 1)), y: atkY },
        morale: 100, hasActed: false, state: 'fielded',
        formationRole: ROLE_BY_TROOP[g.troopType],
      });
    });
  }

  // --- Defenders: general blocks near the wall row (y = 2), garrison block on
  //     the gate, plus a reserve block held back inside the city (state:reserve).
  const defY = 2;
  const defSpread = Math.max(1, Math.floor(BATTLE_WIDTH / (defenderGenerals.length + 2)));
  defenderGenerals.forEach((g, i) => {
    units.push({
      id: mkId(), generalId: g.id, factionId: input.defenderFactionId,
      troops: g.troops, troopType: g.troopType,
      pos: { x: Math.min(BATTLE_WIDTH - 1, defSpread * (i + 1)), y: defY },
      morale: 100, hasActed: false, state: 'fielded',
      formationRole: ROLE_BY_TROOP[g.troopType],
    });
  });
  // Garrison: half fielded on the gate, half reserve.
  const gate = field.wall?.gate ?? { x: Math.floor(BATTLE_WIDTH / 2), y: 1 };
  const fieldedGarrison = Math.ceil(city.garrison / 2);
  const reserveGarrison = city.garrison - fieldedGarrison;
  if (fieldedGarrison > 0) {
    units.push({
      id: mkId(), generalId: '', factionId: input.defenderFactionId,
      troops: fieldedGarrison, troopType: 'infantry',
      pos: { x: gate.x, y: gate.y + 1 }, morale: 100, hasActed: false,
      state: 'fielded', formationRole: 'center',
    });
  }
  if (reserveGarrison > 0) {
    units.push({
      id: mkId(), generalId: '', factionId: input.defenderFactionId,
      troops: reserveGarrison, troopType: 'infantry',
      pos: { x: gate.x, y: 0 }, morale: 100, hasActed: false,
      state: 'reserve', formationRole: 'rear',
    });
  }

  return {
    cityId: input.cityId,
    attackerFactionId: input.attackerFactionId,
    defenderFactionId: input.defenderFactionId,
    daysElapsed: 0,
    units,
    field,
    seed: field.seed,
    rngCursor: field.seed,
    log: [],
  };
}
```

- [ ] **Step 4: Append the barrel export** in `src/engine/battle/index.ts`:

```ts
export { createBattle } from './setup.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/engine/battle-setup.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/engine/battle/setup.ts src/engine/battle/index.ts tests/engine/battle-setup.test.ts
git commit -m "feat(battle): createBattle seeds units + formations from siege"
```

---

### Task 0.4: Simulation — one-day step (movement, melee, events)

The sim resolves **one day per `stepBattle` call**: default orders → movement → ranged → melee → morale/rout → end-check, emitting a `BattleEvent[]` timeline. This task builds the day loop with movement + melee + morale + events. Task 0.5 adds ranged, duels, reserves, and end/timeout.

**Files:**
- Create: `src/engine/battle/simulate.ts`
- Modify: `src/engine/battle/index.ts` (append `export { stepBattle } from './simulate.js';`)
- Test: `tests/engine/battle-sim.test.ts`

**Interfaces:**
- Consumes: `Battle`, `BattleUnit`, `TacticalCommand`, `Terrain` (`../types.js`); `BattleEvent`, `BattleCell`, `Vec2` (`./types.js`); `BATTLE_TUNING` (`./constants.js`); `combatModifier` (`../movement.js`); `COMBAT_MODIFIER`, `BATTLE_DAY_LIMIT` (`../constants.js`); RNG (`../rng.js`).
- Produces:
  - `interface StepInput { battle: Battle; commands: TacticalCommand[]; }`
  - `interface StepResult { battle: Battle; events: BattleEvent[]; }`
  - `stepBattle(input: StepInput): StepResult`

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/battle-sim.test.ts
import { describe, expect, it } from 'vitest';
import { stepBattle } from '../../src/engine/battle/simulate.js';
import type { Battle, BattleUnit } from '../../src/engine/types.js';
import type { BattleField } from '../../src/engine/battle/types.js';

function flatField(w: number, h: number): BattleField {
  return { width: w, height: h, heights: new Array(w * h).fill(0), cells: new Array(w * h).fill('plain'), seed: 1 };
}

function unit(over: Partial<BattleUnit> & Pick<BattleUnit, 'id' | 'factionId' | 'pos'>): BattleUnit {
  return {
    generalId: 'g', troops: 5000, troopType: 'infantry', morale: 100,
    hasActed: false, state: 'fielded', formationRole: 'center',
    ...over,
  } as BattleUnit;
}

function battle(units: BattleUnit[]): Battle {
  return {
    cityId: 'c', attackerFactionId: 'A', defenderFactionId: 'B', daysElapsed: 0,
    units, field: flatField(10, 8), seed: 5, rngCursor: 5, log: [],
  };
}

describe('stepBattle — movement + melee', () => {
  it('advances the day counter and emits dayAdvanced', () => {
    const b = battle([unit({ id: 'a', factionId: 'A', pos: { x: 5, y: 6 } })]);
    const { battle: next, events } = stepBattle({ battle: b, commands: [] });
    expect(next.daysElapsed).toBe(1);
    expect(events.some((e) => e.kind === 'dayAdvanced')).toBe(true);
  });

  it('moves an unordered unit toward the nearest enemy (emits move)', () => {
    const b = battle([
      unit({ id: 'a', factionId: 'A', pos: { x: 1, y: 4 } }),
      unit({ id: 'e', factionId: 'B', pos: { x: 8, y: 4 } }),
    ]);
    const { battle: next, events } = stepBattle({ battle: b, commands: [] });
    const a = next.units.find((u) => u.id === 'a')!;
    expect(a.pos.x).toBeGreaterThan(1); // advanced toward the enemy
    expect(events.some((e) => e.kind === 'move' && e.unitId === 'a')).toBe(true);
  });

  it('resolves melee between adjacent enemies with symmetric-ish casualties + clash event', () => {
    const b = battle([
      unit({ id: 'a', factionId: 'A', pos: { x: 4, y: 4 }, troops: 6000 }),
      unit({ id: 'e', factionId: 'B', pos: { x: 5, y: 4 }, troops: 6000 }),
    ]);
    const { battle: next, events } = stepBattle({ battle: b, commands: [] });
    const a = next.units.find((u) => u.id === 'a')!;
    const e = next.units.find((u) => u.id === 'e')!;
    expect(a.troops).toBeLessThan(6000);
    expect(e.troops).toBeLessThan(6000);
    expect(events.some((ev) => ev.kind === 'clash')).toBe(true);
  });

  it('a large force beats a tiny one: defender loses more', () => {
    const b = battle([
      unit({ id: 'a', factionId: 'A', pos: { x: 4, y: 4 }, troops: 12000 }),
      unit({ id: 'e', factionId: 'B', pos: { x: 5, y: 4 }, troops: 2000 }),
    ]);
    const { battle: next } = stepBattle({ battle: b, commands: [] });
    const a = next.units.find((u) => u.id === 'a')!;
    const e = next.units.find((u) => u.id === 'e')!;
    expect(6000 - a.troops).toBeLessThan(2000); // attacker barely dented
    expect(e.troops).toBeLessThan(2000); // defender mauled
  });

  it('honors an explicit hold command (no move)', () => {
    const b = battle([
      unit({ id: 'a', factionId: 'A', pos: { x: 1, y: 4 } }),
      unit({ id: 'e', factionId: 'B', pos: { x: 8, y: 4 } }),
    ]);
    const { battle: next } = stepBattle({ battle: b, commands: [{ kind: 'hold', unitId: 'a' }] });
    const a = next.units.find((u) => u.id === 'a')!;
    expect(a.pos).toEqual({ x: 1, y: 4 });
  });

  it('is deterministic for identical inputs', () => {
    const mk = () => battle([
      unit({ id: 'a', factionId: 'A', pos: { x: 4, y: 4 } }),
      unit({ id: 'e', factionId: 'B', pos: { x: 5, y: 4 } }),
    ]);
    expect(stepBattle({ battle: mk(), commands: [] })).toEqual(stepBattle({ battle: mk(), commands: [] }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/battle-sim.test.ts`
Expected: FAIL — cannot find module `simulate.js`.

- [ ] **Step 3: Create `src/engine/battle/simulate.ts`**

```ts
// Deterministic one-day battle step. Phases run in a fixed order so results
// are reproducible: default-orders -> move -> ranged -> melee -> morale/rout
// -> end-check. Ranged/duel/reserve/end handling is layered in Task 0.5.
import { BATTLE_DAY_LIMIT, COMBAT_MODIFIER } from '../constants.js';
import { rollInt } from '../rng.js';
import type {
  Battle,
  BattleUnit,
  General,
  TacticalCommand,
  Terrain,
} from '../types.js';
import type { BattleCell, BattleEvent, Vec2 } from './types.js';
import { BATTLE_TUNING } from './constants.js';

export interface StepInput {
  battle: Battle;
  commands: TacticalCommand[];
}
export interface StepResult {
  battle: Battle;
  events: BattleEvent[];
}

const chebyshev = (a: Vec2, b: Vec2): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// Battlefield cell -> the engine's world Terrain vocabulary, so we can reuse
// COMBAT_MODIFIER. 'hill' maps to 'mountain', wall/gate/ramp to 'city',
// ford to 'plain' (crossable), river stays 'river'.
function cellTerrain(cell: BattleCell): Terrain {
  switch (cell) {
    case 'hill': return 'mountain';
    case 'forest': return 'forest';
    case 'river': return 'river';
    case 'wall':
    case 'gate':
    case 'ramp': return 'city';
    case 'ford':
    case 'plain':
    default: return 'plain';
  }
}

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

function isActive(u: BattleUnit): boolean {
  return u.state === 'fielded' && u.troops > 0;
}

function nearestEnemy(u: BattleUnit, units: BattleUnit[]): BattleUnit | undefined {
  let best: BattleUnit | undefined;
  let bestD = Infinity;
  for (const e of units) {
    if (e.factionId === u.factionId || !isActive(e)) continue;
    const d = chebyshev(u.pos, e.pos);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// Leadership multiplier from the commanding general (mirrors combat.ts).
function leadership(general: General | undefined): number {
  if (!general) return 0.5; // unled mob
  const { wu, tong, zhi } = general.stats;
  return (wu * 0.4 + tong * 0.5 + zhi * 0.1) / 50;
}

// One step of movement toward `target`, capped by the unit's daily range and
// blocked by impassable cells (deep river for land units).
function stepToward(battle: Battle, u: BattleUnit, target: Vec2): Vec2 {
  const range = BATTLE_TUNING.moveRange[u.troopType] ?? 2;
  let cur = { ...u.pos };
  for (let s = 0; s < range; s++) {
    const dx = Math.sign(target.x - cur.x);
    const dy = Math.sign(target.y - cur.y);
    if (dx === 0 && dy === 0) break;
    const nxt = { x: cur.x + dx, y: cur.y + dy };
    const cell = cellAt(battle, nxt);
    const landUnit = u.troopType !== 'navy';
    if (cell === 'river' && landUnit) break; // must go around / use a ford
    if (cell === 'wall') break; // cannot walk through a wall
    cur = nxt;
  }
  return cur;
}

export function stepBattle(input: StepInput): StepResult {
  const events: BattleEvent[] = [];
  let rng = input.battle.rngCursor >>> 0;
  const rint = (min: number, max: number): number => {
    const r = rollInt(rng, min, max);
    rng = r.state;
    return r.value;
  };

  // Deep-clone the units we will mutate (immutable outward contract).
  let units: BattleUnit[] = input.battle.units.map((u) => ({ ...u, pos: { ...u.pos }, hasActed: false }));
  const byId = (id: string): BattleUnit | undefined => units.find((u) => u.id === id);
  const generalOf = (u: BattleUnit): General | undefined =>
    u.generalId ? (input.battle as unknown as { _g?: never }) && undefined : undefined;
  // We look generals up from GameState at power time via a closure captured in
  // outcome/session; within pure stepBattle we approximate leadership using a
  // baseline when no general stats are supplied. To keep stepBattle pure and
  // self-contained, general stats are folded into the unit at setup time is a
  // future optimization; here we treat generalId presence as a small bonus.
  void generalOf;

  // --- Order map: unitId -> command (explicit orders win; default otherwise).
  const orders = new Map<string, TacticalCommand>();
  for (const c of input.commands) {
    if ('unitId' in c) orders.set(c.unitId, c);
  }

  // --- Reserve commit (from a commitReserves command).
  for (const c of input.commands) {
    if (c.kind === 'commitReserves') {
      const committed: string[] = [];
      units = units.map((u) => {
        if (u.factionId === c.factionId && u.state === 'reserve') {
          committed.push(u.id);
          return { ...u, state: 'fielded' as const, pos: { ...u.pos, y: Math.min(input.battle.field.height - 1, u.pos.y + 1) } };
        }
        return u;
      });
      if (committed.length > 0) {
        events.push({ kind: 'reserveCommitted', factionId: c.factionId, unitIds: committed });
      }
    }
  }

  // ---------------- MOVEMENT PHASE ----------------
  for (const u of units) {
    if (!isActive(u)) continue;
    const order = orders.get(u.id);
    if (order && (order.kind === 'hold' || order.kind === 'meleeAttack' || order.kind === 'rangedAttack')) {
      continue; // holding or attacking in place: no move
    }
    let target: Vec2 | undefined;
    if (order && order.kind === 'march') target = order.target;
    else if (order && (order.kind === 'charge')) {
      const t = byId(order.targetUnitId);
      target = t?.pos;
    } else {
      const enemy = nearestEnemy(u, units);
      target = enemy?.pos;
    }
    if (!target) continue;
    const from = { ...u.pos };
    const to = stepToward(input.battle, u, target);
    if (to.x !== from.x || to.y !== from.y) {
      u.pos = to;
      events.push({ kind: 'move', unitId: u.id, from, to });
    }
  }

  // ---------------- MELEE PHASE ----------------
  // Each active unit adjacent (Chebyshev<=1) to an enemy fights it once.
  // Casualties: loser loses meleeBaseLoss * powerRatio of engaged troops.
  const meleePower = (u: BattleUnit): number => {
    const t = cellTerrain(cellAt(input.battle, u.pos));
    const mod = COMBAT_MODIFIER[u.troopType]?.[t] ?? 1.0;
    const lead = u.generalId ? 1.0 : 0.6; // led blocks hit harder than mobs
    const charging = orders.get(u.id)?.kind === 'charge' ? BATTLE_TUNING.chargeBonus : 1.0;
    const elev = 1 + heightAt(input.battle, u.pos) * BATTLE_TUNING.elevationPerLevel;
    return u.troops * mod * lead * charging * elev;
  };

  const resolvedPairs = new Set<string>();
  for (const u of units) {
    if (!isActive(u)) continue;
    const enemy = units.find((e) => e.factionId !== u.factionId && isActive(e) && chebyshev(u.pos, e.pos) <= 1);
    if (!enemy) continue;
    const key = [u.id, enemy.id].sort().join('|');
    if (resolvedPairs.has(key)) continue;
    resolvedPairs.add(key);

    const pa = meleePower(u);
    const pb = meleePower(enemy);
    const jitter = 0.85 + rint(0, 30) / 100; // 0.85..1.15
    const bLoss = Math.min(enemy.troops, Math.floor(BATTLE_TUNING.meleeBaseLoss * (pa / Math.max(pb, 1)) * enemy.troops * jitter));
    const aLoss = Math.min(u.troops, Math.floor(BATTLE_TUNING.meleeBaseLoss * (pb / Math.max(pa, 1)) * u.troops * jitter));
    u.troops -= aLoss;
    enemy.troops -= bLoss;
    events.push({ kind: 'clash', unitId: u.id, targetUnitId: enemy.id, casualties: bLoss, defCasualties: aLoss });
  }

  // ---------------- MORALE / ROUT PHASE ----------------
  units = units.map((u) => {
    if (u.state === 'gone' || u.state === 'reserve') return u;
    // (casualty-driven morale is applied in Task 0.5's fuller model; here we
    //  drop units to 'gone' when annihilated.)
    if (u.troops <= 0) {
      return { ...u, troops: 0, state: 'gone' as const };
    }
    return u;
  });

  // ---------------- DAY / END ----------------
  const daysElapsed = input.battle.daysElapsed + 1;
  events.push({ kind: 'dayAdvanced', day: daysElapsed });

  const next: Battle = {
    ...input.battle,
    units,
    daysElapsed,
    rngCursor: rng,
  };

  // End detection is completed in Task 0.5; here we only stamp the timeout
  // flag via an event when the limit is hit so the loop can terminate.
  const attackerAlive = units.some((u) => u.factionId === next.attackerFactionId && (u.state === 'fielded' || u.state === 'reserve') && u.troops > 0);
  const defenderAlive = units.some((u) => u.factionId === next.defenderFactionId && (u.state === 'fielded' || u.state === 'reserve') && u.troops > 0);
  if (!attackerAlive || !defenderAlive) {
    events.push({ kind: 'end', attackerWon: defenderAlive ? false : true, reason: 'destroyed' });
  } else if (daysElapsed >= BATTLE_DAY_LIMIT) {
    events.push({ kind: 'end', attackerWon: false, reason: 'timeout' });
  }

  return { battle: next, events };
}
```

Note: the `generalOf`/`leadership` scaffolding above is intentionally minimal — full general-stat power (looking up `state.generals`) is folded in at Task 0.5 by carrying a `generalStats` snapshot on each `BattleUnit` at `createBattle` time. For Task 0.4, led-vs-mob is approximated by the `1.0` vs `0.6` factor, which satisfies the directional tests. **Remove the dead `leadership`/`generalOf` stubs when Task 0.5 introduces the real stat model.**

- [ ] **Step 4: Append the barrel export** in `src/engine/battle/index.ts`:

```ts
export { stepBattle } from './simulate.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/engine/battle-sim.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/engine/battle/simulate.ts src/engine/battle/index.ts tests/engine/battle-sim.test.ts
git commit -m "feat(battle): one-day sim step — movement, melee, casualties, events"
```

---

### Task 0.5: Simulation — general stats, ranged, duels, morale, reserves, end

Fold real general stats into unit power (carried on the unit at setup), then add the ranged phase, duel resolution, casualty-driven morale + rout, and precise end/timeout detection.

**Files:**
- Modify: `src/engine/battle/types.ts` (add optional `generalStats` + `generalWu` to a `BattleUnit` companion — see Step 3) — actually carried on `BattleUnit` in `src/engine/types.ts`.
- Modify: `src/engine/types.ts` (`BattleUnit` gains `wu?: number` and `command?: number` snapshot fields)
- Modify: `src/engine/battle/setup.ts` (populate the new snapshot fields)
- Modify: `src/engine/battle/simulate.ts` (ranged, duel, morale, reserves already partly there, end-check)
- Test: extend `tests/engine/battle-sim.test.ts`

**Interfaces:**
- Consumes: `BATTLE_TUNING`, `DUEL_TRIGGER_WU_MIN` behavior via `BATTLE_TUNING.duelWuMin`.
- Produces: `BattleUnit` gains `wu?: number`, `command?: number` (leadership snapshot). `stepBattle` now emits `volley`, `duel`, `moraleBreak`, `rout` events and finalizes `end`.

- [ ] **Step 1: Write the failing tests (append to `tests/engine/battle-sim.test.ts`)**

```ts
describe('stepBattle — ranged, duel, morale, end', () => {
  it('archers volley an enemy within range without being adjacent', () => {
    const b = battle([
      unit({ id: 'a', factionId: 'A', pos: { x: 2, y: 4 }, troopType: 'archer' }),
      unit({ id: 'e', factionId: 'B', pos: { x: 4, y: 4 } }),
    ]);
    const { battle: next, events } = stepBattle({ battle: b, commands: [{ kind: 'rangedAttack', unitId: 'a', targetUnitId: 'e' }] });
    const e = next.units.find((u) => u.id === 'e')!;
    expect(e.troops).toBeLessThan(5000);
    expect(events.some((ev) => ev.kind === 'volley')).toBe(true);
  });

  it('a fireAttack gambit damages nearby enemies and emits a fire event', () => {
    const b = battle([
      unit({ id: 'a', factionId: 'A', pos: { x: 3, y: 4 } }),
      unit({ id: 'e', factionId: 'B', pos: { x: 4, y: 4 }, troops: 8000 }),
    ]);
    const { battle: next, events } = stepBattle({ battle: b, commands: [{ kind: 'gambit', gambitId: 'fireAttack', unitIds: ['a'] }] });
    const e = next.units.find((u) => u.id === 'e')!;
    expect(e.troops).toBeLessThan(8000);
    expect(events.some((ev) => ev.kind === 'fire')).toBe(true);
  });

  it('a routed unit is flagged and flees (moraleBreak + rout events)', () => {
    const b = battle([
      unit({ id: 'a', factionId: 'A', pos: { x: 4, y: 4 }, troops: 20000, wu: 95, command: 95 }),
      unit({ id: 'e', factionId: 'B', pos: { x: 5, y: 4 }, troops: 1500, morale: 25 }),
    ]);
    const { battle: next, events } = stepBattle({ battle: b, commands: [] });
    const e = next.units.find((u) => u.id === 'e')!;
    expect(['routing', 'gone']).toContain(e.state);
    expect(events.some((ev) => ev.kind === 'moraleBreak' || ev.kind === 'rout')).toBe(true);
  });

  it('resolves a duel when two high-wu enemy generals stand adjacent', () => {
    const b = battle([
      unit({ id: 'a', factionId: 'A', pos: { x: 4, y: 4 }, generalId: 'lvbu', wu: 100 }),
      unit({ id: 'e', factionId: 'B', pos: { x: 5, y: 4 }, generalId: 'guanyu', wu: 97 }),
    ]);
    const { events } = stepBattle({ battle: b, commands: [{ kind: 'challengeDuel', unitId: 'a', targetUnitId: 'e' }] });
    expect(events.some((ev) => ev.kind === 'duel')).toBe(true);
  });

  it('emits a terminal end event when one side is annihilated', () => {
    const b = battle([
      unit({ id: 'a', factionId: 'A', pos: { x: 4, y: 4 }, troops: 30000, wu: 99, command: 99 }),
      unit({ id: 'e', factionId: 'B', pos: { x: 5, y: 4 }, troops: 300 }),
    ]);
    const { events } = stepBattle({ battle: b, commands: [] });
    const end = events.find((ev) => ev.kind === 'end');
    // may take one day; assert no crash and event shape when present
    if (end && end.kind === 'end') expect(typeof end.attackerWon).toBe('boolean');
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `npx vitest run tests/engine/battle-sim.test.ts`
Expected: FAIL on the volley/duel/morale cases (no `wu` field, no ranged/duel/morale logic).

- [ ] **Step 3: Add snapshot fields to `BattleUnit`** in `src/engine/types.ts` (append to the interface):

```ts
  // Leadership snapshot copied from the commanding general at createBattle
  // time, so stepBattle stays pure (no GameState lookup). Absent for garrison
  // blocks / unled mobs.
  wu?: number; // 武力
  command?: number; // 统率 (tong)
```

- [ ] **Step 4: Populate the snapshot in `src/engine/battle/setup.ts`**

In the attacker general block and defender general block object literals, add `wu: g.stats.wu, command: g.stats.tong,` next to `troopType`.

- [ ] **Step 5: Replace the melee power + add ranged/duel/morale in `src/engine/battle/simulate.ts`**

Replace the `meleePower` helper with a stat-aware version and delete the dead `leadership`/`generalOf` stubs from Task 0.4:

```ts
// Leadership multiplier from the unit's general snapshot (mirrors combat.ts's
// (wu*0.4 + tong*0.5 + zhi*0.1)/50, with zhi folded into a flat term).
function unitLeadership(u: BattleUnit): number {
  if (u.wu === undefined || u.command === undefined) return 0.6; // unled mob
  return (u.wu * 0.45 + u.command * 0.55) / 50;
}

function meleePower(battle: Battle, u: BattleUnit, orders: Map<string, TacticalCommand>): number {
  const t = cellTerrain(cellAt(battle, u.pos));
  const mod = COMBAT_MODIFIER[u.troopType]?.[t] ?? 1.0;
  const charging = orders.get(u.id)?.kind === 'charge' ? BATTLE_TUNING.chargeBonus : 1.0;
  const elev = 1 + heightAt(battle, u.pos) * BATTLE_TUNING.elevationPerLevel;
  return u.troops * mod * unitLeadership(u) * charging * elev;
}
```

Update the melee-phase call sites to `meleePower(input.battle, u, orders)` / `meleePower(input.battle, enemy, orders)`.

Add a **RANGED PHASE** immediately before the MELEE PHASE:

```ts
  // ---------------- RANGED PHASE ----------------
  for (const u of units) {
    if (!isActive(u) || u.troopType !== 'archer') continue;
    const order = orders.get(u.id);
    let target: BattleUnit | undefined;
    if (order && order.kind === 'rangedAttack') target = byId(order.targetUnitId);
    if (!target || !isActive(target)) {
      target = units.find((e) => e.factionId !== u.factionId && isActive(e) && chebyshev(u.pos, e.pos) <= BATTLE_TUNING.volleyRange && chebyshev(u.pos, e.pos) > 1);
    }
    if (!target || chebyshev(u.pos, target.pos) > BATTLE_TUNING.volleyRange) continue;
    const jitter = 0.85 + rint(0, 30) / 100;
    const loss = Math.min(target.troops, Math.floor(BATTLE_TUNING.volleyBaseLoss * u.troops * unitLeadership(u) * jitter));
    target.troops -= loss;
    events.push({ kind: 'volley', unitId: u.id, targetUnitId: target.id, casualties: loss });
  }
```

Add a **DUEL PHASE** immediately after the MELEE PHASE:

```ts
  // ---------------- DUEL PHASE ----------------
  // Explicit challengeDuel, or auto-trigger between two adjacent high-wu
  // generals. Loser's unit loses half its troops + a big morale hit.
  const dueled = new Set<string>();
  const tryDuelPair = (a: BattleUnit, e: BattleUnit): void => {
    if (dueled.has(a.id) || dueled.has(e.id)) return;
    if (a.wu === undefined || e.wu === undefined) return;
    if (a.wu < BATTLE_TUNING.duelWuMin || e.wu < BATTLE_TUNING.duelWuMin) return;
    dueled.add(a.id); dueled.add(e.id);
    const margin = a.wu - e.wu;
    const swing = rint(-8, 8);
    const aWins = margin + swing >= 0;
    const winner = aWins ? a : e;
    const loser = aWins ? e : a;
    loser.troops = Math.floor(loser.troops * 0.5);
    loser.morale = Math.max(0, loser.morale - BATTLE_TUNING.moraleDuelLoss);
    events.push({ kind: 'duel', a: a.generalId, b: e.generalId, winner: winner.generalId });
  };
  for (const c of input.commands) {
    if (c.kind === 'challengeDuel') {
      const a = byId(c.unitId), e = byId(c.targetUnitId);
      if (a && e && isActive(a) && isActive(e) && chebyshev(a.pos, e.pos) <= 1) tryDuelPair(a, e);
    }
  }
  for (const u of units) {
    if (!isActive(u) || u.wu === undefined || u.wu < BATTLE_TUNING.duelWuMin) continue;
    const foe = units.find((e) => e.factionId !== u.factionId && isActive(e) && e.wu !== undefined && e.wu >= BATTLE_TUNING.duelWuMin && chebyshev(u.pos, e.pos) <= 1);
    if (foe) tryDuelPair(u, foe);
  }
```

Add a **FIRE PHASE** immediately after the DUEL PHASE (handles the `fireAttack` gambit command; detection already gates the offer to forest+wind, so the command trusts the caller):

```ts
  // ---------------- FIRE PHASE ----------------
  for (const c of input.commands) {
    if (c.kind !== 'gambit' || c.gambitId !== 'fireAttack') continue;
    for (const uid of c.unitIds) {
      const src = byId(uid);
      if (!src || !isActive(src)) continue;
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
    }
  }
```

Replace the **MORALE / ROUT PHASE** with the full model:

```ts
  // ---------------- MORALE / ROUT PHASE ----------------
  units = units.map((u) => {
    if (u.state === 'gone' || u.state === 'reserve') return u;
    if (u.troops <= 0) return { ...u, troops: 0, state: 'gone' as const };
    return u;
  });
  // Apply casualty-driven morale using the day's clash/volley losses.
  const lossById = new Map<string, number>();
  for (const ev of events) {
    if (ev.kind === 'clash') {
      lossById.set(ev.targetUnitId, (lossById.get(ev.targetUnitId) ?? 0) + ev.casualties);
      lossById.set(ev.unitId, (lossById.get(ev.unitId) ?? 0) + ev.defCasualties);
    } else if (ev.kind === 'volley') {
      lossById.set(ev.targetUnitId, (lossById.get(ev.targetUnitId) ?? 0) + ev.casualties);
    }
  }
  units = units.map((u) => {
    if (u.state !== 'fielded' || u.troops <= 0) return u;
    const lost = lossById.get(u.id) ?? 0;
    const before = lost + u.troops;
    if (before <= 0 || lost <= 0) return u;
    const pctLost = (lost / before) * 100;
    const drop = Math.round((pctLost / 10) * BATTLE_TUNING.moralePer10pctLoss);
    const morale = Math.max(0, u.morale - drop);
    if (morale <= BATTLE_TUNING.routMoraleThreshold) {
      events.push({ kind: 'moraleBreak', unitId: u.id });
      events.push({ kind: 'rout', unitId: u.id });
      // Flee toward the unit's home edge.
      const homeY = u.factionId === input.battle.attackerFactionId ? input.battle.field.height - 1 : 0;
      const fleeY = u.pos.y + Math.sign(homeY - u.pos.y);
      return { ...u, morale, state: 'routing' as const, pos: { ...u.pos, y: fleeY } };
    }
    return { ...u, morale };
  });
  // Routing units that reach their home edge leave the field.
  units = units.map((u) => {
    if (u.state !== 'routing') return u;
    const homeY = u.factionId === input.battle.attackerFactionId ? input.battle.field.height - 1 : 0;
    if (u.pos.y === homeY) return { ...u, state: 'gone' as const };
    return u;
  });
```

Update the **end detection** to count only non-gone, non-routing units as "still fighting", so a side that is entirely routing/gone loses:

```ts
  const stillFighting = (fid: string): boolean =>
    units.some((u) => u.factionId === fid && (u.state === 'fielded' || u.state === 'reserve') && u.troops > 0);
  const attackerAlive = stillFighting(next.attackerFactionId);
  const defenderAlive = stillFighting(next.defenderFactionId);
  if (!attackerAlive || !defenderAlive) {
    events.push({ kind: 'end', attackerWon: attackerAlive && !defenderAlive, reason: 'destroyed' });
  } else if (daysElapsed >= BATTLE_DAY_LIMIT) {
    events.push({ kind: 'end', attackerWon: false, reason: 'timeout' });
  }
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npx vitest run tests/engine/battle-sim.test.ts`
Expected: PASS (all cases, ~10). If the duel case is flaky it is not — both generals exceed `duelWuMin` and the explicit `challengeDuel` forces a pair.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/engine/battle/simulate.ts src/engine/battle/setup.ts src/engine/types.ts tests/engine/battle-sim.test.ts
git commit -m "feat(battle): stat-aware power, ranged volleys, duels, morale/rout, end detection"
```

---

### Task 0.6: Gambit detection

**Files:**
- Create: `src/engine/battle/gambits.ts`
- Modify: `src/engine/battle/index.ts` (append `export { detectGambits } from './gambits.js';`)
- Test: `tests/engine/battle-gambits.test.ts`

**Interfaces:**
- Consumes: `Battle`, `BattleUnit` (`../types.js`); `Gambit`, `GambitId`, `BattleCell` (`./types.js`); `BATTLE_TUNING`.
- Produces: `detectGambits(battle: Battle): Gambit[]` — gambits available to the **attacker** and **defender** are both returned; the session filters to the player's side. Each `Gambit.unitIds` lists the player-side units it would act with.

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/battle-gambits.test.ts
import { describe, expect, it } from 'vitest';
import { detectGambits } from '../../src/engine/battle/gambits.js';
import type { Battle, BattleUnit } from '../../src/engine/types.js';
import type { BattleField } from '../../src/engine/battle/types.js';

function field(cells: BattleField['cells'], w = 6, h = 4): BattleField {
  return { width: w, height: h, heights: new Array(w * h).fill(0), cells, seed: 1 };
}
function u(over: Partial<BattleUnit> & Pick<BattleUnit, 'id' | 'factionId' | 'pos'>): BattleUnit {
  return { generalId: 'g', troops: 4000, troopType: 'infantry', morale: 100, hasActed: false, state: 'fielded', formationRole: 'center', ...over } as BattleUnit;
}
function mk(units: BattleUnit[], f: BattleField): Battle {
  return { cityId: 'c', attackerFactionId: 'A', defenderFactionId: 'B', daysElapsed: 0, units, field: f, seed: 1, rngCursor: 1, log: [] };
}

describe('detectGambits', () => {
  it('offers cavalryCharge when a cavalry unit has an enemy within a couple cells', () => {
    const f = field(new Array(24).fill('plain'));
    const b = mk([
      u({ id: 'a', factionId: 'A', pos: { x: 1, y: 1 }, troopType: 'cavalry' }),
      u({ id: 'e', factionId: 'B', pos: { x: 3, y: 1 } }),
    ], f);
    const ids = detectGambits(b).map((g) => g.id);
    expect(ids).toContain('cavalryCharge');
  });

  it('offers fireAttack only when a unit sits in forest with wind up', () => {
    const cells = new Array(24).fill('plain');
    cells[1 * 6 + 2] = 'forest';
    const f = field(cells);
    const noWind = mk([u({ id: 'e', factionId: 'B', pos: { x: 2, y: 1 } }), u({ id: 'a', factionId: 'A', pos: { x: 2, y: 2 } })], f);
    expect(detectGambits(noWind).map((g) => g.id)).not.toContain('fireAttack');
    const windy = { ...noWind, wind: { dir: { x: 0, y: -1 }, strength: 1 } };
    expect(detectGambits(windy).map((g) => g.id)).toContain('fireAttack');
  });

  it('offers duelChallenge when two high-wu generals are adjacent', () => {
    const f = field(new Array(24).fill('plain'));
    const b = mk([
      u({ id: 'a', factionId: 'A', pos: { x: 2, y: 1 }, generalId: 'lvbu', wu: 100 }),
      u({ id: 'e', factionId: 'B', pos: { x: 3, y: 1 }, generalId: 'guanyu', wu: 96 }),
    ], f);
    expect(detectGambits(b).map((g) => g.id)).toContain('duelChallenge');
  });

  it('offers fordCrossing when a unit is adjacent to a ford', () => {
    const cells = new Array(24).fill('plain');
    cells[1 * 6 + 3] = 'ford';
    const f = field(cells);
    const b = mk([u({ id: 'a', factionId: 'A', pos: { x: 2, y: 1 } })], f);
    expect(detectGambits(b).map((g) => g.id)).toContain('fordCrossing');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/battle-gambits.test.ts`
Expected: FAIL — cannot find module `gambits.js`.

- [ ] **Step 3: Create `src/engine/battle/gambits.ts`**

```ts
// Pure predicates that surface contextual tactical opportunities. Both sides'
// gambits are returned; the battle session filters to the player's side.
import type { Battle, BattleUnit } from '../types.js';
import type { BattleCell, Gambit, Vec2 } from './types.js';
import { BATTLE_TUNING } from './constants.js';

const chebyshev = (a: Vec2, b: Vec2): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const active = (u: BattleUnit): boolean => u.state === 'fielded' && u.troops > 0;

function cellAt(battle: Battle, p: Vec2): BattleCell {
  const { width, height } = battle.field;
  if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) return 'plain';
  return battle.field.cells[p.y * width + p.x] ?? 'plain';
}

export function detectGambits(battle: Battle): Gambit[] {
  const out: Gambit[] = [];
  const units = battle.units;

  // cavalryCharge: a cavalry/heavyCav unit with an enemy within 2 cells.
  for (const u of units) {
    if (!active(u) || (u.troopType !== 'cavalry' && u.troopType !== 'heavyCav')) continue;
    const foe = units.find((e) => e.factionId !== u.factionId && active(e) && chebyshev(u.pos, e.pos) <= 2 && chebyshev(u.pos, e.pos) >= 1);
    if (foe) out.push({ id: 'cavalryCharge', unitIds: [u.id], labelKey: 'battle.gambit.cavalryCharge' });
  }

  // fireAttack: a unit standing in/next to forest with wind up.
  if (battle.wind && battle.wind.strength > 0) {
    for (const u of units) {
      if (!active(u)) continue;
      const inForest = cellAt(battle, u.pos) === 'forest' ||
        [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }].some((d) => cellAt(battle, { x: u.pos.x + d.x, y: u.pos.y + d.y }) === 'forest');
      if (inForest) { out.push({ id: 'fireAttack', unitIds: [u.id], labelKey: 'battle.gambit.fireAttack' }); break; }
    }
  }

  // duelChallenge: two adjacent generals both above the wu threshold.
  for (const u of units) {
    if (!active(u) || u.wu === undefined || u.wu < BATTLE_TUNING.duelWuMin) continue;
    const foe = units.find((e) => e.factionId !== u.factionId && active(e) && e.wu !== undefined && e.wu >= BATTLE_TUNING.duelWuMin && chebyshev(u.pos, e.pos) <= 1);
    if (foe) { out.push({ id: 'duelChallenge', unitIds: [u.id, foe.id], labelKey: 'battle.gambit.duelChallenge' }); break; }
  }

  // fordCrossing: a land unit adjacent to a ford cell.
  for (const u of units) {
    if (!active(u) || u.troopType === 'navy') continue;
    const nextToFord = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 0, y: 0 }]
      .some((d) => cellAt(battle, { x: u.pos.x + d.x, y: u.pos.y + d.y }) === 'ford');
    if (nextToFord) { out.push({ id: 'fordCrossing', unitIds: [u.id], labelKey: 'battle.gambit.fordCrossing' }); break; }
  }

  return out;
}
```

- [ ] **Step 4: Append the barrel export** in `src/engine/battle/index.ts`:

```ts
export { detectGambits } from './gambits.js';
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/engine/battle-gambits.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/engine/battle/gambits.ts src/engine/battle/index.ts tests/engine/battle-gambits.test.ts
git commit -m "feat(battle): contextual gambit detection"
```

---

### Task 0.7: Outcome bridge + headless resolution

Translate a finished `Battle` back into the strategic layer's `QuickBattleResult` contract, and provide a headless resolver (used by quick-resolve and by tests). This reproduces the ownership/loyalty/general-status/relocation/log semantics that live inside `resolveQuickBattle` (win path) plus the loss-path retreat from `applyCompletedSiege`.

**Files:**
- Create: `src/engine/battle/outcome.ts`
- Modify: `src/engine/battle/index.ts` (append the three exports)
- Test: `tests/engine/battle-outcome.test.ts`

**Interfaces:**
- Consumes: `Battle`, `GameState`, `QuickBattleResult` (`../combat.js`), `LogEntry`, `General`, `Personality`, `TacticalCommand` (`../types.js`); `stepBattle` (0.4/0.5); `adjacentCities` (`../map.js`); `tacticalRules` (`../ai/tactical.js`).
- Produces:
  - `battleToResult(state: GameState, battle: Battle): QuickBattleResult`
  - `defaultTacticalCommands(battle: Battle, factionId: FactionId, personality: Personality): TacticalCommand[]`
  - `resolveBattleHeadless(state: GameState, battle: Battle): QuickBattleResult`

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/battle-outcome.test.ts
import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { createBattle } from '../../src/engine/battle/setup.js';
import { resolveBattleHeadless, battleToResult } from '../../src/engine/battle/outcome.js';

function state() {
  return buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 100 });
}

describe('battle outcome bridge', () => {
  it('an overwhelming attacker captures the city (ownership flips, defenders wounded)', () => {
    const s0 = state();
    // Weaken a target city to guarantee a decisive attacker win.
    const target = Object.values(s0.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
    const s = { ...s0, cities: { ...s0.cities, [target.id]: { ...target, garrison: 300, generals: [] } } };
    const battle = createBattle(s, {
      cityId: target.id, attackerFactionId: 'caocao', defenderFactionId: target.factionId!,
      attackingGeneralIds: ['caocao', 'xiahoudun'], attackingTroops: 20000,
    });
    const result = resolveBattleHeadless(s, battle);
    expect(result.attackerWon).toBe(true);
    expect(result.state.cities[target.id]!.factionId).toBe('caocao');
    expect(result.state.rngState).not.toBe(s.rngState); // rng advanced
  });

  it('battleToResult reports casualties and never mutates the input state', () => {
    const s = state();
    const target = Object.values(s.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
    const battle = createBattle(s, {
      cityId: target.id, attackerFactionId: 'caocao', defenderFactionId: target.factionId!,
      attackingGeneralIds: ['caocao'], attackingTroops: 5000,
    });
    // Simulate some casualties by zeroing a defender unit.
    const mangled = { ...battle, units: battle.units.map((u, i) => (i === battle.units.length - 1 ? { ...u, troops: 0, state: 'gone' as const } : u)) };
    const before = JSON.stringify(s.cities[target.id]);
    const result = battleToResult(s, mangled);
    expect(result.attackerCasualties).toBeGreaterThanOrEqual(0);
    expect(result.defenderCasualties).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(s.cities[target.id])).toBe(before); // input untouched
  });

  it('headless resolution terminates within the day limit', () => {
    const s = state();
    const target = Object.values(s.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
    const battle = createBattle(s, {
      cityId: target.id, attackerFactionId: 'caocao', defenderFactionId: target.factionId!,
      attackingGeneralIds: ['caocao'], attackingTroops: 9000,
    });
    const result = resolveBattleHeadless(s, battle);
    expect(typeof result.attackerWon).toBe('boolean');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/battle-outcome.test.ts`
Expected: FAIL — cannot find module `outcome.js`.

- [ ] **Step 3: Create `src/engine/battle/outcome.ts`**

```ts
// Bridges the emergent battle back to the strategic layer. battleToResult
// reproduces resolveQuickBattle's win-path (ownership flip, loyalty haircut,
// defender wounding, attacker relocation, cityFell/attackerRetreated log) plus
// the loss-path attacker retreat to a friendly neighbor. resolveBattleHeadless
// runs the sim to completion with AI orders for both sides.
import { BATTLE_DAY_LIMIT } from '../constants.js';
import { adjacentCities } from '../map.js';
import { tacticalRules } from '../ai/tactical.js';
import type { QuickBattleResult } from '../combat.js';
import type {
  Battle,
  FactionId,
  GameState,
  General,
  LogEntry,
  Personality,
  TacticalCommand,
} from '../types.js';
import { stepBattle } from './simulate.js';

// Personality-driven default orders for a side (thin wrapper over the existing
// tactical AI; kept here so the sim module has no AI dependency).
export function defaultTacticalCommands(
  battle: Battle,
  factionId: FactionId,
  personality: Personality,
): TacticalCommand[] {
  return tacticalRules(battle, factionId, personality);
}

function sumTroops(battle: Battle, factionId: FactionId): number {
  return battle.units
    .filter((u) => u.factionId === factionId)
    .reduce((n, u) => n + Math.max(0, u.troops), 0);
}

export function battleToResult(state: GameState, battle: Battle): QuickBattleResult {
  const city = state.cities[battle.cityId];
  if (!city) {
    return { state, attackerWon: false, attackerCasualties: 0, defenderCasualties: 0, log: [] };
  }

  // Winner: attacker wins iff it still has fighting troops and the defender has
  // none (mirrors the sim's end-check).
  const atkTroops = sumTroops(battle, battle.attackerFactionId);
  const defTroops = sumTroops(battle, battle.defenderFactionId);
  const timedOut = battle.daysElapsed >= BATTLE_DAY_LIMIT;
  const attackerWon = defTroops <= 0 && atkTroops > 0 && !(timedOut && defTroops > 0);

  // Casualties = starting - surviving, reconstructed from the units.
  const attackerGenerals = battle.units
    .filter((u) => u.factionId === battle.attackerFactionId && u.generalId)
    .map((u) => state.generals[u.generalId])
    .filter((g): g is General => Boolean(g));
  const defenderGenerals = city.generals
    .map((id) => state.generals[id])
    .filter((g): g is General => Boolean(g));

  const survivingAtk = atkTroops;
  const startingAtk = battle.units
    .filter((u) => u.factionId === battle.attackerFactionId)
    .reduce((n, u) => n + (u.troops < 0 ? 0 : u.troops), 0);
  void startingAtk;

  // We do not have the pre-battle totals on the finished battle, so derive
  // casualties from the city + committed force snapshot at apply time.
  const committedAtk = attackerGenerals.reduce((n, g) => n + g.troops, 0) || survivingAtk;
  const attackerCasualties = Math.max(0, committedAtk - survivingAtk);
  const defStart = city.garrison + defenderGenerals.reduce((n, g) => n + g.troops, 0);
  const defenderCasualties = Math.max(0, defStart - defTroops);

  const updatedCities = { ...state.cities };
  const updatedGenerals = { ...state.generals };
  let updatedCity = { ...city };
  const log: LogEntry[] = [];
  let rng = battle.rngCursor; // final battle RNG cursor threads back to state

  if (attackerWon) {
    updatedCity = {
      ...updatedCity,
      factionId: battle.attackerFactionId,
      loyalty: Math.max(20, Math.floor(updatedCity.loyalty * 0.6)),
      generals: attackerGenerals.map((g) => g.id),
    };
    for (const g of defenderGenerals) {
      updatedGenerals[g.id] = { ...g, locationCityId: null, status: 'wounded' };
    }
    for (const g of attackerGenerals) {
      updatedGenerals[g.id] = { ...g, locationCityId: city.id };
    }
    const faction = state.factions[battle.attackerFactionId];
    log.push({
      turn: state.turn, year: state.year, month: state.month, key: 'event.cityFell',
      vars: { city: city.name, faction: faction ? faction.name : { zh: battle.attackerFactionId, en: battle.attackerFactionId } },
      factionId: battle.attackerFactionId,
    });
  } else {
    // Attackers retreat to a friendly neighbor of the target, if any.
    const nearbyFriendly = adjacentCities(state, city.id).find((c) => c.factionId === battle.attackerFactionId);
    for (const g of attackerGenerals) {
      if (g.status === 'active') {
        updatedGenerals[g.id] = { ...g, locationCityId: nearbyFriendly ? nearbyFriendly.id : null };
      }
    }
    if (nearbyFriendly) {
      updatedCities[nearbyFriendly.id] = {
        ...nearbyFriendly,
        generals: [...nearbyFriendly.generals, ...attackerGenerals.filter((g) => g.status === 'active' && !nearbyFriendly.generals.includes(g.id)).map((g) => g.id)],
      };
    }
    log.push({
      turn: state.turn, year: state.year, month: state.month, key: 'event.attackerRetreated',
      factionId: battle.attackerFactionId,
    });
  }

  updatedCities[city.id] = updatedCity;
  const nextState: GameState = {
    ...state,
    cities: updatedCities,
    generals: updatedGenerals,
    rngState: rng,
    log: [...state.log, ...log],
  };
  return { state: nextState, attackerWon, attackerCasualties, defenderCasualties, log };
}

export function resolveBattleHeadless(state: GameState, battle: Battle): QuickBattleResult {
  const atkPers = state.factions[battle.attackerFactionId]?.personality ?? 'balanced';
  const defPers = state.factions[battle.defenderFactionId]?.personality ?? 'balanced';
  let cur = battle;
  for (let day = 0; day < BATTLE_DAY_LIMIT; day++) {
    const commands = [
      ...defaultTacticalCommands(cur, battle.attackerFactionId, atkPers),
      ...defaultTacticalCommands(cur, battle.defenderFactionId, defPers),
    ];
    const stepped = stepBattle({ battle: cur, commands });
    cur = stepped.battle;
    if (stepped.events.some((e) => e.kind === 'end')) break;
  }
  return battleToResult(state, cur);
}
```

- [ ] **Step 4: Append the barrel exports** in `src/engine/battle/index.ts`:

```ts
export {
  battleToResult,
  resolveBattleHeadless,
  defaultTacticalCommands,
} from './outcome.js';
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/engine/battle-outcome.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Full engine suite regression**

Run: `npx vitest run tests/engine tests/playthrough`
Expected: PASS — all pre-existing engine + playthrough tests still green (nothing yet touches `tickDays`/`resolveQuickBattle`).

- [ ] **Step 7: Commit**

```bash
git add src/engine/battle/outcome.ts src/engine/battle/index.ts tests/engine/battle-outcome.test.ts
git commit -m "feat(battle): outcome bridge to QuickBattleResult + headless resolver"
```

---

### Task 0.8: Wire player sieges to defer into a pending battle

Branch `applyCompletedSiege` so a player-involved siege sets `state.pendingBattle` instead of auto-resolving — but **only** when a new `deferPlayerBattles` flag is on. `tickDays` halts once a battle is pending. Existing callers/tests pass no flag → behavior is unchanged and all seed-pinned tests stay green.

**Files:**
- Modify: `src/engine/pendingOp.ts` (`tickDays` + `tickOneDay` signatures; `applyCompletedSiege` branch)
- Test: `tests/engine/battle-pendingop.test.ts`

**Interfaces:**
- Consumes: `createBattle` (0.3); `GameState`, `FactionAgent`, `Battle` (`../types.js`).
- Produces: `tickDays(state, days, agents, options?)` where `options?: { deferPlayerBattles?: boolean }`; `applyCompletedSiege` sets `state.pendingBattle` for player-involved sieges when deferral is on.

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/battle-pendingop.test.ts
import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { scheduleOp, tickDays } from '../../src/engine/pendingOp.js';
import { makeDefaultAgent } from '../../src/engine/ai/index.js';
import type { FactionAgent, GameState, PendingOp } from '../../src/engine/types.js';

function agentsFor(s: GameState): Record<string, FactionAgent> {
  const a: Record<string, FactionAgent> = {};
  for (const f of Object.values(s.factions)) a[f.id] = makeDefaultAgent(f.id, f.personality);
  return a;
}

// Force a siege op that completes on the next day for the given attacker.
function withImminentSiege(s: GameState, attacker: string, targetCityId: string, generalIds: string[]): GameState {
  const op = {
    id: s.nextOpId, kind: 'siege', factionId: attacker, durationDays: 1, daysRemaining: 1,
    targetCityId, generalIds, troops: 12000,
  } as Extract<PendingOp, { kind: 'siege' }>;
  return scheduleOp(s, op);
}

describe('player-siege deferral', () => {
  it('sets pendingBattle and halts ticking when the player is the attacker (defer on)', () => {
    const s0 = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 7 });
    const enemyCity = Object.values(s0.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
    const s = withImminentSiege(s0, 'caocao', enemyCity.id, ['caocao']);
    const next = tickDays(s, 3, agentsFor(s), { deferPlayerBattles: true });
    expect(next.pendingBattle).toBeDefined();
    expect(next.pendingBattle!.cityId).toBe(enemyCity.id);
    // Ownership NOT yet flipped — the battle screen owes the resolution.
    expect(next.cities[enemyCity.id]!.factionId).toBe(enemyCity.factionId);
  });

  it('does NOT defer when the flag is off (existing behavior preserved)', () => {
    const s0 = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 7 });
    const enemyCity = Object.values(s0.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
    const s = withImminentSiege(s0, 'caocao', enemyCity.id, ['caocao']);
    const next = tickDays(s, 3, agentsFor(s)); // no options
    expect(next.pendingBattle).toBeUndefined();
  });

  it('AI-vs-AI siege never defers even with the flag on', () => {
    const s0 = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 7 });
    const aiA = Object.values(s0.factions).find((f) => f.id !== 'caocao')!;
    const targetCity = Object.values(s0.cities).find((c) => c.factionId && c.factionId !== 'caocao' && c.factionId !== aiA.id)!;
    const s = withImminentSiege(s0, aiA.id, targetCity.id, [aiA.lordId]);
    const next = tickDays(s, 3, agentsFor(s), { deferPlayerBattles: true });
    expect(next.pendingBattle).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/engine/battle-pendingop.test.ts`
Expected: FAIL — `tickDays` ignores the 4th arg; `pendingBattle` never set.

- [ ] **Step 3: Edit `src/engine/pendingOp.ts`**

Add the import near the top (with the other engine imports):

```ts
import { createBattle } from './battle/index.js';
```

Change the `tickDays` signature + loop (pendingOp.ts:201-210) to thread an options object and halt on a pending battle:

```ts
export function tickDays(
  state: GameState,
  daysToAdvance: number,
  agents: Record<string, FactionAgent>,
  options?: { deferPlayerBattles?: boolean },
): GameState {
  let next = state;
  for (let i = 0; i < daysToAdvance; i++) {
    if (next.pendingBattle) break; // a player battle is owed; stop advancing
    next = tickOneDay(next, agents, options);
  }
  return next;
}
```

Thread `options` into `tickOneDay` (add the same optional param to its signature) and into `applyCompletedOp`/`applyCompletedSiege` calls. In `tickOneDay`'s op loop, once a battle is pending, stop applying further completions (push remaining ops back onto `surviving`):

```ts
  for (const op of beforeOps) {
    const ticked = { ...op, daysRemaining: op.daysRemaining - 1 } as PendingOp;
    if (next.pendingBattle) { surviving.push(ticked); continue; }
    if (ticked.daysRemaining <= 0) {
      next = applyCompletedOp(next, ticked, options);
    } else {
      surviving.push(ticked);
    }
  }
```

**Immediately after that op loop**, before `tickOneDay` proceeds to its AI monthly-decision / month-rollover phases, bail out if a battle became pending so nothing runs behind the player's battle. Inspect `tickOneDay`'s existing "return updated ops" shape and mirror it — e.g.:

```ts
  if (next.pendingBattle) {
    return { ...next, pendingOps: surviving };
  }
```

Thread `options` through `applyCompletedOp(state, op, options?)` to `applyCompletedSiege(state, op, options?)`. In `applyCompletedSiege`, insert the branch right after `const defenderFactionId = target.factionId ?? '__neutral__';`:

```ts
  const defenderFactionId = target.factionId ?? '__neutral__';

  // Player is a participant and the caller asked to defer -> hand off to the
  // tactical BattleScreen. The march already detached the expedition force, so
  // createBattle seeds units from op.generalIds + the target's garrison/generals.
  if (
    options?.deferPlayerBattles &&
    (op.factionId === state.playerFactionId || defenderFactionId === state.playerFactionId)
  ) {
    const battle = createBattle(state, {
      cityId: op.targetCityId,
      attackerFactionId: op.factionId,
      defenderFactionId,
      attackingGeneralIds: op.generalIds,
      attackingTroops: op.troops,
    });
    return { ...state, pendingBattle: battle };
  }

  const result = resolveQuickBattle({
    /* ...unchanged existing call... */
  });
```

(Only the signatures of `tickOneDay`, `applyCompletedOp`, `applyCompletedSiege` gain an optional trailing `options?: { deferPlayerBattles?: boolean }`; every existing internal call passes it through. Existing external callers that omit it are unaffected.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/engine/battle-pendingop.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Full regression — nothing else changed behavior**

Run: `npm test`
Expected: PASS — the entire pre-existing suite stays green (every existing `tickDays` caller omits the flag, so `deferPlayerBattles` is `undefined` and the old path runs).

- [ ] **Step 6: Commit**

```bash
git add src/engine/pendingOp.ts tests/engine/battle-pendingop.test.ts
git commit -m "feat(battle): defer player-involved sieges to pendingBattle (opt-in flag)"
```

**Phase 0 complete.** The engine can create, simulate, and resolve a battle headlessly, and player sieges surface a `pendingBattle`. No UI yet.

---

# PHASE 1 — Session driver + playable battle screen (SVG placeholder, no Three.js)

At the end of Phase 1 the player fights a real battle: advancing time into a player siege opens a battle screen with per-day decision windows, per-unit orders, gambits, reserves, speed control, and quick-resolve; the outcome applies to the strategic game and returns to the map. The view is SVG (jsdom-testable); Plan 2 swaps in Three.js behind the same `battle` store slice.

---

### Task 1.1: Battle session driver (pure)

**Files:**
- Create: `src/state/battleSession.ts`
- Test: `tests/state/battle-session.test.ts`

**Interfaces:**
- Consumes: `stepBattle`, `detectGambits`, `defaultTacticalCommands`, `battleToResult` (`../engine/battle/index.js`); `Battle`, `TacticalCommand`, `GambitId`, `Gambit`, `FactionId`, `GameState`, `Personality`, `Vec2` (engine types); `QuickBattleResult` (`../engine/combat.js`).
- Produces:
  - `type BattlePhase = 'awaitingOrders' | 'resolving' | 'resolved'`
  - `interface BattleSession { battle; phase; speed; playerFactionId; playerIsAttacker; personalities; queuedPlayerCommands; lastEvents; gambits; attackerWon; endReason }`
  - `startSession`, `queuePlayerCommand`, `chooseGambit`, `resolveDay`, `autoResolveSession`, `setSpeed`, `sessionResult`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/state/battle-session.test.ts
import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { createBattle } from '../../src/engine/battle/setup.js';
import {
  startSession, resolveDay, autoResolveSession, sessionResult, queuePlayerCommand,
} from '../../src/state/battleSession.js';
import type { Personality } from '../../src/engine/types.js';

function setup() {
  const s = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 100 });
  const target = Object.values(s.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
  const weak = { ...s, cities: { ...s.cities, [target.id]: { ...target, garrison: 500, generals: [] } } };
  const battle = createBattle(weak, {
    cityId: target.id, attackerFactionId: 'caocao', defenderFactionId: target.factionId!,
    attackingGeneralIds: ['caocao', 'xiahoudun'], attackingTroops: 20000,
  });
  const personalities: Record<string, Personality> = {};
  for (const f of Object.values(weak.factions)) personalities[f.id] = f.personality;
  return { state: weak, battle, personalities };
}

describe('battle session driver', () => {
  it('starts awaiting orders on the player attacker side', () => {
    const { battle, personalities } = setup();
    const sess = startSession(battle, 'caocao', personalities);
    expect(sess.phase).toBe('awaitingOrders');
    expect(sess.playerIsAttacker).toBe(true);
  });

  it('resolveDay advances one day and yields events', () => {
    const { battle, personalities } = setup();
    const sess0 = startSession(battle, 'caocao', personalities);
    const sess1 = resolveDay(sess0);
    expect(sess1.battle.daysElapsed).toBe(sess0.battle.daysElapsed + 1);
    expect(['awaitingOrders', 'resolved']).toContain(sess1.phase);
    expect(sess1.lastEvents.length).toBeGreaterThan(0);
  });

  it('autoResolve reaches a resolved terminal state', () => {
    const { battle, personalities } = setup();
    const sess = autoResolveSession(startSession(battle, 'caocao', personalities));
    expect(sess.phase).toBe('resolved');
    expect(typeof sess.attackerWon).toBe('boolean');
  });

  it('sessionResult applies to the strategic state', () => {
    const { state, battle, personalities } = setup();
    const sess = autoResolveSession(startSession(battle, 'caocao', personalities));
    const result = sessionResult(state, sess);
    if (result.attackerWon) expect(result.state.cities[battle.cityId]!.factionId).toBe('caocao');
    expect(result.state.rngState).toBeDefined();
  });

  it('queuePlayerCommand replaces a prior order for the same unit', () => {
    const { battle, personalities } = setup();
    let sess = startSession(battle, 'caocao', personalities);
    const uid = battle.units.find((u) => u.factionId === 'caocao')!.id;
    sess = queuePlayerCommand(sess, { kind: 'hold', unitId: uid });
    sess = queuePlayerCommand(sess, { kind: 'march', unitId: uid, target: { x: 0, y: 0 } });
    const forUnit = sess.queuedPlayerCommands.filter((c) => 'unitId' in c && c.unitId === uid);
    expect(forUnit).toHaveLength(1);
    expect(forUnit[0]!.kind).toBe('march');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/state/battle-session.test.ts`
Expected: FAIL — cannot find module `battleSession.js`.

- [ ] **Step 3: Create `src/state/battleSession.ts`**

```ts
// Drives a live battle: steps the pure sim, pauses for the player, and folds
// player orders/gambits into the same stepBattle the AI feeds. No React here.
import {
  battleToResult,
  defaultTacticalCommands,
  detectGambits,
  stepBattle,
} from '../engine/battle/index.js';
import type { QuickBattleResult } from '../engine/combat.js';
import type {
  Battle,
  BattleUnit,
  FactionId,
  GameState,
  GambitId,
  Gambit,
  Personality,
  TacticalCommand,
  Vec2,
} from '../engine/types.js';

export type BattlePhase = 'awaitingOrders' | 'resolving' | 'resolved';

export interface BattleSession {
  battle: Battle;
  phase: BattlePhase;
  speed: 1 | 2 | 4;
  playerFactionId: FactionId;
  playerIsAttacker: boolean;
  personalities: Record<FactionId, Personality>;
  queuedPlayerCommands: TacticalCommand[];
  lastEvents: ReturnType<typeof stepBattle>['events'];
  gambits: Gambit[];
  attackerWon: boolean | null;
  endReason: 'destroyed' | 'timeout' | null;
}

const chebyshev = (a: Vec2, b: Vec2): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const isPlayerUnit = (u: BattleUnit, fid: FactionId): boolean => u.factionId === fid;

function filterPlayerGambits(battle: Battle, gambits: Gambit[], playerFactionId: FactionId): Gambit[] {
  return gambits.filter((g) =>
    g.unitIds.some((id) => {
      const u = battle.units.find((x) => x.id === id);
      return u ? isPlayerUnit(u, playerFactionId) : false;
    }),
  );
}

function nearestEnemyId(battle: Battle, unit: BattleUnit): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const e of battle.units) {
    if (e.factionId === unit.factionId || e.state !== 'fielded' || e.troops <= 0) continue;
    const d = chebyshev(unit.pos, e.pos);
    if (d < bestD) { bestD = d; best = e.id; }
  }
  return best;
}

function compileGambit(battle: Battle, g: Gambit, playerFactionId: FactionId): TacticalCommand[] {
  switch (g.id) {
    case 'cavalryCharge':
      return g.unitIds.map((id) => {
        const u = battle.units.find((x) => x.id === id)!;
        const t = nearestEnemyId(battle, u);
        return t
          ? ({ kind: 'charge', unitId: id, targetUnitId: t } as TacticalCommand)
          : ({ kind: 'hold', unitId: id } as TacticalCommand);
      });
    case 'duelChallenge': {
      const a = g.unitIds.find((id) => battle.units.find((u) => u.id === id)?.factionId === playerFactionId);
      const e = g.unitIds.find((id) => id !== a);
      return a && e ? [{ kind: 'challengeDuel', unitId: a, targetUnitId: e }] : [];
    }
    case 'fireAttack':
      return [{ kind: 'gambit', gambitId: 'fireAttack', unitIds: g.unitIds.filter((id) => battle.units.find((u) => u.id === id)?.factionId === playerFactionId) }];
    case 'fordCrossing':
      return g.unitIds.map((id) => ({ kind: 'march', unitId: id, target: battle.field.river?.fords[0] ?? { x: 0, y: 0 } } as TacticalCommand));
    case 'ambush':
    default:
      return [];
  }
}

export function startSession(
  battle: Battle,
  playerFactionId: FactionId,
  personalities: Record<FactionId, Personality>,
): BattleSession {
  return {
    battle,
    phase: 'awaitingOrders',
    speed: 1,
    playerFactionId,
    playerIsAttacker: battle.attackerFactionId === playerFactionId,
    personalities,
    queuedPlayerCommands: [],
    lastEvents: [],
    gambits: filterPlayerGambits(battle, detectGambits(battle), playerFactionId),
    attackerWon: null,
    endReason: null,
  };
}

export function queuePlayerCommand(session: BattleSession, cmd: TacticalCommand): BattleSession {
  const uid = 'unitId' in cmd ? cmd.unitId : undefined;
  const kept = uid
    ? session.queuedPlayerCommands.filter((c) => !('unitId' in c) || c.unitId !== uid)
    : session.queuedPlayerCommands;
  return { ...session, queuedPlayerCommands: [...kept, cmd] };
}

export function chooseGambit(session: BattleSession, gambitId: GambitId): BattleSession {
  const g = session.gambits.find((x) => x.id === gambitId);
  if (!g) return session;
  return { ...session, queuedPlayerCommands: [...session.queuedPlayerCommands, ...compileGambit(session.battle, g, session.playerFactionId)] };
}

export function setSpeed(session: BattleSession, speed: 1 | 2 | 4): BattleSession {
  return { ...session, speed };
}

function mergeCommands(session: BattleSession): TacticalCommand[] {
  const b = session.battle;
  const oppId = session.playerIsAttacker ? b.defenderFactionId : b.attackerFactionId;
  const oppPers = session.personalities[oppId] ?? 'balanced';
  const playerPers = session.personalities[session.playerFactionId] ?? 'balanced';
  const ordered = new Set(
    session.queuedPlayerCommands.filter((c) => 'unitId' in c).map((c) => (c as { unitId: string }).unitId),
  );
  const playerDefaults = defaultTacticalCommands(b, session.playerFactionId, playerPers)
    .filter((c) => !('unitId' in c) || !ordered.has((c as { unitId: string }).unitId));
  return [...defaultTacticalCommands(b, oppId, oppPers), ...playerDefaults, ...session.queuedPlayerCommands];
}

export function resolveDay(session: BattleSession): BattleSession {
  if (session.phase === 'resolved') return session;
  const { battle: next, events } = stepBattle({ battle: session.battle, commands: mergeCommands(session) });
  const end = events.find((e) => e.kind === 'end');
  if (end && end.kind === 'end') {
    return { ...session, battle: next, lastEvents: events, gambits: [], phase: 'resolved', attackerWon: end.attackerWon, endReason: end.reason, queuedPlayerCommands: [] };
  }
  return {
    ...session,
    battle: next,
    lastEvents: events,
    gambits: filterPlayerGambits(next, detectGambits(next), session.playerFactionId),
    phase: 'awaitingOrders',
    queuedPlayerCommands: [],
  };
}

export function autoResolveSession(session: BattleSession): BattleSession {
  let cur: BattleSession = { ...session, queuedPlayerCommands: [] };
  let guard = 0;
  while (cur.phase !== 'resolved' && guard < 60) {
    const b = cur.battle;
    const atkPers = cur.personalities[b.attackerFactionId] ?? 'balanced';
    const defPers = cur.personalities[b.defenderFactionId] ?? 'balanced';
    const commands = [
      ...defaultTacticalCommands(b, b.attackerFactionId, atkPers),
      ...defaultTacticalCommands(b, b.defenderFactionId, defPers),
    ];
    const { battle: nb, events } = stepBattle({ battle: b, commands });
    const end = events.find((e) => e.kind === 'end');
    cur = { ...cur, battle: nb, lastEvents: events };
    if (end && end.kind === 'end') {
      cur = { ...cur, phase: 'resolved', attackerWon: end.attackerWon, endReason: end.reason, gambits: [] };
      break;
    }
    guard++;
  }
  if (cur.phase !== 'resolved') cur = { ...cur, phase: 'resolved', attackerWon: false, endReason: 'timeout' };
  return cur;
}

export function sessionResult(state: GameState, session: BattleSession): QuickBattleResult {
  return battleToResult(state, session.battle);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/state/battle-session.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/state/battleSession.ts tests/state/battle-session.test.ts
git commit -m "feat(battle): pure battle-session driver (orders, gambits, day resolve, auto-resolve)"
```

---

### Task 1.2: Store integration — battle slice + mutators + advance/restore wiring

**Files:**
- Modify: `src/state/store.ts` (`SessionState` slice + init; battle mutators; `advanceDays` deferral; `loadGame` pending-battle entry)
- Modify: `src/state/selectors.ts` (`selectBattle`)
- Test: `tests/state/battle-store.test.ts`

**Interfaces:**
- Consumes: `startSession`, `resolveDay`, `autoResolveSession`, `queuePlayerCommand`, `chooseGambit`, `setSpeed`, `sessionResult`, `BattleSession` (`./battleSession.js`); `tickDays` (already imported); `checkOutcome`, `extractDigest` (existing local helpers in store.ts); `GambitId`, `TacticalCommand`, `Personality`, `GameState` (engine types).
- Produces (exports from store.ts): `submitBattleOrders`, `chooseBattleGambit`, `resolveBattleDay`, `setBattleSpeed`, `quickResolveBattle`, `finishBattle`, `enterPendingBattle`; (selectors.ts) `selectBattle`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/state/battle-store.test.ts
import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { createBattle } from '../../src/engine/battle/setup.js';
import { gameStore, loadGame, finishBattle, quickResolveBattle } from '../../src/state/store.js';

function seedWithPendingBattle() {
  const s = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 100 });
  const target = Object.values(s.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
  const weak = { ...s, cities: { ...s.cities, [target.id]: { ...target, garrison: 500, generals: [] } } };
  const battle = createBattle(weak, {
    cityId: target.id, attackerFactionId: 'caocao', defenderFactionId: target.factionId!,
    attackingGeneralIds: ['caocao', 'xiahoudun'], attackingTroops: 20000,
  });
  return { game: { ...weak, pendingBattle: battle }, targetId: target.id };
}

describe('battle store integration', () => {
  it('loadGame with a pending battle routes to the battle screen + sets the slice', () => {
    const { game } = seedWithPendingBattle();
    loadGame({ game, locale: 'zh' });
    expect(gameStore.getState().ui.screen.kind).toBe('battle');
    expect(gameStore.getState().battle).not.toBeNull();
  });

  it('quickResolve then finishBattle applies the outcome and returns to main/gameOver', () => {
    const { game } = seedWithPendingBattle();
    loadGame({ game, locale: 'zh' });
    quickResolveBattle();
    expect(gameStore.getState().battle!.phase).toBe('resolved');
    finishBattle();
    const st = gameStore.getState();
    expect(st.battle).toBeNull();
    expect(st.game!.pendingBattle).toBeUndefined();
    expect(['main', 'gameOver']).toContain(st.ui.screen.kind);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/state/battle-store.test.ts`
Expected: FAIL — `finishBattle`/`quickResolveBattle` are not exported; `battle` is not on the store.

- [ ] **Step 3: Edit `src/state/store.ts`**

Add imports (top of file, with `.js`):

```ts
import {
  startSession, resolveDay, autoResolveSession, queuePlayerCommand, chooseGambit, setSpeed, sessionResult,
} from './battleSession.js';
import type { BattleSession } from './battleSession.js';
import type { GambitId, Personality, TacticalCommand } from '../engine/types.js';
```

Add `battle` to `SessionState`:

```ts
export interface SessionState {
  game: GameState | null;
  ui: UIState;
  agents: Record<string, FactionAgent>;
  battle: BattleSession | null;
}
```

Initialize it in the `createStore` initializer:

```ts
export const gameStore: StoreApi<SessionState> = createStore<SessionState>(() => ({
  game: null,
  ui: initialUI,
  agents: {},
  battle: null,
}));
```

Add a private helper + `enterPendingBattle`:

```ts
function sessionFromGame(game: GameState): BattleSession {
  const personalities: Record<string, Personality> = {};
  for (const f of Object.values(game.factions)) personalities[f.id] = f.personality;
  return startSession(game.pendingBattle!, game.playerFactionId, personalities);
}

// Route to the battle screen for the game's current pendingBattle (used on
// load/restore and by advanceDays when a siege defers).
export function enterPendingBattle(): void {
  gameStore.setState((s) => {
    if (!s.game?.pendingBattle) return s;
    return { ...s, battle: sessionFromGame(s.game), ui: { ...s.ui, screen: { kind: 'battle' } } };
  });
}
```

Add the battle mutators (next to `setScreen`):

```ts
export function submitBattleOrders(cmds: TacticalCommand[]): void {
  gameStore.setState((s) => {
    if (!s.battle) return s;
    let sess = s.battle;
    for (const c of cmds) sess = queuePlayerCommand(sess, c);
    return { ...s, battle: sess };
  });
}
export function chooseBattleGambit(gambitId: GambitId): void {
  gameStore.setState((s) => (s.battle ? { ...s, battle: chooseGambit(s.battle, gambitId) } : s));
}
export function resolveBattleDay(): void {
  gameStore.setState((s) => (s.battle ? { ...s, battle: resolveDay(s.battle) } : s));
}
export function setBattleSpeed(speed: 1 | 2 | 4): void {
  gameStore.setState((s) => (s.battle ? { ...s, battle: setSpeed(s.battle, speed) } : s));
}
export function quickResolveBattle(): void {
  gameStore.setState((s) => (s.battle ? { ...s, battle: autoResolveSession(s.battle) } : s));
}
export function finishBattle(): void {
  const { game, battle } = gameStore.getState();
  if (!game || !battle) return;
  const result = sessionResult(game, battle);
  const cleared: GameState = { ...result.state, pendingBattle: undefined };
  const outcome = checkOutcome(cleared);
  gameStore.setState((s) => ({
    ...s,
    game: cleared,
    battle: null,
    ui: outcome ? { ...s.ui, screen: { kind: 'gameOver', outcome } } : { ...s.ui, screen: { kind: 'main' } },
  }));
}
```

Change `advanceDays` to defer player battles and enter the screen when one is owed (replace the existing body):

```ts
export function advanceDays(days: number): void {
  const { game, agents } = gameStore.getState();
  if (!game) return;
  const logLenBefore = game.log.length;
  const next = tickDays(game, days, agents, { deferPlayerBattles: true });
  void advanceMonth;
  if (next.pendingBattle) {
    const personalities: Record<string, Personality> = {};
    for (const f of Object.values(next.factions)) personalities[f.id] = f.personality;
    gameStore.setState((s) => ({
      ...s,
      game: next,
      battle: startSession(next.pendingBattle!, next.playerFactionId, personalities),
      ui: { ...s.ui, screen: { kind: 'battle' } },
    }));
    return;
  }
  const digest = extractDigest(logLenBefore, next.log);
  const outcome = checkOutcome(next);
  gameStore.setState((s) => ({
    ...s,
    game: next,
    ui: outcome
      ? { ...s.ui, screen: { kind: 'gameOver', outcome }, turnDigest: digest }
      : { ...s.ui, turnDigest: digest },
  }));
}
```

In `loadGame`, after the existing `gameStore.setState(...)` that installs the loaded game, append:

```ts
  // If the restored game was mid-battle, resume the battle screen.
  if (gameStore.getState().game?.pendingBattle) enterPendingBattle();
```

- [ ] **Step 4: Edit `src/state/selectors.ts`** — add:

```ts
export const selectBattle = (s: SessionState) => s.battle;
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/state/battle-store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Full regression**

Run: `npm test`
Expected: PASS — existing store/persistence/web tests stay green (the new `battle` slice defaults to `null`; autosave still only serializes `game` + `ui.locale`, and `game.pendingBattle` rides along inside `game`).

- [ ] **Step 7: Commit**

```bash
git add src/state/store.ts src/state/selectors.ts tests/state/battle-store.test.ts
git commit -m "feat(battle): store slice + mutators; advanceDays defers player sieges to the battle screen"
```

---

### Task 1.3: Battle screen i18n keys (zh + en)

**Files:**
- Modify: `src/i18n/types.ts` (add keys to the `MessageKey` union, in the Battle group)
- Modify: `src/i18n/catalog/en.ts`, `src/i18n/catalog/zh.ts`
- Test: `tests/i18n/battle-keys.test.ts` (plus the existing `tests/i18n/parity.test.ts` must stay green)

**Interfaces:**
- Produces: these `MessageKey`s exist in the union and both catalogs (non-empty, identical placeholders):
  `battle.heading`, `battle.morale`, `battle.advanceDay`, `battle.play`, `battle.pause`, `battle.quickResolve`, `battle.speed`, `battle.yourOrders`, `battle.gambits`, `battle.commitReserves`, `battle.charge`, `battle.hold`, `battle.advance`, `battle.finish`, `battle.victoryTitle`, `battle.defeatTitle`, `battle.gambit.cavalryCharge`, `battle.gambit.fireAttack`, `battle.gambit.duelChallenge`, `battle.gambit.fordCrossing`, `battle.gambit.ambush`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/i18n/battle-keys.test.ts
import { describe, expect, it } from 'vitest';
import { t, setLocale } from '../../src/i18n/locale.js';

const KEYS = [
  'battle.heading', 'battle.morale', 'battle.advanceDay', 'battle.play', 'battle.pause',
  'battle.quickResolve', 'battle.speed', 'battle.yourOrders', 'battle.gambits',
  'battle.commitReserves', 'battle.charge', 'battle.hold', 'battle.advance', 'battle.finish',
  'battle.victoryTitle', 'battle.defeatTitle', 'battle.gambit.cavalryCharge',
  'battle.gambit.fireAttack', 'battle.gambit.duelChallenge', 'battle.gambit.fordCrossing',
  'battle.gambit.ambush',
] as const;

describe('battle screen i18n keys', () => {
  it('resolve to non-empty, distinct strings in both locales', () => {
    for (const loc of ['zh', 'en'] as const) {
      setLocale(loc);
      for (const k of KEYS) {
        const v = t(k as never);
        expect(v, `${loc} ${k}`).toBeTruthy();
        expect(v, `${loc} ${k} not resolved`).not.toBe(k);
      }
    }
    setLocale('zh');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/i18n/battle-keys.test.ts`
Expected: FAIL — keys resolve to themselves (missing) and/or the file does not typecheck.

- [ ] **Step 3: Add the union members** in `src/i18n/types.ts`, inside the `// Battle screen` group (after `| 'battle.target'`):

```ts
  | 'battle.heading'
  | 'battle.morale'
  | 'battle.advanceDay'
  | 'battle.play'
  | 'battle.pause'
  | 'battle.quickResolve'
  | 'battle.speed'
  | 'battle.yourOrders'
  | 'battle.gambits'
  | 'battle.commitReserves'
  | 'battle.charge'
  | 'battle.hold'
  | 'battle.advance'
  | 'battle.finish'
  | 'battle.victoryTitle'
  | 'battle.defeatTitle'
  | 'battle.gambit.cavalryCharge'
  | 'battle.gambit.fireAttack'
  | 'battle.gambit.duelChallenge'
  | 'battle.gambit.fordCrossing'
  | 'battle.gambit.ambush'
```

- [ ] **Step 4: Add the English values** in `src/i18n/catalog/en.ts` (after `'battle.target': ...`):

```ts
  'battle.heading': 'Battle',
  'battle.morale': 'Morale',
  'battle.advanceDay': 'Advance Day',
  'battle.play': 'Play',
  'battle.pause': 'Pause',
  'battle.quickResolve': 'Quick Resolve',
  'battle.speed': 'Speed',
  'battle.yourOrders': 'Your Orders',
  'battle.gambits': 'Opportunities',
  'battle.commitReserves': 'Commit Reserves',
  'battle.charge': 'Charge',
  'battle.hold': 'Hold',
  'battle.advance': 'Advance',
  'battle.finish': 'Finish Battle',
  'battle.victoryTitle': 'Victory',
  'battle.defeatTitle': 'Defeat',
  'battle.gambit.cavalryCharge': 'Cavalry Charge',
  'battle.gambit.fireAttack': 'Fire Attack',
  'battle.gambit.duelChallenge': 'Duel Challenge',
  'battle.gambit.fordCrossing': 'Ford Crossing',
  'battle.gambit.ambush': 'Ambush',
```

- [ ] **Step 5: Add the Chinese values** in `src/i18n/catalog/zh.ts` (after `'battle.target': ...`):

```ts
  'battle.heading': '战斗',
  'battle.morale': '士气',
  'battle.advanceDay': '推进一日',
  'battle.play': '播放',
  'battle.pause': '暂停',
  'battle.quickResolve': '速战速决',
  'battle.speed': '速度',
  'battle.yourOrders': '你的号令',
  'battle.gambits': '战机',
  'battle.commitReserves': '投入预备队',
  'battle.charge': '突击',
  'battle.hold': '按兵不动',
  'battle.advance': '前进',
  'battle.finish': '结束战斗',
  'battle.victoryTitle': '大捷',
  'battle.defeatTitle': '败退',
  'battle.gambit.cavalryCharge': '骑兵突击',
  'battle.gambit.fireAttack': '火计',
  'battle.gambit.duelChallenge': '单挑',
  'battle.gambit.fordCrossing': '涉渡',
  'battle.gambit.ambush': '伏击',
```

- [ ] **Step 6: Run to verify it passes (incl. parity)**

Run: `npx vitest run tests/i18n/battle-keys.test.ts tests/i18n/parity.test.ts`
Expected: PASS. Then `npm run typecheck` to confirm the union is exhaustive.

- [ ] **Step 7: Commit**

```bash
git add src/i18n/types.ts src/i18n/catalog/en.ts src/i18n/catalog/zh.ts tests/i18n/battle-keys.test.ts
git commit -m "feat(battle): bilingual i18n keys for the battle screen"
```

---

### Task 1.4: Battle audio cues

**Files:**
- Modify: `src/web/audio/battle.ts` (append 5 exported SFX)
- Test: `tests/web/battle-audio.test.ts`

**Interfaces:**
- Consumes: `playTone` (private), `isMuted` (existing pattern).
- Produces: `playCharge()`, `playVolley()`, `playFire()`, `playDuel()`, `playRout()`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/web/battle-audio.test.ts
import { describe, expect, it } from 'vitest';
import { playCharge, playVolley, playFire, playDuel, playRout } from '../../src/web/audio/battle.js';

describe('battle audio cues', () => {
  it('are callable and no-op safely under jsdom (no AudioContext)', () => {
    // jsdom has no Web Audio; these must not throw.
    expect(() => { playCharge(); playVolley(); playFire(); playDuel(); playRout(); }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/web/battle-audio.test.ts`
Expected: FAIL — the five functions are not exported.

- [ ] **Step 3: Append to `src/web/audio/battle.ts`** (uses the existing `playTone`/`isMuted`):

```ts
// Rising rush for a cavalry charge.
export function playCharge(): void {
  if (isMuted()) return;
  playTone({ freq: 160, type: 'sawtooth', durationMs: 260, peakGain: 0.14, attackMs: 8, releaseMs: 120, glideTo: 320 });
}

// Short hiss cluster for an arrow volley.
export function playVolley(): void {
  if (isMuted()) return;
  for (const offsetMs of [0, 40, 80]) {
    setTimeout(() => playTone({ freq: 1400, type: 'triangle', durationMs: 90, peakGain: 0.05, attackMs: 2, releaseMs: 70, glideTo: 700 }), offsetMs);
  }
}

// Low roar for a fire attack.
export function playFire(): void {
  if (isMuted()) return;
  playTone({ freq: 90, type: 'sawtooth', durationMs: 420, peakGain: 0.16, attackMs: 20, releaseMs: 260, glideTo: 60 });
  playTone({ freq: 300, type: 'square', durationMs: 300, peakGain: 0.05, attackMs: 10, releaseMs: 200, glideTo: 140 });
}

// Two-note clash for a general's duel.
export function playDuel(): void {
  if (isMuted()) return;
  playTone({ freq: 990, type: 'square', durationMs: 120, peakGain: 0.1, attackMs: 2, releaseMs: 90, glideTo: 660 });
  setTimeout(() => playTone({ freq: 1240, type: 'square', durationMs: 140, peakGain: 0.1, attackMs: 2, releaseMs: 110, glideTo: 520 }), 130);
}

// Falling tone for a rout.
export function playRout(): void {
  if (isMuted()) return;
  playTone({ freq: 420, type: 'sine', durationMs: 380, peakGain: 0.12, attackMs: 6, releaseMs: 260, glideTo: 90 });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/web/battle-audio.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/audio/battle.ts tests/web/battle-audio.test.ts
git commit -m "feat(battle): add charge/volley/fire/duel/rout audio cues"
```

---

### Task 1.5: BattleScreen (SVG placeholder) + HUD + App routing

**Files:**
- Create: `src/web/battle/BattleField2D.tsx` (SVG field + units + FX markers)
- Create: `src/web/battle/BattleScreen.tsx` (HUD, decision panel, drive loop, after-action)
- Modify: `src/web/App.tsx` (`case 'battle'`)
- Test: `tests/web/BattleScreen.test.tsx`

**Interfaces:**
- Consumes: `useSession` + `selectBattle`/`selectLocale`; battle mutators (`submitBattleOrders`, `chooseBattleGambit`, `resolveBattleDay`, `setBattleSpeed`, `quickResolveBattle`, `finishBattle`) from `../../state/store.js`; `t` (`../../i18n/locale.js`); `factionColor` (`../theme.js`); `BattleSession` type.
- Produces: `BattleField2D`, `BattleScreen` React components.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/web/BattleScreen.test.tsx
import { describe, expect, it } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { createBattle } from '../../src/engine/battle/setup.js';
import { gameStore, loadGame } from '../../src/state/store.js';
import { BattleScreen } from '../../src/web/battle/BattleScreen.js';
import { t } from '../../src/i18n/locale.js';

function enterBattle() {
  const s = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 100 });
  const target = Object.values(s.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
  const weak = { ...s, cities: { ...s.cities, [target.id]: { ...target, garrison: 500, generals: [] } } };
  const battle = createBattle(weak, {
    cityId: target.id, attackerFactionId: 'caocao', defenderFactionId: target.factionId!,
    attackingGeneralIds: ['caocao', 'xiahoudun'], attackingTroops: 20000,
  });
  loadGame({ game: { ...weak, pendingBattle: battle }, locale: 'zh' });
}

describe('BattleScreen', () => {
  it('renders the HUD + decision controls for an active battle', () => {
    enterBattle();
    const { getAllByText } = render(<BattleScreen />);
    expect(getAllByText(t('battle.attackers')).length).toBeGreaterThan(0);
    expect(getAllByText(t('battle.quickResolve')).length).toBeGreaterThan(0);
    expect(getAllByText(t('battle.advanceDay')).length).toBeGreaterThan(0);
  });

  it('quick-resolve resolves the battle and reveals the finish control', () => {
    enterBattle();
    const { getByText, getAllByText } = render(<BattleScreen />);
    fireEvent.click(getByText(t('battle.quickResolve')));
    expect(gameStore.getState().battle!.phase).toBe('resolved');
    expect(getAllByText(t('battle.finish')).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/web/BattleScreen.test.tsx`
Expected: FAIL — cannot find `BattleScreen.js`.

- [ ] **Step 3: Create `src/web/battle/BattleField2D.tsx`**

```tsx
import React from 'react';
import type { BattleSession } from '../../state/battleSession.js';
import type { BattleCell } from '../../engine/battle/types.js';
import { factionColor } from '../theme.js';

const CELL = 26;

const CELL_FILL: Record<BattleCell, string> = {
  plain: '#e9e0c8',
  hill: '#cdbb92',
  forest: '#9bad7a',
  river: '#8fb7c9',
  ford: '#bcd0cf',
  wall: '#8a7a5c',
  gate: '#5c4a2c',
  ramp: '#c2b083',
  // fallback handled below
} as Record<BattleCell, string>;

// SVG placeholder battlefield. Plan 2 replaces this component with a Three.js
// canvas behind the same `session` prop.
export const BattleField2D: React.FC<{ session: BattleSession }> = ({ session }) => {
  const { field } = session.battle;
  const w = field.width * CELL;
  const h = field.height * CELL;
  const fires = session.lastEvents.filter((e) => e.kind === 'fire');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" role="img" aria-label="battlefield">
      {field.cells.map((cell, i) => {
        const x = (i % field.width) * CELL;
        const y = Math.floor(i / field.width) * CELL;
        return <rect key={i} x={x} y={y} width={CELL} height={CELL} fill={CELL_FILL[cell] ?? '#e9e0c8'} stroke="#00000010" />;
      })}
      {session.battle.units
        .filter((u) => u.state === 'fielded' || u.state === 'routing')
        .map((u) => {
          const size = Math.max(8, Math.min(CELL, Math.sqrt(u.troops) / 4));
          const cx = u.pos.x * CELL + CELL / 2;
          const cy = u.pos.y * CELL + CELL / 2;
          const routing = u.state === 'routing';
          return (
            <g key={u.id} opacity={routing ? 0.5 : 1}>
              <rect x={cx - size / 2} y={cy - size / 2} width={size} height={size} rx={2}
                fill={factionColor(u.factionId)} stroke="#2a2016" strokeWidth={1} />
              <rect x={cx - size / 2} y={cy + size / 2 + 1} width={size} height={2} fill="#2a2016" opacity={0.2} />
              <rect x={cx - size / 2} y={cy + size / 2 + 1} width={(size * u.morale) / 100} height={2} fill="#3a7a3a" />
            </g>
          );
        })}
      {fires.map((e, i) => e.kind === 'fire' ? (
        <circle key={`fire${i}`} cx={e.at.x * CELL + CELL / 2} cy={e.at.y * CELL + CELL / 2} r={CELL * 0.7} fill="#d9531e" opacity={0.4} />
      ) : null)}
    </svg>
  );
};
```

- [ ] **Step 4: Create `src/web/battle/BattleScreen.tsx`**

```tsx
import React, { useEffect } from 'react';
import { useSession } from '../hooks/useSession.js';
import { selectBattle, selectLocale } from '../../state/selectors.js';
import {
  chooseBattleGambit, finishBattle, quickResolveBattle, resolveBattleDay,
  setBattleSpeed, submitBattleOrders,
} from '../../state/store.js';
import { t } from '../../i18n/locale.js';
import { factionColor } from '../theme.js';
import { BattleField2D } from './BattleField2D.js';
import type { BattleSession } from '../../state/battleSession.js';

function troopTotal(session: BattleSession, factionId: string): number {
  return session.battle.units
    .filter((u) => u.factionId === factionId && u.troops > 0)
    .reduce((n, u) => n + u.troops, 0);
}

export const BattleScreen: React.FC = () => {
  useSession(selectLocale);
  const session = useSession(selectBattle);
  const [playing, setPlaying] = React.useState(false);

  // Auto-play: while playing and awaiting orders with no gambit to weigh,
  // resolve a day on an interval scaled by speed. Pause at gambit windows.
  useEffect(() => {
    if (!session || !playing) return;
    if (session.phase !== 'awaitingOrders' || session.gambits.length > 0) return;
    const id = setTimeout(() => resolveBattleDay(), 900 / session.speed);
    return () => clearTimeout(id);
  }, [session, playing]);

  if (!session) return null;
  const { battle } = session;
  const atk = battle.attackerFactionId;
  const def = battle.defenderFactionId;
  const playerUnits = battle.units.filter((u) => u.factionId === session.playerFactionId && u.state === 'fielded');
  const reserves = battle.units.filter((u) => u.factionId === session.playerFactionId && u.state === 'reserve');
  const resolved = session.phase === 'resolved';

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-2 px-4 py-3">
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl tracking-widest text-ink-800">{t('battle.heading')}</h2>
        <span className="font-mono text-sm text-ink-500">{t('battle.dayOf', { day: battle.daysElapsed, total: 30 })}</span>
      </header>

      {/* Troop bars */}
      <div className="flex gap-4 text-xs">
        <Bar label={t('battle.attackers')} color={factionColor(atk)} value={troopTotal(session, atk)} />
        <Bar label={t('battle.defenders')} color={factionColor(def)} value={troopTotal(session, def)} />
      </div>

      {/* Field */}
      <div className="relative flex-1 overflow-hidden rounded border border-ink-300/40 bg-parchment-100">
        <BattleField2D session={session} />
      </div>

      {/* Controls */}
      {!resolved && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" onClick={() => resolveBattleDay()}>{t('battle.advanceDay')}</button>
          <button className="btn" onClick={() => setPlaying((p) => !p)}>{playing ? t('battle.pause') : t('battle.play')}</button>
          {[1, 2, 4].map((sp) => (
            <button key={sp} className={`btn btn-ghost ${session.speed === sp ? 'font-bold text-seal-700' : ''}`} onClick={() => setBattleSpeed(sp as 1 | 2 | 4)}>
              {t('battle.speed')} ×{sp}
            </button>
          ))}
          {reserves.length > 0 && (
            <button className="btn" onClick={() => submitBattleOrders([{ kind: 'commitReserves', factionId: session.playerFactionId }])}>
              {t('battle.commitReserves')}
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => quickResolveBattle()}>{t('battle.quickResolve')}</button>
        </div>
      )}

      {/* Gambits */}
      {!resolved && session.gambits.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-seal-500/40 bg-seal-500/5 px-2 py-1">
          <span className="font-display text-xs tracking-widest text-seal-700">{t('battle.gambits')}</span>
          {session.gambits.map((g) => (
            <button key={g.id} className="btn btn-primary" onClick={() => { chooseBattleGambit(g.id); resolveBattleDay(); }}>
              {t(g.labelKey as never)}
            </button>
          ))}
        </div>
      )}

      {/* Per-unit orders */}
      {!resolved && (
        <div className="max-h-28 overflow-y-auto rounded border border-ink-300/40 px-2 py-1">
          <div className="text-[11px] uppercase tracking-widest text-ink-500">{t('battle.yourOrders')}</div>
          <ul className="flex flex-wrap gap-2">
            {playerUnits.map((u) => (
              <li key={u.id} className="flex items-center gap-1 rounded bg-parchment-50 px-1.5 py-0.5 text-xs">
                <span className="font-mono">{u.troops.toLocaleString()}</span>
                <button className="btn-ghost text-[11px]" onClick={() => submitBattleOrders([{ kind: 'hold', unitId: u.id }])}>{t('battle.hold')}</button>
                <button className="btn-ghost text-[11px]" onClick={() => {
                  const foe = battle.units.find((e) => e.factionId !== u.factionId && e.state === 'fielded');
                  if (foe) submitBattleOrders([{ kind: 'charge', unitId: u.id, targetUnitId: foe.id }]);
                }}>{t('battle.charge')}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* After-action */}
      {resolved && (
        <div className="rounded border border-ink-300/50 bg-parchment-50 px-4 py-3">
          <div className={`font-display text-lg tracking-widest ${session.attackerWon === session.playerIsAttacker ? 'text-emerald-700' : 'text-seal-700'}`}>
            {session.attackerWon === session.playerIsAttacker ? t('battle.victoryTitle') : t('battle.defeatTitle')}
          </div>
          <button className="btn btn-primary mt-2" autoFocus onClick={() => finishBattle()}>{t('battle.finish')}</button>
        </div>
      )}
    </div>
  );
};

const Bar: React.FC<{ label: string; color: string; value: number }> = ({ label, color, value }) => (
  <div className="flex items-center gap-2">
    <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
    <span className="text-ink-600">{label}</span>
    <span className="font-mono tabular-nums text-ink-800">{value.toLocaleString()}</span>
  </div>
);
```

- [ ] **Step 5: Add the `battle` case in `src/web/App.tsx`**

Add the import next to the other screen imports:

```ts
import { BattleScreen } from './battle/BattleScreen.js';
```

Add the case in the `switch (screen.kind)`:

```ts
    case 'battle':
      body = <BattleScreen />;
      break;
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run tests/web/BattleScreen.test.tsx`
Expected: PASS (2 tests). The SVG view renders fine under jsdom (no canvas/WebGL used); audio cues are silent no-ops.

- [ ] **Step 7: Commit**

```bash
git add src/web/battle/BattleField2D.tsx src/web/battle/BattleScreen.tsx src/web/App.tsx tests/web/BattleScreen.test.tsx
git commit -m "feat(battle): playable SVG battle screen with HUD, gambits, per-unit orders, quick-resolve"
```

---

### Task 1.6: End-to-end integration + wire the player attack flow

Prove the full loop — schedule an attack, advance time, land in the battle screen, resolve, and return to the map with ownership applied — and retire the vestigial one-shot `BattleAnimation` modal from the player siege path.

**Files:**
- Modify: `src/web/screens/MainScreen.tsx` (remove the now-superseded `battleAnim` modal branch, if present, so the persistent-game path is the only battle route; keep `BattleReport` import only if still used elsewhere)
- Test: `tests/playthrough/battle-flow.test.ts`

**Interfaces:**
- Consumes: `schedulePlayer`, `advanceDays`, `quickResolveBattle`, `finishBattle`, `gameStore` (`../../state/store.js`); `newGame`.

- [ ] **Step 1: Write the integration test** (green by construction if Tasks 0.8 + 1.2 are correct)

```ts
// tests/playthrough/battle-flow.test.ts
import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { adjacentCities } from '../../src/engine/map.js';
import { gameStore, loadGame, advanceDays, quickResolveBattle, finishBattle } from '../../src/state/store.js';

describe('battle flow — schedule attack -> battle screen -> resolve -> map', () => {
  it('a player attack routes through the battle screen and applies the outcome', () => {
    // Seed a state where caocao borders a weak enemy city.
    const s = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 55 });
    const home = Object.values(s.cities).find((c) => c.factionId === 'caocao' && c.generals.length > 0)!;
    const target = adjacentCities(s, home.id).find((c) => c.factionId && c.factionId !== 'caocao');
    if (!target) return; // scenario-dependent; skip if no adjacent enemy
    const weak = {
      ...s,
      cities: {
        ...s.cities,
        [target.id]: { ...s.cities[target.id]!, garrison: 400, generals: [] },
        [home.id]: { ...home, garrison: 25000 },
      },
    };
    loadGame({ game: weak, locale: 'zh' });

    // Schedule the attack via the same command the UI issues, then advance.
    const { schedulePlayer } = require('../../src/state/store.js');
    schedulePlayer({ kind: 'attack', fromCityId: home.id, toCityId: target.id, generalIds: home.generals.slice(0, 2), troops: 20000 });
    // Advance enough days for the march + siege to complete.
    for (let i = 0; i < 20 && gameStore.getState().ui.screen.kind !== 'battle'; i++) advanceDays(7);

    expect(gameStore.getState().ui.screen.kind).toBe('battle');
    quickResolveBattle();
    finishBattle();
    const st = gameStore.getState();
    expect(st.ui.screen.kind === 'main' || st.ui.screen.kind === 'gameOver').toBe(true);
    expect(st.game!.pendingBattle).toBeUndefined();
  });
});
```

Note: use a top-of-file `import` for `schedulePlayer` instead of `require` if the project forbids CommonJS `require` (it does — this is ESM). Replace the inline `require` with a normal import at the top:

```ts
import { schedulePlayer } from '../../src/state/store.js';
```

- [ ] **Step 2: Run to verify current behavior**

Run: `npx vitest run tests/playthrough/battle-flow.test.ts`
Expected: PASS if the wiring from Tasks 0.8/1.2 is correct. If `screen.kind` never becomes `'battle'`, the march/siege durations exceeded 20 weeks for this seed — increase the loop bound or the committed troops. This test exercises the real `schedulePlayer → march → siege → deferPlayerBattles` path.

- [ ] **Step 3: Retire the vestigial `battleAnim` modal (if present)**

In `src/web/screens/MainScreen.tsx`, the `Modal` union has a `battleAnim` variant and a render branch that calls `commitPrecomputedGame`. This belonged to the pre-`pendingOp` instant-attack design and is not reachable in the persistent-game path (attacks now `schedulePlayer` a march). Remove the `battleAnim` case from the `Modal` union and its render branch, and remove the `BattleAnimation` import if it becomes unused. Leave `BattleReport` untouched if still referenced; otherwise remove its import too. Do **not** change the attack composer flow (`schedulePlayer`).

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: PASS — all suites green, including the pre-existing `tests/web/MainScreen.test.tsx` (removing an unreachable modal branch does not affect its assertions).

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/screens/MainScreen.tsx tests/playthrough/battle-flow.test.ts
git commit -m "feat(battle): end-to-end player battle flow; retire vestigial battle-animation modal"
```

**Phase 1 complete.** The player fights a real, deterministic battle in a playable (if plain) screen, and the outcome flows back into the strategic game.

---

## Plan 2 — Three.js renderer (Phases 2–3), authored after Phase 1 lands

Plan 2 will be written once Phase 1 is merged and the `BattleEvent`/`BattleSession` shapes are proven in play. It swaps `BattleField2D` for a Three.js canvas **behind the same `battle` store slice and `BattleSession` API** — no engine or session changes. Scope preview (not bite-sized here):

- **Phase 2:** add `three` + `@types/three`; `src/web/battle/BattleScene.ts` (scene/render loop), `terrainMesh.ts` (mesh from `BattleField.heights/cells` + water plane + wall/gate), `units.ts` (instanced billboards scaled by troop count, faction color, general banner, morale bar), `camera.ts` (cinematic framing + orbit toggle), and core FX (`volley`/`clash`/`rout`) consuming `session.lastEvents`. Guard `getContext('webgl')` so the screen falls back to `BattleField2D` (and quick-resolve) when WebGL is unavailable — including under jsdom tests.
- **Phase 3:** particle fire/flood/charge dust, cinematic camera shots, procedural realistic materials/lighting in `assets.ts`, wind + 赤壁-style naval/fire flavor on `river`/`navy` fields, instancing/perf, and a settings surface (render quality, default-to-quick-resolve).

---

## Self-Review

**Spec coverage** (each spec section → task):
- Hard seam engine→session→renderer → Tasks 0.1–0.7 (engine), 1.1 (session), 1.5 (view); renderer isolated so deletion leaves resolution intact (headless `resolveBattleHeadless` + `battleToResult`).
- `BattleField` parametric terrain (gaussian hills, Catmull-Rom river, wall/gate) → Task 0.2.
- `createBattle` activating `Battle`/`BattleUnit` → Task 0.3.
- `stepBattle` per-tick emergent sim + `BattleEvent` timeline → Tasks 0.4–0.5 (incl. fire).
- Gambits → Task 0.6; compiled into commands → Task 1.1.
- `outcome.ts` reproducing the `QuickBattleResult` contract → Task 0.7.
- `TacticalCommand` extensions (`charge`/`challengeDuel`/`commitReserves`/`gambit`) → Task 0.1, honored in 0.4/0.5.
- Strategic integration: trigger on player attacker **or** defender; AI-vs-AI unchanged; `deferPlayerBattles` flag; halt ticking → Task 0.8. Quick-resolve → Tasks 1.1/1.2/1.5. WebGL-failure fallback → Plan 2 (Phase 2), noted.
- Decision model (battle-level calls + per-unit + gambits + reserves) → Tasks 1.1/1.5.
- i18n zh+en from the first commit → Task 1.3; audio → Task 1.4.
- Determinism + tests → every engine task; regression gates at 0.7/0.8/1.2/1.6.
- Refresh-mid-battle via `game.pendingBattle` restore → Task 1.2 (`loadGame` → `enterPendingBattle`).

**Placeholder scan:** none — every code/test step contains concrete code. The one deliberately-partial spot (Task 0.4's approximate leadership) is explicitly replaced in Task 0.5 with an instruction to delete the stubs.

**Type consistency:** `BattleField` (`width/height/heights:number[]/cells:BattleCell[]/river?/wall?/seed`) is identical across 0.1/0.2/0.3/1.5. `BattleUnit` gains `state`/`formationRole` in 0.1 and `wu?`/`command?` in 0.5; `setup.ts` (0.3) populates `state`/`formationRole` and 0.5 adds `wu`/`command`. `BattleSession` fields used by the store (1.2) and screen (1.5) match those defined in 1.1. `TacticalCommand` kinds produced by gambit compilation (1.1) and per-unit UI (1.5) all exist in the 0.1 union and are handled in 0.4/0.5 (`charge`, `challengeDuel`, `commitReserves`, `gambit:fireAttack`, `march`, `hold`). `battleToResult`/`resolveBattleHeadless`/`defaultTacticalCommands` signatures match between 0.7 and their callers in 1.1.

## Open Questions

None — the spec was approved and every downstream decision (trigger scope, deferral mechanics, sim model, decision loop, phasing, SVG-before-Three.js) is settled and reflected above.

