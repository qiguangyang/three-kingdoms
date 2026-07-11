# Story Campaign — Phase 3: Chapter 2 (群雄逐鹿) + the Historic Transition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the campaign *flow*: winning Chapter 1 now bridges ("…years pass") into a real, playable **Chapter Ⅱ — 群雄逐鹿 (196 CE)** where Liu Bei is a homeless guest among warlords. Deliver Scenario 2's data (playable in Free Play too), a generalized chapter-transition mechanism (finally using the reserved `chapterTransition` bridge), and Liu Bei's Chapter 2 arc.

**Architecture:** Five changes on the Phase-1/2 engine: (1) 19 new general records; (2) a `Scenario.generalOverrides` mechanism for era-variant stats; (3) the Scenario 2 12-faction roster (inline `generalIds` so s1/s2 can differ); (4) a `CHAPTERS` registry + generalized `startChapter(protagonist, n)` + `outcomeScreen` routing a Story-Mode win to `chapterTransition` (→ start next chapter) when a next chapter exists, else `chapterComplete`, with the briefing/transition/complete screens resolving keys by `storyMode.chapter`; (5) the Liu Bei Chapter 2 arc content.

**Tech Stack:** Vite + React 19 + Zustand + TypeScript (ESM/NodeNext, explicit `.js`) + Vitest.

**Spec:** `docs/superpowers/specs/2026-07-11-story-campaign-design.md` (Appendix A Ch.Ⅱ, Appendix B s2 roster). **Builds on Phases 1–2** (branch `story-campaign`, 348 tests green).

## Global Constraints

- **English identifiers + comments; bilingual UI.** Every new user-facing string → a `MessageKey` in `src/i18n/types.ts` **and** both catalogs (parity test). Use the verbatim bilingual text in Appendix C.
- **Always green.** Full Vitest + `npx tsc --noEmit` + `npm run build` at every task boundary. Baseline: **348 tests**.
- **THE SEAM is sacred.** Off-screen `resolveQuickBattle` untouched.
- **Do not regress s1 or Free Play.** Scenario 1 and its shipped Liu Bei arc must behave identically. Because s2 uses **inline `generalIds`** (not the shared `FACTION_GENERAL_IDS`), adding generals to `GENERALS` must NOT add them to any s1 faction. Free Play scenario-select and unify victory unchanged.
- **Determinism + save/load.** Pure engine (no `Date.now`/`Math.random`); `startChapter` uses a fixed seed. New `GameState` nothing added (storyMode.chapter already exists).
- **Clean re-seed on transition.** A chapter transition rebuilds the next scenario fresh (`newGame`-style) — no cross-chapter state carrying (continuity is narrative). This matches the spec.

## Key current-state facts (verified)

- Generals use a builder `g(id, zh, en, [wu,zhi,tong,zheng], age, troopType='infantry', loyalty=80, startCityId=null)`; declared in per-faction `const` arrays spread into `ALL` → `GENERALS` (a `Record`); `FACTION_GENERAL_IDS[factionId] = ARR.map(x=>x.id)`. `WILD` generals have `factionId:null` + a `locationCityId`. A general's `factionId` is assigned by the scenario loader from the scenario's `generalIds` — so the SAME id can be WILD in s1 and faction-owned in s2 (each scenario's `generalIds` is independent).
- `s2-junxiong.ts` is a stub (`factions:[]`, `todo:true`). All s2 city ids already exist (no new cities). `SCENARIOS`/`SCENARIO_LIST` in `src/data/scenarios/index.ts`; scenario-select hides `todo` scenarios.
- `startStoryMode()` (`store.ts:136-160`) hardcodes s1/liubei/chapter1/seed1 → `buildInitialState` + register agents (skip protagonist) + `seedObjectives` + route `briefing`. `newGame(scenario, playerFactionId, seed)` (`store.ts:111-128`) is the non-story twin.
- `outcomeScreen(outcome, game)` (`store.ts:106-109`): `victory && storyMode → chapterComplete; else gameOver`. Three callers pass the committed game. Receives full `game` (can read `storyMode.chapter`).
- `ChapterTransitionScreen` (`StoryEventModal.tsx:108-127`): reads `story.ch1.transition` (hardcoded), `onContinue → setScreen('main')` (the hook point for "start next chapter"). `ChapterCompleteScreen` (`:134-157`): terminal (`clearContinuousSave` + title), keys `story.ch1.complete.*`. `BriefingScreen` (`:83-103`): keys `story.ch1.title`/`.briefing`. All three are Ch1-key-hardcoded and must resolve by `storyMode.chapter`.
- `objectivesFor`/`storyEventsFor`: test-overlay-first, then a direct branch `scenarioId==='s1-dongzhuo' && storyMode?.protagonistFactionId==='liubei'`. Extend with an s2 branch.

## Pre-flight note (task ordering)

Recommended order **T1 → T2 → T3 → T4 → T5**. T4 makes the Briefing/Transition/Complete screens resolve keys dynamically as `` `story.ch${n}.…` as MessageKey `` — the cast lets T4 compile and pass its gate BEFORE T5 authors the `story.ch2.*` catalog entries (a chapter-2 screen would transiently render the raw key until T5 lands). Therefore T4's tests assert routing/state (`storyMode.chapter`, screen kind), NOT rendered Chapter-2 text. The full Ch1→win→transition→Ch2→win→chapterComplete flow only becomes end-to-end after T5 (which supplies Chapter 2's objectives + keys). T5's s2 objective/event registration mirrors the s1 direct-branch with the test overlay checked first.

