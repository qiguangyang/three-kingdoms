# Battle: Tactical Depth (The Commander's Battle) — Design

- **Date:** 2026-07-10
- **Status:** Approved design; ready for implementation plan
- **Direction:** Take the (already-shipped, cinematically-polished) battle screen *deeper* — turn it into a real tactical decision space.

## 1. Goal

The battle screen is already merged to `main` and green (204/204 tests): a pure, deterministic
per-day siege engine feeding a ~1,700-line Three.js cinematic renderer (instanced soldiers,
waving banners, a reactive camera director, particle FX, a synth music bed, reveal cards). The
renderer is excellent. The **tactical brain is deliberately dumb**: every unit just marches at
and hits its nearest enemy (`tacticalRules`, a "dripping advance"), `smartTactics` is `false`
for all personalities, and whole mechanics are typed but inert (`wind` is never set so fire never
fires; `charge`/`hold`/`retreat`/`challengeDuel`/`stratagem`/`ambush` have no sim resolution; the
AI never commits reserves).

This design makes the battle a **commander's game**: the fight auto-plays cinematically and pauses
at a few high-stakes decision windows where the player pulls meaningful levers, opposed by a
**cunning, personality-driven AI** whose style follows the general actually commanding the siege.
Fighting Lü Bu should feel different from fighting Sima Yi.

## 2. Shaping decisions (settled)

| Question | Decision |
|---|---|
| Which dimension of "further"? | **Tactical depth** — the brain, not more visuals or new battle types. |
| Player's role | **Commander / director** — battle auto-plays; player makes a few high-impact calls at decision windows. Never punished for not micro-managing (the AI fights the player's idle line competently). |
| Lever families | **All three**: Stratagems (計), Heroes (将), Maneuver (阵). |
| AI ambition | **Cunning & personality-driven** — smart fundamentals *plus* proactively uses the same levers against the player, styled by the commanding general's stats + faction personality. |
| Scope | **Full vision, phased delivery** — one design, four independently shippable, always-green phases. |
| Architecture | **Approach 2 — utility planner with commander "doctrine."** |

## 3. Why the existing code makes this cheap

- **`TacticalCommand` already includes every verb**: `march`, `meleeAttack`, `rangedAttack`,
  `charge`, `stratagem`, `challengeDuel`, `commitReserves`, `gambit`, `hold`, `retreat`
  (`src/engine/types.ts`). We are *activating* a designed-for surface, not inventing one.
- **`Battle.wind` already exists** (`{ dir, strength }`, `src/engine/types.ts`) — simply never
  populated.
- **`GambitId` already covers** `cavalryCharge | fireAttack | floodAttack | ambush |
  duelChallenge | fordCrossing` (`src/engine/battle/types.ts`).
- **The on-screen AI seam is one function.** `src/state/battleSession.ts` `mergeCommands` calls
  `defaultTacticalCommands` for *both* the enemy and the player's un-ordered ("default") units.
  Upgrade that one function and both get smarter at once.
- **Off-screen AI-vs-AI sieges use a separate path** (`resolveQuickBattle` in `src/engine/combat.ts`),
  so on-screen depth does not touch strategic-layer balance.

## 4. Architecture (Approach 2)

### 4.1 Module layout

The tactical AI graduates from one file into a small **pure** package (no React/Three,
deterministic, no wall-clock):

```
src/engine/ai/tactical/
  doctrine.ts     — derive a Doctrine (weight vector) from the lead general + faction personality
  assessment.ts   — per-day battlefield read: threat map, unit roles, opportunity flags
  candidates.ts   — enumerate candidate plays for a side (unit-level + battle-level)
  score.ts        — utility score of a candidate under a Doctrine
  plan.ts         — planTactical(battle, factionId, doctrine, assessment) => TacticalCommand[]
  index.ts        — barrel; defaultTacticalCommands() delegates to planTactical()
```

Supporting edits, all surgical:

- `src/engine/battle/simulate.ts` — resolution for the currently-inert verbs (`charge`, `hold`,
  `retreat`, `challengeDuel`, `ambush` stratagem), a per-day wind update, and the `rally` effect.
  (`fire`/`flood` phases already resolve; fire gains downwind spread + linger.)
- `src/engine/battle/setup.ts` + `terrain.ts` — populate `Battle.wind` (seeded); snapshot `zhi`
  onto each `BattleUnit`.
- `src/engine/types.ts` / `src/engine/battle/types.ts` — add `zhi?` to `BattleUnit`; add the
  `Doctrine` type; add `BattleEvent` kinds `rally`, `ambushSprung`, `feint` for narration/FX.
- `src/state/battleSession.ts` — generalize `detectGambits`/`chooseGambit` into
  **offered decisions** (§6); expose them on the session.
- `src/web/battle/BattleScreen.tsx` — surface offered decisions as lever buttons; pause auto-play
  at high-salience windows. (SFX already exist in `src/web/audio/battle.ts`.)
- i18n catalogs (`src/i18n/catalog/*`) — new `battle.*` keys (levers, doctrines, narration),
  zh + en from the first commit.
- `scripts/battle-balance.ts` + `tests/engine/battle-balance.test.ts` — the tuning harness (§8).

### 4.2 The hard seam (keeps all 204 tests green)

- **On-screen, player-involved battles → the new planner** (via `defaultTacticalCommands`).
- **Off-screen AI-vs-AI sieges → unchanged `resolveQuickBattle`.**
- The old `tacticalRules` stays in place and untouched (its direct determinism tests stay green);
  only `defaultTacticalCommands` re-points to `planTactical`. Tests that directly pin
  `defaultTacticalCommands` output are updated deliberately with new expectations.
- All randomness stays in `battle.rngCursor`; the planner is a pure function of
  `(battle, doctrine, assessment)`.

### 4.3 The Doctrine model — where "personality" comes from

A `Doctrine` is a small weight vector in `0..1`, derived **deterministically from the general
commanding the siege** (the highest-`tong` active general on the side, or the faction lord) plus
the faction's `Personality`:

| Axis | Driven by | Pushes the planner toward |
|---|---|---|
| `aggression` | `wu` + `active` personality | charges, duels, forward pressure, accepting melee |
| `guile` | `zhi` | stratagems (fire/flood/ambush), feigned retreat, targeting the enemy general |
| `discipline` | `tong` | holding chokepoints, coordinated focus-fire, well-timed reserves |
| `caution` | `turtle` personality, inverse `wu` | retreat when losing, avoid ambushes, guard the keep |

So the specific commander sets the tone with **zero per-general code**:

- **Lü Bu** (wu ~100, zhi ~30) → aggression high, guile low → bulls in, hunts duels, charges.
- **Sima Yi** (zhi ~98, tong high) → guile + discipline high → stratagems, patient reserves, feints.
- **Zhuge Liang** (zhi 100) → guile maxed → the fire/flood/ambush maestro.

Doctrine is derived at battle start (recomputed on load — it is a pure function of the saved
units, so it is never persisted). **Optional / not v1:** if the lead general is slain or routs,
recompute doctrine for the survivors ("the commander has fallen, the army wavers").

"Cunning" and distinct personalities *emerge from the weights* rather than being hand-scripted.
Because the planner is side-agnostic, running it for the player's side is exactly what produces
the player's offered levers — **one brain, three consumers: the enemy, the player's auto-line,
and the player's choices.**

## 5. The player-facing loop

1. At each `awaitingOrders`, the session runs the planner **for the player's own side** and keeps
   the valid plays above a **salience threshold** → `session.offeredDecisions` (capped ~3).
2. **Auto-play pauses only when a high-salience decision is offered** — a genuine fork. Quiet days
   flow cinematically. This keeps it "few decisions, big impact."
