# Story Campaign — "Liu Bei's Road to Hegemony" Design Spec

> **Status:** Approved design (brainstorming complete). Next step: implementation plan (Phase 1) via `superpowers:writing-plans` → `superpowers:subagent-driven-development`.

**Goal:** Turn a mechanically-rich but narratively-bare Three Kingdoms strategy game into a story-guided, challenging, replayable campaign — a four-chapter guided arc following Liu Bei (189→220 CE) with tracked objectives and branching player choices — while keeping the existing sandbox as a "Free Play" mode.

**Architecture:** A new **objective engine** and **interactive story-event system** layered onto the existing scenario/event pipeline, plus **victory-condition + chapter-transition** logic, a **Story-Mode** framing over the current scenario/faction machinery, and the three unbuilt scenarios (196/208/220) filled in from `SCENARIOS.md`. The one novel engine mechanism is a **`pendingStoryEvent` pause** that freezes time-advance for a player decision, modeled exactly on the existing `pendingBattle` flow.

**Tech Stack:** Vite + React 19 (DOM) + Zustand + TypeScript (ESM/NodeNext, explicit `.js` specifiers) + Vitest. Engine stays pure/deterministic; UI in `src/web`.

## Global Constraints

- **English identifiers + comments; bilingual UI.** All code identifiers and comments in English. Every user-facing string ships as `zh` + `en` from day one, added to `src/i18n/types.ts` (`MessageKey` union) **and** both `catalog/en.ts` and `catalog/zh.ts` — enforced by `tests/i18n/parity.test.ts`.
- **Always green.** Full Vitest suite + `tsc` + `vite build` must pass at every task boundary. Current baseline: **285 tests**.
- **THE SEAM is sacred.** Off-screen AI-vs-AI resolution (`resolveQuickBattle`, `pendingOp.ts`, `turn.ts`) must not change behavior. New story logic hooks into `runScenarioEvents` and the time-tick, never into off-screen combat resolution.
- **Determinism + save/load.** Any new `GameState` field must round-trip through the continuous autosave (which serializes the whole `game` object) and be resumable on load. Player choices are recorded so state stays reconstructable.
- **No copyrighted text.** All narrative prose is original wording grounded in the historical record / Romance of the Three Kingdoms — never a copyrighted translation, no quoted passages.
- **Tribute framing.** Honors the four-chapter structure of 《三国霸业》 per `SCENARIOS.md` §8; data/values are original.

---

## 1. Problem & current state (verified end-to-end)

A cold-start walkthrough (Title → Scenario select → Faction select → Campaign map, plus the battle/game-over paths in code) confirmed:

- The flow **works** and looks good (paper title, painted-scroll map, resource bar, music).
- But it is **narratively bare**: no goal/guidance on the map; the **only** win condition is "own all 40 cities" (`hasVictory` ignores `VictoryCondition.kind`); one-line scenario blurb, no per-faction hook; 3 scripted events that each only append a one-line log; only **1 of 4 scenarios** implemented (s2/s3/s4 are `todo` stubs).
- Polish bugs: Faction-select renders raw general **IDs** (`caocao xiahoudun…`) instead of names; the title subtitle still says "终端战棋策略 / terminal strategy" (a TUI leftover).

The `SCENARIOS.md` design doc already specifies the full four-chapter narrative, historic-route chapter transitions, and hidden-hero quests — **almost none of it built.** This spec builds it, with Liu Bei as the first authored protagonist.

---

## 2. Design overview — two modes

From the **Title screen**, two entries:

- **Story Mode (剧情模式)** — the guided campaign. Launches Liu Bei's arc at Chapter 1. Provides an opening briefing, a tracked objective chain, and branching choice-moments; winning a chapter's *historic route* transitions to the next chapter ("…years pass"). `GameState` carries `storyMode = { protagonistFactionId, chapter }`.
- **Free Play (自由模式)** — today's sandbox: `scenarioSelect → factionSelect`, any faction, any implemented scenario. Enriched (Phase 5) with per-faction intros + shared world-event beats + objectives, but no authored personal arc.

Architected so more protagonists can be authored later; **the first build authors Liu Bei deeply.**

---

## 3. The Liu Bei campaign

Four chapters, escalating. Each hands the player a guided objective chain plus one fateful branching choice, tied to real mechanics. Full bilingual player-facing text is in **Appendix A** (it becomes the i18n entries verbatim).

| Ch | Scenario / start | Liu Bei's situation | Objective chain | Fateful choice |
|----|------------------|---------------------|-----------------|----------------|
| Ⅰ | `s1-dongzhuo` 189/9 ★★★★ | Pingyuan magistrate — 1 city, Guan Yu & Zhang Fei | Answer the coalition → recruit **Zhao Yun** → aid Tao Qian at Xuzhou → decide the bequest | **Accept Xuzhou** (power now) vs **Decline** (renown, easier recruiting) |
| Ⅱ | `s2-junxiong` 196/1 ★★★★★ | Homeless in Xiaopei after Lü Bu's betrayal | Outlast Lü Bu → shelter with Cao Cao → the Plum-Wine dinner → break the leash | **Break free** (freedom, Cao Cao's enmity) vs **Bide** (safe growth, vassalage) |
| Ⅲ | `s3-chibi` 208/7 ★★★ | Comeback — Jiangxia, now with **Zhuge Liang** | Longzhong Plan → forge Sun–Liu alliance → **Red Cliffs fire** → claim Jing | **Borrow Jingzhou** (power, future war) vs **Honor terms** (renown, slower) |
| Ⅳ | `s4-dingli` 220/10 ★★★ | Sovereign at Chengdu, 7 cities of Yi | Proclaim Shu-Han → the Yiling decision → Northern Expeditions → unify | **Launch Yiling** (vengeance, historically fatal) vs **Restraint** (consolidate) |