## File Structure

- **Modify:** `src/data/generals/index.ts` (T1: +19 records), `src/engine/types.ts` (T2: `Scenario.generalOverrides?`), `src/engine/scenario.ts` (T2: apply overrides), `src/data/scenarios/s2-junxiong.ts` (T3: roster), `src/state/store.ts` (T4: `startChapter`, `outcomeScreen`), `src/web/screens/StoryEventModal.tsx` (T4: chapter-keyed screens + transition onContinue), `src/engine/story/objectives.ts` + `events.ts` (T5: s2 branch), `src/i18n/types.ts` + catalogs (T5: ch2 keys).
- **Create:** `src/engine/story/chapters.ts` (T4: `CHAPTERS` registry), `src/data/story/s2-liubei.ts` (T5: Ch.2 content).
- **Tests:** `tests/data/generals.test.ts` or similar (T1), `tests/engine/scenario.test.ts` (T2), `tests/data/scenarios.test.ts` (T3), `tests/state/story-store.test.ts` + a chapter-transition test (T4), `tests/engine/story/s2-liubei.test.ts` (T5).

---

### Task 1: Scenario 2 new general records (19)

**Files:** Modify `src/data/generals/index.ts`. Test: `tests/data/generals.test.ts` (create if absent).

**Interfaces:** Produces 19 new ids in `GENERALS` (see Appendix A). They are added to `GENERALS` (via a new `const S2_NEW: General[]` spread into `ALL`) but MUST NOT be added to any existing `FACTION_GENERAL_IDS` array (s2 references them via inline `generalIds` in T3, keeping s1 rosters unchanged). The two searchers (`caizhong`, `hanxuan`) are WILD-style (given a `locationCityId`).

- [ ] **Step 1: failing test** — assert each of the 19 new ids exists in `GENERALS` with the exact stats/name/troopType from Appendix A (spot-check ~5: `zhouyu` 80/95/95/85 navy, `zhangliao` 92/80/92/70 cavalry, `chengong` 35/90/70/80, `sunquan` 55/80/75/88, `caizhong` wild@`xiapi`). Also assert NONE of the 19 appear in `FACTION_GENERAL_IDS.caocao` (guards the s1-unchanged invariant).
- [ ] **Step 2: run, verify fail** (`npx vitest run tests/data/generals.test.ts`) — ids undefined.
- [ ] **Step 3: implement** — add a `const S2_NEW: General[] = [ ... ]` block using the `g(...)` builder, one line per Appendix A row, and spread `...S2_NEW` into the `ALL` array. Do NOT add a `FACTION_GENERAL_IDS.*` entry for these (s2 uses inline ids). Faction-owned s2 generals get the builder default `factionId:null` (loader assigns); the two searchers pass their `locationCityId` (7th/8th args) like existing WILD entries. Example rows:
  ```ts
  g('zhouyu', '周瑜', 'Zhou Yu', [80, 95, 95, 85], 21, 'navy'),
  g('zhangliao', '张辽', 'Zhang Liao', [92, 80, 92, 70], 27, 'cavalry'),
  g('chengong', '陈宫', 'Chen Gong', [35, 90, 70, 80], 41, 'infantry'),
  g('sunquan', '孙权', 'Sun Quan', [55, 80, 75, 88], 14, 'infantry'),
  g('caizhong', '蔡中', 'Cai Zhong', [60, 40, 55, 35], 30, 'navy', 80, 'xiapi'),
  ```
