# Liu Bei Duel RPG — 虎牢关三英战吕布 Design Spec

**Date:** 2026-07-12
**Status:** Approved (brainstorming) — ready for implementation planning
**Feature branch (proposed):** `liubei-duel`

## Goal

Give the Three Kingdoms game a **story-guided, hero's-eye action-RPG set-piece** — a real-time, third-person, souls-lite **duel** playing *as Liu Bei* against **Lü Bu** at **虎牢关 (Hulao Pass)** — folded directly into the existing Story-Mode campaign as the dramatic climax of **Chapter 1 (讨董卓, 189)**. Inspired in *spirit* (not fidelity) by *Black Myth: Wukong*: play one hero, story-driven, cinematic, skill-based combat.

This is the first instance of a **reusable duel set-piece system**: once built, future dramatic 1v1 moments across the campaign are just *data + a trigger*.

## Non-Goals / Honest Constraints

- **Not photorealistic.** It runs in a browser with no 3D asset pipeline and no existing character models. Quality comes from **art direction** — lighting, motion, framing, hit-stop, slow-mo, particles, sound — not raw fidelity. Characters are **stylized procedural rigs** extending the existing battle renderer's look.
- **Not a separate game or mode.** No new title-screen entry. The duel is embedded *inside* the campaign we already shipped.
- **Not a replacement for the strategy game.** The strategic layer, the tactical battle renderer, and especially the off-screen `resolveQuickBattle` (**THE SEAM**) are untouched.
- **Not an open world / free exploration.** The "RPG" narrative around the duel is delivered through the existing story-event system (paper-card scenes + branching choices), not a new explorable-world engine.

## Approved Design Decisions

| Decision | Choice |
|---|---|
| Camera / POV | **Third-person over-the-shoulder** (like Black Myth), soft lock-on to the boss |
| Combat depth | **Souls-lite** — light/heavy attacks, dodge-roll with i-frames, stamina, telegraphed boss with 2 phases |
| First milestone | **One complete 虎牢关 episode** — story lead-in → duel → aftermath — inside Chapter 1; duel tech built first |
| Integration | **Folded into the campaign**: a `pendingDuel` pause mirroring `pendingBattle`/`pendingStoryEvent`; scripted onto the 响应义盟 (join-coalition) beat |
| Art | **Stylized cinematic 3D** — procedural rigs + the existing bloom/grade/fog/particle pipeline; juice over fidelity |
| Win/Lose | **Graceful both ways** — win = Lü Bu driven off (canon); lose = brothers wounded, coalition presses on. Never a dead-end. Retry-or-continue on death. |

## Architecture

Three layers, each respecting the project's invariants (pure/testable engine, isolated renderer, no strategy-game regression):

1. **Duel simulation** (`src/duel/`) — a **pure fixed-timestep** real-time model. `stepDuel(state, input, dt) → {state, events}`. Real input/RAF live only at the edge (the renderer); the logic is deterministic given `(state, input, dt)` with a seeded RNG threaded through boss AI, so it is fully unit-testable despite being "real-time."
2. **Duel renderer** (`src/web/duel/`) — a Three.js scene that **reuses the battle renderer's presentation pipeline** (lighting, sky, bloom+grade post, particle FX, camera shake, Web Audio, CSS2D labels), adds a third-person follow-cam, procedural character rigs, real-time input, and the RAF loop that drives `stepDuel`.
3. **Campaign integration** (`src/engine`, `src/state`, `src/data/story`) — a **`pendingDuel` pause** that freezes the strategic tick and routes to the duel, exactly mirroring the existing `pendingBattle` and `pendingStoryEvent` mechanisms; on outcome, `resolveDuel` branches the story and continues Chapter 1.

### Why this shape

