# Living World: Goal-Oriented AI + Visibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the other Three Kingdoms factions behave with multi-month intent and surface their activity to the player, so the world feels alive.

**Architecture:** Each AI faction carries a persistent `FactionStrategy` (posture + target) in `GameState`. A new `reassess` step on `FactionAgent` recomputes it each month; `strategicRules` translates the strategy into concrete commands via four pure helpers (internal affairs, recruitment, force concentration, military). A web visibility layer (world-news feed, faction power panel, between-turn digest) renders the activity, enabled by tagging log entries with `factionId`.

**Tech Stack:** TypeScript, Vite, React 19, Zustand, Vitest, Testing Library.

**Source spec:** `docs/superpowers/specs/2026-05-15-living-world-ai-visibility-design.md`

---

## File Structure

**Engine — goal-oriented AI:**
- `src/engine/types.ts` — MODIFY: add `AiPosture`, `FactionStrategy`; `aiStrategies` on `GameState`; `strategy?` on `AgentContext`; `reassess` on `FactionAgent`.
- `src/engine/scenario.ts` — MODIFY: initialize `aiStrategies: {}`.
- `src/state/persistence.ts` — MODIFY: normalize `aiStrategies` on load (old saves).
- `src/engine/selectors.ts` — MODIFY: add `factionPower`, `powerLeader`, `factionRankings`.
- `src/engine/ai/personality.ts` — MODIFY: add/remove tuning knobs.
- `src/engine/ai/strategy.ts` — CREATE: threat detection, target selection, `reassessStrategy`.
- `src/engine/ai/strategic.ts` — REWRITE: four command helpers + composed `strategicRules`.
- `src/engine/ai/index.ts` — MODIFY: `makeDefaultAgent` gains `reassess`.
- `src/engine/pendingOp.ts` — MODIFY: `runAiMonthlyDecisions` runs the reassess→decide lifecycle; `addLog` tags `factionId`.
- `src/engine/turn.ts` — MODIFY: `advanceMonth` runs the same lifecycle.
- `src/engine/politics.ts` — MODIFY: `addLog` + callers tag `factionId`.

**Web — visibility:**
- `src/i18n/types.ts`, `src/i18n/catalog/en.ts`, `src/i18n/catalog/zh.ts` — MODIFY: new message keys.
- `src/state/store.ts` — MODIFY: `turnDigest` UI state, capture in `advanceDays`, `dismissTurnDigest`, `extractDigest`.
- `src/web/components/WorldNewsFeed.tsx` — CREATE (replaces `EventLog.tsx`).
- `src/web/components/EventLog.tsx` — DELETE.
- `src/web/components/FactionPanel.tsx` — CREATE.
- `src/web/components/TurnDigest.tsx` — CREATE.
- `src/web/screens/MainScreen.tsx` — MODIFY: wire new components.

**Tests:**
- `tests/engine/_ai-fixtures.ts` — CREATE: controlled-topology test helpers.
- `tests/engine/ai-strategy.test.ts` — CREATE.
- `tests/engine/ai-strategic.test.ts` — MODIFY: extend.
- `tests/playthrough/long-simulation.test.ts` — MODIFY: extend.
- `tests/web/WorldNewsFeed.test.tsx`, `tests/web/FactionPanel.test.tsx`, `tests/web/TurnDigest.test.tsx`, `tests/web/MainScreen.test.tsx` — CREATE.

**Commands:** typecheck `npm run typecheck` · lint `npm run lint` · all tests `npm test` · one file `npx vitest run <path>` · build `npm run build`.

---

## Task 1: AI core types + `GameState.aiStrategies` + persistence normalization

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/engine/scenario.ts:140-160` (the `return { ... }` of `buildInitialState`)
- Modify: `src/state/persistence.ts` (`loadFromSlot`)
- Test: `tests/engine/ai-strategy.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/engine/ai-strategy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';

describe('GameState.aiStrategies', () => {
  it('buildInitialState seeds an empty aiStrategies map', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 1,
    });
    expect(state.aiStrategies).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: FAIL — `aiStrategies` is `undefined`.

- [ ] **Step 3: Add the types**

In `src/engine/types.ts`, immediately after the `Personality` type declaration (`export type Personality = 'active' | 'balanced' | 'turtle';`), add:

```ts
// ----- AI strategy (goal-oriented faction planning) -----
//
// Each non-player faction carries a persistent strategy that survives
// across months so it can run coherent multi-month campaigns. It lives in
// GameState (not the agent) so it is deterministic and round-trips through
// save/load.
export type AiPosture = 'expand' | 'consolidate' | 'defend';

export interface FactionStrategy {
  posture: AiPosture;
  targetFactionId: FactionId | null; // faction we are campaigning against
  targetCityId: CityId | null; // specific enemy city we mass toward
  stagingCityId: CityId | null; // our city where we concentrate troops
  updatedTurn: number; // turn the strategy was last reassessed
}
```

In `src/engine/types.ts`, in the `AgentContext` interface, add the `strategy` field:

```ts
export interface AgentContext {
  state: GameState;
  factionId: FactionId;
  // Supplied by the turn loop, which calls agent.reassess() before
  // agent.decideStrategic(). Absent only in direct unit-test calls.
  strategy?: FactionStrategy;
}
```

In `src/engine/types.ts`, in the `GameState` interface, add `aiStrategies` right after `nextOpId: number;`:

```ts
  // Per-faction AI strategy, keyed by FactionId. Player faction has no
  // entry. Empty at scenario start; populated by the turn loop's
  // reassess step. See engine/ai/strategy.ts.
  aiStrategies: Record<FactionId, FactionStrategy>;
```

- [ ] **Step 4: Initialize the field in buildInitialState**

In `src/engine/scenario.ts`, in the object returned by `buildInitialState`, add `aiStrategies: {},` immediately after `nextOpId: 1,`:

```ts
    pendingOps: [],
    nextOpId: 1,
    aiStrategies: {},
  };
```

- [ ] **Step 5: Normalize old saves on load**

In `src/state/persistence.ts`, in `loadFromSlot`, after the version check and before `return parsed;`, add:

```ts
  // Back-compat: saves written before aiStrategies existed load without it.
  if (!parsed.state.aiStrategies) {
    parsed.state.aiStrategies = {};
  }
  return parsed;
```

- [ ] **Step 6: Run the test + typecheck**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS. If any test file constructs a `GameState` object literal from scratch (not via `buildInitialState` or a spread), TypeScript will flag the missing `aiStrategies` — add `aiStrategies: {}` to that literal.

- [ ] **Step 7: Commit**

```bash
git add src/engine/types.ts src/engine/scenario.ts src/state/persistence.ts tests/engine/ai-strategy.test.ts
git commit -m "Add FactionStrategy types and GameState.aiStrategies"
```

---

## Task 2: Personality tuning knobs

**Files:**
- Modify: `src/engine/ai/personality.ts`
- Test: `tests/engine/ai-strategy.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/ai-strategy.test.ts`:

```ts
import { PERSONALITY_PRESETS } from '../../src/engine/ai/personality.js';

describe('personality presets', () => {
  it('expose the goal-oriented tuning knobs with sane ordering', () => {
    for (const key of ['active', 'balanced', 'turtle'] as const) {
      const p = PERSONALITY_PRESETS[key];
      expect(p.leaderBiasWeight).toBeGreaterThanOrEqual(0);
      expect(p.concentrationThreshold).toBeGreaterThan(1);
      expect(p.reinforceAggressiveness).toBeGreaterThan(0);
    }
    // Aggressive factions attack with less of an edge and gang up on #1 more.
    expect(PERSONALITY_PRESETS.active.concentrationThreshold).toBeLessThan(
      PERSONALITY_PRESETS.turtle.concentrationThreshold,
    );
    expect(PERSONALITY_PRESETS.active.leaderBiasWeight).toBeGreaterThan(
      PERSONALITY_PRESETS.turtle.leaderBiasWeight,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: FAIL — `leaderBiasWeight` etc. undefined.

- [ ] **Step 3: Add the knobs**

In `src/engine/ai/personality.ts`, add three fields to the `PersonalityParams` interface (keep the existing fields):

```ts
export interface PersonalityParams {
  // Probability of invading a hostile-controlled neighbor when our army
  // exceeds theirs. Empty (uncontrolled) neighbors are always invaded.
  attackHostileProb: number;
  // Minimum army-strength advantage required to invade.
  minAdvantageRatio: number;
  // Probability of running an internal-affairs command in a quiet month.
  internalAffairsProb: number;
  // Whether to enable battlefield niceties (terrain awareness, retreats).
  smartTactics: boolean;
  // 0..1 — how strongly to prefer attacking the current power leader.
  leaderBiasWeight: number;
  // Staging-force advantage ratio required before launching an assault.
  concentrationThreshold: number;
  // 0..1 — fraction of an interior city's garrison sent to the staging city.
  reinforceAggressiveness: number;
}
```

Update each preset in `PERSONALITY_PRESETS` to include the three new fields:

```ts
export const PERSONALITY_PRESETS: Record<Personality, PersonalityParams> = {
  active: {
    attackHostileProb: 0.5,
    minAdvantageRatio: 1.05,
    internalAffairsProb: 0.8,
    smartTactics: false,
    leaderBiasWeight: 0.6,
    concentrationThreshold: 1.1,
    reinforceAggressiveness: 0.6,
  },
  balanced: {
    attackHostileProb: 0.2,
    minAdvantageRatio: 1.2,
    internalAffairsProb: 0.9,
    smartTactics: false,
    leaderBiasWeight: 0.35,
    concentrationThreshold: 1.4,
    reinforceAggressiveness: 0.4,
  },
  turtle: {
    attackHostileProb: 0.05,
    minAdvantageRatio: 1.5,
    internalAffairsProb: 1.0,
    smartTactics: false,
    leaderBiasWeight: 0.15,
    concentrationThreshold: 2.0,
    reinforceAggressiveness: 0.25,
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/ai/personality.ts tests/engine/ai-strategy.test.ts
git commit -m "Add goal-oriented personality knobs"
```

---

## Task 3: Test fixtures + threat detection (`strategy.ts`)

**Files:**
- Create: `tests/engine/_ai-fixtures.ts`
- Create: `src/engine/ai/strategy.ts`
- Test: `tests/engine/ai-strategy.test.ts`

- [ ] **Step 1: Create the test fixture helper**

Create `tests/engine/_ai-fixtures.ts`:

```ts
// Controlled-topology builders for AI unit tests. Not a test file (no
// `.test.` in the name) so vitest won't execute it directly.
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import type { City, GameState, PendingOp } from '../../src/engine/types.js';

export interface PlacedCity {
  id: string;
  factionId: string | null;
  pos: { x: number; y: number };
  garrison?: number;
  generals?: string[];
}

// Build a GameState whose only mutually-adjacent cities are the ones you
// place. Every other scenario city is parked in the far corner as neutral
// so it cannot interfere with adjacency-based AI logic.
export function makeTopology(placed: PlacedCity[]): GameState {
  const base = buildInitialState({
    scenario: SCENARIO_DONGZHUO,
    playerFactionId: 'liubei',
    refData: REF_DATA,
    seed: 1,
  });
  const placedIds = new Set(placed.map((p) => p.id));
  const cities: Record<string, City> = {};
  for (const [id, city] of Object.entries(base.cities)) {
    if (placedIds.has(id)) continue;
    cities[id] = { ...city, pos: { x: 99, y: 39 }, factionId: null, generals: [] };
  }
  for (const p of placed) {
    const src = base.cities[p.id];
    if (!src) throw new Error(`makeTopology: unknown city "${p.id}"`);
    cities[p.id] = {
      ...src,
      factionId: p.factionId,
      pos: p.pos,
      garrison: p.garrison ?? src.garrison,
      generals: p.generals ?? [],
    };
  }
  return { ...base, cities };
}

// Hand-crafted siege op targeting a city (for threat-detection tests).
export function siegeOp(targetCityId: string, factionId: string): PendingOp {
  return {
    id: 9001,
    kind: 'siege',
    factionId,
    durationDays: 10,
    daysRemaining: 5,
    targetCityId,
    generalIds: [],
    troops: 5000,
  };
}

// Hand-crafted inbound attack-march op (for threat-detection tests).
export function attackMarchOp(
  fromCityId: string,
  toCityId: string,
  factionId: string,
): PendingOp {
  return {
    id: 9002,
    kind: 'march',
    factionId,
    durationDays: 8,
    daysRemaining: 4,
    fromCityId,
    toCityId,
    generalIds: [],
    troops: 5000,
    intent: 'attack',
  };
}
```

- [ ] **Step 2: Write the failing test**

Append to `tests/engine/ai-strategy.test.ts`:

```ts
import { threatenedCityIds, isFactionThreatened } from '../../src/engine/ai/strategy.js';
import { makeTopology, siegeOp, attackMarchOp } from './_ai-fixtures.js';

describe('threat detection', () => {
  it('flags a city that is under siege', () => {
    let state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 8000 },
    ]);
    state = { ...state, pendingOps: [siegeOp('luoyang', 'caocao')] };
    expect(threatenedCityIds(state, 'dongzhuo')).toContain('luoyang');
    expect(isFactionThreatened(state, 'dongzhuo')).toBe(true);
  });

  it('flags a city targeted by an inbound enemy attack-march', () => {
    let state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 8000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 8000 },
    ]);
    state = { ...state, pendingOps: [attackMarchOp('chenliu', 'luoyang', 'caocao')] };
    expect(threatenedCityIds(state, 'dongzhuo')).toContain('luoyang');
  });

  it('flags a city with a hostile neighbor holding a big garrison edge', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 2000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 9000 },
    ]);
    expect(threatenedCityIds(state, 'dongzhuo')).toContain('luoyang');
  });

  it('reports no threat for a quiet faction', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 8000 },
    ]);
    expect(isFactionThreatened(state, 'dongzhuo')).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: FAIL — `src/engine/ai/strategy.js` does not exist.