**Objective ↔ mechanics mapping (already-existing systems the objectives read):**
- *Recruit Zhao Yun* → the `hireWild`/defection + loyalty path; Zhao Yun already exists under Gongsun Zan.
- *Aid Tao Qian / claim Xuzhou* → city ownership check (Tao Qian faction already in s1).
- *Red Cliffs fire* → the tactical battle's existing **fire gambit** + wind system.
- *Unify / dominate* → the victory-condition system (§5.3).

---

## 4. System architecture

Exact hook points below are from the integration map (file:line current as of this spec). All new engine code is pure and deterministic.

### 4.1 Objective engine

**Types (new, `src/engine/story/types.ts`):**
```ts
export type ObjectiveStatus = 'active' | 'complete' | 'failed';

// Static definition (data). check() is a pure predicate over GameState.
export interface ObjectiveDef {
  id: string;
  titleKey: MessageKey;
  descKey: MessageKey;
  check: (state: GameState) => boolean;   // completion predicate
  optional?: boolean;                       // does not gate chapter victory
  hidden?: boolean;                         // not shown until unlocked
}

// Runtime state (lives in GameState, persisted).
export interface ObjectiveState {
  id: string;
  status: ObjectiveStatus;
  completedTurn?: number;
}
```

**GameState field (new):** `objectives: ObjectiveState[]` (init `[]` in `buildInitialState`, `scenario.ts:132-151`). Auto-persists via the whole-`game` autosave.

**Evaluation:** in `runScenarioEvents` (`events.ts:12-21`), after story events, iterate the active scenario/protagonist objective table; for each `active` objective whose `check(state)` passes, mark `complete`, append a `LogEntry` (`objective.completed` key), and — if it's the arc's gating objective — allow a follow-on story beat / next objective to unlock. Objective tables are looked up per `scenarioId` (+ `storyMode.protagonistFactionId`) alongside `eventsFor`.

**Victory by objectives** (optional victory kind, §5.3): a chapter can be won by completing all non-optional objectives rather than by map domination.

### 4.2 Interactive story events + the pause mechanism (the key piece)

The event pipeline (`runScenarioEvents`) is **synchronous and cannot block for player input** — the only thing that currently freezes time-advance is `pendingBattle` (`pendingOp.ts:236-259` sets it and returns early; the tick loop breaks at `pendingOp.ts:213`; the store detects it at `store.ts:134` and opens the battle screen). We reuse that exact pattern.

**Types (new, `src/engine/story/types.ts`):**
```ts
export interface StoryChoice {
  id: string;
  labelKey: MessageKey;
  descKey: MessageKey;                       // one-line consequence preview
  apply: (state: GameState) => GameState;    // the branch's state change (pure)
}

// A story event may be pure-narrative (no choices → single "continue") or a
// decision (2-3 choices). Fired from the scenario's event table.
export interface StoryEvent {
  id: string;
  check: (state: GameState) => boolean;
  titleKey: MessageKey;
  bodyKey: MessageKey;
  choices: StoryChoice[];                    // empty → narrative beat, one "continue"
  portrait?: string;                         // optional faction/general key for art
}

// Queued on GameState when a StoryEvent fires; freezes time-advance until resolved.
export interface PendingStoryEvent {
  eventId: string;
  scenarioId: string;
}
```

**GameState field (new):** `pendingStoryEvent?: PendingStoryEvent` (analogous to `pendingBattle`).