- [ ] **Step 4: run, verify pass.**
- [ ] **Step 5: full gate + commit** — `git commit -m "Add Scenario 2 general records (196 CE roster)"`.

---

### Task 2: Scenario `generalOverrides` mechanism (era-variant stats)

**Files:** Modify `src/engine/types.ts` (add field to `Scenario`), `src/engine/scenario.ts` (apply in `buildInitialState`). Test: `tests/engine/scenario.test.ts`.

**Interfaces:** Produces `Scenario.generalOverrides?: Record<GeneralId, Partial<Pick<General, 'stats' | 'age' | 'troopType' | 'loyalty'>>>` — a per-scenario patch applied to the cloned general records at build time (so s2 can make `sunce`/`machao` adults without touching the shared `GENERALS` base or s1).

- [ ] **Step 1: failing test** — build a scenario with `generalOverrides: { sunce: { stats: { wu: 92, zhi: 75, tong: 88, zheng: 70 }, age: 21 } }` and assert the built `GameState.generals['sunce'].stats.wu === 92` and `.age === 21`, while a build WITHOUT the override leaves the base stats. (Use a tiny inline scenario or SCENARIO_DONGZHUO with an added override for the test.)
- [ ] **Step 2: run, verify fail** — the field doesn't exist / isn't applied.
- [ ] **Step 3: implement** — add `generalOverrides?: Record<GeneralId, Partial<Pick<General,'stats'|'age'|'troopType'|'loyalty'>>>;` to the `Scenario` interface. In `buildInitialState`, after the generals are cloned into the working map and BEFORE faction assignment, apply the overrides: for each `[id, patch]`, if the general exists, merge — `stats` is a shallow-merge (`{ ...g.stats, ...patch.stats }`), other fields replace. Keep it pure/immutable (replace the general object). Do nothing if `generalOverrides` is absent (s1 unaffected).
- [ ] **Step 4: run, verify pass.**
- [ ] **Step 5: full gate + commit** — `"Add scenario generalOverrides for era-variant stats"`.

---

### Task 3: Scenario 2 roster (playable)

**Files:** Modify `src/data/scenarios/s2-junxiong.ts`. Test: `tests/data/scenarios.test.ts`.

**Interfaces:** Consumes T1 generals + T2 overrides. Produces a real `SCENARIO_JUNXIONG` (12 factions, `todo` removed) → `buildInitialState` succeeds; scenario-select offers it.

- [ ] **Step 1: failing test** — `buildInitialState({ scenario: SCENARIO_JUNXIONG, playerFactionId: 'liubei', refData: REF_DATA, seed: 1 })` succeeds; the result has 12 factions all `alive`, every faction's `generalIds` resolve to real generals now owned by that faction (e.g. `generals['zhouyu'].factionId === 'sunce'`, `generals['xunyu'].factionId === 'caocao'`), `cities['xiaopei'].factionId === 'liubei'`, and the era-override applied (`generals['sunce'].stats.wu === 92`). Also assert `SCENARIO_JUNXIONG.todo` is falsy and it appears in `SCENARIO_LIST` as selectable.
- [ ] **Step 2: run, verify fail** — stub has empty factions / `todo:true`.
- [ ] **Step 3: implement** — fill `factions` with the 12 `FactionSetup` objects from Appendix B (INLINE `generalIds` id arrays — NOT `FACTION_GENERAL_IDS`), set `generalOverrides` for `sunce`/`machao` (Appendix B footnotes), remove `todo:true`, and drop the "(stub)" from the description. Keep `startYear:196, startMonth:1, victory:{kind:'unify'}`. Resolve the Wancheng owner to `zhangxiu` (Cao holds `xuchang,chenliu,puyang`).
- [ ] **Step 4: run, verify pass.**
- [ ] **Step 5: full gate + commit** — `"Implement Scenario 2 (群雄逐鹿) 12-faction roster"`.