- [ ] **Step 4: Create strategy.ts with threat detection**

Create `src/engine/ai/strategy.ts`:

```ts
import { adjacentCities, citiesOf } from '../map.js';
import type { CityId, FactionId, GameState } from '../types.js';

// A city is "threatened" when an enemy army is on its way or massed next
// door. Reads state.pendingOps and adjacency — pure, deterministic.
export function threatenedCityIds(state: GameState, factionId: FactionId): CityId[] {
  const owned = citiesOf(state, factionId);
  const ownedIds = new Set(owned.map((c) => c.id));
  const threatened = new Set<CityId>();

  for (const op of state.pendingOps) {
    if (op.kind === 'siege' && ownedIds.has(op.targetCityId)) {
      threatened.add(op.targetCityId);
    }
    if (
      op.kind === 'march' &&
      op.intent === 'attack' &&
      op.factionId !== factionId &&
      ownedIds.has(op.toCityId)
    ) {
      threatened.add(op.toCityId);
    }
  }

  for (const city of owned) {
    for (const n of adjacentCities(state, city.id)) {
      if (n.factionId === null || n.factionId === factionId) continue;
      if (n.garrison > city.garrison * 1.5) {
        threatened.add(city.id);
        break;
      }
    }
  }

  return [...threatened];
}

export function isFactionThreatened(state: GameState, factionId: FactionId): boolean {
  return threatenedCityIds(state, factionId).length > 0;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/engine/_ai-fixtures.ts src/engine/ai/strategy.ts tests/engine/ai-strategy.test.ts
git commit -m "Add AI threat detection + test fixtures"
```

---

## Task 4: Faction power + expansion target selection

**Files:**
- Modify: `src/engine/selectors.ts`
- Modify: `src/engine/ai/strategy.ts`
- Test: `tests/engine/ai-strategy.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/ai-strategy.test.ts`:

```ts
import { factionPower, powerLeader } from '../../src/engine/selectors.js';
import { selectExpansionTarget } from '../../src/engine/ai/strategy.js';
import { PERSONALITY_PRESETS } from '../../src/engine/ai/personality.js';

describe('expansion target selection', () => {
  // dongzhuo borders a weak caocao city and a strong yuanshao city.
  function bordersState() {
    return makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 10000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 500 },
      { id: 'puyang', factionId: 'yuanshao', pos: { x: 14, y: 10 }, garrison: 50000 },
    ]);
  }

  it('picks the softest bordering enemy city as the target', () => {
    const state = bordersState();
    const target = selectExpansionTarget(state, 'dongzhuo', PERSONALITY_PRESETS.turtle);
    expect(target?.targetCityId).toBe('chenliu');
    expect(target?.stagingCityId).toBe('luoyang');
  });

  it('biases toward the power leader when the bias weight is high', () => {
    const state = bordersState();
    // yuanshao holds the 50k-garrison city, so it is the leader.
    expect(powerLeader(state)).toBe('yuanshao');
    const target = selectExpansionTarget(state, 'dongzhuo', {
      ...PERSONALITY_PRESETS.active,
      leaderBiasWeight: 1,
    });
    expect(target?.targetFactionId).toBe('yuanshao');
  });

  it('returns null when the faction has no enemy-adjacent cities', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 10000 },
    ]);
    expect(selectExpansionTarget(state, 'dongzhuo', PERSONALITY_PRESETS.balanced)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: FAIL — `factionPower`, `powerLeader`, `selectExpansionTarget` not defined.

- [ ] **Step 3: Add factionPower + powerLeader to selectors.ts**

In `src/engine/selectors.ts`, append:

```ts
// Composite power score for a faction: troops plus 5000 per city. Used by
// both the AI's target selection and the UI's faction power panel so the
// two agree on "who is winning".
export function factionPower(state: GameState, factionId: FactionId): number {
  const totals = factionTotals(state, factionId);
  return totals.troops + totals.cities * 5000;
}

// The strongest alive faction — the one rivals want to gang up on.
export function powerLeader(state: GameState): FactionId | null {
  let best: FactionId | null = null;
  let bestPower = -1;
  for (const f of aliveFactions(state)) {
    const p = factionPower(state, f.id);
    if (p > bestPower) {
      bestPower = p;
      best = f.id;
    }
  }
  return best;
}
```

- [ ] **Step 4: Add selectExpansionTarget to strategy.ts**

In `src/engine/ai/strategy.ts`, update the import line and append the new code:

```ts
import { adjacentCities, citiesOf } from '../map.js';
import { factionPower, powerLeader } from '../selectors.js';
import type { City, CityId, FactionId, GameState } from '../types.js';
import type { PersonalityParams } from './personality.js';
```

Append to `src/engine/ai/strategy.ts`:

```ts
export interface ExpansionTarget {
  targetFactionId: FactionId;
  targetCityId: CityId;
  stagingCityId: CityId;
}