**Flow (mirrors the battle flow exactly):**
1. During `runScenarioEvents`, when a `StoryEvent.check` passes, instead of applying, set `state.pendingStoryEvent = { eventId, scenarioId }`, record the fired id in `state.events` (so `check` won't re-fire), and **return** — the month-tick loop breaks on `pendingStoryEvent` just as it does on `pendingBattle` (`pendingOp.ts:213`, add a sibling guard). Time freezes; no further days advance.
2. `advanceDays` (`store.ts:125-154`) detects `next.pendingStoryEvent` (a new branch beside the `pendingBattle` branch at `store.ts:134`) and routes to a new `Screen` kind `{ kind: 'story'; eventId }`.
3. The **StoryEventModal** renders `titleKey`/`bodyKey` + the choices. The player picks one.
4. A new store action **`resolveStoryChoice(eventId, choiceId)`** looks up the `StoryEvent` + `StoryChoice`, applies `choice.apply(game)`, clears `pendingStoryEvent`, appends the choice to `actionLog` (a new `StrategicCommand` member `{ kind: 'storyChoice'; eventId; choiceId }` so the decision is recorded/replayable and persisted), returns to `main`, and resumes.
5. **Save/load resume:** because `pendingStoryEvent` lives in `GameState`, `loadGame` (`store.ts:328-347`) resumes it exactly like the mid-battle resume (`store.ts:346`) — if `snapshot.game.pendingStoryEvent`, route to the `story` screen.

**Why a recorded choice command:** it keeps the game reconstructable and consistent with how player actions already append to `actionLog`, and makes the branch auditable (the `GeneralsScreen` activity feed already reads `actionLog`).

### 4.3 Victory conditions & chapter transitions

**Implement the declared-but-unused kinds** in `hasVictory` (`selectors.ts:54-58`) by reading the scenario's `VictoryCondition`:
- `unify` — own every city (existing behavior).
- `dominate` — `owned >= cityCount` **and** all `requiredCityIds` held.
- `historic` — a scripted flag: the arc's terminal objective completed (checked via `state.objectives`/`state.events`). This is what a Story-Mode chapter uses to "win historically."
- (optional) `objectives` — all non-optional objectives complete.

**`checkOutcome`** (`turn.ts:225-230`) is unchanged in shape (`'victory'|'defeat'|null`) but now `hasVictory` respects the scenario. A historic victory in **Story Mode** does not go to the plain game-over; instead:

**Chapter transition:** when a Story-Mode chapter is won historically, show a **ChapterTransition** interstitial (the "…years pass" text, Appendix A) with a "Continue" action that calls `newGame(nextScenario, protagonistFactionId, seed)` — a **clean re-seed** of the next chapter's scenario (rosters already re-specified per chapter in `SCENARIOS.md`; continuity is narrative, not state-carrying, which keeps this tractable). `storyMode.chapter` increments. After Chapter Ⅳ's win, the campaign ends with the final transition text → game-over "campaign complete."

Free Play keeps the normal game-over → title.

### 4.4 Story Mode vs Free Play + Title

- **Title** (`TitleScreen.tsx:8-22`): add a `story` option (`title.storyMode`) as the first entry, launching Liu Bei Ch.1: build s1 with `playerFactionId='liubei'`, set `game.storyMode = { protagonistFactionId:'liubei', chapter:1 }`, seed the chapter's objectives, and show the opening **briefing** before `main`. The existing `new` option becomes **Free Play** (`title.freePlay`), unchanged flow.
- **GameState field (new):** `storyMode?: { protagonistFactionId: FactionId; chapter: 1|2|3|4 }`. Its presence is what makes objective tables/briefings/choice-events protagonist-specific and enables chapter transitions. Absent ⇒ Free Play.

### 4.5 UI

- **StoryEventModal** (`src/web/screens/StoryEventModal.tsx`, routed by `App.tsx:28-61` on `screen.kind === 'story'`): full-screen paper card — title, narrative body, optional portrait, and 1–3 choice buttons showing label + one-line consequence. Selecting calls `resolveStoryChoice`. Keyboard-navigable (reuse `useMenuKeys`). Matches the existing paper aesthetic.
- **Briefing** / **ChapterTransition**: same modal component in a "narrative beat" configuration (single "Continue" choice), or a thin dedicated screen. Reuses the StoryEvent rendering path.
- **Objectives HUD** (`src/web/screens/MainScreen.tsx`): a compact panel on the campaign map (collapsed pill → expandable list) reading `game.objectives` + their `titleKey`/`descKey`, showing active objectives and ✓ completed ones. This is the "story-guided" surface.
- **Digest integration:** add the new `objective.completed` and story-beat keys to `DIGEST_KEYS` (`store.ts:79-92`) so non-blocking beats surface in the "while you were occupied" digest.

### 4.6 i18n

New key namespaces in `src/i18n/types.ts` + both catalogs (parity-tested):
- `title.storyMode`, `title.freePlay`
- `story.*` — briefings, chapter titles, transition lines, event titles/bodies
- `objective.*` — objective titles/descriptions + `objective.completed`
- `choice.*` — choice labels + consequence previews
- `chapter.*` — chapter labels, "campaign complete"

All content is in **Appendix A** (Liu Bei arc) ready to become entries.

### 4.7 Data — generals, cities, scenarios

**Generals (~90 new).** Split `src/data/generals/` into per-faction files per `SCENARIOS.md` §7 (`wei.ts`, `shu.ts`, `wu.ts`, `misc.ts`) or extend `index.ts`; author the MUST-CREATE lists (Appendix B). Shared ids (e.g. `zhangliao`, `zhugeliang`, `sunquan`, `simayi`, `luxun`) are authored **once** and referenced by multiple chapters. A few s1 ids (`sunce`, `sunquan`, `machao`, `guanyu`, `zhaoyun`) need era-specific stat/age variants for later chapters — a general-data concern, handled when each chapter is built. Stat values follow `SCENARIOS.md`'s per-general four-dimension figures (武/智/统/政).

**Cities:** all referenced cities exist **except** `jiaozhou` (交州, s3 Shi Xie). Either add one city def to `cities.ts` (far-south frontier) or fold Shi Xie into `lingling`/`guiyang` — decided in the Chapter-3 task.

**Scenarios:** fill `s2-junxiong.ts`, `s3-chibi.ts`, `s4-dingli.ts` with the concrete faction setups from Appendix B (removing their `todo:true`), each with all three victory conditions. Register their event/objective tables in `eventsFor` (`events.ts:5-8`).

### 4.8 Polish fixes (fold into Phase 1)

- **Faction-select names:** resolve general `LocalizedString` names via `pickName` instead of rendering raw ids (`FactionSelectScreen.tsx`).
- **Title copy:** replace "终端战棋策略 / terminal strategy" with web-appropriate wording ("乱世策略 / grand-strategy of the Three Kingdoms" or similar), zh + en.

---

## 5. Determinism & save/load (cross-cutting)

- New `GameState` fields (`objectives`, `pendingStoryEvent?`, `storyMode?`) are serialized by the existing whole-`game` autosave (`store.ts:362-377`) automatically; initialize them in `buildInitialState`.
- `loadGame` gains a `pendingStoryEvent` resume branch mirroring the `pendingBattle` one (`store.ts:346`).
- Player choices append a `{ kind:'storyChoice' }` command to `actionLog`; the new `StrategicCommand` member is handled in the required switches (`applyCommand` `turn.ts:31-63`; and it does **not** schedule a `PendingOp`, so it's applied immediately by `resolveStoryChoice`, keeping `pendingOp.ts` untouched for it).
- Objective `check` and story-event `check` are pure functions of `GameState`; no wall-clock, no `Math.random` (engine RNG only if needed).

---

## 6. Phasing (5 phases; spec covers all, plan details Phase 1)

1. **Phase 1 — Story & Objective Engine (foundations).** All reusable machinery, proven on Scenario 1: the new types; `objectives` + `pendingStoryEvent` + `storyMode` on `GameState`; objective evaluation + story-event pause in the tick; `resolveStoryChoice`; `hasVictory` implements `dominate`/`historic`; `story` screen + StoryEventModal; Objectives HUD; Title Story/Free-Play split (launching a **real** Ch.1 briefing + 2–3 real objectives + 1 real choice-event on s1); i18n namespaces; **both polish fixes**. Deliverable: Scenario 1 is story-guided with a working objective chain and one branching choice, save/load-safe, all green.
2. **Phase 2 — Liu Bei Chapter 1 arc.** Full Ch.1 content on the engine: briefing, all 4 objectives, Zhao Yun recruit quest, coalition beats, the Xuzhou choice-event, chapter-complete → transition scaffold.
3. **Phase 3 — Chapters 2–4 data + transitions.** The ~90 new generals (era variants), s2/s3/s4 faction setups + `jiaozhou`, scenario-select enablement, and the historic-route chapter-transition (Story-Mode chapter advance + clean re-seed).
4. **Phase 4 — Liu Bei Chapters 2–4 arcs.** Briefings, objectives, and the Plum-Wine / Borrow-Jing / Yiling choice-events, tied to each chapter's mechanics (Red Cliffs fire, dominate).
5. **Phase 5 — Balance, Free-Play enrichment, polish.** Per-faction intros + world-event digest beats for Free Play, difficulty/balance tuning across chapters, final whole-branch review.

Built subagent-driven with per-task + whole-branch reviews, always green — same method as the tactical-depth roadmap.

---

## 7. Testing strategy

- **Objective engine:** unit tests that a scenario's objective flips `active→complete` exactly when its predicate is met; that optional objectives don't gate victory; that completion logs the digest key once.
- **Story-event pause:** a test that a firing `StoryEvent` sets `pendingStoryEvent`, freezes the tick (no day/month advance), and that `resolveStoryChoice` applies the correct branch, clears the pending event, appends the `storyChoice` command, and resumes.
- **Save/load:** round-trip a `GameState` with `pendingStoryEvent` + `objectives` + `storyMode`; assert `loadGame` resumes to the `story` screen and state is identical.
- **Victory kinds:** `hasVictory` unit tests for `dominate` (count + required cities) and `historic` (terminal objective) in addition to `unify`.
- **Chapter transition:** a Story-Mode historic win advances `storyMode.chapter` and re-seeds the next scenario with the protagonist faction.
- **i18n parity:** every new key present in both catalogs, non-empty (existing `tests/i18n/parity.test.ts`).
- **UI:** StoryEventModal renders choices and dispatches `resolveStoryChoice`; Objectives HUD lists active objectives; Title launches Story Mode. (Testing-Library/jsdom, matching existing screen tests.)
- **Regression:** full 285-test suite + `tsc` + build green at every task boundary. THE SEAM (off-screen resolution) untouched.

---

## Appendix A — Liu Bei arc content (bilingual, verbatim → i18n)

*(Original wording; historically grounded; no copyrighted translation. Becomes `story.* / objective.* / choice.* / chapter.*` entries.)*

### Chapter Ⅰ — 董卓弄权 / The Tyrant's Shadow (189)

**Briefing** — zh: 你是平原县令刘备，坐拥一城，身边只有关羽、张飞两位结义兄弟。汉室倾颓，董卓挟天子以令诸侯，暴虐四海。你出身寒微，却胸怀匡扶社稷之志——乱世将起，正是仁义立名之时。 · en: You are Liu Bei, magistrate of Pingyuan — one city, and two sworn brothers, Guan Yu and Zhang Fei, at your side. The Han crumbles as the tyrant Dong Zhuo holds the boy-emperor hostage and bleeds the realm. You are a man of humble birth but boundless purpose: in a world turned to chaos, a name built on virtue may yet raise a dynasty.

**Objectives**
1. 响应义盟 · 加入讨董联军，以微薄之力立于天下诸侯之列。 / Answer the Call — Join the coalition against Dong Zhuo and take your place among the lords of the realm.
2. 三顾常山 · 于乱军之中结识赵云，广纳英才。 / Find the Dragon of Changshan — Meet Zhao Yun amid the fighting and win a warrior to your cause.
3. 驰援徐州 · 应陶谦之请，率军解徐州之围，以信义动人心。 / Ride to Xuzhou's Aid — Answer Tao Qian's plea, break the siege, and let your honor speak for you.
4. 抉择基业 · 面对陶谦让州之请，决定进退。 / A Foundation Offered — Decide your answer when Tao Qian offers you his province.

**Choice — 陶谦让徐州 / The Bequest of Xuzhou**
- Setup — zh: 陶谦病笃，三让徐州于你。徐州乃四战之地，富庶却众目睽睽。取之，则一夕由客将而为诸侯；辞之，则仁名传遍天下，然基业无着。糜竺、陈登拱手相候，只待你一言。 · en: Tao Qian lies dying and three times presses Xuzhou upon you. It is rich country — and country every warlord covets. Take it, and overnight you rise from wandering guest to sovereign lord. Refuse it, and your name for righteousness spreads across the land — but you remain a man without a home. Mi Zhu and Chen Deng wait, needing only your word.
- **A 受徐州 / Accept Xuzhou** — 获徐州六城与钱粮，即刻成为一方诸侯；然树大招风，吕布、曹操皆将侧目而视。 / Gain Xuzhou's cities plus treasury and grain — a true warlord at once; but a tall tree draws the wind, and Lü Bu and Cao Cao now turn their eyes upon you.
- **B 辞徐州 / Decline Xuzhou** — 声望大涨，天下归心，日后招贤纳士事半功倍；然仅得小沛一城，基业微薄，前路艰难。 / Renown soars and hearts turn to you — recruiting worthy men grows far easier hereafter; but you hold only Xiaopei, a slender foundation for a hard road.

**Transition** — zh: 群雄纷起，汉祚将倾。你以一介布衣立身乱世，名已初显。风云变幻，数载春秋倏忽而过…… · en: The warlords rise, and the Han's mandate flickers low. From a commoner's beginnings you have carved a name into a world of chaos. The winds shift, and the years slip swiftly by…

### Chapter Ⅱ — 群雄逐鹿 / Among Wolves (196)

**Briefing** — zh: 吕布背信夺城，你痛失徐州，寄身小沛，进退失据。北有曹操虎视，东有吕布反覆，你如浮萍飘摇于群雄之间。然大丈夫能屈能伸——潜龙在渊，静待腾云之时。 · en: Lü Bu has betrayed you and seized your seat; Xuzhou is lost, and you shelter in Xiaopei with nowhere firm to stand. Cao Cao watches from the north like a tiger; Lü Bu turns his coat again to the east. You drift like duckweed among the mighty. Yet a great man bends before he rises — the dragon waits in the deep for the hour to mount the clouds.

**Objectives**
1. 周旋吕布 · 在吕布反覆无常的威胁下保全部众，暂避锋芒。 / Outlast Lü Bu — Keep your people whole under the treacherous warlord's shadow.
2. 归附许都 · 投奔曹操，暂借其势以图后计。 / Shelter in Xudu — Take refuge with Cao Cao and borrow his strength while you plan.
3. 煮酒论英雄 · 于曹操青梅煮酒之宴上藏锋守拙，不露圭角。 / The Plum-Wine Reckoning — At Cao Cao's table, hide your ambition and play the harmless man.
4. 脱身立业 · 觅得时机，摆脱曹操掌控，另图基业。 / Break the Leash — Seize the moment to slip Cao Cao's grasp.

**Choice — 青梅煮酒 / Green Plums and Warm Wine**
- Setup — zh: 曹操设宴，青梅煮酒，忽指你与他曰：「天下英雄，唯使君与操耳。」雷声骤至，你借惊雷失箸，掩尽锋芒。宴罢，是趁乱脱身、自立门户，还是暂作鹰犬、深藏不露？ · en: Cao Cao lays out plums and warm wine, then points from himself to you: "The only heroes in this realm are you and I." Thunder cracks — you let your chopsticks fall as if startled, and hide your fear behind the storm. When the cup is set down: do you break away and stand on your own, or bide as his hound, your claws sheathed?
- **A 脱身自立 / Break Free** — 重获自由与本部兵马，可另寻州郡立足；然自此与曹操决裂，成其心腹之患，追兵将至。 / Reclaim your freedom and troops, free to seek a province; but you break with Cao Cao for good — his pursuers will come.
- **B 蛰伏许都 / Bide Your Time** — 得曹操资粮扶持，实力稳步积累，安全无虞；然久居人下，行止受制，坐失良机则将永为附庸。 / Cao Cao's grain and gold let your strength grow in safety; but under another's roof, linger too long and you may remain a vassal forever.

**Transition** — zh: 猛虎之侧，你终未沦为鹰犬。挣脱牢笼，仍无寸土可依，然志向愈坚。颠沛流离间，数载又已成空…… · en: Beside the tiger, you never became its hound. You have slipped the cage — landless still, but harder of purpose than before. Through wandering and want, the years fall away once more…

### Chapter Ⅲ — 赤壁之战 / The Fires of Red Cliffs (208)

**Briefing** — zh: 三顾茅庐，你终得卧龙诸葛亮辅佐，如鱼得水。然曹操已挥师南下，八十万大军压境，荆州震动。孤军难支，唯有东联孙权、共抗强曹，方能于绝境中觅得生机——成败在此一举。 · en: After three visits to his thatched hut, you have won Zhuge Liang, the Sleeping Dragon — a fish that has found its water at last. But Cao Cao marches south with a host said to number eight hundred thousand, and Jing Province trembles. Alone you cannot stand; only by binding an alliance with Sun Quan can you find life in a hopeless place. All hangs on this single stroke.

**Objectives**
1. 隆中定策 · 采纳诸葛亮「跨有荆益、三分天下」之大略。 / The Longzhong Plan — Embrace Zhuge Liang's grand design: hold Jing and Yi, split the realm in three.
2. 联吴抗曹 · 遣诸葛亮出使江东，促成孙刘联盟。 / Forge the Alliance — Send Zhuge Liang to the Southlands and bind Sun and Liu against Cao Cao.
3. 火烧赤壁 · 借东风之利，以火攻大破曹军水寨。 / Burn the Fleet — Ride the east wind and shatter Cao Cao's chained ships with fire.
4. 略定荆州 · 趁曹操败退，抉择如何取得荆州之地。 / Claim Jing Province — As Cao Cao reels, decide how you take the land of Jing.

**Choice — 借荆州 / The Borrowing of Jing**
- Setup — zh: 赤壁功成，荆州空虚。诸葛亮献计：可向东吴「借」荆州以为根本，名为暂借，实则难还。鲁肃诚意相商，孙权势大难违。取之则据战略要地、进可图益州；然背信之名一旦坐实，孙刘联盟恐生裂痕。 · en: Red Cliffs is won, and Jing Province lies open. Zhuge Liang counsels: "borrow" Jing from the Southlands as your foothold — lent in name, but hard ever to return. Lu Su bargains in good faith, and Sun Quan is too strong to cross lightly. Take it, and you hold the strategic key to advancing on Yi Province; but let the name of oath-breaker stick, and the alliance may crack.
- **A 借荆州 / Borrow Jingzhou** — 立得荆州数郡为立业根基，兵精粮足、进取有路；然埋下东吴索还之患，日后同盟离心，恐招兵祸。 / Win several commanderies of Jing as the base you have long lacked; but plant the seed of the Southlands' resentment — a fractured alliance may one day bring war.
- **B 守盟约 / Honor the Terms** — 巩固孙刘联盟，声望大增，东南无后顾之忧；然所得之地大减，扩张受限，图取益州之路更为艰难。 / Cement the alliance and raise your renown, securing your flank; but your gains shrink and the road to Yi Province grows steeper.

**Transition** — zh: 赤壁一炬，曹操北归，天下三分之势已成。你终有荆州立足，龙已离渊。风云际会，数载光阴转瞬即逝…… · en: One blaze at Red Cliffs sent Cao Cao north, and the realm's division into three is sealed. Jing Province is yours to stand upon at last — the dragon has left the deep. Fortune gathers, and a few short years race past…

### Chapter Ⅳ — 三国鼎立 / The Three Kingdoms Stand (220)

**Briefing** — zh: 你已定益州，坐拥成都，益州七城尽归麾下，霸业初成。曹丕篡汉自立，汉室名存实亡；你身系汉祚正统，当继大位以安天下。然荆州失守、关羽殒命之仇未报——是称帝兴复，还是复仇雪恨？王图霸业，尽在你一念之间。 · en: Yi Province is yours — Chengdu your seat, seven cities under your hand, your dominion founded at last. Cao Pi has usurped the throne and the Han lives now in name alone; as its rightful heir, you must take the imperial seat to steady the realm. Yet Jing is lost and Guan Yu is slain, and that debt of blood remains unpaid. To reign and restore — or to avenge? The fate of an empire turns on a single thought.

**Objectives**
1. 继统称帝 · 于成都即皇帝位，立国号「汉」，昭告天下正统所在。 / Proclaim Shu-Han — Take the throne at Chengdu, name your realm "Han," declare where the true mandate lies.
2. 夷陵抉择 · 面对关羽之仇、荆州之失，决定是否兴兵伐吴。 / The Yiling Decision — With Guan Yu unavenged and Jing lost, decide whether to march on the Southlands.
3. 北伐中原 · 委诸葛亮六出祁山，兴师北向，图复中原。 / The Northern Expeditions — Entrust Zhuge Liang to march again on Qishan to reclaim the heartland.
4. 一统山河 · 剪灭群雄，成就统一大业，重整汉室江山。 / Unify the Realm — Cut down your rivals and make the Han whole once more.

**Choice — 夷陵之征 / The March to Yiling**
- Setup — zh: 关羽败亡、荆州陷落，此仇如刺在心。群臣力谏：孙权可暂缓，曹魏乃国贼，宜北伐而非东征。然桃园结义之情，岂容坐视？举国之兵东下伐吴，是快意恩仇，还是自蹈危局？ · en: Guan Yu is dead and Jing has fallen — the grief sits in your chest like a blade. Your ministers plead: let Sun Quan wait; Cao's Wei is the true traitor, and the sword should point north, not east. But the oath sworn in the peach garden — can you watch it go unanswered? To lead the whole nation's army east: righteous vengeance, or a step into ruin?
- **A 兴兵伐吴 / Launch the Yiling Campaign** — 士气高昂、举国同愤，胜则可复荆州、扬威天下；然孤军深入、连营数百里，一旦为陆逊火攻所破，将元气大伤、国势危殆。 / Morale burns high — victory wins back Jing and awes the realm; but strung out deep in enemy land, one fire-attack by Lu Xun could gut your strength and leave your kingdom reeling.
- **B 隐忍图强 / Restraint** — 保存国力、稳固联盟，集中兵力北向图取中原；然关羽之仇暂搁，君臣心结难平，须以大局隐忍私情。 / Preserve your strength and hold the alliance, massing north against Wei; but Guan Yu's death goes unavenged, a knot only the greater cause can bind.

**Campaign complete** — zh: 汉旗重扬于中原，三分之世终归一统。你自织席贩履之身，成一代开国之君——桃园之誓，今日终得圆满。青史煌煌，英名不朽，永载千秋…… · en: The Han banner flies again over the heartland, and a world split three ways is made one at last. From a weaver of mats and seller of sandals you have risen to found a dynasty — and the peach-garden oath is fulfilled at last. The chronicles blaze bright, your name undimmed, carried down through a thousand years…

---

## Appendix B — Scenarios 2/3/4 rosters & must-create lists

Field shape mirrors `s1-dongzhuo.ts`: `{ id, lordId, cityIds, generalIds, resources:{money,food,troops}, difficulty:1-5, personality }`. `†` = id absent from current data (must be created). Resources marked *(inferred)* are designer-assigned to match s1 scaling; others quoted from `SCENARIOS.md`.

### Scenario 2 — `s2-junxiong` 群雄逐鹿 (196/1) — 12 factions

| faction | lordId | diff | pers | money/food/troops | cities | notable generals |
|---|---|---|---|---|---|---|
| caocao | caocao | 1 | active | 60k/100k/60k* | xuchang, chenliu, puyang | +xunyu, guojia, chengyu, dianwei, xuchu, xunyou†, yujin† |
| yuanshao | yuanshao | 1 | balanced | 80k/140k/90k* | yecheng, nanpi, pingyuan, beihai, jinyang, beiping | +chunyuqiong†, guotu†, xinping† |
| sunce | sunce | 3 | active | 30k/50k/25k | jianye, wujun, kuaiji, chaisang | zhouyu†, sunquan†, zhoutai†, taishici |
| liubei | liubei | 5 | balanced | 3k/5k/2k | xiaopei | guanyu, zhangfei, zhaoyun, jianyong, mizhu |
| lvbu | lvbu | 2 | active | 30k/45k/30k* | xiapi, pengcheng | gaoshun†, zhangliao†, zangba†, chengong†, weixu†, songxian†, houcheng† |
| liubiao | liubiao | 2 | turtle | 40k/70k/30k | xiangyang, jiangxia, jiangling | (as s1) |
| zhangxiu | zhangxiu† | 3 | balanced | 15k/25k/12k* | wancheng | zhangxiu†, jiaxu |
| yuanshu | yuanshu | 3 | balanced | 50k/70k/30k* | shouchun, lujiang | jiling, zhangxun, yanghong |
| liuzhang | liuzhang† | 2 | turtle | 30k/80k/25k* | chengdu, mianzhu, zitong, bajun, jianning, yunnan | zhangren, yanyan, huangquan, liyan, wuyi |
| mahan | mateng | 3 | active | 15k/25k/18k* | xiliang, tianshui | hansui, machao, pangde |
| zhanglu | zhanglu | 3 | turtle | 20k/40k/12k | hanzhong | yangsong, yangren, yangang2 |
| gongsundu | gongsundu | 4 | turtle | 15k/25k/10k | xiangping | liangji |

Decisions: Wancheng → **zhangxiu** (Cao drops to 3 cities); `liuyan` dropped (died) → `liuzhang`. **Must-create:** `xunyou, yujin, chunyuqiong, guotu, xinping, zhouyu, sunquan, zhoutai, gaoshun, zhangliao, zangba, chengong, weixu, songxian, houcheng, zhangxiu, liuzhang`. Hidden searchers: `caizhong` (通宵虫@xiapi), `hanxuan` (南方小鬼@xiliang).

### Scenario 3 — `s3-chibi` 赤壁之战 (208/7) — 8 factions

| faction | lordId | diff | pers | money/food/troops | cities | notable generals |
|---|---|---|---|---|---|---|
| caocao | caocao | 1 | active | 200k/300k/250k | 20 northern cities (changan…shouchun) | +zhangliao†, xuhuang†, simayi†, pangde, jiaxu |
| sunquan | sunquan† | 2 | balanced | 60k/100k/80k* | jianye, wujun, kuaiji, chaisang, lujiang | zhouyu†, lusu†, lvmeng†, luxun†, ganning†, taishici, +Wu civil |
| liubei | liubei | 3 | balanced | 8k/12k/10k | jiangxia | zhugeliang†, guanyu, zhangfei, zhaoyun, mizhu, mifang†, sunqian† |
| liuzhang | liuzhang† | 2 | turtle | 35k/90k/40k* | chengdu, mianzhu, zitong, bajun, jianning, yunnan | zhangren, yanyan, huangquan, liyan, wuyi |
| mahan | machao | 3 | active | 30k/50k/40k* | xiliang, tianshui | hansui |
| zhanglu | zhanglu | 4 | turtle | 20k/40k/15k* | hanzhong | yangsong, yangren, yangang2 |
| shixie | shixie† | 5 | turtle | 10k/20k/8k* | jiaozhou† (or lingling+guiyang) | — |
| gongsunkang | gongsunkang† | 4 | turtle | 15k/25k/10k* | xiangping | liangji |

Decisions: Cao's list = 20 (襄平→gongsunkang); 江夏→**liubei** (Sun drops to 5); Pang De starts with **Cao** (not mahan); `xushu` wild@xuchang, `pangtong` wild. **Must-create:** Wei `zhangliao, xuhuang, yujin, xunyou, simayi`; Wu `sunquan, zhouyu, zhoutai, lusu, lvmeng, luxun, ganning, lingtong, jiangqin, zhangzhao, zhanghong, guyong`; Shu `zhugeliang, mifang, sunqian` + wild `xushu, pangtong`; lords `liuzhang, shixie, gongsunkang`; city `jiaozhou` (unless folded). Hidden searchers: `jiahua` (通宵虫@changan), `yangqiu` (南方小鬼@bajun).

### Scenario 4 — `s4-dingli` 三国鼎立 (220/10) — 3+1 factions

| faction | lordId | name | diff | pers | money/food/troops | cities |
|---|---|---|---|---|---|---|
| caopi | caopi† | 曹魏 Cao Wei | 2 | balanced | 250k/400k/300k | 22 northern cities |
| liubei | liubei | 蜀汉 Shu Han | 3 | active | 80k/150k/120k | chengdu, mianzhu, zitong, bajun, hanzhong, jianning, yunnan (7) |
| sunquan | sunquan† | 东吴 Dong Wu | 3 | balanced | 150k/250k/180k | jianye, wujun, kuaiji, chaisang, lujiang, jiangxia, jiangling, changsha, guiyang, wuling, lingling, xiangyang (12) |
| gongsunyuan | gongsunyuan† | 辽东 Liaodong | 5 | turtle | 20k/30k/15k* | xiangping |

Decisions: 襄阳→**sunquan** (per doc); `guanyu` excluded (dead 219) unless the optional "关羽未死" branch flag is set; `jiangwei` starts in Wei's `xiliang`, joins Shu via event (not in Shu's starting roster); `lvmeng` player-selectable (died 220). **Must-create (many shared with s3):** Wei `caopi, caozhen, caoxiu, simayi, simashi, simazhao, zhangliao, xuhuang, yujin, manchong, tianyu, qianzhao, zhongyao, huaxin, wanglang, dengai, zhonghui`; Shu `zhugeliang, huangzhong, weiyan, jiangwan, feiyi, dongyun, maliang, masu, jiangwei, wangping, zhangni, liaohua, guanxing, zhangbao`; Wu `sunquan, luxun, lvmeng, ganning, lingtong, xusheng, dingfeng, jiangqin, panzhang, zhugejin, guyong, buzhi, zhangzhao`; Liaodong `gongsunyuan`. Hidden searchers: `liushan` (通宵虫@xiliang), `menghuo` (南方小鬼@jinyang).

**Cross-chapter note:** shared new ids (`zhangliao`, `zhugeliang`, `sunquan`, `simayi`, `luxun`, `yujin`, `xunyou`, …) are authored **once** in the general-data files and referenced by multiple chapters. Several s1 ids (`sunce`, `sunquan`→child, `machao`, `guanyu`, `zhaoyun`, `liubei`) need era-specific stat/age variants for later chapters — handled per-chapter in Phase 3.
