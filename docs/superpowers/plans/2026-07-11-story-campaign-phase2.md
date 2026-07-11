# Story Campaign — Phase 2: Chapter 1 Complete, Winnable & Richer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make Story-Mode **Chapter 1 a complete, winnable chapter** — completing its four objectives now *wins the chapter* (a "Chapter Ⅰ Complete" celebration) instead of doing nothing — and deepen the arc with two narrative beats (the Guandong Coalition, the Dragon of Changshan).

**Architecture:** Three small, independent changes on the Phase-1 engine: (1) `hasVictory` uses the `historic` (objectives-complete) condition when `state.storyMode` is present, and `resolveStoryChoice` evaluates objectives immediately so a chapter-completing choice is detected without a one-tick lag; (2) a shared outcome-routing helper sends a Story-Mode *victory* to a new `chapterComplete` screen (the celebratory `story.ch1.complete` beat), leaving the unrouted `chapterTransition` bridge for Phase 3; (3) two beat `StoryEvent`s pushed into `S1_LIUBEI_EVENTS`.

**Tech Stack:** Vite + React 19 (DOM) + Zustand + TypeScript (ESM/NodeNext, explicit `.js` specifiers) + Vitest (+ Testing-Library/jsdom).

**Spec:** `docs/superpowers/specs/2026-07-11-story-campaign-design.md`. **Builds on Phase 1** (branch `story-campaign`, 334 tests green).

## Global Constraints

- **English identifiers + comments; bilingual UI.** Every new user-facing string adds a `MessageKey` to `src/i18n/types.ts` **and** an entry to **both** `catalog/en.ts` and `catalog/zh.ts` (parity test `tests/i18n/parity.test.ts`). Use the exact bilingual text in Appendix A of this plan.
- **Always green.** Full Vitest + `npx tsc --noEmit` + `npm run build` at every task boundary. Baseline: **334 tests**.
- **THE SEAM is sacred.** Off-screen `resolveQuickBattle` untouched. Free Play behavior (no `storyMode`) must not change — unify victory, game-over routing, etc. all identical.
- **Determinism + save/load.** Pure engine (no `Date.now`/`Math.random`). The new `chapterComplete` screen is UI state; a saved mid-chapter game still resumes correctly (nothing new persists on `GameState` in this phase).
- **Content-lookup pattern unchanged.** Add beats by pushing into `S1_LIUBEI_EVENTS` (the direct-branch lookup already returns the whole array); test overlays still take precedence/concatenate as in Phase 1.

## Key current-state facts (verified)

- `hasVictory` (`src/engine/selectors.ts:71`) reads `scenario.victory.kind` and never consults `state.storyMode`. `s1-dongzhuo.victory = {kind:'unify'}`, so the `historic` branch is **dead code** for Story Mode today.
- `checkOutcome` (`turn.ts:231`) returns `'victory'|'defeat'|null`. It is called by three store functions — `advanceDays` (`store.ts:200`), `resolveStoryChoice` (`store.ts:231`), `finishBattle` (`store.ts:372`) — each routing a non-null outcome to `{kind:'gameOver', outcome}`. None branch on `storyMode`.
- `evaluateObjectives` runs only inside `runScenarioEvents` (month tick), NOT inside `applyStoryChoice`, so `foundation` completes on the *next* tick after the Xuzhou choice (a known one-tick lag).
- `chapterTransition` screen + `ChapterTransitionScreen` component exist but are **unrouted** (nothing calls `setScreen({kind:'chapterTransition'})`); it reads `story.ch1.transition`. Leave it for Phase 3.
- Adding a `StoryEvent` = push into `S1_LIUBEI_EVENTS` (`src/data/story/s1-liubei.ts`); the framework records a fired event's id in `state.events` and skips already-fired ids, so a beat's `check` needs only its trigger condition (no separate "seen" flag). First-eligible-in-array-order fires per tick; a story event short-circuits before `evaluateObjectives`.

## File Structure

- **Modify:** `src/engine/selectors.ts` (T1 `hasVictory`), `src/state/store.ts` (T1 `resolveStoryChoice`; T2 Screen kind + routing helper + 3 callers), `src/web/App.tsx` (T2 route), `src/web/screens/StoryEventModal.tsx` (T2 `ChapterCompleteScreen`), `src/data/story/s1-liubei.ts` (T3 two beats), `src/i18n/types.ts` + `catalog/{en,zh}.ts` (T2 + T3 keys).
- **Tests:** `tests/engine/victory.test.ts` (T1), `tests/state/story-store.test.ts` (T1/T2), `tests/web/App.test.tsx` or a new screen test (T2), `tests/engine/story/s1-liubei.test.ts` (T3).