---

### Task 4: Chapter registry + generalized startChapter + transition routing

**Files:** Create `src/engine/story/chapters.ts`. Modify `src/state/store.ts` (`startStoryMode`→uses `startChapter`; `outcomeScreen`), `src/web/screens/StoryEventModal.tsx` (chapter-keyed Briefing/Transition/Complete; transition `onContinue`). Test: `tests/state/story-store.test.ts` + `tests/state/chapter-transition.test.ts`.

**Interfaces:**
- Produces `src/engine/story/chapters.ts`: `interface ChapterDef { chapter: number; scenarioId: string }` and `CHAPTERS: Record<FactionId, ChapterDef[]>` = `{ liubei: [{chapter:1, scenarioId:'s1-dongzhuo'}, {chapter:2, scenarioId:'s2-junxiong'}] }`; helper `nextChapter(protagonistId, chapter): ChapterDef | undefined` and `chapterScenarioId(protagonistId, chapter): string | undefined`.
- `startChapter(protagonistId: FactionId, chapter: number): void` in `store.ts` (generalized `startStoryMode`).
- `outcomeScreen` now routes a Story-Mode victory to `chapterTransition` when a next chapter exists, else `chapterComplete`.

- [ ] **Step 1: failing tests** — (a) a Story-Mode game at chapter 1 that reaches `'victory'` routes to `{kind:'chapterTransition'}` (a next chapter exists); (b) a Story-Mode game at chapter 2 that reaches `'victory'` routes to `{kind:'chapterComplete'}` (no chapter 3); (c) `startChapter('liubei', 2)` builds `s2-junxiong` with `storyMode:{protagonistFactionId:'liubei',chapter:2}`, seeds Chapter-2 objectives (empty until T5 — assert `storyMode.chapter===2` + scenarioId + screen `briefing`), registers agents for non-`liubei` factions; (d) `startStoryMode()` still launches chapter 1 (`storyMode.chapter===1`, s1). (Drive victory via the existing overlays.)
- [ ] **Step 2: run, verify fail.**
- [ ] **Step 3: implement**
  - `chapters.ts`: the registry + `nextChapter`/`chapterScenarioId` helpers.
  - `startChapter(protagonistId, chapter)`: look up `chapterScenarioId`; `SCENARIOS[scenarioId]`; `buildInitialState({ scenario, playerFactionId: protagonistId, refData: REF_DATA, seed: 1 })`; set `storyMode:{protagonistFactionId, chapter}`; `seedObjectives`; register agents (skip `protagonistId`); route `{kind:'briefing'}`. Refactor `startStoryMode()` to `startChapter('liubei', 1)`.
  - `outcomeScreen(outcome, game)`: `if (outcome==='victory' && game.storyMode) { return nextChapter(game.storyMode.protagonistFactionId, game.storyMode.chapter) ? { kind:'chapterTransition' } : { kind:'chapterComplete' }; } return { kind:'gameOver', outcome };`
  - `StoryEventModal.tsx`: make `BriefingScreen`/`ChapterTransitionScreen`/`ChapterCompleteScreen` read `const n = game.storyMode?.chapter ?? 1;` and resolve keys `` `story.ch${n}.briefing` `` / `` `story.ch${n}.transition` `` / `` `story.ch${n}.complete.title` `` etc. (cast to `MessageKey`). `ChapterTransitionScreen.onContinue` → `startChapter(game.storyMode!.protagonistFactionId, game.storyMode!.chapter + 1)` (start the next chapter) instead of `setScreen('main')`.
- [ ] **Step 4: run, verify pass.**
- [ ] **Step 5: full gate + commit** — `"Add chapter registry + generalized startChapter + Ch1->Ch2 transition"`.

---

### Task 5: Liu Bei Chapter 2 arc content

**Files:** Create `src/data/story/s2-liubei.ts`. Modify `src/engine/story/objectives.ts` + `events.ts` (add s2 branch), `src/i18n/types.ts` + both catalogs (ch2 keys). Test: `tests/engine/story/s2-liubei.test.ts`.