3. **Salience = the planner's own utility delta** between taking the play and letting the default
   stand — the same brain that makes the AI act decides when it is worth interrupting the player.
   No separate hand-tuned "when to show the button" logic.
4. Choosing a lever queues its `TacticalCommand[]` (`chooseDecision`, generalizing the existing
   `chooseGambit`); declining lets the auto-line's default play proceed. A "Give orders" panel is
   always openable for manual hold/charge/target/commit even on a quiet day — director-first, but
   never helpless.

## 6. The lever catalog (10 levers, 3 families)

`→ mechanic` = what it activates in the sim. ✅ = command already typed, needs resolution.
🆕 = genuinely new mechanic. **Family = UI grouping; it is independent of build phase (§7).**

### Stratagems (計) — gated by the commander's `zhi`

| Lever | Effect | Mechanic | Trigger |
|---|---|---|---|
| **Fire Attack 火攻** | Ignite forest/camp near the enemy; burning cells sear troops + morale for several days, spreading downwind | 🆕 wind model + extend fire phase to spread/linger | your unit by forest/enemy **and wind is up**; zhi check |
| **Flood Attack 水攻** | Breach the river; enemy on low ground loses ~30% + heavy morale | ✅ existing `floodAttack` phase | you hold high ground by a river, enemy below; zhi-gated |
| **Ambush 伏兵** | Pre-hide a unit in forest; spring a surprise strike + morale shock when the enemy passes | 🆕 `hidden` unit state + spring resolution + `ambushSprung` event | a unit on/near forest off the front; zhi-gated |

### Heroes (将) — gated by `wu`

| Lever | Effect | Mechanic | Trigger |
|---|---|---|---|
| **Challenge Duel 單挑** | Hero challenges an enemy general; win → their block loses half + morale shatters (capture/wound); lose → your hero wounded | ✅ `challengeDuel` → existing duel math | your general can reach an enemy general, both high `wu`; player also accepts/declines *their* challenges |
| **Rally 激勵** | Your commander steadies a wavering unit — restores morale, halts a rout | 🆕 `rally` effect (scaled by wu/tong) + `rally` event | a friendly unit near rout, commander in range |
| **Hero Charge 陷陣** | Hero-led decisive charge: charge bonus **+ morale shock** to the target, at the cost of exposure | ✅ `charge` command resolution + morale rider | your cavalry/hero within striking distance of a soft block |

### Maneuver (阵) — gated by `tong`

| Lever | Effect | Mechanic | Trigger |
|---|---|---|---|
| **Commit Reserves 投入預備隊** | Bring your reserve block on at the decisive moment | ✅ `commitReserves` (now the **AI uses it too**) | reserves exist and the line buckles or an opening appears |
| **Hold the Line 堅守** | Hold a ford/gate/hilltop instead of advancing — make them come on bad terms | ✅ `hold` resolution (+ terrain/defensive bonus while holding) | you hold a chokepoint with enemy across it |
| **Feign Retreat 誘敵** | Pull back to bait an aggressive enemy into an ambush or bad ground | ✅ `retreat` resolution + the AI's **bait-taking** logic | you have a trap set and an aggressive enemy near |
| **Focus Fire 集火 / Target the General 擒賊擒王** | Concentrate the whole force on one block — their strongest, or their commander | 🆕 coordinated targeting override in the planner | always available with 2+ / ranged units |

### Weather

`createBattle` gains a seeded `wind = { dir, strength }` (already on the `Battle` type). Strength
`0..1`, one of 8 directions, **optionally shifting per day** so "the wind rises" is a dramatic beat
that arms Fire Attack. Fire spreads downwind. Deterministic; serializes cleanly. Unlocks the 赤壁
payoff and lights up the renderer's existing two-layer fire FX.

### Symmetry payoff