// Pick an enemy faction + a specific border city to march on, plus our own
// staging city. Prefers weak enemies that border us, biased toward the
// current power leader by the personality's leaderBiasWeight.
export function selectExpansionTarget(
  state: GameState,
  factionId: FactionId,
  params: PersonalityParams,
): ExpansionTarget | null {
  const owned = citiesOf(state, factionId);
  if (owned.length === 0) return null;
  const leader = powerLeader(state);

  type Pair = { our: City; enemy: City };
  const pairs: Pair[] = [];
  for (const our of owned) {
    for (const enemy of adjacentCities(state, our.id)) {
      if (enemy.factionId === null || enemy.factionId === factionId) continue;
      pairs.push({ our, enemy });
    }
  }
  if (pairs.length === 0) return null;

  // Lower score = better target. Soft city + weak faction lower it; being
  // the power leader lowers it further (gang-up bias).
  let best: Pair | null = null;
  let bestScore = Infinity;
  for (const p of pairs) {
    const enemyFactionPower = factionPower(state, p.enemy.factionId as FactionId);
    const leaderBonus =
      p.enemy.factionId === leader ? -params.leaderBiasWeight * 20000 : 0;
    const score = p.enemy.garrison + enemyFactionPower * 0.1 + leaderBonus;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (!best) return null;

  return {
    targetFactionId: best.enemy.factionId as FactionId,
    targetCityId: best.enemy.id,
    stagingCityId: best.our.id,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/selectors.ts src/engine/ai/strategy.ts tests/engine/ai-strategy.test.ts
git commit -m "Add faction power scoring and AI expansion target selection"
```

---

## Task 5: `reassessStrategy` — posture decision + persistence

**Files:**
- Modify: `src/engine/ai/strategy.ts`
- Test: `tests/engine/ai-strategy.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/ai-strategy.test.ts`:

```ts
import { reassessStrategy } from '../../src/engine/ai/strategy.js';
import type { FactionStrategy } from '../../src/engine/types.js';

describe('reassessStrategy', () => {
  function healthyBorders() {
    return makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 30000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 4000 },
    ]);
  }

  it('returns defend when a city is under siege', () => {
    let state = healthyBorders();
    state = { ...state, pendingOps: [siegeOp('luoyang', 'caocao')] };
    const s = reassessStrategy(
      { state, factionId: 'dongzhuo' },
      null,
      PERSONALITY_PRESETS.balanced,
    );
    expect(s.posture).toBe('defend');
  });

  it('returns consolidate when a city has collapsed loyalty', () => {
    let state = healthyBorders();
    state = {
      ...state,
      cities: {
        ...state.cities,
        luoyang: { ...state.cities['luoyang']!, loyalty: 10 },
      },
    };
    const s = reassessStrategy(
      { state, factionId: 'dongzhuo' },
      null,
      PERSONALITY_PRESETS.balanced,
    );
    expect(s.posture).toBe('consolidate');
  });

  it('returns expand with a target when healthy and bordering an enemy', () => {
    const state = healthyBorders();
    const s = reassessStrategy(
      { state, factionId: 'dongzhuo' },
      null,
      PERSONALITY_PRESETS.balanced,
    );
    expect(s.posture).toBe('expand');
    expect(s.targetCityId).toBe('chenliu');
    expect(s.stagingCityId).toBe('luoyang');
  });

  it('persists a still-valid expand strategy across reassessment', () => {
    const state = healthyBorders();
    const first = reassessStrategy(
      { state, factionId: 'dongzhuo' },
      null,
      PERSONALITY_PRESETS.balanced,
    );
    const second = reassessStrategy(
      { state, factionId: 'dongzhuo' },
      first,
      PERSONALITY_PRESETS.balanced,
    );
    expect(second).toBe(first);
  });

  it('drops a strategy whose target city we have already captured', () => {
    const state = healthyBorders();
    const stale: FactionStrategy = {
      posture: 'expand',
      targetFactionId: 'caocao',
      targetCityId: 'chenliu',
      stagingCityId: 'luoyang',
      updatedTurn: 0,
    };
    const captured = {
      ...state,
      cities: {
        ...state.cities,
        chenliu: { ...state.cities['chenliu']!, factionId: 'dongzhuo' },
      },
    };
    const s = reassessStrategy(
      { state: captured, factionId: 'dongzhuo' },
      stale,
      PERSONALITY_PRESETS.balanced,
    );
    expect(s.targetCityId).not.toBe('chenliu');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: FAIL — `reassessStrategy` not defined.

- [ ] **Step 3: Implement reassessStrategy**

In `src/engine/ai/strategy.ts`, update the imports and append the new code:

```ts
import { adjacentCities, citiesOf } from '../map.js';
import { factionPower, factionTotals, powerLeader } from '../selectors.js';
import type {
  AgentContext,
  City,
  CityId,
  FactionId,
  FactionStrategy,
  GameState,
} from '../types.js';
import type { PersonalityParams } from './personality.js';
```

Append:

```ts
function consolidate(turn: number): FactionStrategy {
  return {
    posture: 'consolidate',
    targetFactionId: null,
    targetCityId: null,
    stagingCityId: null,
    updatedTurn: turn,
  };
}

// "Internally weak": a city below a loyalty/food/money floor, or the
// faction's troops are thin relative to its city count.
export function isInternallyWeak(state: GameState, factionId: FactionId): boolean {
  const owned = citiesOf(state, factionId);
  for (const c of owned) {
    if (c.loyalty < 30) return true;
    if (c.food < c.garrison * 2) return true;
    if (c.money < c.garrison * 0.5) return true;
  }
  const totals = factionTotals(state, factionId);
  if (totals.troops < totals.cities * 3000) return true;
  return false;
}

// A persisted expand strategy stays valid while the target faction still
// owns the target city (or it is neutral) and our staging city is still
// ours.
export function isStrategyStillValid(
  state: GameState,
  factionId: FactionId,
  s: FactionStrategy,
): boolean {
  if (!s.targetFactionId || !s.targetCityId || !s.stagingCityId) return false;
  const targetCity = state.cities[s.targetCityId];
  const stagingCity = state.cities[s.stagingCityId];
  if (!targetCity || !stagingCity) return false;
  if (stagingCity.factionId !== factionId) return false;
  if (targetCity.factionId === factionId) return false; // already captured
  if (targetCity.factionId === null) return true; // neutral, still grabbable
  const targetFaction = state.factions[s.targetFactionId];
  if (!targetFaction || !targetFaction.alive) return false;
  return targetCity.factionId === s.targetFactionId;
}

// Recompute a faction's standing strategy. Deterministic given state.
// Posture priority: defend > consolidate > expand. An expand strategy is
// kept verbatim while it stays valid, giving multi-month coherence.
export function reassessStrategy(
  ctx: AgentContext,
  current: FactionStrategy | null,
  params: PersonalityParams,
): FactionStrategy {
  const { state, factionId } = ctx;
  const owned = citiesOf(state, factionId);
  if (owned.length === 0) return consolidate(state.turn);

  if (isFactionThreatened(state, factionId)) {
    return {
      posture: 'defend',
      targetFactionId: null,
      targetCityId: null,
      stagingCityId: null,
      updatedTurn: state.turn,
    };
  }

  if (isInternallyWeak(state, factionId)) return consolidate(state.turn);

  if (
    current &&
    current.posture === 'expand' &&
    isStrategyStillValid(state, factionId, current)
  ) {
    return current;
  }

  const target = selectExpansionTarget(state, factionId, params);
  if (!target) return consolidate(state.turn);
  return {
    posture: 'expand',
    targetFactionId: target.targetFactionId,
    targetCityId: target.targetCityId,
    stagingCityId: target.stagingCityId,
    updatedTurn: state.turn,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/ai/strategy.ts tests/engine/ai-strategy.test.ts
git commit -m "Add reassessStrategy: posture decision with persistent targets"
```

---

## Task 6: Add `reassess` to `FactionAgent` + wire `makeDefaultAgent`

**Files:**
- Modify: `src/engine/types.ts` (`FactionAgent` interface)
- Modify: `src/engine/ai/index.ts`
- Test: `tests/engine/ai-strategy.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/ai-strategy.test.ts`:

```ts
import { makeDefaultAgent } from '../../src/engine/ai/index.js';

describe('makeDefaultAgent.reassess', () => {
  it('produces a strategy for the faction', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 30000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 4000 },
    ]);
    const agent = makeDefaultAgent('dongzhuo', 'balanced');
    const strategy = agent.reassess({ state, factionId: 'dongzhuo' }, null);
    expect(['expand', 'consolidate', 'defend']).toContain(strategy.posture);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: FAIL — `agent.reassess` is not a function.

- [ ] **Step 3: Add reassess to the FactionAgent interface**

In `src/engine/types.ts`, update the `FactionAgent` interface (add `reassess` as the first method):

```ts
export interface FactionAgent {
  // Recompute the faction's standing strategy. Called by the turn loop
  // before decideStrategic each month; the result is persisted into
  // GameState.aiStrategies and passed back via AgentContext.strategy.
  reassess(ctx: AgentContext, current: FactionStrategy | null): FactionStrategy;
  decideStrategic(ctx: AgentContext): StrategicCommand[];
  decideTactical(battle: Battle, ctx: AgentContext): TacticalCommand[];
}
```

- [ ] **Step 4: Implement reassess in makeDefaultAgent**

Replace the entire contents of `src/engine/ai/index.ts` with:

```ts
import type {
  AgentContext,
  Battle,
  FactionAgent,
  FactionStrategy,
  Personality,
  StrategicCommand,
  TacticalCommand,
} from '../types.js';
import { reassessStrategy } from './strategy.js';
import { strategicRules } from './strategic.js';
import { tacticalRules } from './tactical.js';
import { PERSONALITY_PRESETS } from './personality.js';

// Default rule-based agent. The same FactionAgent interface is what an
// LLM-backed implementation would satisfy; the store accepts any factory.
export function makeDefaultAgent(factionId: string, personality: Personality): FactionAgent {
  const params = PERSONALITY_PRESETS[personality];
  return {
    reassess(ctx: AgentContext, current: FactionStrategy | null): FactionStrategy {
      return reassessStrategy({ ...ctx, factionId }, current, params);
    },
    decideStrategic(ctx: AgentContext): StrategicCommand[] {
      return strategicRules({ ...ctx, factionId }, personality);
    },
    decideTactical(battle: Battle, ctx: AgentContext): TacticalCommand[] {
      void ctx;
      return tacticalRules(battle, factionId, personality);
    },
  };
}

export type { FactionAgent, AgentContext } from '../types.js';
export { strategicRules } from './strategic.js';
export { tacticalRules } from './tactical.js';
export { reassessStrategy } from './strategy.js';
export { PERSONALITY_PRESETS } from './personality.js';
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS — `makeDefaultAgent` is the only `FactionAgent` literal, so the interface change compiles cleanly everywhere else.

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts src/engine/ai/index.ts tests/engine/ai-strategy.test.ts
git commit -m "Add reassess to FactionAgent and wire makeDefaultAgent"
```

---

## Task 7: `strategicRules` helper — internal affairs (up to 2 per city)

**Files:**
- Modify: `src/engine/ai/strategic.ts`
- Test: `tests/engine/ai-strategic.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/ai-strategic.test.ts`:

```ts
import { internalAffairsCommands } from '../../src/engine/ai/strategic.js';
import { factionGenerals } from '../../src/engine/selectors.js';

describe('internalAffairsCommands', () => {
  it('emits up to two distinct internal-affairs actions for a needy city', () => {
    const base = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 7,
    });
    // Make Dong Zhuo's Luoyang both disloyal and short on food.
    const luoyang = base.cities['luoyang']!;
    const state = {
      ...base,
      cities: {
        ...base.cities,
        luoyang: { ...luoyang, loyalty: 12, food: 10, garrison: 9000 },
      },
    };
    const generals = factionGenerals(state, 'dongzhuo');
    const cmds = internalAffairsCommands(state, 'dongzhuo', generals);
    const forLuoyang = cmds.filter(
      (c) => 'cityId' in c && c.cityId === 'luoyang',
    );
    expect(forLuoyang.length).toBe(2);
    expect(forLuoyang.some((c) => c.kind === 'govern')).toBe(true);
    expect(forLuoyang.some((c) => c.kind === 'develop')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/ai-strategic.test.ts`
Expected: FAIL — `internalAffairsCommands` not exported.

- [ ] **Step 3: Add the helper to strategic.ts**

In `src/engine/ai/strategic.ts`, append (do not touch the existing `strategicRules` yet):

```ts
// ----- Command helpers (consumed by the rewritten strategicRules) -----

type CityNeed = 'govern' | 'develop' | 'commerce' | 'search' | 'patrol';

function hasWildGeneralIn(state: GameState, cityId: string): boolean {
  return Object.values(state.generals).some(
    (g) => g.factionId === null && g.locationCityId === cityId && g.status === 'active',
  );
}

// Ordered list of what a city most needs, most urgent first. De-duplicated.
function rankCityNeeds(state: GameState, city: City): CityNeed[] {
  const needs: CityNeed[] = [];
  if (city.loyalty < 50) needs.push('govern');
  if (city.food < city.garrison * 3) needs.push('develop');
  if (city.money < city.garrison) needs.push('commerce');
  if (city.agriculture < 70) needs.push('develop');
  if (city.commerce < 70) needs.push('commerce');
  if (hasWildGeneralIn(state, city.id)) needs.push('search');
  needs.push('patrol');
  return [...new Set(needs)];
}

// Up to two distinct internal-affairs actions per owned city per month,
// each run by a different stationed general where possible.
export function internalAffairsCommands(
  state: GameState,
  factionId: string,
  generals: General[],
): StrategicCommand[] {
  const cmds: StrategicCommand[] = [];
  for (const city of citiesOf(state, factionId)) {
    const inCity = generals
      .filter((g) => g.locationCityId === city.id && g.status === 'active')
      .sort((a, b) => b.stats.zheng - a.stats.zheng);
    if (inCity.length === 0) continue;
    const needs = rankCityNeeds(state, city);
    const count = Math.min(2, needs.length);
    for (let i = 0; i < count; i++) {
      const general = inCity[i] ?? inCity[0]!;
      cmds.push({ kind: needs[i]!, cityId: city.id, generalId: general.id });
    }
  }
  return cmds;
}
```

If `City` or `General` are not already imported in `strategic.ts`, add them to the existing `import type { ... } from '../types.js';` line so it reads:

```ts
import type {
  AgentContext,
  StrategicCommand,
  Personality,
  City,
  General,
  GameState,
} from '../types.js';
```

- [ ] **Step 4: Run test + the existing suite for this file**

Run: `npx vitest run tests/engine/ai-strategic.test.ts`
Expected: PASS — new test passes, the two pre-existing `strategicRules` tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/ai/strategic.ts tests/engine/ai-strategic.test.ts
git commit -m "Add internalAffairsCommands AI helper"
```

---

## Task 8: `strategicRules` helper — recruitment (posture-weighted)

**Files:**
- Modify: `src/engine/ai/strategic.ts`
- Test: `tests/engine/ai-strategic.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/ai-strategic.test.ts`:

```ts
import { recruitmentCommands } from '../../src/engine/ai/strategic.js';
import type { FactionStrategy } from '../../src/engine/types.js';

describe('recruitmentCommands', () => {
  it('recruits hardest at the staging city when expanding', () => {
    const base = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 8,
    });
    // Give Dong Zhuo's cities plenty of gold so affordability never blocks.
    const cities = { ...base.cities };
    for (const c of Object.values(cities)) {
      if (c.factionId === 'dongzhuo') {
        cities[c.id] = { ...c, money: 500000, garrison: 5000 };
      }
    }
    const state = { ...base, cities };
    const stagingId = Object.values(cities).find((c) => c.factionId === 'dongzhuo')!.id;
    const strategy: FactionStrategy = {
      posture: 'expand',
      targetFactionId: 'caocao',
      targetCityId: 'chenliu',
      stagingCityId: stagingId,
      updatedTurn: 0,
    };
    const cmds = recruitmentCommands(state, 'dongzhuo', strategy);
    const staging = cmds.find(
      (c) => c.kind === 'recruit' && c.cityId === stagingId,
    );
    expect(staging).toBeDefined();
    expect(staging && staging.kind === 'recruit' && staging.count).toBe(2000);
  });

  it('skips cities that cannot afford even a small draft', () => {
    const base = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 8,
    });
    const cities = { ...base.cities };
    for (const c of Object.values(cities)) {
      if (c.factionId === 'dongzhuo') cities[c.id] = { ...c, money: 0 };
    }
    const state = { ...base, cities };
    const strategy: FactionStrategy = {
      posture: 'consolidate',
      targetFactionId: null,
      targetCityId: null,
      stagingCityId: null,
      updatedTurn: 0,
    };
    expect(recruitmentCommands(state, 'dongzhuo', strategy)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/ai-strategic.test.ts`
Expected: FAIL — `recruitmentCommands` not exported.

- [ ] **Step 3: Add the helper to strategic.ts**

In `src/engine/ai/strategic.ts`, add `FactionStrategy` to the `import type { ... } from '../types.js';` line, add a threat-detection import, and append the helper:

```ts
import { threatenedCityIds } from './strategy.js';
```

```ts
// Posture-weighted recruitment. expand → mass at the staging city;
// defend → reinforce threatened cities; otherwise routine build-up. A
// city needs gold for at least 500 troops to recruit at all.
export function recruitmentCommands(
  state: GameState,
  factionId: string,
  strategy: FactionStrategy,
): StrategicCommand[] {
  const cmds: StrategicCommand[] = [];
  const threatened = new Set(threatenedCityIds(state, factionId));
  for (const city of citiesOf(state, factionId)) {
    if (city.money < 500) continue;
    let count = 0;
    if (strategy.posture === 'expand' && city.id === strategy.stagingCityId) {
      count = 2000;
    } else if (strategy.posture === 'defend' && threatened.has(city.id)) {
      count = 2000;
    } else if (city.money > city.garrison * 2 && city.garrison < 20000) {
      count = 1000;
    }
    if (count > 0) cmds.push({ kind: 'recruit', cityId: city.id, count });
  }
  return cmds;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/ai-strategic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/ai/strategic.ts tests/engine/ai-strategic.test.ts
git commit -m "Add recruitmentCommands AI helper"
```

---

## Task 9: `strategicRules` helper — force concentration + opportunistic grabs

**Files:**
- Modify: `src/engine/ai/strategic.ts`
- Test: `tests/engine/ai-strategic.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/ai-strategic.test.ts`:

```ts
import { concentrationCommands } from '../../src/engine/ai/strategic.js';
import { PERSONALITY_PRESETS } from '../../src/engine/ai/personality.js';
import { makeTopology } from './_ai-fixtures.js';

describe('concentrationCommands', () => {
  it('moves troops from a safe interior city toward the staging city', () => {
    // luoyang (staging, borders enemy chenliu) + anding (interior, safe).
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 8000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 8000 },
      { id: 'anding', factionId: 'dongzhuo', pos: { x: 60, y: 30 }, garrison: 10000 },
    ]);
    const generals = factionGenerals(state, 'dongzhuo');
    const strategy: FactionStrategy = {
      posture: 'expand',
      targetFactionId: 'caocao',
      targetCityId: 'chenliu',
      stagingCityId: 'luoyang',
      updatedTurn: 0,
    };
    const cmds = concentrationCommands(
      state,
      'dongzhuo',
      strategy,
      generals,
      PERSONALITY_PRESETS.active,
    );
    const move = cmds.find((c) => c.kind === 'move');
    expect(move).toBeDefined();
    expect(move && move.kind === 'move' && move.fromCityId).toBe('anding');
    expect(move && move.kind === 'move' && move.toCityId).toBe('luoyang');
  });

  it('grabs an adjacent neutral city when troops are spare', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 9000 },
      { id: 'chenliu', factionId: null, pos: { x: 12, y: 10 }, garrison: 1000 },
    ]);
    const generals = factionGenerals(state, 'dongzhuo');
    const strategy: FactionStrategy = {
      posture: 'consolidate',
      targetFactionId: null,
      targetCityId: null,
      stagingCityId: null,
      updatedTurn: 0,
    };
    const cmds = concentrationCommands(
      state,
      'dongzhuo',
      strategy,
      generals,
      PERSONALITY_PRESETS.balanced,
    );
    const grab = cmds.find((c) => c.kind === 'attack');
    expect(grab).toBeDefined();
    expect(grab && grab.kind === 'attack' && grab.toCityId).toBe('chenliu');
  });
});
```

Note: `luoyang`, `chenliu`, and `anding` are all real city ids in `src/data/cities.ts` (the source of `REF_DATA.cities`), so `makeTopology` accepts them. `anding` here is the safe interior city — it sits far from `luoyang`/`chenliu` so it has no enemy neighbor.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/ai-strategic.test.ts`
Expected: FAIL — `concentrationCommands` not exported.

- [ ] **Step 3: Add the helper to strategic.ts**

In `src/engine/ai/strategic.ts`, ensure `enemyNeighbors` and `citiesOf` are imported from `../map.js` (the file already imports `citiesOf, enemyNeighbors`). Add `PersonalityParams` import:

```ts
import type { PersonalityParams } from './personality.js';
```

Append the helper. It reuses the existing `topGeneralsIn` helper already in the file:

```ts
// expand → funnel troops from safe interior cities to the staging city.
// Any posture → take one adjacent neutral city when troops are spare.
export function concentrationCommands(
  state: GameState,
  factionId: string,
  strategy: FactionStrategy,
  generals: General[],
  params: PersonalityParams,
): StrategicCommand[] {
  const cmds: StrategicCommand[] = [];
  const owned = citiesOf(state, factionId);

  if (strategy.posture === 'expand' && strategy.stagingCityId) {
    const staging = state.cities[strategy.stagingCityId];
    if (staging) {
      for (const city of owned) {
        if (city.id === staging.id) continue;
        // Only drain "interior" cities — those with no enemy/neutral neighbor.
        if (enemyNeighbors(state, city.id, factionId).length > 0) continue;
        const spare = Math.floor(city.garrison * params.reinforceAggressiveness);
        if (spare < 1000) continue;
        const escort = topGeneralsIn(generals, city.id, 1).map((g) => g.id);
        cmds.push({
          kind: 'move',
          fromCityId: city.id,
          toCityId: staging.id,
          generalIds: escort,
          troops: spare,
        });
      }
    }
  }

  for (const city of owned) {
    if (city.garrison < 3000) continue;
    const neutral = enemyNeighbors(state, city.id, factionId).find(
      (n) => n.factionId === null,
    );
    if (!neutral) continue;
    const led = topGeneralsIn(generals, city.id, 1);
    if (led.length === 0) continue;
    cmds.push({
      kind: 'attack',
      fromCityId: city.id,
      toCityId: neutral.id,
      generalIds: led.map((g) => g.id),
      troops: Math.min(city.garrison - 1000, 4000),
    });
    break; // one opportunistic grab per month
  }

  return cmds;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/ai-strategic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/ai/strategic.ts tests/engine/ai-strategic.test.ts
git commit -m "Add concentrationCommands AI helper (force massing + neutral grabs)"
```

---

## Task 10: `strategicRules` helper — military (assault + defense)

**Files:**
- Modify: `src/engine/ai/strategic.ts`
- Test: `tests/engine/ai-strategic.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/ai-strategic.test.ts`:

```ts
import { militaryCommands } from '../../src/engine/ai/strategic.js';
import { siegeOp } from './_ai-fixtures.js';

describe('militaryCommands', () => {
  it('assaults the target once the staging force clears the threshold', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 30000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 4000 },
    ]);
    const generals = factionGenerals(state, 'dongzhuo');
    const strategy: FactionStrategy = {
      posture: 'expand',
      targetFactionId: 'caocao',
      targetCityId: 'chenliu',
      stagingCityId: 'luoyang',
      updatedTurn: 0,
    };
    const cmds = militaryCommands(
      state,
      'dongzhuo',
      strategy,
      generals,
      PERSONALITY_PRESETS.active,
    );
    const attack = cmds.find((c) => c.kind === 'attack');
    expect(attack).toBeDefined();
    expect(attack && attack.kind === 'attack' && attack.toCityId).toBe('chenliu');
  });

  it('does not assault while the staging force is too thin', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 4000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 30000 },
    ]);
    const generals = factionGenerals(state, 'dongzhuo');
    const strategy: FactionStrategy = {
      posture: 'expand',
      targetFactionId: 'caocao',
      targetCityId: 'chenliu',
      stagingCityId: 'luoyang',
      updatedTurn: 0,
    };
    const cmds = militaryCommands(
      state,
      'dongzhuo',
      strategy,
      generals,
      PERSONALITY_PRESETS.turtle,
    );
    expect(cmds.find((c) => c.kind === 'attack')).toBeUndefined();
  });

  it('reinforces a threatened city from a safe neighbor when defending', () => {
    let state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 2000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 9000 },
      { id: 'anding', factionId: 'dongzhuo', pos: { x: 11, y: 11 }, garrison: 10000 },
    ]);
    state = { ...state, pendingOps: [siegeOp('luoyang', 'caocao')] };
    const generals = factionGenerals(state, 'dongzhuo');
    const strategy: FactionStrategy = {
      posture: 'defend',
      targetFactionId: null,
      targetCityId: null,
      stagingCityId: null,
      updatedTurn: 0,
    };
    const cmds = militaryCommands(
      state,
      'dongzhuo',
      strategy,
      generals,
      PERSONALITY_PRESETS.balanced,
    );
    const move = cmds.find((c) => c.kind === 'move');
    expect(move).toBeDefined();
    expect(move && move.kind === 'move' && move.toCityId).toBe('luoyang');
    expect(move && move.kind === 'move' && move.fromCityId).toBe('anding');
  });
});
```

Note: in the defense test `anding` is placed at `(11, 11)` so it is adjacent to `luoyang` at `(10, 10)` (manhattan distance 2, well within the adjacency threshold).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/ai-strategic.test.ts`
Expected: FAIL — `militaryCommands` not exported.