**Interfaces:** Consumes the `hasEvent` pattern + `transferCityWithGenerals` (import/re-implement from `s1-liubei.ts`). Produces `S2_LIUBEI_OBJECTIVES` (ids `outlastLvbu`, `shelter`, `plumWine`, `breakFree`[optional]) and `S2_LIUBEI_EVENTS` (`shelter_xudu` beat, `plum_wine` choice[`break`/`bide`]), registered under `scenarioId==='s2-junxiong' && storyMode?.protagonistFactionId==='liubei'` in both lookups (test-overlay precedence preserved).

- [ ] **Step 1: failing tests** — `objectivesFor('s2-junxiong', liubeiCh2)` returns the 4 objectives (`breakFree.optional===true`); each `check` flips per Appendix C's predicates; `storyEventsFor(...)` includes `shelter_xudu` (beat, `choices:[]`) and `plum_wine` (2 choices, `portrait:'caocao'`); the `shelter_xudu` apply injects Xiaopei resources; `plum_wine` `break`/`bide` apply the specified effects + record `plum_wine_broke`/`plum_wine_bided`; `plumWine` objective completes on either flag (gating), `breakFree` only on `plum_wine_broke`; i18n parity.
- [ ] **Step 2: run, verify fail.**
- [ ] **Step 3: implement** — author `s2-liubei.ts` per Appendix C (predicates + apply effects verbatim), add the s2 branch to `objectivesFor`/`storyEventsFor` (mirroring the s1 branch, after the overlay check), and add ALL ch2 MessageKeys (Appendix C §5 list) to `types.ts` + both catalogs with the exact bilingual text. Reuse `story.ch1.transition` for the Ch1→Ch2 bridge (do NOT add a `story.ch2.intro`). Add `story.ch2.transition` + `story.ch2.complete.*` (for the Ch2 terminal, since Ch3 isn't built).
- [ ] **Step 4: run, verify pass.**
- [ ] **Step 5: full gate + commit** — `"Add Liu Bei Chapter 2 arc (群雄逐鹿): objectives + shelter beat + Plum-Wine choice"`.

---

## Appendix A — the 19 new general records (`[wu, zhi, tong, zheng]`, age 196 CE)

| id | zh / en | stats | age | troopType | note |
|---|---|---|---|---|---|
| `xunyou` | 荀攸 / Xun You | 30/92/65/88 | 39 | infantry | Cao advisor |
| `yujin` | 于禁 / Yu Jin | 84/70/88/70 | 40 | infantry | shared s3/s4 |
| `zhouyu` | 周瑜 / Zhou Yu | 80/95/95/85 | 21 | navy | shared s3 |
| `sunquan` | 孙权 / Sun Quan | 55/80/75/88 | 14 | infantry | era-variant later; shared s3/s4 |
| `zhoutai` | 周泰 / Zhou Tai | 88/50/75/40 | 26 | navy | shared s3 |
| `gaoshun` | 高顺 / Gao Shun | 88/65/88/50 | 40 | infantry | Lü Bu |
| `zhangliao` | 张辽 / Zhang Liao | 92/80/92/70 | 27 | cavalry | shared s3/s4 |
| `zangba` | 臧霸 / Zang Ba | 82/65/75/55 | 31 | cavalry | Lü Bu |
| `chengong` | 陈宫 / Chen Gong | 35/90/70/80 | 41 | infantry | Lü Bu |
| `zhangxiu` | 张绣 / Zhang Xiu | 88/55/80/50 | 33 | cavalry | (zhi/tong/zheng inferred) |
| `liuzhang` | 刘璋 / Liu Zhang | 15/55/45/60 | 35 | infantry | inferred (feeble lord) |
| `chunyuqiong` | 淳于琼 / Chunyu Qiong | 72/45/68/40 | 46 | cavalry | inferred |
| `guotu` | 郭图 / Guo Tu | 25/72/55/65 | 40 | infantry | inferred |
| `xinping` | 辛评 / Xin Ping | 30/70/50/68 | 40 | infantry | inferred |
| `weixu` | 魏续 / Wei Xu | 72/40/65/35 | 35 | cavalry | inferred (Lü Bu betrayer) |
| `songxian` | 宋宪 / Song Xian | 73/38/63/33 | 34 | cavalry | inferred (betrayer) |
| `houcheng` | 侯成 / Hou Cheng | 74/42/64/38 | 36 | cavalry | inferred (betrayer) |
| `caizhong` | 蔡中 / Cai Zhong | 60/40/55/35 | 30 | navy | WILD searcher @`xiapi`, loyalty 80 |
| `hanxuan` | 韩玄 / Han Xuan | 55/45/58/50 | 45 | infantry | WILD searcher @`xiliang`, loyalty 80 |

## Appendix B — Scenario 2 faction setups (inline `generalIds`)

`generalOverrides` for the whole scenario: `{ sunce: { stats:{wu:92,zhi:75,tong:88,zheng:70}, age:21 }, machao: { stats:{wu:95,zhi:50,tong:80,zheng:40}, age:21 } }`.

| # | id | lordId | color | diff | pers | money/food/troops | cityIds | generalIds (inline) |
|---|---|---|---|---|---|---|---|---|
| 1 | caocao | caocao | magenta | 1 | active | 60000/100000/60000 | xuchang, chenliu, puyang | caocao, xiahoudun, xiahouyuan, caoren, caohong, yuejin, lidian, xunyu, guojia, chengyu, dianwei, xuchu, xunyou, yujin |
| 2 | yuanshao | yuanshao | blueBright | 1 | balanced | 80000/140000/90000 | yecheng, nanpi, pingyuan, beihai, jinyang, beiping | yuanshao, yanliang, wenchou, tianfeng, jushou, shenpei, zhanghe, gaolan, chunyuqiong, guotu, xinping |
| 3 | sunce | sunce | cyanBright | 3 | active | 30000/50000/25000 | jianye, wujun, kuaiji, chaisang | sunce, zhouyu, sunquan, chengpu, huanggai, handang, taishici, zhoutai |
| 4 | liubei | liubei | green | 5 | balanced | 3000/5000/2000 | xiaopei | liubei, guanyu, zhangfei, zhaoyun, jianyong, mizhu |
| 5 | lvbu | lvbu | redBright | 2 | active | 30000/45000/30000 | xiapi, pengcheng | lvbu, gaoshun, zhangliao, zangba, chengong, weixu, songxian, houcheng |
| 6 | liubiao | liubiao | yellow | 2 | turtle | 40000/70000/30000 | xiangyang, jiangxia, jiangling | liubiao, kuaiyue, kuailiang, caimao, zhangyun, huangzu, wenpin |
| 7 | zhangxiu | zhangxiu | whiteBright | 3 | balanced | 15000/25000/12000 | wancheng | zhangxiu, jiaxu |
| 8 | yuanshu | yuanshu | yellowBright | 3 | balanced | 50000/70000/30000 | shouchun, lujiang | yuanshu, jiling, zhangxun, yanghong |
| 9 | liuzhang | liuzhang | cyan | 2 | turtle | 30000/80000/25000 | chengdu, mianzhu, zitong, bajun, jianning, yunnan | liuzhang, zhangren, yanyan, huangquan, liyan, wuyi |
| 10 | mahan | mateng | redBright | 3 | active | 15000/25000/18000 | xiliang, tianshui | mateng, hansui, machao, pangde |
| 11 | zhanglu | zhanglu | white | 3 | turtle | 20000/40000/12000 | hanzhong | zhanglu, yangsong, yangren, yangang2 |
| 12 | gongsundu | gongsundu | blue | 4 | turtle | 15000/25000/10000 | xiangping | gongsundu, liangji |

Names for the faction `name` field: caocao 曹操/Cao Cao · yuanshao 袁绍/Yuan Shao · sunce 孙策/Sun Ce · liubei 刘备/Liu Bei · lvbu 吕布/Lü Bu · liubiao 刘表/Liu Biao · zhangxiu 张绣/Zhang Xiu · yuanshu 袁术/Yuan Shu · liuzhang 刘璋/Liu Zhang · mahan 马腾韩遂/Ma Teng & Han Sui · zhanglu 张鲁/Zhang Lu · gongsundu 公孙度/Gongsun Du. (`caizhong`/`hanxuan` are WILD, not in any faction's `generalIds`.)

## Appendix C — Chapter 2 content (predicates, apply effects, verbatim i18n)

### Objectives (`objective.s2.*`, `.title`/`.desc`)
1. `outlastLvbu` — **周旋吕布** / **Outlast Lü Bu** · zh: 在吕布反覆无常的威胁下保全部众，待其伏诛。 · en: Keep your people whole under the treacherous warlord's shadow until the wolf is put down. — **check:** `state.factions['lvbu']?.alive === false || state.cities['xiapi']?.factionId === 'liubei' || state.cities['pengcheng']?.factionId === 'liubei'`
2. `shelter` — **归附许都** / **Shelter in Xudu** · zh: 投奔曹操，暂借其势以图后计。 · en: Take refuge with Cao Cao and borrow his strength while you plan. — **check:** `hasEvent(state, 'shelter_xudu')`
3. `plumWine` (gating) — **煮酒论英雄** / **The Plum-Wine Reckoning** · zh: 于曹操青梅煮酒之宴上藏锋守拙，择定进退。 · en: At Cao Cao's table, hide your ambition, play the harmless man, and choose your course. — **check:** `hasEvent(state,'plum_wine_broke') || hasEvent(state,'plum_wine_bided')`
4. `breakFree` (`optional:true`) — **脱身立业** / **Break the Leash** · zh: 觅得时机，摆脱曹操掌控，另图基业。 · en: Seize the moment to slip Cao Cao's grasp and win a base to fight from. — **check:** `hasEvent(state,'plum_wine_broke')`

### Story events (`story.s2.*`)
- **`shelter_xudu`** (beat, `choices:[]`) — **check:** `state.turn >= 2` (framework prevents re-fire via id). **apply:** shallow-copy cities; `xiaopei.garrison += 3000`, `.food += 6000`, `.money += 3000`; return new state (no decision flag needed — the framework records `shelter_xudu`). Keys `story.s2.shelter.title`/`.body`:
  - title zh 屈身许都 / en Under the Roof at Xudu
  - body zh: 小沛难守，你束装北上，投于曹操麾下。曹操表你为豫州牧，赠以兵粮，使还小沛以御吕布。程昱进言宜早除之，曹操却笑而不纳：「方今收英雄之时，杀一人而失天下之心，不可。」你谢过而退，心知这虎穴之中，一言一行皆在人耳目之下。 · en: Xiaopei cannot hold, so you gather your baggage, ride north, and place yourself under Cao Cao. He names you Governor of Yu Province, grants you soldiers and grain, and sends you back to Xiaopei to bar Lü Bu's road. Cheng Yu urges him to cut you down early; Cao Cao only laughs it off — "This is the hour to gather heroes; to kill one man and lose the realm's heart will not do." You bow your thanks and withdraw, knowing that in this tiger's den every word and glance is watched.
- **`plum_wine`** (choice, `portrait:'caocao'`) — **check:** `state.factions['lvbu']?.alive === false && hasEvent(state,'shelter_xudu') && !hasEvent(state,'plum_wine_broke') && !hasEvent(state,'plum_wine_bided')`. Keys `story.s2.plumwine.title`/`.body`:
  - title zh 青梅煮酒论英雄 / en Green Plums and Warm Wine
  - body zh: 曹操设宴，青梅煮酒，忽以箸指你与他曰：「今天下英雄，唯使君与操耳。」雷声骤至，你借惊雷失箸，俯身拾之，掩尽锋芒。宴罢，你思忖：是趁袁术北上之机，请兵脱身、自立门户，还是暂作鹰犬、深藏不露？ · en: Cao Cao lays out green plums and warm wine, then points his chopsticks from himself to you: "The only heroes in this realm today are you and I." Thunder cracks — you let your chopsticks fall as if startled, stoop to gather them, and bury your fear beneath the storm. When the cup is set down you weigh it: seize on Yuan Shu's northward flight to beg an army and break away on your own — or bide as his hound a while longer, your claws sheathed?
  - **choice `break`** (`choice.s2.plumwine.break.label`/`.desc`): label zh 脱身自立 / en Break Free · desc zh 重夺本部兵马，趁势袭取徐州为根基；然自此与曹操决裂，成其心腹之患，追兵将至。 / en Reclaim your own troops and snatch Xuzhou for a foothold; but you break with Cao Cao for good — you become the thorn in his side, and his pursuers will come. — **apply:** record `plum_wine_broke`; `xiaopei.garrison += 6000`, `.money += 5000`, `.food += 8000`; then iff `cities['xiapi'].factionId ∈ {'caocao','lvbu',null}` → `transferCityWithGenerals(cities, generals, 'xiapi', 'liubei')`.
  - **choice `bide`** (`choice.s2.plumwine.bide.label`/`.desc`): label zh 蛰伏许都 / en Bide Your Time · desc zh 得曹操资粮扶持，实力稳步积累，安全无虞；然久居人下，行止受制，坐失良机则将永为附庸。 / en Cao Cao's grain and gold let your strength grow in safety; but under another's roof, linger too long and you may remain a vassal forever. — **apply:** record `plum_wine_bided`; `xiaopei.money += 12000`, `.food += 20000`, `.garrison += 8000`; `xiaopei.agriculture = min(100, agriculture+12)`, `.commerce = min(100, commerce+12)`.

### Chapter framing (`story.ch2.*`)
- `story.ch2.title` — zh 群雄逐鹿 / en Among Wolves
- `story.ch2.briefing` — zh: 吕布背信夺城，你痛失徐州，寄身小沛，进退失据。北有曹操虎视，东有吕布反覆，你如浮萍飘摇于群雄之间。然大丈夫能屈能伸——潜龙在渊，静待腾云之时。 · en: Lü Bu has betrayed you and seized your seat; Xuzhou is lost, and you shelter in Xiaopei with nowhere firm to stand. Cao Cao watches from the north like a tiger; Lü Bu turns his coat again to the east. You drift like duckweed among the mighty. Yet a great man bends before he rises — the dragon waits in the deep for the hour to mount the clouds.
- `story.ch2.transition` (Ch2→Ch3 bridge, for a future phase) — zh: 猛虎之侧，你终未沦为鹰犬。挣脱牢笼，仍无寸土可依，然志向愈坚。颠沛流离间，数载又已成空…… · en: Beside the tiger, you never became its hound. You have slipped the cage — landless still, but harder of purpose than before. Through wandering and want, the years fall away once more…
- `story.ch2.complete.title` — zh 第二章 · 蛟龙脱困 / en Chapter Ⅱ Complete — The Dragon Slips the Snare
- `story.ch2.complete.body` — zh: 你曾寄人篱下，与虎谋皮，青梅煮酒之间几遭窥破，终以韬晦全身。今吕布已诛，牢笼已破，你虽仍无立锥之地，然羽翼渐丰、人心愈附。潜龙未升，风雷已隐隐可闻。（未完待续） · en: You lived under another's roof and bargained with a tiger; over plums and warm wine your heart was nearly read, yet you veiled it and came through whole. Lü Bu is dead now and the snare is broken, and though you still hold no ground to call your own, your wings have thickened and hearts turn ever more to you. The dragon has not yet risen — but thunder is already faint on the wind. (To be continued)
- **Ch1→Ch2 bridge REUSES `story.ch1.transition`** (already in catalog) — no new key.

### §5 full new-key list (all in `types.ts` union + both catalogs)
`story.ch2.title`, `story.ch2.briefing`, `story.ch2.transition`, `story.ch2.complete.title`, `story.ch2.complete.body`, `objective.s2.outlastLvbu.title`, `objective.s2.outlastLvbu.desc`, `objective.s2.shelter.title`, `objective.s2.shelter.desc`, `objective.s2.plumWine.title`, `objective.s2.plumWine.desc`, `objective.s2.breakFree.title`, `objective.s2.breakFree.desc`, `story.s2.shelter.title`, `story.s2.shelter.body`, `story.s2.plumwine.title`, `story.s2.plumwine.body`, `choice.s2.plumwine.break.label`, `choice.s2.plumwine.break.desc`, `choice.s2.plumwine.bide.label`, `choice.s2.plumwine.bide.desc`.