- **THE SEAM stays sacred.** The duel is a self-contained excursion that hands back exactly one outcome; `resolveQuickBattle`/combat/turn are never touched.
- **Always-green testing survives real-time.** Pure `(state, input, dt)` step functions are as testable as the strategy engine.
- **Max reuse, min risk.** The shipped `BattleScene` (1700 lines) is not surgically rewired; cleanly-standalone helpers are extracted to `src/web/three/`, entangled scene-setup is copied-then-factored.
- **On-vision.** 虎牢关三英战吕布 is canonically the Chapter-1 climax, so the duel *is* the campaign's story, not a side attraction.

## The Combat Model (§1)

**Liu Bei — 雌雄双股剑 (paired swords), agile.**

| Input | Action | Cost / property |
|---|---|---|
| WASD | Move (camera-relative); soft lock-on faces Lü Bu | — |
| J / LMB | Light attack — 3-hit combo string | low stamina, fast, chip damage |
| K / RMB | Heavy attack — slow wind-up | high stamina, high damage, staggers |
| Space | Dodge-roll — directional, **i-frames** | stamina; the core defensive tool |
| L / Shift | Guard — reduce chip, deflect | drains stamina on hit; breaks if empty |

Resources: **HP** + **Stamina** (drains on attack/dodge/guard-hit, regens while neutral). Stamina gates aggression — the souls-lite tension. Getting hit staggers/interrupts.

**Lü Bu — 方天画戟 (halberd), on foot. A boss AI state machine of telegraphed attacks.**

- **Phase 1 (100→50% HP):** horizontal **sweep**, overhead **smash**, thrust **lunge** (gap-closer), occasional reposition. Every attack has a **wind-up tell** (pose + light flash) = the player's react window → dodge through, punish the recovery.
- **Phase 2 (<50%):** a red rage shift — faster, adds a multi-hit combo + a **charge**; punish windows shrink. The difficulty spike that sells the victory.

**The loop:** read tell → dodge/guard → punish the opening → manage stamina → survive phase 2 → win (or die).