- [ ] **Step 3: Add the helper to strategic.ts**

In `src/engine/ai/strategic.ts`, add `adjacentCities` and `citiesAdjacent` to the `../map.js` import so it reads:

```ts
import { adjacentCities, citiesAdjacent, citiesOf, enemyNeighbors } from '../map.js';
```

Append the helper. It reuses the existing `topGeneralsIn` and `sumGeneralTroopsIn` helpers already in the file:

```ts
// defend → reinforce threatened cities from safe neighbors.
// expand → assault the target city once the staging force clears the
// personality's concentrationThreshold advantage ratio.
export function militaryCommands(
  state: GameState,
  factionId: string,
  strategy: FactionStrategy,
  generals: General[],
  params: PersonalityParams,
): StrategicCommand[] {
  const cmds: StrategicCommand[] = [];

  if (strategy.posture === 'defend') {
    const threatened = threatenedCityIds(state, factionId);
    for (const tid of threatened) {
      const donor = adjacentCities(state, tid).find(
        (c) =>
          c.factionId === factionId &&
          c.garrison > 2000 &&
          !threatened.includes(c.id),
      );
      if (!donor) continue;
      const escort = topGeneralsIn(generals, donor.id, 1).map((g) => g.id);
      cmds.push({
        kind: 'move',
        fromCityId: donor.id,
        toCityId: tid,
        generalIds: escort,
        troops: Math.floor(donor.garrison * 0.5),
      });
    }
    return cmds;
  }

  if (strategy.posture === 'expand' && strategy.stagingCityId && strategy.targetCityId) {
    const staging = state.cities[strategy.stagingCityId];
    const target = state.cities[strategy.targetCityId];
    if (!staging || !target) return cmds;
    if (!citiesAdjacent(staging, target)) return cmds;
    const stagingForce = staging.garrison + sumGeneralTroopsIn(state, staging.id);
    const targetForce = target.garrison + sumGeneralTroopsIn(state, target.id);
    if (stagingForce >= Math.max(2000, targetForce * params.concentrationThreshold)) {
      const led = topGeneralsIn(generals, staging.id, 2);
      if (led.length > 0) {
        cmds.push({
          kind: 'attack',
          fromCityId: staging.id,
          toCityId: target.id,
          generalIds: led.map((g) => g.id),
          troops: Math.max(1000, staging.garrison - 1000),
        });
      }
    }
  }

  return cmds;
}
```

