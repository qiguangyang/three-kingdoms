# Story Campaign — Phase 4: Chapter 3 — 赤壁之战 (Red Cliffs, 208 CE) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend the flowing campaign into a playable **Chapter Ⅲ — 火烧赤壁 (Red Cliffs, 208 CE)**: winning Chapter 2 now bridges into Scenario 3, where Liu Bei — at last joined by Zhuge Liang but cornered at Jiangxia against a vast Cao Cao — forges the Sun–Liu alliance, wins the fire at Red Cliffs, and claims a foothold in Jing. Ship Scenario 3's data (Free-Play-playable), Liu Bei's Chapter 3 arc, and the Ch2→Ch3 transition (which the Phase-3 machinery already supports).

**Architecture:** Four changes on the Phases 1-3 engine: (1) ~17 new general records (`S3_NEW`); (2) the Scenario 3 7-faction roster + `generalOverrides` for era-variants + registering chapter 3 in the `CHAPTERS` registry (one line — the transition mechanism is chapter-count-agnostic); (3) the Liu Bei Chapter 3 arc (`s3-liubei.ts`: 4 objectives + 3 scripted beats + the Borrow-Jing choice) + i18n; (4) an end-to-end reachability/integration test (Ch2→Ch3 transition + Liu Bei survives Cao Cao + the arc completes to Chapter Ⅲ Complete; tune the start only if the sim shows he can't).

**Tech Stack:** Vite + React 19 + Zustand + TypeScript (ESM/NodeNext, explicit `.js`) + Vitest.

**Spec:** `docs/superpowers/specs/2026-07-11-story-campaign-design.md` (Appendix A Ch.Ⅲ). **Builds on Phases 1–3** (branch `story-campaign`, 409 tests green).

## Global Constraints

- **English identifiers + comments; bilingual UI.** Every new user-facing string → a `MessageKey` in `src/i18n/types.ts` **and** both catalogs (parity test). Use the verbatim bilingual text in Appendix C.
- **Always green.** Full Vitest + `npx tsc --noEmit` + `npm run build` at every task boundary. Baseline: **409 tests**.
- **THE SEAM is sacred.** Off-screen `resolveQuickBattle` untouched.
- **Do NOT regress s1/s2 or Free Play or Chapters 1–2.** s3 uses **inline `generalIds`** (not shared `FACTION_GENERAL_IDS`). **Do NOT add a global city to `cities.ts`** (it would leak into s1/s2 and could break their unify victory) — Shi Xie's faction is DROPPED and no `jiaozhou` is created; all s3 cities are existing ids. `generalOverrides` is per-scenario (no-op for s1/s2). Chapter registration is additive.
- **Determinism + save/load.** Pure engine (no `Date.now`/`Math.random`); fixed seeds. Clean re-seed on transition (continuity is narrative).

## Key current-state facts (verified)

- **The chapter-transition mechanism is fully generic.** Adding `{ chapter: 3, scenarioId: 's3-chibi' }` to `CHAPTERS.liubei` (`src/engine/story/chapters.ts:21-26`) makes a Chapter-2 win route to `chapterTransition` (→ `startChapter('liubei', 3)` → s3 briefing) with NO other transition-code change. The only content needed: `story.ch3.title`/`.briefing` (+ `.complete.*` since Ch4 isn't built) in i18n, else the screens render raw keys. `story.ch2.transition` (the Ch2→Ch3 bridge, shown when leaving Ch2) already exists.
- Generals: builder `g(id, zh, en, [wu,zhi,tong,zheng], age, troopType='infantry', loyalty=80, startCityId=null)`; new records go in an `S3_NEW: General[]` spread into `ALL` only (NOT `FACTION_GENERAL_IDS`), exactly like `S2_NEW`.
- `Scenario.generalOverrides?: Record<GeneralId, Partial<Pick<General,'stats'|'age'|'troopType'|'loyalty'>>>` (Phase 3) applies era-variant stats in `buildInitialState`.
- s3-chibi.ts is a stub (`factions:[]`, `todo:true`); `index.ts` already registers `SCENARIO_CHIBI`. Only `s3-chibi.ts` changes (mirror `s2-junxiong.ts`).
- **Red Cliffs is modeled as scripted story beats** (no reliable tactical-fire or war-state signal exists): `objectivesFor`/`storyEventsFor` get an `s3-chibi`+`liubei` branch (after the test overlay), mirroring s2. The `red_cliffs` fire is a beat that records a flag; `burnFleet` checks the flag. Reuse `hasEvent`/`transferCityWithGenerals` from `src/data/story/helpers.ts`.

## File Structure

- **Modify:** `src/data/generals/index.ts` (T1: +~17 records), `src/data/scenarios/s3-chibi.ts` (T2: roster), `src/engine/story/chapters.ts` (T2: register ch3), `src/engine/story/objectives.ts` + `events.ts` (T3: s3 branch), `src/i18n/types.ts` + catalogs (T3: ch3 keys), possibly `src/data/scenarios/s3-chibi.ts` again (T4: start tuning if needed).
- **Create:** `src/data/story/s3-liubei.ts` (T3: Ch.3 content). Tests per task; a new `tests/playthrough/s3-chapter3-reachability.test.ts` (T4).

---

### Task 1: Scenario 3 new general records (~17)

**Files:** Modify `src/data/generals/index.ts`. Test: extend `tests/data/generals.test.ts`.

**Interfaces:** Produces ~17 new ids in `GENERALS` via `const S3_NEW: General[]` spread into `ALL` only (NOT any `FACTION_GENERAL_IDS`). Per Appendix A.

- [ ] **Step 1: failing test** — assert each new id exists in `GENERALS` with exact stats/age/troopType from Appendix A (spot-check ~5: `zhugeliang` 30/100/92/95 age27, `simayi` 45/92/82/88, `lusu` 42/92/82/88, `xuhuang` 89/75/88/55, wild `pangtong` @`chaisang` loyalty40). Assert none appear in `FACTION_GENERAL_IDS.caocao` (s1-unchanged guard). **NOTE: `shixie` is NOT created (his faction is dropped) — do not add it.**
- [ ] **Step 2: run, verify fail.**
- [ ] **Step 3: implement** — add `const S3_NEW: General[] = [ ... ]` (Appendix A rows, one `g(...)` each; `xushu`@`xuchang`/`pangtong`@`chaisang` are WILD-style with loyalty 40 + locationCityId), spread `...S3_NEW` into `ALL`.
- [ ] **Step 4: run, verify pass.**
- [ ] **Step 5: full gate + commit** — `"Add Scenario 3 general records (208 CE Red Cliffs roster)"`.

---

### Task 2: Scenario 3 roster (playable) + register chapter 3

**Files:** Modify `src/data/scenarios/s3-chibi.ts` (roster), `src/engine/story/chapters.ts` (register ch3). Test: extend `tests/data/scenarios.test.ts`, extend a chapters test.

**Interfaces:** Consumes T1 generals. Produces a real `SCENARIO_CHIBI` (7 factions, `todo` removed) + `CHAPTERS.liubei` gains `{chapter:3, scenarioId:'s3-chibi'}`.

- [ ] **Step 1: failing test** — `buildInitialState({scenario: SCENARIO_CHIBI, playerFactionId:'liubei', refData:REF_DATA, seed:1})` succeeds; **7** factions all alive; representative resolution (`generals['zhugeliang'].factionId==='liubei'`, `generals['zhouyu'].factionId==='sunquan'`, `generals['simayi'].factionId==='caocao'`); `cities['jiangxia'].factionId==='liubei'`; Cao Cao owns **22** cities incl. `xiangyang`+`jiangling`; the four southern Jing cities `changsha`/`guiyang`/`wuling`/`lingling` are **neutral** (`factionId===null`); the `sunquan` override applied (`generals['sunquan'].stats.zhi===85`, age 26); `todo` falsy; s3 in `SCENARIO_LIST`. Also assert `nextChapter('liubei',2)` now returns the ch3 def (`{chapter:3, scenarioId:'s3-chibi'}`) and `chapterScenarioId('liubei',3)==='s3-chibi'`.
- [ ] **Step 2: run, verify fail.**
- [ ] **Step 3: implement** — fill `s3-chibi.ts` `factions` with the 7 `FactionSetup` objects from Appendix B (INLINE `generalIds`; Cao Cao's 22 cityIds incl. xiangyang+jiangling; NO shixie faction), set `generalOverrides` (Appendix B), remove `todo:true`, keep `startYear:208, startMonth:7, victory:{kind:'unify'}`. Add `{ chapter: 3, scenarioId: 's3-chibi' }` to `CHAPTERS.liubei`.
- [ ] **Step 4: run, verify pass.**
- [ ] **Step 5: full gate + commit** — `"Implement Scenario 3 (赤壁之战) 7-faction roster + register chapter 3"`.

---

### Task 3: Liu Bei Chapter 3 arc content

**Files:** Create `src/data/story/s3-liubei.ts`. Modify `src/engine/story/objectives.ts` + `events.ts` (s3 branch), `src/i18n/types.ts` + both catalogs (ch3 keys). Test: `tests/engine/story/s3-liubei.test.ts`.

**Interfaces:** Consumes `hasEvent`/`transferCityWithGenerals` from `src/data/story/helpers.ts`. Produces `S3_LIUBEI_OBJECTIVES` (`longzhong`, `alliance`, `burnFleet`, `claimJing`[gating] — all mandatory) and `S3_LIUBEI_EVENTS` (beats `longzhong_plan`, `sun_liu_alliance`, `red_cliffs`, then the `jing_borrow` choice[`take`/`honor`]).

- [ ] **Step 1: failing tests** — `objectivesFor('s3-chibi', liubeiCh3)` returns the 4 objectives; each `check` flips per Appendix C predicates; `storyEventsFor(...)` includes the 3 beats (`choices:[]`) + `jing_borrow` (2 choices, `portrait:'lusu'`) in the order `[longzhong_plan, sun_liu_alliance, red_cliffs, jing_borrow]`; the beats' `apply` inject Jiangxia resources / weaken Cao's Jing garrisons per Appendix C; `jing_borrow` `take`/`honor` apply the specified effects + record `jing_borrowed`/`jing_honored`; `claimJing` gates on either flag; i18n parity. Overlay precedence preserved. s1/s2 branches + content unchanged.
- [ ] **Step 2: run, verify fail.**
- [ ] **Step 3: implement** — author `s3-liubei.ts` per Appendix C (predicates + apply effects + array order verbatim), add the s3 branch to `objectivesFor`/`storyEventsFor` (after the s2 branch, after the overlay check), add ALL ch3 MessageKeys (Appendix C §6 list — framing `story.ch3.*` + `objective.s3.*` + `story.s3.*` + `choice.s3.*`) to `types.ts` + both catalogs with exact Appendix C text. (`story.ch2.transition` reused for the Ch2→Ch3 bridge — do NOT re-add.)
- [ ] **Step 4: run, verify pass.**
- [ ] **Step 5: full gate + commit** — `"Add Liu Bei Chapter 3 arc (赤壁): Longzhong + alliance + Red Cliffs fire + Borrow-Jing choice"`.

---

### Task 4: End-to-end reachability & transition integration test

**Files:** Create `tests/playthrough/s3-chapter3-reachability.test.ts`. Possibly modify `src/data/scenarios/s3-chibi.ts` (liubei start tuning, only if the sim requires it).

**Interfaces:** Consumes the full Phases 1-4 stack. Produces a deterministic guard that Chapter 3 is winnable and the Ch2→Ch3 transition is wired.

- [ ] **Step 1: write the test** (this task is test-first by nature). Build s3 as Liu Bei in Story Mode (`startChapter`/`buildInitialState` + `seedObjectives`, seed 1; drive AI like `tests/playthrough/s2-chapter2-reachability.test.ts` / `long-simulation.test.ts`). Run the turn loop a bounded number of turns (e.g. 24-36). Assert:
  - **(a) Transition wiring:** a Story-Mode Chapter-2 *victory* state routes (via `outcomeScreen`) to `chapterTransition`, and `startChapter('liubei',3)` produces a valid s3 game (`storyMode.chapter===3`, scenario `s3-chibi`, briefing). (This can be a focused unit assertion, not the full sim.)
  - **(b) Survival:** Liu Bei's faction is still `alive` past ~turn 3 (survives Cao Cao's opening — the `sun_liu_alliance` beat injects +8000 Jiangxia garrison early to help).
  - **(c) Arc completes:** within the bound, the scripted beats fire in order and `claimJing`'s gate becomes reachable (i.e. after `red_cliffs` fires, the `jing_borrow` event's `check` is satisfiable) — the chapter is winnable. Since the beats auto-fire on turn/flag conditions (not on combat), this should be robust; assert the flags progress `longzhong_plan → sun_liu_alliance → red_cliffs`.
- [ ] **Step 2: run it.** If Liu Bei is routinely eliminated before the arc can progress (Cao Cao at 22 cities/250k troops is overwhelming), apply a MINIMAL `s3-chibi.ts` liubei start buff (bump `resources.troops`, e.g. 10000 → 15000-20000, and/or Jiangxia garrison) — just enough to reliably survive to the alliance beat, keeping him a clear underdog (still far below Sun Quan's 80k / Cao's 250k). Re-run across a few seeds (1/2/3/7/42) for determinism. Report the exact tuning + the sim outcome that drove it; if he already survives, apply none.
- [ ] **Step 3: full gate + commit** — `"Add Chapter 3 reachability/transition test (+ start tuning if needed)"`.

---

## Appendix A — the ~17 new general records (`[wu,zhi,tong,zheng]`, age 208 CE)

Add via `const S3_NEW: General[]` (builder `g(...)`), spread into `ALL` only. `shixie` is intentionally OMITTED (faction dropped).

```ts
const S3_NEW: General[] = [
  g('zhugeliang', '诸葛亮', 'Zhuge Liang', [30, 100, 92, 95], 27, 'infantry'),
  g('lusu',       '鲁肃',   'Lu Su',       [42, 92, 82, 88], 36, 'infantry'),
  g('lvmeng',     '吕蒙',   'Lü Meng',     [80, 75, 82, 65], 30, 'navy'),
  g('luxun',      '陆逊',   'Lu Xun',      [60, 82, 78, 82], 25, 'navy'),
  g('ganning',    '甘宁',   'Gan Ning',    [90, 62, 82, 40], 39, 'navy'),
  g('lingtong',   '凌统',   'Ling Tong',   [85, 55, 76, 45], 20, 'navy'),
  g('jiangqin',   '蒋钦',   'Jiang Qin',   [80, 58, 76, 52], 35, 'navy'),
  g('zhangzhao',  '张昭',   'Zhang Zhao',  [15, 85, 62, 95], 52, 'infantry'),
  g('zhanghong',  '张紘',   'Zhang Hong',  [15, 80, 55, 90], 55, 'infantry'),
  g('guyong',     '顾雍',   'Gu Yong',     [20, 78, 58, 92], 40, 'infantry'),
  g('xuhuang',    '徐晃',   'Xu Huang',    [89, 75, 88, 55], 39, 'infantry'),
  g('simayi',     '司马懿', 'Sima Yi',     [45, 92, 82, 88], 29, 'infantry'),
  g('mifang',     '糜芳',   'Mi Fang',     [60, 50, 60, 65], 35, 'infantry'),
  g('sunqian',    '孙乾',   'Sun Qian',    [25, 72, 45, 78], 45, 'infantry'),
  g('gongsunkang','公孙康', 'Gongsun Kang',[72, 60, 70, 58], 35, 'cavalry',  100),
  g('xushu',      '徐庶',   'Xu Shu',      [45, 90, 80, 78], 38, 'infantry', 40, 'xuchang'),
  g('pangtong',   '庞统',   'Pang Tong',   [40, 96, 85, 75], 29, 'infantry', 40, 'chaisang'),
];
```

## Appendix B — Scenario 3 faction setups (7 factions, inline `generalIds`)

`generalOverrides` (whole scenario):
```ts
generalOverrides: {
  sunquan:  { stats: { wu: 65, zhi: 85, tong: 88, zheng: 92 }, age: 26 },
  liubei:   { stats: { wu: 65, zhi: 80, tong: 85, zheng: 90 }, age: 47 },
  machao:   { stats: { wu: 95, zhi: 50, tong: 80, zheng: 40 }, age: 32 },
  zhouyu:   { age: 33 }, zhoutai: { age: 38 }, zhangliao: { age: 39 }, yujin: { age: 52 },
  xunyou:   { age: 51 }, jiaxu: { age: 61 }, zhanghe: { age: 41 }, pangde: { age: 38 },
  hansui:   { age: 61 }, liuzhang: { age: 47 }, guanyu: { age: 46 }, zhangfei: { age: 44 },
  zhaoyun:  { age: 41 }, mizhu: { age: 51 }, jianyong: { age: 49 }, chengpu: { age: 60 },
  huanggai: { age: 59 }, handang: { age: 57 }, taishici: { age: 43 }, liangji: { age: 55 },
},
```

| # | id | lordId | color | diff | pers | money/food/troops | cityIds | generalIds (inline) |
|---|---|---|---|---|---|---|---|---|
| 1 | caocao | caocao | magenta | 1 | active | 200000/300000/250000 | changan, luoyang, henei, hongnong, anding, jinyang, shangdang, beiping, yecheng, nanpi, pingyuan, beihai, xuchang, chenliu, puyang, wancheng, xiapi, pengcheng, xiaopei, shouchun, **xiangyang, jiangling** (22) | caocao, xiahoudun, xiahouyuan, caoren, caohong, yuejin, lidian, zhangliao, zhanghe, xuhuang, yujin, xunyu, xunyou, jiaxu, chengyu, simayi, xuchu, pangde |
| 2 | sunquan | sunquan | cyanBright | 2 | balanced | 60000/100000/80000 | jianye, wujun, kuaiji, chaisang, lujiang | sunquan, zhouyu, lusu, lvmeng, luxun, ganning, lingtong, jiangqin, chengpu, huanggai, handang, zhoutai, taishici, zhangzhao, zhanghong, guyong |
| 3 | liubei | liubei | green | 3 | balanced | 8000/12000/10000 | jiangxia | liubei, zhugeliang, guanyu, zhangfei, zhaoyun, mizhu, mifang, sunqian, jianyong |
| 4 | liuzhang | liuzhang | cyan | 2 | turtle | 35000/90000/40000 | chengdu, mianzhu, zitong, bajun, jianning, yunnan | liuzhang, zhangren, yanyan, huangquan, liyan, wuyi |
| 5 | mahan | machao | redBright | 3 | active | 30000/50000/40000 | xiliang, tianshui | machao, hansui |
| 6 | zhanglu | zhanglu | white | 4 | turtle | 20000/40000/15000 | hanzhong | zhanglu, yangsong, yangren, yangang2 |
| 7 | gongsunkang | gongsunkang | blue | 4 | turtle | 15000/25000/10000 | xiangping | gongsunkang, liangji |

Neutral (unowned) in s3: `changsha, guiyang, wuling, lingling` (the four southern Jing commanderies, for Liu Bei to claim via the Borrow-Jing choice). Faction `name{zh,en}`: caocao 曹操/Cao Cao · sunquan 孙权/Sun Quan · liubei 刘备/Liu Bei · liuzhang 刘璋/Liu Zhang · mahan 马超韩遂/Ma Chao & Han Sui · zhanglu 张鲁/Zhang Lu · gongsunkang 公孙康/Gongsun Kang. (`xushu`/`pangtong` are WILD, in no faction.) City accounting: 22+5+1+6+2+1+1 = 38 owned + 4 neutral = 42 (all existing).

## Appendix C — Chapter 3 content (predicates, apply effects, verbatim i18n)

**Array order in `S3_LIUBEI_EVENTS`:** `[longzhongBeat, allianceBeat, redCliffsBeat, jingBorrow]`. Shared helper: `const jingDecided = (s) => hasEvent(s,'jing_borrowed') || hasEvent(s,'jing_honored');`

### Objectives (`objective.s3.*`, all mandatory; `claimJing` gating)
1. `longzhong` — **隆中定策** / **The Longzhong Plan** · zh desc 采纳诸葛亮「跨有荆益、三分天下」之大略。 · en Embrace Zhuge Liang's grand design — hold Jing and Yi, and split the realm in three. — **check:** `hasEvent(state,'longzhong_plan')`
2. `alliance` — **联吴抗曹** / **Forge the Alliance** · zh 遣诸葛亮出使江东，促成孙刘联盟。 · en Send Zhuge Liang to the Southlands and bind Sun and Liu against Cao Cao. — **check:** `hasEvent(state,'sun_liu_alliance')`
3. `burnFleet` — **火烧赤壁** / **Burn the Fleet** · zh 借东风之利，以火攻大破曹军水寨。 · en Ride the east wind and shatter Cao Cao's chained ships with fire. — **check:** `hasEvent(state,'red_cliffs')`
4. `claimJing` (GATING) — **略定荆州** / **Claim Jing Province** · zh 趁曹操败退，抉择如何取得荆州之地。 · en As Cao Cao reels, decide how you take the land of Jing. — **check:** `jingDecided(state)`

### Beats (`story.s3.*`, `choices:[]`)
- **`longzhong_plan`** — check `state.turn >= 1`, portrait `zhugeliang`, NO apply. title 隆中对策 / The Longzhong Reply · body zh: 草庐之中，诸葛亮为你铺开天下大势：「曹操拥百万之众，挟天子以令诸侯，此诚不可与争锋；孙权据有江东，可为援而不可图。唯荆、益二州沃野千里，可跨而有之——西和诸戎，南抚夷越，外结孙权，内修政理，则霸业可成，汉室可兴。」一席之言，如拨云见日。你离席长揖：先生之言，孤如鱼得水。 · en: In the thatched hut Zhuge Liang unrolls the shape of the age before you: "Cao Cao commands a host of a million and holds the Son of Heaven to command the lords — him you cannot meet head-on. Sun Quan is dug into the Southlands, an ally to lean on, not a prize to seize. But Jing and Yi are a thousand li of rich earth, and both may be yours to hold — make peace westward, soothe the tribes of the south, bind Sun Quan without and order your rule within, and a hegemon's work is done, the Han may yet be raised." The words part cloud from sun. You rise and bow low: With you, Master, I am a fish that has found its water.
- **`sun_liu_alliance`** — check `hasEvent(state,'longzhong_plan')`, portrait `sunquan`. **apply:** `jiangxia.garrison += 8000, .food += 12000, .money += 6000` (immutable copy). title 孙刘联盟 / The Southlands Pact · body zh: 诸葛亮孤身过江，舌战群儒，激孙权、说周瑜。江东主战主和，争论不休；终是鲁肃力主抗曹，周瑜慷慨请缨，孙权拔剑斫案：「敢再言降曹者，与此案同！」孙刘之盟遂成。周瑜起三万水军溯江而上，与你会师夏口，共御北来之众——绝境之中，终有并肩之人。 · en: Zhuge Liang crosses the river alone, matching wits against a hall of scholars, goading Sun Quan and swaying Zhou Yu. The Southlands quarrel without end, surrender against war — until Lu Su holds firm for resistance, Zhou Yu begs the command, and Sun Quan hacks the corner from his desk: "The next man to speak of yielding to Cao ends as this table does!" So the pact of Sun and Liu is sealed. Zhou Yu raises thirty thousand marines and sails upriver to join you at Xiakou, one front against the north — in a hopeless hour, shoulders at last beside your own.
- **`red_cliffs`** — check `hasEvent(state,'sun_liu_alliance') && !hasEvent(state,'red_cliffs')`, portrait `zhugeliang`. **apply:** for `['jiangling','xiangyang']`, if `factionId==='caocao'` set `garrison = floor(garrison*0.2)`, `defense = max(0, defense-30)`; `jiangxia.money += 5000, .food += 8000`. (Records its own id `red_cliffs` via the framework.) title 借东风 / The East Wind · body zh: 隆冬之月，江上尽刮西北风，火攻无从借力。诸葛亮筑坛作法，披发仗剑——三更时分，风向骤转东南。黄盖诈降，以蒙冲斗舰十艘满载薪草膏油，乘风纵火，直扑曹军连环船阵。顷刻烈焰腾空，火借风势，樯橹相连尽成焦土；曹军人马烧溺，死者无数。八十万大军，一夕而溃。赤壁之下，火光烛天。 · en: Deep in winter the river wind blew only from the northwest, and fire had nothing to ride. Zhuge Liang raised an altar and worked his rites, hair loose and sword in hand — and at the third watch the wind wheeled hard to the southeast. Huang Gai feigned surrender, ran ten fire-ships heaped with brushwood and oil before the wind, and drove them into Cao Cao's chained fleet. In a breath the flames leapt sky-high; wind fed fire, and the linked hulls burned to a single field of ash; Cao's men and horses were consumed or drowned past counting. Eight hundred thousand, undone in a night. Beneath the Red Cliffs, the fire lit the heavens.

### Choice `jing_borrow` (`story.s3.borrow.*`, portrait `lusu`)
- check `hasEvent(state,'red_cliffs') && !jingDecided(state)`. title 借荆州 / The Borrowing of Jing · body zh: 赤壁功成，荆州空虚。诸葛亮献计：可向东吴「借」荆州以为根本，名为暂借，实则难还。鲁肃诚意相商，孙权势大难违。取之则据战略要地、进可图益州；然背信之名一旦坐实，孙刘联盟恐生裂痕。 · en: Red Cliffs is won, and Jing Province lies open. Zhuge Liang counsels: "borrow" Jing from the Southlands as your foothold — lent in name, but hard ever to return. Lu Su bargains in good faith, and Sun Quan is too strong to cross lightly. Take it, and you hold the strategic key to advancing on Yi Province; but let the name of oath-breaker stick, and the alliance may crack.
  - **`take`** (`choice.s3.borrow.take.*`) label 借荆州 / Borrow Jingzhou · desc zh 立得荆州数郡为立业根基，兵精粮足、进取有路；然埋下东吴索还之患，日后同盟离心，恐招兵祸。 / en Win several commanderies of Jing as the base you have long lacked; but plant the seed of the Southlands' resentment — a fractured alliance may one day bring war. — **apply:** for `['jiangling','changsha','lingling','guiyang','wuling']`, if `factionId ∈ {'caocao', null}` → `transferCityWithGenerals(cities, generals, id, 'liubei')` then `garrison += 2000`; `jiangxia.money += 6000, .food += 10000`; record `jing_borrowed`.
  - **`honor`** (`choice.s3.borrow.honor.*`) label 守盟约 / Honor the Terms · desc zh 巩固孙刘联盟，声望大增，东南无后顾之忧；然所得之地大减，扩张受限，图取益州之路更为艰难。 / en Cement the alliance and raise your renown, securing your flank; but your gains shrink and the road to Yi Province grows steeper. — **apply:** for `['lingling','guiyang']`, if `factionId ∈ {'caocao', null}` → `transferCityWithGenerals(..., 'liubei')`; for every `liubei` city `loyalty = min(100, loyalty+8)`; `jiangxia.money += 3000, .food += 5000`; record `jing_honored`.

### Chapter framing (`story.ch3.*`)
- `story.ch3.title` — zh 火烧赤壁 / en The Fires of Red Cliffs
- `story.ch3.briefing` — zh: 三顾茅庐，你终得卧龙诸葛亮辅佐，如鱼得水。然曹操已挥师南下，八十万大军压境，荆州震动。孤军难支，唯有东联孙权、共抗强曹，方能于绝境中觅得生机——成败在此一举。 · en: After three visits to his thatched hut, you have won Zhuge Liang, the Sleeping Dragon — a fish that has found its water at last. But Cao Cao marches south with a host said to number eight hundred thousand, and Jing Province trembles. Alone you cannot stand; only by binding an alliance with Sun Quan can you find life in a hopeless place. All hangs on this single stroke.
- `story.ch3.transition` (Ch3→Ch4 bridge, future) — zh: 赤壁一炬，曹操北归，天下三分之势已成。你终有荆州立足，龙已离渊。风云际会，数载光阴转瞬即逝…… · en: One blaze at Red Cliffs sent Cao Cao north, and the realm's division into three is sealed. Jing Province is yours to stand upon at last — the dragon has left the deep. Fortune gathers, and a few short years race past…
- `story.ch3.complete.title` — zh 第三章 完 — 龙已离渊 / en Chapter Ⅲ Complete — The Dragon Leaves the Deep
- `story.ch3.complete.body` — zh: 一炬冲天，八十万曹军樯橹灰飞，北师仓皇遁归。你自江夏孤城而起，赖卧龙之谋、东吴之盟，终于绝境之中夺得荆州立足之地——飘泊半生，今始有寸土可守。天下三分之势已隐然成形，然益州未取、汉室未兴，前路犹长。潜龙已离深渊，云雷方动，只待乘时而上……（未完待续） · en: One tower of flame, and Cao Cao's eight hundred thousand went up in smoke and ash; the northern host fled home in disarray. From the lone city of Jiangxia you rose — on the Sleeping Dragon's counsel and the Southlands' pact — to wrest from a hopeless corner the ground of Jing you had wandered a lifetime without a home to hold. The realm's division into three now takes shape in shadow; yet Yi Province is untaken and the Han unrestored, and the road runs on. The dragon has left the deep at last, and the thunder stirs — it waits only for its hour to mount the clouds. (To be continued)
- **Ch2→Ch3 bridge REUSES `story.ch2.transition`** (already shipped) — no new key.

### §6 full new-key list (all in `types.ts` union + both catalogs)
`story.ch3.title`, `story.ch3.briefing`, `story.ch3.transition`, `story.ch3.complete.title`, `story.ch3.complete.body`, `objective.s3.longzhong.title`, `objective.s3.longzhong.desc`, `objective.s3.alliance.title`, `objective.s3.alliance.desc`, `objective.s3.burnFleet.title`, `objective.s3.burnFleet.desc`, `objective.s3.claimJing.title`, `objective.s3.claimJing.desc`, `story.s3.longzhong.title`, `story.s3.longzhong.body`, `story.s3.alliance.title`, `story.s3.alliance.body`, `story.s3.eastwind.title`, `story.s3.eastwind.body`, `story.s3.borrow.title`, `story.s3.borrow.body`, `choice.s3.borrow.take.label`, `choice.s3.borrow.take.desc`, `choice.s3.borrow.honor.label`, `choice.s3.borrow.honor.desc`.