---

### Task 1: Story-Mode historic victory + immediate objective evaluation

**Files:**
- Modify: `src/engine/selectors.ts` (`hasVictory`, ~line 71)
- Modify: `src/state/store.ts` (`resolveStoryChoice`, ~line 215-239)
- Test: `tests/engine/victory.test.ts`, `tests/state/story-store.test.ts`

**Interfaces:**
- Consumes: `objectivesFor(scenarioId, storyMode)`, `state.objectives`, `state.storyMode` (Phase 1); `evaluateObjectives(state)` (`src/engine/story/objectives.ts`).
- Produces: `hasVictory` now returns `true` for a Story-Mode game whose non-optional objectives are all complete, regardless of `scenario.victory.kind`. Free Play unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/engine/victory.test.ts`, add (reuse the existing `setTestObjectives`/`clearTestObjectives` + `SCENARIOS` injection style already in this file):

```ts
it('Story Mode wins by completing objectives even when the scenario declares unify', () => {
  // s1-dongzhuo declares victory {kind:'unify'}. A Story-Mode game (storyMode set)
  // with all non-optional objectives complete must win WITHOUT owning every city.
  const defs = [
    { id: 'a', titleKey: 'app.title', descKey: 'app.subtitle', check: () => true },
    { id: 'b', titleKey: 'app.title', descKey: 'app.subtitle', check: () => true },
  ];
  setTestObjectives('s1-dongzhuo', defs);
  const base = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'liubei', refData: REF_DATA, seed: 1 });
  const storyGame: GameState = {
    ...base,
    storyMode: { protagonistFactionId: 'liubei', chapter: 1 },
    objectives: [
      { id: 'a', status: 'complete' },
      { id: 'b', status: 'complete' },
    ],
  };
  expect(hasVictory(storyGame, 'liubei')).toBe(true); // historic, not unify
  // Same board WITHOUT storyMode = Free Play = unify = not won (Liu Bei owns 1 city).
  const freePlay: GameState = { ...storyGame, storyMode: undefined };
  expect(hasVictory(freePlay, 'liubei')).toBe(false);
});