The existing `sumGeneralTroopsIn` in `strategic.ts` takes an `AgentContext` (`sumGeneralTroopsIn(ctx, cityId)`). Change its signature to take `GameState` directly so it works here — replace the existing function with:

```ts
function sumGeneralTroopsIn(state: GameState, cityId: string): number {
  return Object.values(state.generals)
    .filter((g) => g.locationCityId === cityId && g.status === 'active')
    .reduce((s, g) => s + g.troops, 0);
}
```

The old `strategicRules` calls `sumGeneralTroopsIn(ctx, ...)` in two places — update those two call sites to `sumGeneralTroopsIn(state, ...)` (the old `strategicRules` already has `state` in scope via `const { state, factionId } = ctx;`). This keeps the file compiling until Task 11 replaces `strategicRules` entirely.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/ai-strategic.test.ts`
Expected: PASS — all helper tests pass and the two original `strategicRules` tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/ai/strategic.ts tests/engine/ai-strategic.test.ts
git commit -m "Add militaryCommands AI helper (assault + defensive reinforce)"
```

---

## Task 11: Compose `strategicRules` from the helpers

**Files:**
- Modify: `src/engine/ai/strategic.ts`
- Modify: `src/engine/ai/personality.ts`
- Test: `tests/engine/ai-strategic.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/ai-strategic.test.ts`:

```ts
import { strategicRules } from '../../src/engine/ai/strategic.js';

describe('strategicRules (composed)', () => {
  it('emits a move command when handed an expand strategy with a staging city', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 8000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 8000 },
      { id: 'anding', factionId: 'dongzhuo', pos: { x: 60, y: 30 }, garrison: 12000 },
    ]);
    const strategy: FactionStrategy = {
      posture: 'expand',
      targetFactionId: 'caocao',
      targetCityId: 'chenliu',
      stagingCityId: 'luoyang',
      updatedTurn: 0,
    };
    const cmds = strategicRules({ state, factionId: 'dongzhuo', strategy }, 'active');
    expect(cmds.some((c) => c.kind === 'move')).toBe(true);
    expect(cmds[cmds.length - 1]!.kind).toBe('endTurn');
  });
});
```

