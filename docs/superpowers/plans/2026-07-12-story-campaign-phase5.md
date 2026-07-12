# Story Campaign — Phase 5 (FINALE): Chapter 4 — 三国鼎立 (220 CE) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Complete the campaign. Winning Chapter 3 now bridges into the playable **Chapter Ⅳ — 三国鼎立 (220 CE)**, the finale of Liu Bei's arc: he proclaims Shu-Han at Chengdu, faces the wrenching **夷陵 Yiling** revenge decision, entrusts the Northern Expeditions to Zhuge Liang, and — with the mandatory arc complete — reaches the **grand finale ending** (the peach-garden oath fulfilled, "The End"). Ship Scenario 4's data (Free-Play-playable), the Chapter 4 arc + finale, and the Ch3→Ch4 transition.

**Architecture:** Four changes on the Phases 1-4 engine, all riding generic mechanisms: (1) 32 new general records (`S4_NEW`); (2) the Scenario 4 3+1-faction roster + `generalOverrides` era-variants + registering chapter 4 in `CHAPTERS` (one line — which also flips a Ch3 win from `chapterComplete` to `chapterTransition`); (3) the Liu Bei Chapter 4 arc (`s4-liubei.ts`: 4 objectives [proclaim / yiling(gating) / northern / unify(optional)] + 2 beats + the Yiling choice) + i18n incl. the terminal finale; (4) a reachability/finale integration test.

**Tech Stack:** Vite + React 19 + Zustand + TypeScript (ESM/NodeNext, explicit `.js`) + Vitest.

**Spec:** `docs/superpowers/specs/2026-07-11-story-campaign-design.md` (Appendix A Ch.Ⅳ). **Builds on Phases 1–4** (branch `story-campaign`, 475 tests green).

## Global Constraints

- **English identifiers + comments; bilingual UI.** Every new string → a `MessageKey` in `src/i18n/types.ts` **and** both catalogs (parity test). Use verbatim Appendix C text.
- **Always green.** Full Vitest + `npx tsc --noEmit` + `npm run build` at every task boundary. Baseline: **475 tests**.
- **THE SEAM is sacred.** Off-screen `resolveQuickBattle` untouched.
- **Do NOT regress s1/s2/s3, Free Play, or Chapters 1–3.** s4 uses **inline `generalIds`** (not `FACTION_GENERAL_IDS`); the `findDuplicateId` module-init guard (Phase 4) will catch any colliding id. **No global city added** (all s4 cities exist). `generalOverrides` is per-scenario. Chapter registration is additive except for the intentional Ch3-routing flip (below).
- **Determinism + save/load.** Pure engine (no `Date.now`/`Math.random`); fixed seeds.

## Key current-state facts (verified)

- **Adding chapter 4 is one registry line** — `{ chapter: 4, scenarioId: 's4-dingli' }` in `CHAPTERS.liubei` (`src/engine/story/chapters.ts:22-26`). The transition mechanism is generic: a Ch3 win then routes to `chapterTransition` (rendering the already-shipped `story.ch3.transition` Ch3→Ch4 bridge) → `startChapter('liubei',4)` → Ch4 briefing. `story.ch3.complete.*` goes dead (harmless). **RIPPLE:** the "final-chapter victory → chapterComplete" test (retargeted to Ch3 in Phase 4) must move to **Ch4** (Ch3 win is no longer terminal). Confirm the s3 reachability test asserts `checkOutcome==='victory'` (not the screen) — it should be unaffected.
- **Ch4 is terminal** — `nextChapter('liubei',4)` is `undefined`, so a Ch4 win → `chapterComplete` → `ChapterCompleteScreen` renders `story.ch4.complete.title`/`.body` (must be authored — the grand finale), clears the save, returns to title.
- **historic victory gates on non-optional objectives only** (`hasVictory` `selectors.ts`). So an `optional: true` `unify` objective does NOT block the finale. **TRAP:** Ch4 MUST have ≥1 non-optional objective (proclaim/yiling/northern satisfy this).
- s4-dingli.ts is a stub (`todo:true`); `index.ts` already registers it. NO new cities (Wei 22 + Shu 7 + Wu 12 + Liaodong 1 = 42, all existing). Objective/event branches added after the s3 branch, after the test overlay. Reuse `hasEvent`/`transferCityWithGenerals` from `src/data/story/helpers.ts`.