it('Story Mode does NOT win while a non-optional objective is still active', () => {
  const defs = [
    { id: 'a', titleKey: 'app.title', descKey: 'app.subtitle', check: () => true },
    { id: 'b', titleKey: 'app.title', descKey: 'app.subtitle', check: () => true },
  ];
  setTestObjectives('s1-dongzhuo', defs);
  const base = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'liubei', refData: REF_DATA, seed: 1 });
  const g: GameState = {
    ...base,
    storyMode: { protagonistFactionId: 'liubei', chapter: 1 },
    objectives: [{ id: 'a', status: 'complete' }, { id: 'b', status: 'active' }],
  };
  expect(hasVictory(g, 'liubei')).toBe(false);
});
```

In `tests/state/story-store.test.ts`, add a test that `resolveStoryChoice` evaluates objectives immediately (drive via `setTestStoryEvents` + `setTestObjectives`): register a story event whose choice's `apply` makes an objective's `check` pass, seed that objective `active`, call `resolveStoryChoice`, and assert the objective is `complete` in `st.game.objectives` right after (no extra `advanceDays`). Clear overlays in `afterEach`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/engine/victory.test.ts tests/state/story-store.test.ts`
Expected: the new assertions fail — `hasVictory` returns `false` for the Story-Mode case (it currently uses `scenario.victory` = unify), and the objective is still `active` after `resolveStoryChoice` (objectives aren't evaluated there yet).

- [ ] **Step 3: Implement**

In `src/engine/selectors.ts`, `hasVictory` — select the effective victory kind by `storyMode` (a Story-Mode game always uses the protagonist arc's historic condition):

```ts
export function hasVictory(state: GameState, factionId: FactionId): boolean {
  const scenario = SCENARIOS[state.scenarioId];
  const victory: VictoryCondition = scenario?.victory ?? { kind: 'unify' };
  // A Story-Mode game wins by its authored objective arc (the "historic route"),
  // regardless of the scenario's declared victory (which governs Free Play).
  const kind = state.storyMode ? 'historic' : victory.kind;
  const ownedCities = citiesOf(state, factionId);
  const ownedCount = ownedCities.length;
  switch (kind) {
    case 'unify': {
      const total = Object.keys(state.cities).length;
      return total > 0 && ownedCount === total;
    }
    case 'dominate': {
      if (victory.cityCount != null && ownedCount < victory.cityCount) return false;
      const ownedIds = new Set(ownedCities.map((c) => c.id));
      return (victory.requiredCityIds ?? []).every((id) => ownedIds.has(id));
    }
    case 'historic': {
      const required = objectivesFor(state.scenarioId, state.storyMode).filter((o) => !o.optional);
      if (required.length === 0) return false;
      return required.every((def) =>
        state.objectives.some((o) => o.id === def.id && o.status === 'complete'));
    }
    default:
      return false;
  }
}
```

In `src/state/store.ts`, `resolveStoryChoice` — evaluate objectives right after applying the choice, before `checkOutcome`, so a chapter-completing choice (and any objective the choice satisfies) is reflected immediately (this also removes the one-tick lag). Import `evaluateObjectives` from `../engine/story/objectives.js`:

```ts
export function resolveStoryChoice(eventId: string, choiceId: string): void {
  const { game } = gameStore.getState();
  const applied = applyStoryChoice(game, eventId, choiceId);
  if (applied === game) return; // unknown id / no-op — don't record or navigate
  const next = evaluateObjectives(applied); // reflect objective completion immediately
  const actionLog = [...next.actionLog, { turn: next.turn, command: { kind: 'storyChoice', eventId, choiceId } as StrategicCommand, factionId: next.playerFactionId }];
  const committed = { ...next, actionLog };
  const outcome = checkOutcome(committed);
  gameStore.setState((s) => ({ ...s, game: committed, ui: /* T2 replaces this with the routing helper */ outcome ? { ...s.ui, screen: { kind: 'gameOver', outcome } } : { ...s.ui, screen: { kind: 'main' } } }));
}
```
(Keep the existing `actionLog`/`setState` shape; the only additions are the `evaluateObjectives(applied)` call and using its result. Task 2 swaps the `outcome ? … : …` screen expression for the shared routing helper.)

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/engine/victory.test.ts tests/state/story-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate + commit**

`npx vitest run` (all green), `npx tsc --noEmit`, `npm run build`. Then:
```bash
git add -A && git commit -m "Story Mode wins by historic objectives; evaluate objectives on story choice"
```

---

### Task 2: Chapter-complete routing + ChapterComplete screen

**Files:**
- Modify: `src/state/store.ts` (Screen union + a routing helper + the 3 checkOutcome callers)
- Modify: `src/web/screens/StoryEventModal.tsx` (new `ChapterCompleteScreen`)
- Modify: `src/web/App.tsx` (route `chapterComplete`)
- Modify: `src/i18n/types.ts` + `catalog/en.ts` + `catalog/zh.ts` (`story.ch1.complete.title`, `story.ch1.complete.body`)
- Test: `tests/state/story-store.test.ts`, `tests/web/App.test.tsx` (or a focused screen test)

**Interfaces:**
- Consumes: `checkOutcome` (`'victory'|'defeat'|null`), `state.storyMode` (T1).
- Produces: Screen kind `{ kind: 'chapterComplete' }`; a `ChapterCompleteScreen` component; a routing helper `outcomeScreen(outcome, game): Screen | null` used by all three outcome callers.

- [ ] **Step 1: Write the failing tests**

In `tests/state/story-store.test.ts`: a Story-Mode game that reaches `'victory'` (all objectives complete) via `resolveStoryChoice` routes to `{kind:'chapterComplete'}` (NOT `gameOver`); a Free-Play `'victory'` routes to `{kind:'gameOver', outcome:'victory'}`; a Story-Mode `'defeat'` routes to `{kind:'gameOver', outcome:'defeat'}` (only wins go to chapterComplete). Drive with the test overlays; assert `gameStore.getState().ui.screen`.

In `tests/web/App.test.tsx` (or `tests/web/ChapterComplete.test.tsx`): rendering with `ui.screen = {kind:'chapterComplete'}` shows `t('story.ch1.complete.title')` and `t('story.ch1.complete.body')`, and clicking the continue button calls `clearContinuousSave` + routes to `{kind:'title'}`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/state/story-store.test.ts tests/web/App.test.tsx`
Expected: FAIL — `chapterComplete` isn't a Screen kind / isn't routed; the story win currently goes to `gameOver`.

- [ ] **Step 3: Implement**

`src/state/store.ts` — add the Screen kind (beside `chapterTransition`):
```ts
  | { kind: 'chapterComplete' }
```
Add a shared routing helper and use it in all three outcome callers:
```ts
// A Story-Mode victory is a CHAPTER win → celebratory chapterComplete screen;
// every other outcome (Free-Play win, any defeat) → the normal game-over.
function outcomeScreen(outcome: 'victory' | 'defeat', game: GameState): Screen {
  if (outcome === 'victory' && game.storyMode) return { kind: 'chapterComplete' };
  return { kind: 'gameOver', outcome };
}
```
Replace each caller's `screen: { kind: 'gameOver', outcome }` with `screen: outcomeScreen(outcome, <the committed game>)` — in `advanceDays` (use `next`), `resolveStoryChoice` (use `committed`), and `finishBattle` (use `cleared`). Free-Play routing is unchanged because `game.storyMode` is undefined there.

`src/web/screens/StoryEventModal.tsx` — add `ChapterCompleteScreen` (mirror `ChapterTransitionScreen`'s structure, but terminal — clears the save and returns to title, like `GameOverScreen`'s button):
```tsx
export function ChapterCompleteScreen(): React.ReactElement {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  const onDone = (): void => { clearContinuousSave(); setScreen({ kind: 'title' }); };
  useMenuKeys({ count: 1, onSelect: onDone });
  void locale;
  return (
    <div className="panel /* match ChapterTransition/GameOver paper styling */">
      <h1 className="font-serif text-seal-700">{t('story.ch1.complete.title')}</h1>
      <p className="italic text-ink-600">{t('story.ch1.complete.body')}</p>
      <button className="btn btn-primary" onClick={onDone}>{t('app.continue')}</button>
    </div>
  );
}
```
(Import `clearContinuousSave` and `setScreen` from the store, as `GameOverScreen` does. Follow the exact class names/structure the sibling screens use.)

`src/web/App.tsx` — import `ChapterCompleteScreen` and add:
```tsx
    case 'chapterComplete':
      return <ChapterCompleteScreen />;
```

i18n — add to `src/i18n/types.ts` union and BOTH catalogs, using Appendix A text:
`story.ch1.complete.title`, `story.ch1.complete.body`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/state/story-store.test.ts tests/web/App.test.tsx tests/i18n/parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate + commit**

`npx vitest run`, `npx tsc --noEmit`, `npm run build`. Then:
```bash
git add -A && git commit -m "Route Story-Mode chapter victory to a Chapter Complete screen"
```

---

### Task 3: Coalition + Dragon-of-Changshan narrative beats

**Files:**
- Modify: `src/data/story/s1-liubei.ts` (push two beats into `S1_LIUBEI_EVENTS`)
- Modify: `src/i18n/types.ts` + `catalog/en.ts` + `catalog/zh.ts` (`story.s1.coalition.title/body`, `story.s1.zhaoyun.title/body`)
- Test: `tests/engine/story/s1-liubei.test.ts`

**Interfaces:**
- Consumes: `hasEvent(state, id)` helper (already in `s1-liubei.ts`); `StoryEvent` type; `state.generals['zhaoyun']`.
- Produces: two new `StoryEvent` beats in `S1_LIUBEI_EVENTS` with ids `coalition_beat`, `zhaoyun_beat` (`choices: []`).

- [ ] **Step 1: Write the failing tests**

In `tests/engine/story/s1-liubei.test.ts`, add: `storyEventsFor('s1-dongzhuo', {protagonistFactionId:'liubei',chapter:1})` includes `coalition_beat` and `zhaoyun_beat`, both with `choices.length === 0`; `coalition_beat.check` is true when `state.events` contains `guandong_coalition` (and false otherwise); `zhaoyun_beat.check` is true when `guandong_coalition` has fired AND `state.generals['zhaoyun'].factionId === 'gongsunzan'` (false once Zhao Yun's `factionId` is `'liubei'`). Assert array order places `coalition_beat` before `zhaoyun_beat` and both before `xuzhou_bequest` (first-eligible-per-tick ordering).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/engine/story/s1-liubei.test.ts`
Expected: FAIL — the beats don't exist yet.

- [ ] **Step 3: Implement**

In `src/data/story/s1-liubei.ts`, define the two beats and place them at the FRONT of `S1_LIUBEI_EVENTS` (before `xuzhou_bequest`):
```ts
// The eighteen-lord coalition forms — surface the (otherwise silent) scripted
// guandong_coalition event as a dramatic beat. Fires the same tick it forms
// (scripted events run before the story-event scan). The framework records this
// beat's id in state.events, so it fires exactly once — no separate seen-flag.
const coalitionBeat: StoryEvent = {
  id: 'coalition_beat',
  check: (state) => hasEvent(state, 'guandong_coalition'),
  titleKey: 'story.s1.coalition.title',
  bodyKey: 'story.s1.coalition.body',
  choices: [],
};

// A nudge toward recruiting Zhao Yun — fires after the coalition, while he still
// serves Gongsun Zan. Once he joins Liu Bei (factionId 'liubei') it can't fire.
const zhaoyunBeat: StoryEvent = {
  id: 'zhaoyun_beat',
  check: (state) =>
    hasEvent(state, 'guandong_coalition') &&
    state.generals['zhaoyun']?.factionId === 'gongsunzan',
  titleKey: 'story.s1.zhaoyun.title',
  bodyKey: 'story.s1.zhaoyun.body',
  choices: [],
};

export const S1_LIUBEI_EVENTS: StoryEvent[] = [coalitionBeat, zhaoyunBeat, xuzhouBequest];
```
(Keep `xuzhouBequest` as the existing object — just add the two beats before it in the exported array.)

i18n — add to `src/i18n/types.ts` union and BOTH catalogs, using Appendix A text:
`story.s1.coalition.title`, `story.s1.coalition.body`, `story.s1.zhaoyun.title`, `story.s1.zhaoyun.body`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/engine/story/s1-liubei.test.ts tests/i18n/parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate + commit**

`npx vitest run`, `npx tsc --noEmit`, `npm run build`. Then:
```bash
git add -A && git commit -m "Add Guandong Coalition and Dragon of Changshan narrative beats"
```

---

## Appendix A — new bilingual i18n content (verbatim)

*(Original wording, no copyrighted translation.)*

**`story.ch1.complete.title`** — zh: `第一章 · 义名初立` · en: `Chapter Ⅰ Complete — A Name Forged in Chaos`
**`story.ch1.complete.body`** — zh: `从平原一城之令，到义名传于四海——你以信义聚将，以仁德收心，于群雄割据之间立稳了脚跟。汉室未复，霸业方兴，然天下已然记住"刘玄德"三字。潜龙已动，且待风云再起。（未完待续）` · en: `From the magistrate of a single town, your name for honor now carries to the four seas. By faith you have gathered captains, by virtue won hearts, and amid the scramble of warlords you have found firm ground to stand. The Han is not yet restored and your great work has only begun — but the realm will not soon forget the name of Liu Xuande. The dragon has stirred; await the turning of the winds. (To be continued)`

**`story.s1.coalition.title`** — zh: `关东义盟` · en: `The Guandong Coalition`
**`story.s1.coalition.body`** — zh: `董卓废立天子、鸩杀太后，四海共愤。关东十八路诸侯歃血为盟，共推袁绍为盟主，旌旗蔽野，同讨国贼。你率关、张二弟，引数百乡勇，随公孙瓒之军奔赴盟坛——势虽单薄，亦誓要在这讨逆的洪流中留下名姓。` · en: `Dong Zhuo has cast down one emperor to enthrone a puppet and poisoned the dowager — and the realm rises in fury. Across the eastern passes eighteen lords swear a blood-oath and raise Yuan Shao as their chief; their banners darken the fields as they march upon the traitor. You bring your sworn brothers Guan and Zhang and a few hundred village men, riding under Gongsun Zan's colors to the muster — small among the mighty, yet resolved that your name, too, shall be written into this reckoning.`

**`story.s1.zhaoyun.title`** — zh: `常山赵子龙` · en: `The Dragon of Changshan`
**`story.s1.zhaoyun.body`** — zh: `乱军之中，一员白袍小将单枪匹马，枪出如龙，于万军之内救主而还——常山赵云，字子龙。他此时寄身公孙瓒麾下，然其志不在于此。你与他一席倾谈，恍如故交；若能以诚相待、以义相结，这条常山之龙，或将随你一世。` · en: `In the churn of battle a young captain in white rides out alone, his spear striking like a dragon as he cuts his lord free from ten thousand blades — Zhao Yun of Changshan, styled Zilong. For now he serves under Gongsun Zan, yet his heart is not bound there. You share a single conversation and it is as though you have always known one another; treat him with sincerity and bind him with honor, and this dragon of Changshan may follow you all your days.`

## Appendix B — deferred to a later phase

- **Sheltering Lü Bu** (a second Ch.1 choice-event): chronologically it fits only the "Accept Xuzhou" branch and its whole point is to *arm Chapter Ⅱ's betrayal* ("Lü Bu has betrayed you and seized your seat"). Author it when Chapter Ⅱ (Phase 3+) exists to consume the consequence. Content drafted; keys reserved: `story.s1.lubu.*`, `choice.s1.lubu.{shelter,refuse}.{label,desc}`.
- The `chapterTransition` bridge (→ next chapter via `newGame`) is wired for Phase 3, when Scenario 2 exists to transition into.
