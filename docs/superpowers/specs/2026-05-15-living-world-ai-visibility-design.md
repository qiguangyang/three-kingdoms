# Living World: Goal-Oriented AI + Visibility

**Date:** 2026-05-15
**Status:** Approved design — ready for implementation planning
**Slice:** B + A of the "make all factions interact, operate, fight" initiative

## Problem

The engine's strategic AI already runs every month and produces real activity
— a simulated 18-month run on the live game path issued 1,233 AI commands
including 145 attacks, with factions dying and cities changing hands. But the
game still feels like the other factions are inert, for two reasons:

1. **The AI is shallow.** `src/engine/ai/strategic.ts` is a stateless pass:
   each city does at most one internal-affairs action per month, war logic only
   attacks directly-adjacent cities with naive ratio checks, and the AI never
   reinforces, concentrates force, defends a threatened city, reacts to being
   attacked, or deliberately targets a weak faction. It has no memory, so it
   cannot run a multi-month campaign.
2. **The living world is invisible.** `EventLog` shows only the last 6 lines,
   mixing the player's own action results with AI internal-affairs noise. There
   is no world-news feed, no faction power ranking, and no between-turn summary,
   so the player never perceives what the other factions are doing.

## Goals

- AI factions behave with **intent** — coherent, multi-month campaigns:
  concentrate force, reinforce/defend, pick targets deliberately.
- AI-vs-AI is a **free-for-all with target-weighted rivalries**: every faction
  can fight every other, but target selection favors weak bordering enemies and
  biases toward the current power leader. No formal alliances yet.
- The player can **see the living world**: who is rising, who is at war with
  whom (by observed activity), what happened while they were busy.
- Preserve the engine's deterministic, test-driven character.

## Non-Goals (deferred to later slices)

- Diplomacy subsystem — relations, alliances, non-aggression pacts, coalitions
  (slice C).
- Finer AI cadence — the AI continues to think once per month (slice D).
- Tactical (battlefield) AI changes — `src/engine/ai/tactical.ts` is untouched.
- LLM-backed agents.
- New `StrategicCommand` kinds — `move`, `attack`, and the internal-affairs
  commands already cover everything this slice needs.

## Architecture

Two halves, both extending existing structures.

### Part 1 — Engine: goal-oriented strategic AI

Each AI faction carries a small **persistent strategy** that survives across
months. It lives in `GameState` (not in the agent closure) so it is
deterministic and round-trips through save/load.

**New types (`src/engine/types.ts`):**

```ts
export type AiPosture = 'expand' | 'consolidate' | 'defend';

export interface FactionStrategy {
  posture: AiPosture;
  targetFactionId: FactionId | null; // faction we are campaigning against
  targetCityId: CityId | null;       // specific enemy city we mass toward
  stagingCityId: CityId | null;      // our city where we concentrate troops
  updatedTurn: number;               // turn the strategy was last reassessed
}
```

**`GameState` gains:** `aiStrategies: Record<FactionId, FactionStrategy>`.
Initialized to `{}` in `buildInitialState`. Because it is part of `GameState`
it serializes with saves automatically; old saves load with `aiStrategies`
absent, and read sites default it with `?? {}`.

**`FactionAgent` interface (`src/engine/types.ts`) gains `reassess`:**

```ts
export interface FactionAgent {
  reassess(ctx: AgentContext, current: FactionStrategy | null): FactionStrategy;
  decideStrategic(ctx: AgentContext): StrategicCommand[];
  decideTactical(battle: Battle, ctx: AgentContext): TacticalCommand[];
}
```

`AgentContext` gains an optional `strategy?: FactionStrategy`. Keeping
`decideStrategic` returning only `StrategicCommand[]` avoids an
interface-breaking return shape; the turn loop owns the strategy lifecycle.

**Monthly decision lifecycle**, run by the turn loop for each alive non-player
faction:

1. `strategy = agent.reassess({ state, factionId }, state.aiStrategies[factionId] ?? null)`
2. `state.aiStrategies[factionId] = strategy`
3. `cmds = agent.decideStrategic({ state, factionId, strategy })`
4. each command is scheduled via `schedulePlayerCommand` (pendingOp path) or
   applied via `applyCommand` (legacy `advanceMonth` path).

**`reassess` logic** — picks posture and target, deterministic given state:

- **`defend`** when any owned city is under siege, is the target of an inbound
  enemy `march` op with `intent: 'attack'`, or has a hostile neighbor with a
  large garrison advantage.
- **`consolidate`** when not threatened but internally weak — cities with low
  loyalty/food/money, or the faction is militarily weak relative to its
  neighbors.