## File Structure

- **Modify:** `src/data/generals/index.ts` (T1: +32 records), `src/data/scenarios/s4-dingli.ts` (T2: roster), `src/engine/story/chapters.ts` (T2: register ch4), `tests/state/story-store.test.ts` (T2: retarget final-chapter test), `src/engine/story/objectives.ts` + `events.ts` (T3: s4 branch), `src/i18n/types.ts` + catalogs (T3: ch4 keys).
- **Create:** `src/data/story/s4-liubei.ts` (T3), `tests/playthrough/s4-chapter4-finale.test.ts` (T4).

---

### Task 1: Scenario 4 new general records (32)

**Files:** Modify `src/data/generals/index.ts`. Test: extend `tests/data/generals.test.ts`.

**Interfaces:** Produces 32 new ids in `GENERALS` via `const S4_NEW: General[]` spread into `ALL` only (NOT `FACTION_GENERAL_IDS`). Per Appendix A. `dengai`/`zhonghui` WILD-style; `jiangwei` a normal record (placed in Wei via T2's inline generalIds); lords `caopi`/`gongsunyuan` loyalty 100.

- [ ] **Step 1: failing test** — assert each of the 32 new ids exists in `GENERALS` with exact stats/age/troopType from Appendix A (spot-check ~6: `caopi` 60/82/80/88, `dengai` WILD @`xiangping` loyalty40, `jiangwei` 88/90/90/70, `huangzhong` 92/60/82/45 archer, `luxun`... no `luxun` exists already — skip). Assert none appear in `FACTION_GENERAL_IDS.caocao`. The Phase-4 `findDuplicateId` guard also catches collisions at import.
- [ ] **Step 2: run, verify fail.**
- [ ] **Step 3: implement** — add `const S4_NEW: General[] = [ ... ]` (Appendix A rows via `g(...)`, mirroring `S3_NEW`), spread `...S4_NEW` into `ALL`. `dengai`@`xiangping`/`zhonghui` (pick a wild city, e.g. `luoyang`) are WILD-style (loyalty 40 + locationCityId); `jiangwei` a plain record (Wei assigns it inline in T2); `caopi`/`gongsunyuan` loyalty 100. Do NOT recreate any base/S2_NEW/S3_NEW id.
- [ ] **Step 4: run, verify pass.**
- [ ] **Step 5: full gate + commit** — `"Add Scenario 4 general records (220 CE Three Kingdoms roster)"`.

---

### Task 2: Scenario 4 roster (playable) + register chapter 4

**Files:** Modify `src/data/scenarios/s4-dingli.ts`, `src/engine/story/chapters.ts`, `tests/state/story-store.test.ts` (retarget). Test: extend `tests/data/scenarios.test.ts`.

**Interfaces:** Consumes T1 generals. Produces a real `SCENARIO_DINGLI` (4 factions, `todo` removed) + `CHAPTERS.liubei` gains `{chapter:4, scenarioId:'s4-dingli'}`.

- [ ] **Step 1: failing test** — `buildInitialState({scenario: SCENARIO_DINGLI, playerFactionId:'liubei', refData:REF_DATA, seed:1})` succeeds; **4** factions all alive; representative resolution (`generals['caopi'].factionId==='caopi'`, `generals['zhugeliang'].factionId==='liubei'`, `generals['luxun'].factionId==='sunquan'`, `generals['jiangwei'].factionId==='caopi'`); city accounting 22+7+12+1 = **42, zero neutral** (assert no city has `factionId===null`); the `liubei` override applied (`generals['liubei'].stats.wu===55`, age 59) + `zhugeliang` peak (`stats.zheng===100`); `todo` falsy; s4 in `SCENARIO_LIST`. Assert `nextChapter('liubei',3)` now returns the ch4 def AND `nextChapter('liubei',4)` is `undefined` (Ch4 terminal). **RETARGET** the `story-store.test.ts` "final-chapter victory → chapterComplete" test from Ch3 to **Ch4** (a Ch4 story-win → `chapterComplete`; a Ch3 story-win now → `chapterTransition`) — preserve the assertions, only change the chapter tag; add/keep a "Ch3 win → chapterTransition" case.
- [ ] **Step 2: run, verify fail** (stub empty; and the old Ch3-final test now fails because Ch3 win → chapterTransition).
- [ ] **Step 3: implement** — fill `s4-dingli.ts` `factions` with the 4 `FactionSetup` objects from Appendix B (INLINE `generalIds`; Wei 22 cities; Shu 7; Wu 12; Liaodong 1; zero neutral), set `generalOverrides` (Appendix B), remove `todo:true`, keep `startYear:220, startMonth:10, victory:{kind:'unify'}`, faction `name` = kingdom names (曹魏/蜀汉/东吴/辽东). Add `{ chapter: 4, scenarioId: 's4-dingli' }` to `CHAPTERS.liubei`. Retarget the story-store final-chapter test to Ch4.
- [ ] **Step 4: run, verify pass.**
- [ ] **Step 5: full gate + commit** — `"Implement Scenario 4 (三国鼎立) 4-faction roster + register chapter 4 (finale)"`.

---

### Task 3: Liu Bei Chapter 4 arc + the grand finale

**Files:** Create `src/data/story/s4-liubei.ts`. Modify `src/engine/story/objectives.ts` + `events.ts` (s4 branch), `src/i18n/types.ts` + both catalogs (ch4 keys). Test: `tests/engine/story/s4-liubei.test.ts`.

**Interfaces:** Consumes `hasEvent`/`transferCityWithGenerals` from `helpers.ts`. Produces `S4_LIUBEI_OBJECTIVES` (`proclaim`, `yiling`[gating], `northern`, `unify`[optional]) and `S4_LIUBEI_EVENTS` in order `[proclaimBeat, yilingMarch, northernBeat]`.

- [ ] **Step 1: failing tests** — `objectivesFor('s4-dingli', liubeiCh4)` returns the 4 objectives (`unify.optional===true`; proclaim/yiling/northern NOT optional); each `check` per Appendix C; `storyEventsFor(...)` includes the 2 beats (`choices:[]`) + `yiling_march` (2 choices, `portrait:'guanyu'`) in order `[proclaim_han, yiling_march, northern_expedition]`; the beats' `apply` (proclaim: none/narrative; northern: none) — actually per Appendix C proclaim/northern are pure narrative (no apply); `yiling_march` `launch`/`restraint` apply the specified effects (launch: take Wu's `jiangling` guarded + Lu Xun's fire guts it + bleed `bajun` + halve `chengdu` treasury, record `yiling_launched`; restraint: loyalty+10 all Shu cities + Chengdu economy + Hanzhong garrison, record `yiling_restrained`); `yiling` objective gates on either flag (shared `yilingDecided`); `unify` checks own-all-cities and is optional. i18n parity. Overlay precedence preserved; s1/s2/s3 unchanged.
- [ ] **Step 2: run, verify fail.**
- [ ] **Step 3: implement** — author `s4-liubei.ts` per Appendix C (predicates + apply effects + array order verbatim; `yilingDecided` helper shared by the objective + the choice guard), add the s4 branch to `objectivesFor`/`storyEventsFor` (after s3, after overlay), add ALL ch4 MessageKeys (Appendix C §7) to `types.ts` + both catalogs with exact text — **including the grand-finale `story.ch4.complete.title`/`.body`**. Reuse `story.ch3.transition` for the Ch3→Ch4 bridge (do NOT add a new one; Ch4 is terminal so there's no `story.ch4.transition`).
- [ ] **Step 4: run, verify pass.**
- [ ] **Step 5: full gate + commit** — `"Add Liu Bei Chapter 4 finale (三国鼎立): Shu-Han + Yiling choice + Northern Expeditions + the ending"`.

---

### Task 4: Chapter 4 reachability/finale integration test

**Files:** Create `tests/playthrough/s4-chapter4-finale.test.ts`. Possibly modify `s4-dingli.ts` (only if a sim shows a problem — unlikely; Liu Bei is a power in s4).

**Interfaces:** Consumes the full Phases 1-5 stack. Produces a deterministic guard that Chapter 4 reaches the finale and the Ch3→Ch4 transition is wired.

- [ ] **Step 1: write the test** (test-first). Model on `tests/playthrough/s3-chapter3-reachability.test.ts` (drive AI + resolve `pendingStoryEvent` after each `advanceMonth` via `applyStoryChoice` — beats with `''`, the `yiling_march` choice with `'launch'` or `'restraint'`). Assert:
  - **(a) Transition wiring:** a Story-Mode Chapter-3 *victory* routes (via `outcomeScreen`) to `chapterTransition` (Ch4 now exists), and `startChapter('liubei',4)` produces a valid s4 game (`storyMode.chapter===4`, scenario `s4-dingli`, briefing).
  - **(b) Finale reached:** build s4 as Liu Bei, run the loop resolving story events; the beats fire in order `proclaim_han → (yiling_march resolved) → northern_expedition`; after `northern_expedition` the 3 mandatory objectives (`proclaim`/`yiling`/`northern`) are complete → `checkOutcome==='victory'` → `outcomeScreen(victory, game)` returns `{kind:'chapterComplete'}` (the terminal finale; NOT `chapterTransition`, since Ch4 has no next chapter). Assert both Yiling branches reach the finale.
  - **(c) Optional `unify` does NOT gate:** the finale is reached WITHOUT owning all 42 cities (assert Liu Bei owns < 42 at the win, and `unify` is still `active`/incomplete while `checkOutcome==='victory'`).
  - Fixed seeds; deterministic; no Date.now/Math.random.
- [ ] **Step 2: run it.** Liu Bei is strong in s4 (7 cities, 120k troops), so survival/tuning should NOT be needed — but if the sim surfaces any issue, note it (do not tune blindly). Report the outcome.
- [ ] **Step 3: full gate + commit** — `"Add Chapter 4 finale reachability/transition test"`.

---

## Appendix A — the 32 new general records (`[wu,zhi,tong,zheng]`, age 220 CE)

Add via `const S4_NEW: General[]` (builder `g(...)`), spread into `ALL` only. `dengai`@`xiangping`/`zhonghui`@`luoyang` are WILD (loyalty 40 + locationCityId); `caopi`/`gongsunyuan` loyalty 100; the rest builder-default (loyalty 80, factionId null — loader assigns via T2 inline ids).

```ts
const S4_NEW: General[] = [
  // Wei
  g('caopi',      '曹丕',   'Cao Pi',      [60, 82, 80, 88], 33, 'cavalry', 100),
  g('caozhen',    '曹真',   'Cao Zhen',    [85, 78, 88, 65], 35, 'cavalry'),
  g('caoxiu',     '曹休',   'Cao Xiu',     [84, 70, 84, 60], 42, 'cavalry'),
  g('simashi',    '司马师', 'Sima Shi',    [60, 72, 68, 62], 12, 'infantry'),
  g('simazhao',   '司马昭', 'Sima Zhao',   [55, 66, 62, 60],  9, 'infantry'),
  g('manchong',   '满宠',   'Man Chong',   [75, 82, 85, 80], 58, 'infantry'),
  g('tianyu',     '田豫',   'Tian Yu',     [80, 80, 85, 70], 50, 'cavalry'),
  g('qianzhao',   '牵招',   'Qian Zhao',   [80, 76, 82, 68], 50, 'cavalry'),
  g('zhongyao',   '钟繇',   'Zhong Yao',   [25, 85, 70, 92], 69, 'infantry'),
  g('huaxin',     '华歆',   'Hua Xin',     [20, 80, 55, 90], 63, 'infantry'),
  g('wanglang',   '王朗',   'Wang Lang',   [25, 78, 55, 88], 64, 'infantry'),
  g('jiangwei',   '姜维',   'Jiang Wei',   [88, 90, 90, 70], 18, 'cavalry', 60),
  g('dengai',     '邓艾',   'Deng Ai',     [84, 90, 90, 78], 23, 'infantry', 40, 'xiangping'),
  g('zhonghui',   '钟会',   'Zhong Hui',   [75, 90, 85, 80], 15, 'infantry', 40, 'luoyang'),
  // Shu
  g('huangzhong', '黄忠',   'Huang Zhong', [92, 60, 82, 45], 72, 'archer'),
  g('weiyan',     '魏延',   'Wei Yan',     [90, 76, 88, 50], 42, 'infantry'),
  g('jiangwan',   '蒋琬',   'Jiang Wan',   [20, 84, 75, 92], 36, 'infantry'),
  g('feiyi',      '费祎',   'Fei Yi',      [25, 85, 70, 90], 25, 'infantry'),
  g('dongyun',    '董允',   'Dong Yun',    [20, 80, 55, 88], 26, 'infantry'),
  g('maliang',    '马良',   'Ma Liang',    [25, 88, 70, 85], 33, 'infantry'),
  g('masu',       '马谡',   'Ma Su',       [40, 82, 68, 72], 30, 'infantry'),
  g('wangping',   '王平',   'Wang Ping',   [80, 70, 84, 50], 28, 'infantry'),
  g('zhangni',    '张嶷',   'Zhang Ni',    [78, 75, 80, 65], 28, 'infantry'),
  g('liaohua',    '廖化',   'Liao Hua',    [77, 62, 72, 48], 30, 'infantry'),
  g('guanxing',   '关兴',   'Guan Xing',   [85, 65, 78, 55], 20, 'cavalry'),
  g('zhangbao',   '张苞',   'Zhang Bao',   [86, 45, 72, 40], 20, 'cavalry'),
  // Wu
  g('xusheng',    '徐盛',   'Xu Sheng',    [82, 72, 82, 55], 40, 'navy'),
  g('dingfeng',   '丁奉',   'Ding Feng',   [85, 68, 80, 45], 24, 'navy'),
  g('panzhang',   '潘璋',   'Pan Zhang',   [84, 55, 76, 40], 45, 'navy'),
  g('zhugejin',   '诸葛瑾', 'Zhuge Jin',   [25, 82, 72, 85], 46, 'infantry'),
  g('buzhi',      '步骘',   'Bu Zhi',      [30, 80, 70, 85], 44, 'infantry'),
  // Liaodong
  g('gongsunyuan','公孙渊', 'Gongsun Yuan',[68, 62, 70, 60], 25, 'cavalry', 100),
];
```

## Appendix B — Scenario 4 faction setups (3+1, inline `generalIds`)

`generalOverrides` (whole scenario):
```ts
generalOverrides: {
  caohong: { age: 61 }, simayi: { stats: { wu: 50, zhi: 98, tong: 92, zheng: 95 }, age: 41 },
  zhangliao: { age: 51 }, zhanghe: { age: 53 }, xuhuang: { age: 51 },
  yujin: { stats: { wu: 70, zhi: 65, tong: 72, zheng: 62 }, age: 64 },
  liubei: { stats: { wu: 55, zhi: 80, tong: 85, zheng: 90 }, age: 59 },
  zhugeliang: { stats: { wu: 30, zhi: 100, tong: 95, zheng: 100 }, age: 39 },
  zhangfei: { age: 56 }, zhaoyun: { age: 53 }, machao: { stats: { wu: 95, zhi: 50, tong: 80, zheng: 40 }, age: 44 },
  sunquan: { stats: { wu: 60, zhi: 85, tong: 88, zheng: 95 }, age: 38 },
  luxun: { stats: { wu: 70, zhi: 95, tong: 95, zheng: 88 }, age: 37 },
  lvmeng: { stats: { wu: 82, zhi: 82, tong: 90, zheng: 68 }, age: 42 },
  zhangzhao: { age: 64 }, ganning: { age: 51 }, lingtong: { age: 32 }, jiangqin: { age: 47 }, guyong: { age: 52 },
},
```

| id | lordId | name{zh,en} | color | diff | pers | money/food/troops | cityIds | generalIds (inline) |
|---|---|---|---|---|---|---|---|---|
| caopi | caopi | 曹魏/Cao Wei | magenta | 2 | balanced | 250000/400000/300000 | xiliang, anding, tianshui, changan, luoyang, henei, hongnong, jinyang, shangdang, beiping, yecheng, nanpi, pingyuan, beihai, puyang, xuchang, chenliu, wancheng, xiapi, xiaopei, pengcheng, shouchun (22) | caopi, caozhen, caoxiu, caohong, simayi, simashi, simazhao, zhangliao, zhanghe, xuhuang, yujin, manchong, tianyu, qianzhao, zhongyao, huaxin, wanglang, jiangwei |
| liubei | liubei | 蜀汉/Shu Han | green | 3 | active | 80000/150000/120000 | chengdu, mianzhu, zitong, bajun, hanzhong, jianning, yunnan (7) | liubei, zhugeliang, zhangfei, zhaoyun, machao, huangzhong, weiyan, jiangwan, feiyi, dongyun, maliang, masu, wangping, zhangni, liaohua, guanxing, zhangbao |
| sunquan | sunquan | 东吴/Dong Wu | cyanBright | 3 | balanced | 150000/250000/180000 | jianye, wujun, kuaiji, chaisang, lujiang, jiangxia, jiangling, changsha, guiyang, wuling, lingling, xiangyang (12) | sunquan, luxun, lvmeng, zhangzhao, ganning, lingtong, xusheng, dingfeng, jiangqin, panzhang, zhugejin, guyong, buzhi |
| gongsunyuan | gongsunyuan | 辽东/Liaodong | blue | 5 | turtle | 20000/30000/15000 | xiangping (1) | gongsunyuan |

City accounting: 22+7+12+1 = 42, zero neutral (all existing cities). (`dengai`/`zhonghui` are WILD, in no faction. `guanyu` excluded — dead 219.)

## Appendix C — Chapter 4 content (predicates, apply effects, verbatim i18n)

**Array order in `S4_LIUBEI_EVENTS`:** `[proclaimBeat, yilingMarch, northernBeat]`. Shared helper: `const yilingDecided = (s) => hasEvent(s,'yiling_launched') || hasEvent(s,'yiling_restrained');`

### Objectives (`objective.s4.*`)
1. `proclaim` (mandatory) — **继统称帝** / **Proclaim Shu-Han** · zh 于成都即皇帝位，立国号「汉」，昭告天下正统所在。 · en Take the throne at Chengdu, name your realm "Han," and declare where the true mandate lies. — **check:** `hasEvent(state,'proclaim_han')`
2. `yiling` (mandatory, GATING) — **夷陵抉择** / **The Yiling Decision** · zh 云长之仇未报、荆州之失犹痛，决意是否兴兵伐吴。 · en With Lord Guan unavenged and Jing still lost, decide whether to march on the Southlands. — **check:** `yilingDecided(state)`
3. `northern` (mandatory capstone) — **北伐中原** / **The Northern Expeditions** · zh 委诸葛亮六出祁山，兴师北向，图复中原。 · en Entrust Zhuge Liang to march again on Qishan and reclaim the heartland. — **check:** `hasEvent(state,'northern_expedition')`
4. `unify` (**OPTIONAL** — `optional: true`) — **一统山河** / **Unify the Realm** · zh 剪灭群雄，混一宇内，重整汉家河山。 · en Cut down every rival, make the realm one, and restore the rivers and mountains of Han. — **check:** `Object.values(state.cities).every((c) => c.factionId === 'liubei')`

### Beats (`story.s4.*`, `choices:[]`)
- **`proclaim_han`** — check `state.turn >= 1`, portrait `liubei`, NO apply. title 登基称帝 / The Ascension at Chengdu · body zh: 群臣三劝，谶纬呈瑞。你于成都武担之南筑坛告天，称帝续统，改元章武，国号仍称「汉」——世谓之蜀汉。文武山呼，声震巴蜀。四百年汉家旌旗，今日重扬于西土；织席贩履之身，终登九五之位。然中原未复、逆魏犹存，这一副担子，比帝冕更沉。 · en: Thrice your ministers press the throne upon you, and the omens are read as favorable. South of Chengdu you raise an altar, make sacrifice to Heaven, and proclaim yourself emperor — heir to the Han's line, the reign styled Zhangwu, the realm still named "Han," which the age will call Shu-Han. Ten thousand voices cry your reign, and the sound shakes the land of Shu. The banners of four Han centuries fly again in the west; a weaver of mats and seller of sandals has mounted the highest seat. Yet the heartland is unreclaimed and the traitor's Wei still stands — and that burden weighs heavier than any crown.
- **`northern_expedition`** — check `yilingDecided(state) && !hasEvent(state,'northern_expedition')`, portrait `zhugeliang`, NO apply. (Terminal capstone: completing it makes the 3 mandatory objectives complete → historic victory → finale.) title 六出祁山 / The Northern Expeditions · body zh: 白帝托孤，丞相受命。诸葛孔明抚孤主、总国政，励精图治，南征孟获而后方遂安，乃率大军出祁山，六伐中原。「兴复汉室，还于旧都」——出师一表，字字泣血。旌旗指北，粮车络绎于剑阁栈道之间。汉家的火种，自此由丞相之手，向着长安一路擎去。 · en: At Baidi the dying sovereign gave his orphan into the Chancellor's keeping, and Zhuge Kongming took up the charge. He steadied the boy-emperor, governed the state with a whole heart, pacified Meng Huo in the south to make the rear secure, then led the great host out through Qishan — six campaigns against the heartland. "Restore the House of Han; return to the old capital" — every word of his memorial written as if in blood. The banners point north; the grain-carts wind endless along the plank-roads of Jian'ge. From this day the Han's flame is carried on by the Chancellor's hand, borne step by step toward Chang'an.

### Choice `yiling_march` (`story.s4.yiling.*`, portrait `guanyu`)
- check `hasEvent(state,'proclaim_han') && !yilingDecided(state)`. title 夷陵之征 / The March to Yiling · body zh: 云长败亡、荆州陷落，此仇如刺，昼夜噬心。群臣力谏：孙权可缓，曹魏乃篡汉国贼，当北伐而非东征；赵云叩首泣血，愿陛下以社稷为重。然桃园一诺，义重如山，岂容坐视不报？倾举国之师东下伐吴——是快意恩仇、扬威荆楚，还是自蹈险地、连营待焚？ · en: Lord Guan is dead and Jing has fallen, and the grief sits like a barb that gnaws day and night. Your ministers plead: let Sun Quan keep — it is Cao's Wei that usurped the Han, and the sword should point north, not east; Zhao Yun kneels and weeps blood, begging you to weigh the altars of state above a brother's death. But the oath of the peach garden is heavy as a mountain — can it go unanswered? To pour the whole nation's army east against Wu: righteous vengeance and glory won on the rivers of Jing, or a march into ruin, camps strung out and waiting for the flame?
  - **`launch`** (`choice.s4.yiling.launch.*`) label 兴兵伐吴 / Launch the Yiling Campaign · desc zh 举国同仇，士气如虹，长驱直取荆州门户江陵；然孤军深入、连营数百里，陆逊纵火猇亭，一炬之下前军尽墨，国力大损、社稷动摇。 / en The nation marches as one, morale ablaze, and you seize Jiangling, the gate of Jing; but strung out deep in enemy land, Lu Xun looses fire upon Xiaoting — one blaze, and your forward army is ash, your strength gutted, your young dynasty left reeling. — **apply:** if `cities['jiangling'].factionId==='sunquan'` → `transferCityWithGenerals(cities, generals, 'jiangling', 'liubei')` then seized `jiangling.garrison = floor(*0.25)`, `defense = max(0, -30)`; `bajun.garrison = floor(*0.3)`; `chengdu.money = floor(*0.5)`, `.food = floor(*0.5)`; record `yiling_launched`. (Immutable.)
  - **`restraint`** (`choice.s4.yiling.restraint.*`) label 隐忍图强 / Restraint · desc zh 强忍锥心之痛，罢兵息民，固盟东吴、积粮劝农，倾力北向以图中原；然云长之仇终未得雪，君臣抱恨，唯以大局隐忍私情。 / en You master the grief that stabs, stand your men down and rest the people, hold the pact with Wu, store grain and till the fields, and turn your whole strength north toward the heartland; but Lord Guan's death goes unavenged still — a private sorrow swallowed for the greater cause. — **apply:** for every `liubei` city `loyalty = min(100, +10)`; `chengdu.money += 15000`, `.food += 25000`; `hanzhong.garrison += 15000`, `.food += 15000`; record `yiling_restrained`. (Immutable.)

### Chapter framing (`story.ch4.*`)
- `story.ch4.title` — zh 三国鼎立 / en The Three Kingdoms Stand
- `story.ch4.briefing` — zh: 益州已定，你坐镇成都，七城尽归麾下，基业初成。曹丕废帝篡位，汉祚断绝，四百年社稷竟亡于逆臣之手。你身负中山靖王之后、汉室正统，当继大位、承汉家之火，以正天下视听。然荆州已失，云长殒身，血仇未雪——是登基兴复、还于旧都，还是提兵东下、为兄弟雪恨？王业与私情，皆系于你一念之间。 · en: Yi Province is settled; you hold Chengdu, seven cities beneath your hand, your foundation laid at last. Cao Pi has deposed the emperor and seized the throne — four centuries of the Han, snuffed out by a traitor's hand. As a scion of the imperial house and heir to its mandate, you must ascend and carry its flame, that the realm may know where right still lives. Yet Jing is lost and Lord Guan is slain, and that debt of blood cries unanswered — to take the throne and restore the dynasty, or to march east and avenge a brother? Empire and grief alike hang upon a single thought.
- **THE GRAND FINALE** `story.ch4.complete.title` — zh 第四章 完 · 战役达成 — 汉祚重光，桃园圆梦 / en Chapter Ⅳ Complete · Campaign Won — The Han Rekindled, the Oath Fulfilled
- `story.ch4.complete.body` — zh: 汉旗重扬于中原，三分之世终归一统。回望来路——平原一令、小沛孤城、江夏残兵，你自织席贩履之微，历尽颠沛流离，终成一代开国之君。云长、翼德泉下有知，当拊掌相庆：桃园结义之誓，「上报国家，下安黎庶」，今日终得圆满。汉室四百年之火，几灭而复燃，皆赖有此身。青史煌煌，英名不朽，永载千秋——三国的故事，至此落幕。（全剧终） · en: The Han banner flies again over the heartland, and a world split three ways is made one at last. Look back down the road you came — the lone magistracy of Pingyuan, the borrowed walls of Xiaopei, the broken remnant at Jiangxia — and see how far a weaver of mats and seller of sandals has traveled, through exile and want, to found a dynasty. If Yunchang and Yide can hear from below, let them clap and rejoice: the oath sworn in the peach garden — to serve the state above and shelter the people below — is fulfilled at last. The flame of four Han centuries, guttering to its final ember, burns bright again because you lived. The chronicles blaze, your name undimmed, carried down a thousand years — and here the tale of the Three Kingdoms comes to its close. (The End)
- **Ch3→Ch4 bridge REUSES `story.ch3.transition`** (already shipped) — no new key. Ch4 is terminal (no `story.ch4.transition`).

### §7 full new-key list (all in `types.ts` union + both catalogs)
`story.ch4.title`, `story.ch4.briefing`, `story.ch4.complete.title`, `story.ch4.complete.body`, `objective.s4.proclaim.title`, `objective.s4.proclaim.desc`, `objective.s4.yiling.title`, `objective.s4.yiling.desc`, `objective.s4.northern.title`, `objective.s4.northern.desc`, `objective.s4.unify.title`, `objective.s4.unify.desc`, `story.s4.proclaim.title`, `story.s4.proclaim.body`, `story.s4.yiling.title`, `story.s4.yiling.body`, `story.s4.northern.title`, `story.s4.northern.body`, `choice.s4.yiling.launch.label`, `choice.s4.yiling.launch.desc`, `choice.s4.yiling.restraint.label`, `choice.s4.yiling.restraint.desc`.

## Deferred to a fast-follow (not in this slice)
- The 姜维归蜀 (Jiang Wei defection) event; the 关羽未死 optional branch; the hidden-tribute searchers (liushan/menghuo → 通宵虫/南方小鬼); Liaodong subordinates. `jiangwei` starts in Wei; the rest are enrichment.
- Free-Play enrichment (per-faction intros, world-event beats) remains a distinct future effort.