Because the planner is side-agnostic, **the AI draws from the same 10 levers against the player**,
weighted by its doctrine: Sima Yi feigns and baits, Zhuge Liang burns and floods, Lü Bu duels and
charges, a turtle holds the gate. The player's offered levers are the planner's top plays computed
for the player's side. Build the intelligence once; the enemy, the auto-line, and the buttons all
fall out of it.

## 7. Phased delivery

A lever's **family** (§6) is a UI grouping; its **phase** is build order — they are independent.
Each phase is independently shippable and leaves the full suite + `tsc` + `build` green.

- **Phase 1 — Foundation: planner + doctrine + maneuver + harness.** Stand up `ai/tactical/`,
  re-point `defaultTacticalCommands` → `planTactical`, snapshot `zhi`, activate `hold` / AI
  `commitReserves` / coordinated focus-fire, generalize `offeredDecisions`. Ship the balance
  harness + the doctrine-differentiation test. **Levers:** Commit Reserves, Hold the Line, Focus
  Fire. → Battles are immediately smarter and personality-differentiated; the enemy holds chokes,
  spends reserves, concentrates fire.
- **Phase 2 — Heroes.** Sim resolution for `challengeDuel` (wire existing duel math in), `charge` +
  morale shock, and 🆕 `rally`. **Levers:** Challenge Duel (+ accept/decline theirs), Rally, Hero
  Charge. Duels use the renderer's existing reveal-card treatment.
- **Phase 3 — Stratagems + bait.** 🆕 wind model (+ per-day shift), fire spread/linger, full flood,
  🆕 ambush hidden-state, and `retreat` + AI bait-taking. **Levers:** Fire, Flood, Ambush, Feign
  Retreat (ambush + feint are a natural pair, so feign-retreat lands here despite being a maneuver
  lever). Lights up the existing fire/flood FX.
- **Phase 4 — Balance pass + polish.** Run the full sweep; tune utility weights + tuning constants
  to the win-rate / length / upset / lever-usage targets; audit player-as-defender symmetry,
  timeout, and mid-battle save/restore across all new state; finish i18n + audio-cue + narration
  wiring. Optional: dynamic doctrine when a commander falls.

## 8. Determinism, correctness, and balance

### 8.1 Determinism guarantees

- The planner is a pure function of `(battle, doctrine, assessment)` — no `Math.random`, no
  wall-clock. All randomness through `battle.rngCursor`.
- **Speed never affects outcome.** Auto-play's `setTimeout` only paces *when* `resolveDay` runs;
  ×1 / ×2 / ×4 / headless of the same decisions produce identical results (asserted).
- **Reproducible via a decision log.** A battle = seed + the ordered list of player decisions
  (mirroring the strategic `actionLog`); replay yields the same battle. Closes the "real-time
  auto-play vs. reproducible" tension.
- **Save/restore mid-battle:** wind + hidden-ambush state live inside `Battle` (already
  serialized); `Doctrine` and `offeredDecisions` are derived and recomputed on load. No save
  migration (`pendingBattle` is already optional).

### 8.2 Balance-tuning harness

- **`scripts/battle-balance.ts`** — a dev sweep over a matrix (troop-mix × strength ratio ×
  commander/doctrine × terrain), reporting attacker win-rate by advantage, casualty curves,
  battle-length distribution, per-lever usage frequency, and upset rate. Both sides driven by the
  planner via `resolveBattleHeadless`.
- **`tests/engine/battle-balance.test.ts`** — fast deterministic invariants (heavy sweep stays in
  the script): a 2× quality advantage wins ≥ ~70% of a fixed seed set (illustrative starting
  target, retuned in Phase 4), upsets remain possible (win-rate is not ~100%), every battle
  terminates without NaN, and **every lever is reachable** (the planner emits each verb under some
  constructed scenario).
- **`tests/engine/doctrine-differentiation.test.ts`** — an aggression-doctrine commander produces a
  measurably duel/charge-heavy profile; a guile-doctrine one a stratagem-heavy profile. Direct
  rebuttal to today's "personality has zero tactical effect."