**Juice — quality over fidelity:** hit-stop on impact, **slow-mo on the decisive blow**, camera shake, spark-on-clash / dust-on-dodge / ink-splash-on-hit particles, rim-lit silhouettes in fog, thunderous Web Audio (halberd whoosh, sword clang, war drums, Lü Bu's roar) — reused/extended from the battle FX pipeline.

## Components & File Structure (§2)

**Duel simulation — pure & testable (`src/duel/`)**

| File | Responsibility |
|---|---|
| `types.ts` | `DuelState`, `DuelInput`, `FighterState`, `BossState`, phase enums, `DuelOutcome`, hitbox types |
| `simulate.ts` | `stepDuel(state, input, dt) → {state, events}` — movement, stamina, dodge i-frames, attack state timers, hitbox→damage, stagger, HP |
| `boss.ts` | Lü Bu AI state machine — telegraph→active→recovery, action selection, phase flip at 50%; seeded RNG threaded through state |
| `hitbox.ts` | pure overlap math (capsule / attack-arc vs target) |
| `config.ts` | all tunables — damage, stamina costs, i-frame window, timings (the balance surface) |

**Duel renderer (`src/web/duel/`)**

| File | Responsibility |
|---|---|
| `DuelScene.ts` | Three.js scene: third-person follow-cam, player+boss rigs, FX; owns the RAF loop (input → accumulate fixed dt → `stepDuel` → sync meshes → render) |
| `DuelCanvas.tsx` | React↔DuelScene lifecycle bridge |
| `DuelScreen.tsx` | HUD (HP/stamina/boss bars, control hints), result overlay, wires input, calls the store on outcome |
| `input.ts` | keyboard/pointer → `DuelInput` (WASD/J/K/Space/L) with input buffering |
| `characterRig.ts` | procedural Liu Bei (dual swords) & Lü Bu (halberd) rigs with pose states (idle/walk/attack/dodge/hit/wind-up) |

**Reused from the battle renderer (the one honest refactor):** lighting/sky/fog, bloom+grade post-stack, particle FX (`makeParticles`/`advanceParticles`), camera shake, Web Audio, CSS2D labels. To protect the shipped `BattleScene`, **extract only cleanly-standalone helpers** into a shared `src/web/three/`; **adapt (copy-then-factor)** entangled scene-setup rather than rewiring BattleScene up front.

**Campaign fold-in (mirrors `pendingBattle`/`pendingStoryEvent`):**

- `src/engine/types.ts`: add `pendingDuel?: PendingDuel` + a `duelResults: Record<string, 'win'|'lose'>` to `GameState`.
- `src/engine/duel/setpieces.ts`: a data registry — `{ id:'hulaoguan', bossId:'lubu', arenaKey, briefingKey, onWin(state)→state, onLose(state)→state }`. Pure. Future duels = one more entry.
- `src/data/story/s1-liubei.ts`: a Ch1 event that sets `pendingDuel` on the coalition beat; aftermath events branching on the recorded result.
- `src/state/store.ts`: freeze the tick on `pendingDuel` (loop guard) + route `screen:'duel'`; `resolveDuel(outcome)` applies onWin/onLose, records the flag, clears the pause, re-evaluates objectives, returns to the campaign; restore-on-load resumes a mid-duel.
- `src/web/App.tsx`: add `case 'duel'`.
- **No-WebGL fallback** (mirrors BattleScreen's `webglSupport` gate + 2D fallback): if WebGL is unavailable, the duel **auto-resolves via a stat check** (Liu Bei `wu` vs Lü Bu `wu` + a seeded roll) so the campaign never hard-requires a GPU.

## Data Flow (§3)

```
Ch1 strategy map ──reach 响应义盟 beat──▶ story event sets game.pendingDuel
        │                                          │
   tick frozen  ◀───────────────────────── store routes screen:'duel'
        │                                          ▼
        │                         DuelScreen ▶ DuelCanvas ▶ DuelScene (RAF)
        │                         input → fixed-dt stepDuel/stepBoss → DuelState
        │                         → meshes sync, FX, HUD; until HP hits 0
        │                                          ▼
        │                         outcome overlay → resolveDuel(outcome)
        ▼                                          │
resolveDuel: apply setpiece.onWin/onLose ◀─────────┘
        → record duelResults, clear pendingDuel, evaluate objectives
        → route back to screen:'main'; aftermath story event branches on the result
        → Chapter 1 continues (win OR lose — never a dead-end)
```

The strategic engine and `resolveQuickBattle` never see the duel.

## Testing Strategy (§4)

- **Duel sim (pure/deterministic, the bulk):** `stepDuel`/`stepBoss` — movement integrates; stamina drains/regens and gates actions; dodge i-frames negate damage inside the window and not outside; an attack's hitbox deals damage once per swing; stagger interrupts; boss phase flips at 50%; telegraph→active→recovery timing; win at boss HP≤0, lose at player HP≤0. Fixed dt + seeded RNG → deterministic.
- **Balance harness:** a scripted "perfect-play" input sequence beats Lü Bu within a bounded time; a "do-nothing" sequence loses. Guards against soft-lock tunings.
- **Campaign integration (store):** `pendingDuel` freezes the tick & routes to `'duel'`; `resolveDuel('win'|'lose')` applies the right branch, records the flag, clears the pause, returns; restore-on-load resumes a mid-duel.
- **Ch1 reachability sim (extended):** reach the coalition beat → `pendingDuel` set → `resolveDuel('win')` → win-aftermath → chapter proceeds; and the `'lose'` path also proceeds. Deterministic; drives `resolveDuel` directly (no real-time).
- **Component (jsdom):** DuelScreen renders HUD from a `DuelState`; `input.ts` maps keys→`DuelInput`; App routes `'duel'`. The GL canvas sits behind the WebGL gate, so no real GPU is needed.
- **i18n parity** for all new keys; **full existing suite (600) + tsc + build stay green** — THE SEAM & strategy tests untouched.

## Global Constraints (bind every task)

- **English identifiers + comments; user-facing strings bilingual zh+en** via `MessageKey` + both catalogs; the i18n parity test must stay green.
- **THE SEAM is sacred:** no behavior change to `resolveQuickBattle`, combat, pendingOp, or turn resolution.
- **No regression:** the full existing suite (currently 600) + `tsc --noEmit` + `npm run build` stay green after every task.
- **Pure engine discipline:** no `Date.now()` / `Math.random()` in `src/duel/` logic or `src/engine/`; use fixed timesteps and seeded RNG. RAF and wall-clock live only in the renderer edge.
- **ESM/NodeNext:** explicit `.js` import specifiers.
- **Isolation:** the duel must not import from, or be imported by, the strategic simulation except through the `pendingDuel`/`resolveDuel` seam.
- **Determinism at the seam:** `resolveDuel(outcome)` is a pure state transition; the no-WebGL auto-resolve uses a seeded roll.

## Scope of the First Slice (the 虎牢关 vertical)

**In:** the full duel simulation + renderer; one boss (Lü Bu, 2 phases); one arena (Hulao Pass at dusk); third-person souls-lite controls; HUD; juice (hit-stop/slow-mo/particles/audio); the `pendingDuel` campaign seam; the Ch1 coalition-beat trigger + win/lose aftermath beats; no-WebGL auto-resolve fallback; full test coverage; bilingual i18n.

**Deferred (future entries, not this slice):** additional duels/bosses; mounted combat (赤兔马); the 三英 fighting *simultaneously* (first slice = Liu Bei solo, brothers present narratively); combos beyond the base moveset; difficulty settings; gamepad input; emergent (map-position-based) triggering.

## Appendix A — Lü Bu moveset & tuning surface (for the plan)

- **Phase-1 attacks:** `sweep` (wide horizontal, dodge through/side), `smash` (overhead, dodge lateral), `lunge` (forward thrust gap-closer, dodge side). Each: `windupMs` (tell) → `activeMs` (hitbox live) → `recoveryMs` (punish window).
- **Phase-2 additions:** `combo` (sweep→smash chain), `charge` (tracking rush). Shorter windups, shorter recovery.
- **Tunables (`config.ts`):** player {hp, stamina, staminaRegen, lightDmg, heavyDmg, lightStam, heavyStam, dodgeStam, iframeMs, dodgeDistance, moveSpeed}; boss {hp, per-attack {windupMs, activeMs, recoveryMs, dmg, range}, phase2Threshold, phase2SpeedMul, aggression}.

## Appendix B — 虎牢关 narrative beats (Chapter 1, for the plan)

- **Lead-in (story event, on 响应义盟):** the coalition stalls at Hulao Pass; Lü Bu routs the lords; Zhang Fei charges, Guan Yu joins, Liu Bei rides in — challenge issued. Sets `pendingDuel = {duelId:'hulaoguan'}`.
- **Duel:** Liu Bei vs Lü Bu (brothers present in-scene narratively).
- **Aftermath — win:** Lü Bu is driven back behind the pass; the coalition's name rings out; Liu Bei's reputation rises (a small morale/standing beat). Chapter 1 proceeds.
- **Aftermath — lose:** the brothers are beaten back and wounded, but the coalition's assault buys the day; you regroup. Chapter 1 proceeds (optionally a minor setback). Death overlay offers **retry** or **continue wounded**.

## Appendix C — i18n keys (namespace `duel.*`, both catalogs)

HUD (`duel.hud.hp`, `duel.hud.stamina`, control hints), boss name (`duel.boss.lubu`), arena (`duel.arena.hulaoguan`), briefing/lead-in, win/lose aftermath titles+bodies, result overlay (`duel.result.win`, `duel.result.lose`, `duel.retry`, `duel.continue`). All zh+en, parity-tested.