(`anding` at `(60, 30)` is the safe interior city, as in Task 9.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/ai-strategic.test.ts`
Expected: FAIL — the current `strategicRules` ignores `ctx.strategy` and never emits `move`.

- [ ] **Step 3: Replace strategicRules with the composed version**

In `src/engine/ai/strategic.ts`, replace the **entire old `strategicRules` function body** (from `export function strategicRules(` through its closing `}`) and delete the now-unused old helpers `pickGovernor` and `hasWildGeneral`. Keep `topGeneralsIn` and the new `sumGeneralTroopsIn`. The new function:

```ts
// Decide one faction's actions for the current month. The strategy is
// supplied by the turn loop (which calls agent.reassess first) via
// ctx.strategy; a missing strategy falls back to a neutral consolidate
// posture so direct unit-test calls never throw.
export function strategicRules(
  ctx: AgentContext,
  personality: Personality,
): StrategicCommand[] {
  const { state, factionId } = ctx;
  const params = PERSONALITY_PRESETS[personality];
  const owned = citiesOf(state, factionId);
  if (owned.length === 0) return [{ kind: 'endTurn' }];
  const generals = factionGenerals(state, factionId);
  if (generals.length === 0) return [{ kind: 'endTurn' }];

  const strategy: FactionStrategy = ctx.strategy ?? {
    posture: 'consolidate',
    targetFactionId: null,
    targetCityId: null,
    stagingCityId: null,
    updatedTurn: state.turn,
  };

  const commands: StrategicCommand[] = [
    ...internalAffairsCommands(state, factionId, generals),
    ...recruitmentCommands(state, factionId, strategy),
    ...concentrationCommands(state, factionId, strategy, generals, params),
    ...militaryCommands(state, factionId, strategy, generals, params),
  ];
  commands.push({ kind: 'endTurn' });
  return commands;
}
```

Ensure these imports are present at the top of `strategic.ts` and remove any now-unused ones (`rollChance` from `../rng.js` is no longer used — delete that import):

```ts
import { adjacentCities, citiesAdjacent, citiesOf, enemyNeighbors } from '../map.js';
import { factionGenerals } from '../selectors.js';
import { threatenedCityIds } from './strategy.js';
import { PERSONALITY_PRESETS } from './personality.js';
import type { PersonalityParams } from './personality.js';
import type {
  AgentContext,
  City,
  FactionStrategy,
  GameState,
  General,
  Personality,
  StrategicCommand,
} from '../types.js';
```

- [ ] **Step 4: Remove the now-dead personality knobs**

The old `strategicRules` was the only consumer of `attackHostileProb`, `minAdvantageRatio`, and `internalAffairsProb`. In `src/engine/ai/personality.ts`, delete those three fields from the `PersonalityParams` interface and from all three presets. The interface becomes:

```ts
export interface PersonalityParams {
  // Whether to enable battlefield niceties (terrain awareness, retreats).
  smartTactics: boolean;
  // 0..1 — how strongly to prefer attacking the current power leader.
  leaderBiasWeight: number;
  // Staging-force advantage ratio required before launching an assault.
  concentrationThreshold: number;
  // 0..1 — fraction of an interior city's garrison sent to the staging city.
  reinforceAggressiveness: number;
}
```

And each preset keeps only those four fields, e.g.:

```ts
  active: {
    smartTactics: false,
    leaderBiasWeight: 0.6,
    concentrationThreshold: 1.1,
    reinforceAggressiveness: 0.6,
  },
```

(Apply the same shape to `balanced` and `turtle`, keeping the values from Task 2.)

- [ ] **Step 5: Run test + full engine suite + typecheck**

Run: `npx vitest run tests/engine/ai-strategic.test.ts`
Expected: PASS — the composed test plus all helper tests plus the two original tests.

Run: `npm run typecheck`
Expected: PASS. `tacticalRules` references `params` only via `void params;`, so dropping the three knobs does not break `tactical.ts`.

Run: `npx vitest run tests/engine/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/ai/strategic.ts src/engine/ai/personality.ts tests/engine/ai-strategic.test.ts
git commit -m "Compose strategicRules from goal-oriented helpers; drop dead knobs"
```

---

## Task 12: Wire the reassess→decide lifecycle into the turn loops

**Files:**
- Modify: `src/engine/pendingOp.ts` (`runAiMonthlyDecisions`)
- Modify: `src/engine/turn.ts` (`advanceMonth`)
- Test: `tests/engine/ai-strategy.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/ai-strategy.test.ts`:

```ts
import { advanceMonth } from '../../src/engine/turn.js';
import { tickDays } from '../../src/engine/pendingOp.js';
import type { FactionAgent, GameState } from '../../src/engine/types.js';

function buildAgents(state: GameState): Record<string, FactionAgent> {
  const agents: Record<string, FactionAgent> = {};
  for (const f of Object.values(state.factions)) {
    if (f.id === state.playerFactionId) continue;
    agents[f.id] = makeDefaultAgent(f.id, f.personality);
  }
  return agents;
}

describe('AI lifecycle wiring', () => {
  it('advanceMonth populates aiStrategies for non-player factions', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 12,
    });
    state = advanceMonth(state, buildAgents(state));
    const aiFactionIds = Object.values(state.factions)
      .filter((f) => f.id !== state.playerFactionId && f.alive)
      .map((f) => f.id);
    const populated = aiFactionIds.filter((id) => state.aiStrategies[id]);
    expect(populated.length).toBeGreaterThan(0);
  });

  it('tickDays populates aiStrategies on month rollover', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 12,
    });
    const agents = buildAgents(state);
    state = tickDays(state, 31, agents); // cross one month boundary
    expect(Object.keys(state.aiStrategies).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: FAIL — `aiStrategies` stays `{}` because the turn loops never call `reassess`.

- [ ] **Step 3: Update runAiMonthlyDecisions in pendingOp.ts**

In `src/engine/pendingOp.ts`, replace the body of `runAiMonthlyDecisions` with:

```ts
function runAiMonthlyDecisions(
  state: GameState,
  agents: Record<string, FactionAgent>,
): GameState {
  let next = state;
  for (const faction of aliveFactions(next)) {
    if (faction.id === next.playerFactionId) continue;
    const agent = agents[faction.id];
    if (!agent) continue;
    // Reassess this faction's standing strategy, persist it, then let the
    // agent translate the strategy into concrete commands.
    const current = next.aiStrategies[faction.id] ?? null;
    const strategy = agent.reassess({ state: next, factionId: faction.id }, current);
    next = {
      ...next,
      aiStrategies: { ...next.aiStrategies, [faction.id]: strategy },
    };
    const ctx: AgentContext = { state: next, factionId: faction.id, strategy };
    const cmds = agent.decideStrategic(ctx);
    for (const cmd of cmds) {
      next = schedulePlayerCommand(next, faction.id, cmd);
      next = {
        ...next,
        actionLog: [
          ...next.actionLog,
          { turn: next.turn, command: cmd, factionId: faction.id },
        ],
      };
    }
  }
  return next;
}
```

- [ ] **Step 4: Update advanceMonth in turn.ts**

In `src/engine/turn.ts`, in `advanceMonth`, replace the AI strategic phase loop (the `for (const faction of aliveFactions(next))` block) with:

```ts
  // AI strategic phase. Skip the player's faction — the UI dispatches
  // player commands directly.
  for (const faction of aliveFactions(next)) {
    if (faction.id === next.playerFactionId) continue;
    const agent = agents[faction.id];
    if (!agent) continue;
    const current = next.aiStrategies[faction.id] ?? null;
    const strategy = agent.reassess({ state: next, factionId: faction.id }, current);
    next = {
      ...next,
      aiStrategies: { ...next.aiStrategies, [faction.id]: strategy },
    };
    const ctx: AgentContext = { state: next, factionId: faction.id, strategy };
    const cmds = agent.decideStrategic(ctx);
    for (const cmd of cmds) {
      next = applyCommand(next, faction.id, cmd);
      next = {
        ...next,
        actionLog: [...next.actionLog, { turn: next.turn, command: cmd, factionId: faction.id }],
      };
    }
  }
```

- [ ] **Step 5: Run test + full engine suite**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: PASS.

Run: `npx vitest run tests/engine/ tests/playthrough/`
Expected: PASS — `long-simulation.test.ts` and `turn.test.ts` still green (their `buildAgents` uses `makeDefaultAgent`, which now provides `reassess`).

- [ ] **Step 6: Commit**

```bash
git add src/engine/pendingOp.ts src/engine/turn.ts tests/engine/ai-strategy.test.ts
git commit -m "Wire reassess->decide AI lifecycle into both turn loops"
```

---

## Task 13: Tag log entries with `factionId`

**Files:**
- Modify: `src/engine/politics.ts`
- Modify: `src/engine/pendingOp.ts` (the local `addLog`)
- Test: `tests/engine/ai-strategy.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/ai-strategy.test.ts`:

```ts
import { develop } from '../../src/engine/politics.js';

describe('log faction tagging', () => {
  it('tags an internal-affairs log entry with the city owner faction', () => {
    const base = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 13,
    });
    const luoyang = base.cities['luoyang']!;
    const governor = luoyang.generals[0]!;
    const next = develop(base, { cityId: 'luoyang', generalId: governor });
    const entry = next.log[next.log.length - 1]!;
    expect(entry.key).toBe('result.developed');
    expect(entry.factionId).toBe(luoyang.factionId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: FAIL — `entry.factionId` is `undefined`.

- [ ] **Step 3: Thread factionId through politics.ts addLog**

In `src/engine/politics.ts`, add `FactionId` to the type import from `./types.js`, then change the local `addLog` signature and body:

```ts
function addLog(
  state: GameState,
  key: string,
  vars?: Record<string, string | number | LocalizedString>,
  factionId?: FactionId,
): GameState {
  const entry: LogEntry = {
    turn: state.turn,
    year: state.year,
    month: state.month,
    key,
    vars,
    factionId,
  };
  return { ...state, log: [...state.log, entry] };
}
```

Then update the `addLog` call sites in this file to pass the owning faction:

- In `develop`: `next = addLog(next, 'result.developed', { city: city.name, amount: gain }, city.factionId ?? undefined);`
- In `commerce`: `next = addLog(next, 'result.commerceUp', { city: city.name, amount: gain }, city.factionId ?? undefined);`
- In `govern`: `next = addLog(next, 'result.governed', { city: city.name, amount: gain }, city.factionId ?? undefined);`
- In `patrol`: `next = addLog(next, 'result.patrolled', { city: city.name }, city.factionId ?? undefined);`
- In `recruit`: `next = addLog(next, 'result.recruited', { city: city.name, amount: actual, garrison: updated.garrison }, city.factionId ?? undefined);`
- In `search`: every `addLog(..., 'result.searched', { city: city.name })` call gets `, city.factionId ?? undefined` appended; the three wild-general found events (`eventKey` block) get `, gen.factionId ?? undefined` appended.
- In `applyMonthlySettlement`: the rebellion `log.push({ ... })` object gets `factionId: city.factionId ?? undefined,` added (this is the pre-flip `city`, so it records the faction that lost the city).
- In `applyYearlyAging`: the `event.generalDied` `log.push({ ... })` object gets `factionId: updated.factionId ?? undefined,` added.

- [ ] **Step 4: Thread factionId through pendingOp.ts addLog**

In `src/engine/pendingOp.ts`, change the local `addLog` signature and body:

```ts
function addLog(
  state: GameState,
  key: string,
  vars: Record<string, unknown>,
  factionId?: FactionId,
): GameState {
  const entry: LogEntry = {
    turn: state.turn,
    year: state.year,
    month: state.month,
    key,
    vars: vars as LogEntry['vars'],
    factionId,
  };
  return { ...state, log: [...state.log, entry] };
}
```

`FactionId` is already imported in `pendingOp.ts`. Update the one `addLog` call in `applyCompletedMarch` (`event.generalMoved`) to pass the marching faction: append `, op.factionId` to that call.

- [ ] **Step 5: Run test + full engine suite**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: PASS.

Run: `npx vitest run tests/engine/ tests/playthrough/`
Expected: PASS — combat.ts already tagged `event.cityFell`/`event.attackerRetreated`, so nothing regresses.

- [ ] **Step 6: Commit**

```bash
git add src/engine/politics.ts src/engine/pendingOp.ts tests/engine/ai-strategy.test.ts
git commit -m "Tag log entries with factionId for the visibility layer"
```

---

## Task 14: i18n keys for the visibility layer

**Files:**
- Modify: `src/i18n/types.ts`
- Modify: `src/i18n/catalog/en.ts`
- Modify: `src/i18n/catalog/zh.ts`
- Test: `tests/i18n/parity.test.ts` (existing — runs as the verification)

- [ ] **Step 1: Add the keys to the MessageKey union**

In `src/i18n/types.ts`, at the end of the `MessageKey` union, immediately after `| 'common.grain';` change that line to `| 'common.grain'` (drop the semicolon) and append a new section before the final `;`:

```ts
  | 'common.grain'

  // World news feed
  | 'news.heading'
  | 'news.filter.all'
  | 'news.filter.mine'
  | 'news.filter.world'
  | 'news.empty'

  // Faction power panel
  | 'faction.rankHeading'
  | 'faction.you'
  | 'faction.eliminated'

  // Between-turn digest
  | 'digest.heading'
  | 'digest.dismiss';
```

- [ ] **Step 2: Add the English strings**

In `src/i18n/catalog/en.ts`, before the closing `};` of the `en` object, add:

```ts
  'news.heading': 'Chronicle',
  'news.filter.all': 'All',
  'news.filter.mine': 'My Realm',
  'news.filter.world': 'The Realm',
  'news.empty': 'No news to report.',

  'faction.rankHeading': 'Powers of the Realm',
  'faction.you': '(you)',
  'faction.eliminated': 'fallen',

  'digest.heading': 'While you were occupied…',
  'digest.dismiss': 'Continue',
```

- [ ] **Step 3: Add the Chinese strings**

In `src/i18n/catalog/zh.ts`, before the closing `};` of the `zh` object, add:

```ts
  'news.heading': '编年',
  'news.filter.all': '全部',
  'news.filter.mine': '我方',
  'news.filter.world': '天下',
  'news.empty': '暂无消息。',

  'faction.rankHeading': '天下群雄',
  'faction.you': '（你）',
  'faction.eliminated': '已灭',

  'digest.heading': '此间天下事…',
  'digest.dismiss': '继续',
```

- [ ] **Step 4: Run the i18n parity test + typecheck**

Run: `npx vitest run tests/i18n/parity.test.ts`
Expected: PASS — both catalogs cover the full `MessageKey` union.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/types.ts src/i18n/catalog/en.ts src/i18n/catalog/zh.ts
git commit -m "Add i18n keys for world news feed, faction panel, turn digest"
```

---

## Task 15: `factionRankings` selector

**Files:**
- Modify: `src/engine/selectors.ts`
- Test: `tests/engine/ai-strategy.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/engine/ai-strategy.test.ts`:

```ts
import { factionRankings } from '../../src/engine/selectors.js';

describe('factionRankings', () => {
  it('ranks every faction by power, strongest first, with 1-based rank', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10, y: 10 }, garrison: 90000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12, y: 10 }, garrison: 1000 },
    ]);
    const rankings = factionRankings(state);
    expect(rankings.length).toBe(Object.keys(state.factions).length);
    expect(rankings[0]!.factionId).toBe('dongzhuo');
    expect(rankings[0]!.rank).toBe(1);
    // Power must be non-increasing down the list.
    for (let i = 1; i < rankings.length; i++) {
      expect(rankings[i - 1]!.power).toBeGreaterThanOrEqual(rankings[i]!.power);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: FAIL — `factionRankings` not defined.

- [ ] **Step 3: Add the selector**

In `src/engine/selectors.ts`, add `LocalizedString` to the type import from `./types.js`, then append:

```ts
export interface FactionRanking {
  factionId: FactionId;
  name: LocalizedString;
  color: string;
  alive: boolean;
  cities: number;
  generals: number;
  troops: number;
  power: number;
  rank: number;
}

// Every faction ranked by power, strongest first. Reuses factionPower so
// the panel reflects exactly what the AI's target selection "sees".
export function factionRankings(state: GameState): FactionRanking[] {
  const rows = Object.values(state.factions).map((f) => {
    const totals = factionTotals(state, f.id);
    return {
      factionId: f.id,
      name: f.name,
      color: f.color,
      alive: f.alive,
      cities: totals.cities,
      generals: totals.generals,
      troops: totals.troops,
      power: factionPower(state, f.id),
    };
  });
  rows.sort((a, b) => b.power - a.power);
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/ai-strategy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/selectors.ts tests/engine/ai-strategy.test.ts
git commit -m "Add factionRankings selector for the faction power panel"
```

---

## Task 16: `WorldNewsFeed` component

**Files:**
- Create: `src/web/components/WorldNewsFeed.tsx`
- Test: `tests/web/WorldNewsFeed.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/web/WorldNewsFeed.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { WorldNewsFeed } from '../../src/web/components/WorldNewsFeed.js';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import type { LogEntry } from '../../src/engine/types.js';

function stateWithLog(playerFactionId: string, entries: LogEntry[]) {
  const base = buildInitialState({
    scenario: SCENARIO_DONGZHUO,
    playerFactionId,
    refData: REF_DATA,
    seed: 1,
  });
  return { ...base, log: entries };
}

const mineEntry: LogEntry = {
  turn: 1, year: 190, month: 1, key: 'result.developed',
  vars: { city: { zh: '洛阳', en: 'Luoyang' }, amount: 3 }, factionId: 'caocao',
};
const worldEntry: LogEntry = {
  turn: 1, year: 190, month: 1, key: 'result.governed',
  vars: { city: { zh: '陈留', en: 'Chenliu' }, amount: 4 }, factionId: 'yuanshao',
};

describe('WorldNewsFeed', () => {
  it('shows all entries under the All filter', () => {
    const game = stateWithLog('caocao', [mineEntry, worldEntry]);
    const { container } = render(<WorldNewsFeed game={game} />);
    expect(container.querySelectorAll('li').length).toBe(2);
  });

  it('shows only other factions under the World filter', () => {
    const game = stateWithLog('caocao', [mineEntry, worldEntry]);
    const { container, getByRole } = render(<WorldNewsFeed game={game} />);
    fireEvent.click(getByRole('tab', { name: /realm|天下/i }));
    const items = container.querySelectorAll('li');
    expect(items.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/WorldNewsFeed.test.tsx`
Expected: FAIL — `WorldNewsFeed` does not exist.

- [ ] **Step 3: Create the component**

Create `src/web/components/WorldNewsFeed.tsx`:

```tsx
import React, { useState } from 'react';
import type { GameState } from '../../engine/types.js';
import { t } from '../../i18n/locale.js';
import type { MessageKey } from '../../i18n/types.js';
import { useSession } from '../hooks/useSession.js';
import { selectLocale } from '../../state/selectors.js';

type NewsFilter = 'all' | 'mine' | 'world';

interface WorldNewsFeedProps {
  game: GameState;
  lines?: number;
}

// Filterable, scrollable chronicle of log entries. "World" shows only
// entries tagged with a faction other than the player's.
export const WorldNewsFeed: React.FC<WorldNewsFeedProps> = ({ game, lines = 50 }) => {
  useSession(selectLocale);
  const [filter, setFilter] = useState<NewsFilter>('all');
  const player = game.playerFactionId;
  const filtered = game.log.filter((entry) => {
    if (filter === 'all') return true;
    if (filter === 'mine') return entry.factionId === player;
    return entry.factionId !== undefined && entry.factionId !== player;
  });
  const tail = filtered.slice(-lines);
  return (
    <div className="panel bamboo max-h-44 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div className="panel-heading">{t('news.heading')}</div>
        <div className="flex gap-1" role="tablist">
          {(['all', 'mine', 'world'] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                filter === f
                  ? 'bg-seal-500 text-parchment-50'
                  : 'bg-parchment-50 text-ink-600'
              }`}
              onClick={() => setFilter(f)}
            >
              {t(`news.filter.${f}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>
      {tail.length === 0 ? (
        <div className="text-xs text-ink-500">{t('news.empty')}</div>
      ) : (
        <ul className="flex flex-col gap-0.5 text-xs text-ink-800">
          {tail.map((entry, i) => (
            <li key={`${entry.turn}-${i}`} className="flex gap-2">
              <span className="font-mono text-[10px] text-ink-500">
                {entry.year}.{String(entry.month).padStart(2, '0')}
              </span>
              <span>{t(entry.key as MessageKey, entry.vars)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/web/WorldNewsFeed.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/components/WorldNewsFeed.tsx tests/web/WorldNewsFeed.test.tsx
git commit -m "Add WorldNewsFeed component with All/Mine/World filters"
```

---

## Task 17: `FactionPanel` component

**Files:**
- Create: `src/web/components/FactionPanel.tsx`
- Test: `tests/web/FactionPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/web/FactionPanel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { FactionPanel } from '../../src/web/components/FactionPanel.js';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';

describe('FactionPanel', () => {
  it('lists factions in power order, strongest first', () => {
    const base = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 1,
    });
    // Make Dong Zhuo overwhelmingly the strongest.
    const cities = { ...base.cities };
    for (const c of Object.values(cities)) {
      if (c.factionId === 'dongzhuo') cities[c.id] = { ...c, garrison: 200000 };
    }
    const game = { ...base, cities };
    const { container } = render(<FactionPanel game={game} />);
    const rows = container.querySelectorAll('li[data-faction]');
    expect(rows.length).toBe(Object.keys(game.factions).length);
    expect(rows[0]!.getAttribute('data-faction')).toBe('dongzhuo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/FactionPanel.test.tsx`
Expected: FAIL — `FactionPanel` does not exist.

- [ ] **Step 3: Create the component**

Create `src/web/components/FactionPanel.tsx`:

```tsx
import React from 'react';
import type { GameState } from '../../engine/types.js';
import { factionRankings } from '../../engine/selectors.js';
import { pickName, t } from '../../i18n/locale.js';
import { factionColor } from '../theme.js';
import { useSession } from '../hooks/useSession.js';
import { selectLocale } from '../../state/selectors.js';

interface FactionPanelProps {
  game: GameState;
}

// Power ranking of every faction — tells the player where they stand and
// who the threats are.
export const FactionPanel: React.FC<FactionPanelProps> = ({ game }) => {
  useSession(selectLocale);
  const rankings = factionRankings(game);
  return (
    <div className="panel">
      <div className="panel-heading">{t('faction.rankHeading')}</div>
      <ul className="flex flex-col gap-1 text-xs">
        {rankings.map((r) => (
          <li
            key={r.factionId}
            data-faction={r.factionId}
            className={`flex items-center gap-2 ${r.alive ? '' : 'opacity-40'}`}
          >
            <span className="w-4 text-right font-mono text-ink-500">{r.rank}</span>
            <span
              className="stamp-square text-[10px]"
              style={{ backgroundColor: factionColor(r.factionId) }}
              aria-hidden
            >
              {pickName(r.name)[0] ?? '·'}
            </span>
            <span className="flex-1 font-serif text-ink-800">
              {pickName(r.name)}
              {r.factionId === game.playerFactionId && (
                <span className="ml-1 text-seal-500">{t('faction.you')}</span>
              )}
            </span>
            {r.alive ? (
              <span className="font-mono tabular-nums text-ink-600">
                {t('status.cities')} {r.cities} · {r.troops.toLocaleString()}
              </span>
            ) : (
              <span className="italic text-ink-500">{t('faction.eliminated')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/web/FactionPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/components/FactionPanel.tsx tests/web/FactionPanel.test.tsx
git commit -m "Add FactionPanel component (faction power rankings)"
```

---

## Task 18: Store — `turnDigest` UI state, capture, and dismiss

**Files:**
- Modify: `src/state/store.ts`
- Test: `tests/web/turn-digest-store.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/web/turn-digest-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  extractDigest,
  gameStore,
  newGame,
  dismissTurnDigest,
} from '../../src/state/store.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import type { LogEntry } from '../../src/engine/types.js';

function entry(key: string): LogEntry {
  return { turn: 1, year: 190, month: 1, key };
}

describe('extractDigest', () => {
  it('keeps only significant entries appended after the cutoff', () => {
    const log: LogEntry[] = [
      entry('result.developed'),
      entry('result.patrolled'),
      entry('event.cityFell'),
      entry('result.recruited'),
      entry('event.rebellion'),
    ];
    const digest = extractDigest(2, log);
    expect(digest.map((e) => e.key)).toEqual(['event.cityFell', 'event.rebellion']);
  });

  it('ignores significant entries from before the cutoff', () => {
    const log: LogEntry[] = [entry('event.cityFell'), entry('result.developed')];
    expect(extractDigest(1, log)).toEqual([]);
  });
});

describe('dismissTurnDigest', () => {
  it('clears the turn digest', () => {
    newGame(SCENARIO_DONGZHUO, 'caocao', 1);
    gameStore.setState((s) => ({
      ...s,
      ui: { ...s.ui, turnDigest: [entry('event.cityFell')] },
    }));
    dismissTurnDigest();
    expect(gameStore.getState().ui.turnDigest).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/turn-digest-store.test.ts`
Expected: FAIL — `extractDigest` / `dismissTurnDigest` not exported; `ui.turnDigest` undefined.

- [ ] **Step 3: Add turnDigest to UIState**

In `src/state/store.ts`, add `LogEntry` to the engine types import:

```ts
import type { FactionAgent, GameState, LogEntry, Scenario, StrategicCommand } from '../engine/types.js';
```

Add the field to the `UIState` interface (after `locale: Locale;`):

```ts
  // Significant world events that occurred during the last time-advance.
  // Rendered by <TurnDigest>; empty when nothing significant happened.
  turnDigest: LogEntry[];
```

Add it to `initialUI` (after `locale: 'zh',`):

```ts
  turnDigest: [],
```

- [ ] **Step 4: Add extractDigest, update advanceDays, add dismissTurnDigest**

In `src/state/store.ts`, add the digest-key set and the pure extractor near the top of the "Helpers" section (just above `newGame`):

```ts
// Log message keys worth surfacing in the between-turn digest. Everything
// else (routine internal-affairs results) stays in the news feed only.
const DIGEST_KEYS = new Set<string>([
  'event.cityFell',
  'event.rebellion',
  'event.attackerRetreated',
  'event.guandongCoalition',
  'event.qianduChangan',
  'event.generalDied',
  'event.defected',
]);

// Pure: significant log entries appended at or after `beforeLen`.
export function extractDigest(beforeLen: number, log: LogEntry[]): LogEntry[] {
  return log.slice(beforeLen).filter((e) => DIGEST_KEYS.has(e.key));
}
```

Replace the body of `advanceDays` with:

```ts
export function advanceDays(days: number): void {
  const { game, agents } = gameStore.getState();
  if (!game) return;
  const logLenBefore = game.log.length;
  const next = tickDays(game, days, agents);
  void advanceMonth; // keep import alive for tests that use it directly
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

Add `dismissTurnDigest` near the other UI setters (e.g. after `setMessage`):

```ts
export function dismissTurnDigest(): void {
  gameStore.setState((s) => ({ ...s, ui: { ...s.ui, turnDigest: [] } }));
}
```

`endTurn` calls `advanceDays(30)`, so it inherits digest capture with no change. `newGame` and `loadGame` already spread `initialUI` / prior `ui`, so `turnDigest` is present.

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run tests/web/turn-digest-store.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/state/store.ts tests/web/turn-digest-store.test.ts
git commit -m "Capture significant between-turn events into ui.turnDigest"
```

---

## Task 19: `TurnDigest` component

**Files:**
- Create: `src/web/components/TurnDigest.tsx`
- Test: `tests/web/TurnDigest.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/web/TurnDigest.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { TurnDigest } from '../../src/web/components/TurnDigest.js';
import type { LogEntry } from '../../src/engine/types.js';

const fell: LogEntry = {
  turn: 3, year: 190, month: 3, key: 'event.cityFell',
  vars: { city: { zh: '陈留', en: 'Chenliu' }, faction: { zh: '曹操', en: 'Cao Cao' } },
};

describe('TurnDigest', () => {
  it('renders nothing when there are no entries', () => {
    const { container } = render(<TurnDigest entries={[]} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a dialog listing the entries', () => {
    const { container } = render(<TurnDigest entries={[fell]} onDismiss={() => {}} />);
    expect(container.querySelectorAll('li').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/TurnDigest.test.tsx`
Expected: FAIL — `TurnDigest` does not exist.

- [ ] **Step 3: Create the component**

Create `src/web/components/TurnDigest.tsx`:

```tsx
import React from 'react';
import type { LogEntry } from '../../engine/types.js';
import { t } from '../../i18n/locale.js';
import type { MessageKey } from '../../i18n/types.js';
import { Dialog } from './Dialog.js';

interface TurnDigestProps {
  entries: LogEntry[];
  onDismiss: () => void;
}

// Shown after the player advances time, when significant world events
// occurred. Renders nothing when there is nothing significant to report.
export const TurnDigest: React.FC<TurnDigestProps> = ({ entries, onDismiss }) => {
  if (entries.length === 0) return null;
  return (
    <Dialog title={t('digest.heading')} onClose={onDismiss}>
      <ul className="flex flex-col gap-1 text-sm text-ink-800">
        {entries.map((entry, i) => (
          <li key={`${entry.turn}-${i}`} className="flex gap-2">
            <span className="font-mono text-[10px] text-ink-500">
              {entry.year}.{String(entry.month).padStart(2, '0')}
            </span>
            <span>{t(entry.key as MessageKey, entry.vars)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex justify-end">
        <button className="btn btn-primary" onClick={onDismiss}>
          {t('digest.dismiss')}
        </button>
      </div>
    </Dialog>
  );
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/web/TurnDigest.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/components/TurnDigest.tsx tests/web/TurnDigest.test.tsx
git commit -m "Add TurnDigest between-turn summary modal"
```

---

## Task 20: Wire the visibility components into `MainScreen`; delete `EventLog`

**Files:**
- Modify: `src/web/screens/MainScreen.tsx`
- Delete: `src/web/components/EventLog.tsx`
- Test: `tests/web/MainScreen.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/web/MainScreen.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { MainScreen } from '../../src/web/screens/MainScreen.js';
import { newGame } from '../../src/state/store.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { t } from '../../src/i18n/locale.js';

describe('MainScreen visibility surfaces', () => {
  it('renders the world news feed and faction power panel', () => {
    newGame(SCENARIO_DONGZHUO, 'caocao', 1);
    const { getAllByText } = render(<MainScreen />);
    expect(getAllByText(t('news.heading')).length).toBeGreaterThan(0);
    expect(getAllByText(t('faction.rankHeading')).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/web/MainScreen.test.tsx`
Expected: FAIL — `MainScreen` still renders `EventLog`, not the new panels.

- [ ] **Step 3: Update MainScreen imports**

In `src/web/screens/MainScreen.tsx`:

Replace the `EventLog` import line (`import { EventLog } from '../components/EventLog.js';`) with:

```tsx
import { WorldNewsFeed } from '../components/WorldNewsFeed.js';
import { FactionPanel } from '../components/FactionPanel.js';
import { TurnDigest } from '../components/TurnDigest.js';
```

Add `dismissTurnDigest` to the existing `'../../state/store.js'` import (alongside `advanceDays`, `endTurn`, etc.).

- [ ] **Step 4: Swap the EventLog block and add FactionPanel**

In `src/web/screens/MainScreen.tsx`, replace this block:

```tsx
          <div className="px-3 py-2">
            <EventLog game={game} />
          </div>
```

with:

```tsx
          <div className="flex flex-col gap-2 px-3 py-2">
            <WorldNewsFeed game={game} />
            <FactionPanel game={game} />
          </div>
```

- [ ] **Step 5: Render the TurnDigest modal**

In `src/web/screens/MainScreen.tsx`, add a selector near the other `useSession` calls at the top of the `MainScreen` component (next to `const game = useSession(selectGame);`):

```tsx
  const turnDigest = useSession((s) => s.ui.turnDigest);
```

Then, just before the final closing `</div>` of the component's returned JSX (after the `modal.kind === 'info'` block), add:

```tsx
      <TurnDigest entries={turnDigest} onDismiss={dismissTurnDigest} />
```

`TurnDigest` returns `null` when `entries` is empty, so rendering it unconditionally is safe.

- [ ] **Step 6: Delete EventLog**

```bash
git rm src/web/components/EventLog.tsx
```

If `npm run typecheck` reports any other importer of `EventLog`, update it to `WorldNewsFeed` (per the grep, `MainScreen.tsx` is the only importer).

- [ ] **Step 7: Run test + typecheck + full web suite**

Run: `npx vitest run tests/web/MainScreen.test.tsx`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

Run: `npx vitest run tests/web/`
Expected: PASS — `App.test.tsx`, `keyboard-nav.test.tsx`, etc. still green.

- [ ] **Step 8: Commit**

```bash
git add src/web/screens/MainScreen.tsx tests/web/MainScreen.test.tsx
git commit -m "Wire WorldNewsFeed, FactionPanel, TurnDigest into MainScreen"
```

---

## Task 21: Extend long-simulation tests + full verification

**Files:**
- Modify: `tests/playthrough/long-simulation.test.ts`
- Test: the whole suite + typecheck + lint + build

- [ ] **Step 1: Write the failing tests**

Append two tests inside the `describe('multi-month simulation', ...)` block in `tests/playthrough/long-simulation.test.ts`:

```ts
  it('AI factions run multi-month campaigns (a target persists >= 3 months)', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 303,
    });
    // Track, per faction, the longest run of identical non-null targetCityId.
    const streak: Record<string, number> = {};
    const best: Record<string, number> = {};
    const lastTarget: Record<string, string | null> = {};
    for (let i = 0; i < 36; i++) {
      state = advanceMonth(state, buildAgents(state));
      for (const [fid, strat] of Object.entries(state.aiStrategies)) {
        const tgt = strat.targetCityId;
        if (tgt && lastTarget[fid] === tgt) {
          streak[fid] = (streak[fid] ?? 1) + 1;
        } else {
          streak[fid] = tgt ? 1 : 0;
        }
        lastTarget[fid] = tgt;
        best[fid] = Math.max(best[fid] ?? 0, streak[fid] ?? 0);
      }
    }
    const longest = Math.max(0, ...Object.values(best));
    expect(longest).toBeGreaterThanOrEqual(3);
  });

  it('AI concentrates force (emits move commands over a long run)', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 304,
    });
    for (let i = 0; i < 36; i++) {
      state = advanceMonth(state, buildAgents(state));
    }
    const aiMoves = state.actionLog.filter(
      (a) => a.factionId !== 'liubei' && a.command.kind === 'move',
    );
    expect(aiMoves.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `npx vitest run tests/playthrough/long-simulation.test.ts`
Expected: PASS — the goal-oriented AI persists targets and emits `move` commands. If `longest` is `< 3`, the persistence logic in `reassessStrategy` / `isStrategyStillValid` (Task 5) is too eager to flip — investigate before weakening the assertion.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: PASS — every test green.

- [ ] **Step 4: Typecheck + lint + build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run lint`
Expected: PASS — no unused imports/vars. (If `void params;` in `tactical.ts` now lints as unused after the knob removal, leave `tactical.ts` untouched and instead confirm lint already tolerated it; do not expand scope into tactical AI.)

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Manual smoke check**

Run: `npx tsx scripts/playthrough.ts --faction caocao --months 48 --lang en`
Expected: factions rise and fall, AI attacks and reinforcements appear in the log, no crash.

Run: `npm run dev`, open the app, start a game, advance several weeks. Confirm: the Chronicle feed filters work, the faction power panel ranks factions, and a between-turn digest appears after a month in which a city falls.

- [ ] **Step 6: Commit**

```bash
git add tests/playthrough/long-simulation.test.ts
git commit -m "Add long-simulation coverage for goal-oriented AI campaigns"
```

---

## Done

All 21 tasks complete. The slice delivers: a persistent goal-oriented strategic AI (threat-aware posture, target-weighted rivalries, force concentration, defensive reinforcement) and a visibility layer (filterable world-news chronicle, faction power rankings, between-turn digest). Diplomacy (slice C) and finer AI cadence (slice D) remain as separate future plans.