### 8.3 Testing strategy

Pure-unit tests per new module (doctrine, assessment, candidates, scoring); a resolution test per
newly-activated verb asserting effect + `toEqual` determinism; the balance-invariant and
doctrine-differentiation suites; session/integration tests that offered levers surface, that
choosing one changes the outcome, that salience gating pauses only on real forks, and that
mid-battle save/restore round-trips. Existing 204 tests stay green (off-screen path + `tacticalRules`
untouched); only tests directly pinning `defaultTacticalCommands` are deliberately updated. The 3D
glue remains browser-verified as before (jsdom has no WebGL); new events get HUD/FX hooks but the
WebGL renderer stays out of automated scope.

## 9. Success criteria ("done")

- A player battle presents ~2–3 meaningful forks, each visibly swinging the result.
- Different commanders feel measurably different (distinct AI lever-usage profiles).
- All 10 levers are reachable and AI-used when apt.
- Balance targets met: a clear advantage usually wins, yet upsets remain possible via good
  stratagem play; battles resolve in a sensible day range (rarely timeout, rarely trivially short).
- All new mechanics are deterministic + serializable; existing 204 tests green + new coverage.

## 10. Non-goals (explicit)

- **No new battle types** — sieges only; field/naval battles are a separate direction.
- **No renderer rework or new 3D assets** — trigger existing FX (fire/flood/duel/reveal cards) and
  add at most tiny event hooks; cinematic spectacle is a separate direction.
- **No LLM tactical AI** — the `FactionAgent` seam stays open for it; v1 is the rule/utility planner.
- **No change to `QuickBattleResult` or off-screen `resolveQuickBattle` outcomes.**
- **No graphics-quality tiers / perf work / code-splitting** — that is the "performance &
  robustness" direction.
- **No hands-on RTS micro** — director-first; the manual-orders panel stays basic.

## 11. Open questions / risks

- **Utility tuning is the main risk.** The 10 levers interacting could produce a degenerate optimum
  (e.g. the AI always feign-retreats). Mitigation: the harness + lever-reachability and
  doctrine-differentiation tests catch dead or dominant levers early; Phase 4 is a dedicated tuning
  pass.
- **Feign Retreat vs. ambush-avoidance is a delicate balance** — the same caution axis that makes a
  smart AI avoid ambushes also makes it refuse bait. Tune so aggressive doctrines take bait and
  cautious ones do not, giving each personality a real weakness.
- **Salience threshold calibration** — too low and the player is nagged every day; too high and
  levers never surface. Start conservative (interrupt rarely) and tune against playthroughs.
- **Dynamic doctrine on commander loss** is deferred; if battles feel static once the lead falls,
  revisit in Phase 4.

## 12. Key file anchors

| Path | Role |
|---|---|
| `src/engine/ai/tactical/` (new pkg) | doctrine / assessment / candidates / score / plan |
| `src/engine/ai/tactical.ts` (existing) | old "dripping advance" — kept untouched as fallback |
| `src/engine/battle/simulate.ts` | activate charge/hold/retreat/duel/ambush/rally + wind + fire spread |
| `src/engine/battle/setup.ts`, `terrain.ts` | seed `wind`; snapshot `zhi` |
| `src/engine/battle/gambits.ts` | opportunity detection feeding candidates |
| `src/engine/types.ts`, `src/engine/battle/types.ts` | `TacticalCommand`/`Battle`/`BattleUnit`/`BattleEvent` extensions; `Doctrine` |
| `src/state/battleSession.ts` | `offeredDecisions`, `chooseDecision`, planner-driven `mergeCommands` |
| `src/web/battle/BattleScreen.tsx` | lever HUD + salience-gated auto-play pause |
| `src/engine/combat.ts` | off-screen `resolveQuickBattle` — **unchanged** |
| `scripts/battle-balance.ts`, `tests/engine/battle-balance.test.ts` | tuning sweep + invariants |