- **`expand`** otherwise. Target selection (the "rivalries"):
  - candidates = enemy factions whose territory borders ours;
  - prefer the **weakest** candidate by total power (troops + cities);
  - **bias toward the current power leader** when we are mid-pack or stronger,
    weighted by the personality's `leaderBiasWeight`;
  - `targetCityId` = the softest enemy city of the chosen faction that is
    adjacent to our territory;
  - `stagingCityId` = our city adjacent to (or nearest) `targetCityId` with the
    best garrison potential.
- Strategy **persists**: `reassess` keeps the existing strategy when its
  preconditions still hold (target faction alive, target city still hostile,
  staging city still ours, no new threat). It only flips when conditions change
  materially. This produces multi-month coherence.

**`decideStrategic` logic** — emits commands derived from the strategy:

- **Internal affairs** (all postures): per owned city, up to **2** actions per
  month chosen by need priority — loyalty below threshold → `govern`; food
  short → `develop`; money short → `commerce`; politically strong governor with
  a wild general present → `search`; otherwise → `patrol`. Fixes today's
  one-action-per-city behavior.
- **Recruitment**: posture-weighted. `expand` recruits hard at the staging city
  and its feeder cities; `defend` recruits at threatened cities; `consolidate`
  recruits modestly wherever affordable.
- **Force concentration** (`expand`): `move` (reinforce) commands funnel troops
  from safe interior cities toward `stagingCityId`. This is the first time the
  AI emits `move`.
- **Assault** (`expand`): an `attack` from `stagingCityId` to `targetCityId`
  fires only once the staging force exceeds the target by the personality's
  `concentrationThreshold` advantage ratio. Until then the faction keeps
  massing.
- **Defense** (`defend`): `move` reinforcements into threatened cities and
  recruitment there; no offensives launched.
- **Opportunistic grabs** (any posture): an adjacent neutral/empty city is
  taken cheaply when spare troops are available.
- Always ends with `endTurn`.

**Personality** remains the tuning layer. `PersonalityParams`
(`src/engine/ai/personality.ts`) gains:

- `leaderBiasWeight` — how strongly to gang up on the current #1.
- `concentrationThreshold` — advantage ratio required before launching an
  assault.
- `reinforceAggressiveness` — how readily troops are pulled from interior
  cities to the staging point.

`active` attacks sooner with less advantage and hunts the leader; `turtle` uses
a high threshold, defends readily, and rarely picks `expand`; `balanced` sits
between.

**Threat detection** is a helper in `ai/strategy.ts` that reads
`state.pendingOps`: a faction is threatened if one of its cities is a `siege`
target, is the `toCityId` of an enemy `march` with `intent: 'attack'`, or has a
hostile adjacent city with a large garrison advantage.

**Engine files:**

| File | Change |
|------|--------|
| `src/engine/ai/strategy.ts` | **New** — `reassess`, threat detection, target/staging selection helpers. |
| `src/engine/ai/strategic.ts` | **Rewrite** — consumes `FactionStrategy`, emits commands. Stays a pure function returning `StrategicCommand[]`. |
| `src/engine/ai/personality.ts` | Extend `PersonalityParams` with the three new knobs; update the three presets. |
| `src/engine/ai/index.ts` | `makeDefaultAgent` gains a `reassess` method delegating to `ai/strategy.ts`. |
| `src/engine/types.ts` | Add `AiPosture`, `FactionStrategy`; add `aiStrategies` to `GameState`; add `reassess` to `FactionAgent`; add `strategy?` to `AgentContext`. |
| `src/engine/scenario.ts` | Initialize `aiStrategies: {}` in `buildInitialState`. |
| `src/engine/pendingOp.ts` | `runAiMonthlyDecisions` runs the reassess → store → decide lifecycle. |
| `src/engine/turn.ts` | `advanceMonth` runs the same lifecycle (kept in sync for tests that use it directly). |

`src/engine/ai/tactical.ts` is intentionally untouched.

### Part 2 — Web: living-world visibility

**Enabling engine change:** thread `factionId` into log emissions. `LogEntry`
already has an optional `factionId` field — it is simply not populated today.
The politics and combat functions know the `cityId`, and the city knows its
`factionId`, so log entries can be tagged at emission. This is the data the
visibility surfaces filter on.

**Three UI surfaces:**

1. **World News feed** — `EventLog` is rewritten into a filterable, scrollable
   panel with tabs `All` / `My faction` / `World`, where `World` is entries
   whose `factionId !== playerFactionId`. Scrollback grows from 6 lines to
   roughly the last 50.
2. **Faction Power panel** — a new sidebar section listing every alive faction
   ranked by power (cities, generals, total troops, a composite score), built
   on a new `factionRankings` selector that wraps the existing `factionTotals`.
   Tells the player where they stand and who the threats are.
3. **Between-turn digest** — when the player advances time, the store diffs the
   log; if "significant" entries appeared (city fell, faction died, siege
   began, battle resolved — a curated set of message keys), a dismissible modal
   summarizes them: "While you were busy: …". No modal appears when nothing
   significant happened.

The diplomatic-status display is **not** built in this slice — with a pure
free-for-all there is no relation state to show. It belongs to slice C.

**Web files:**

| File | Change |
|------|--------|
| `src/web/components/WorldNewsFeed.tsx` | **New** — replaces `EventLog.tsx`; filterable, scrollable. |
| `src/web/components/EventLog.tsx` | Removed (superseded by `WorldNewsFeed`). |
| `src/web/components/FactionPanel.tsx` | **New** — power rankings. |
| `src/web/components/TurnDigest.tsx` | **New** — between-turn digest modal. |
| `src/web/screens/MainScreen.tsx` | Swap `EventLog` for `WorldNewsFeed`; place `FactionPanel`; wire `TurnDigest` into the advance-time flow. |
| `src/state/store.ts` | `advanceDays` / `endTurn` capture the log entries appended during the tick so the digest can render them. |
| `src/state/selectors.ts` | Add `factionRankings` selector. |
| `src/i18n/catalog/en.ts`, `src/i18n/catalog/zh.ts` | New keys: filter tabs, panel labels, digest heading. Bilingual from day one. |

## Data Flow

```
month rollover (tickOneDay in pendingOp.ts)
  └─ runAiMonthlyDecisions:
       for each alive non-player faction:
         strategy = agent.reassess({state, factionId}, state.aiStrategies[fid] ?? null)
         state.aiStrategies[fid] = strategy
         cmds = agent.decideStrategic({state, factionId, strategy})
         for cmd in cmds: state = schedulePlayerCommand(state, fid, cmd)
  └─ pending ops tick down over subsequent days → applyCompletedOp
       → engine fns → log entries tagged with factionId

player advances time (advanceDays / endTurn in store.ts)
  └─ record game.log.length before tick
  └─ tickDays(...)
  └─ slice the newly-appended log entries; filter to significant keys
  └─ store the result as ui.turnDigest
  └─ MainScreen renders <TurnDigest> when ui.turnDigest is non-empty

UI render
  └─ WorldNewsFeed reads game.log, filters by active tab on factionId
  └─ FactionPanel reads factionRankings(game)
```

## Edge Cases

- **Old saves** without `aiStrategies` — read sites default `?? {}`; `reassess`
  receives `null` as `current` and builds a fresh strategy.
- **Target faction dies / target city captured / staging city lost** mid-campaign
  — `reassess` detects the broken precondition and re-picks a target or flips to
  `consolidate` / `defend`.
- **One-city faction with no reachable enemies** — `reassess` returns
  `consolidate`; no crash, no stream of empty attacks.
- **Determinism** — strategy lives in `GameState`; all randomness still flows
  through `state.rngState`; `reassess` is a pure function of state.
- **Empty digest** — zero significant entries this tick means no modal; the
  player is not nagged.

## Testing

- `tests/engine/ai-strategy.test.ts` — **new**. `reassess` returns `defend`
  when an owned city is under siege; picks the weakest bordering enemy as
  target; `active` personality biases toward the power leader; target persists
  across months while preconditions hold; flips when the target faction dies.
- `tests/engine/ai-strategic.test.ts` — **extended**. `decideStrategic` emits
  `move` commands to concentrate force; emits more than one internal-affairs
  action for a needy city; emits `attack` only once the advantage threshold is
  met.
- `tests/playthrough/long-simulation.test.ts` — **extended**. Over a 36-month
  run, AI factions both gain and lose cities (territory is not monotonic
  decline); at least one faction holds the same target for ≥3 consecutive
  months.
- `tests/web/` — `WorldNewsFeed` filters by tab; `FactionPanel` renders factions
  in power order; `TurnDigest` appears on a significant change and stays hidden
  otherwise.
- All existing tests stay green. The `FactionAgent` interface change ripples to
  the `buildAgents` helpers in `tests/playthrough/long-simulation.test.ts` and
  `scripts/playthrough.ts` — those gain the `reassess` method via
  `makeDefaultAgent`, so no test-side change beyond rebuilding agents.

## Open Questions

None — design approved in brainstorming.
