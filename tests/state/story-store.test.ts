import { afterEach, describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import {
  storyEventsFor,
  setTestStoryEvents,
  clearTestStoryEvents,
} from '../../src/engine/story/events.js';
import {
  setTestObjectives,
  clearTestObjectives,
} from '../../src/engine/story/objectives.js';
import type { StoryEvent, StoryMode } from '../../src/engine/story/types.js';
import {
  advanceDays,
  gameStore,
  loadGame,
  newGame,
  resolveStoryChoice,
} from '../../src/state/store.js';

const STORY_MODE: StoryMode = { protagonistFactionId: 'liubei', chapter: 1 };

// A test choice-event registered in the story overlay so the store's
// resolveStoryChoice path can be exercised deterministically before the real
// s1 narrative content lands (Task 10). Mirrors tests/engine/story-choice.test.ts:
// the authored s1 table is intentionally empty for now, so we drive the pipeline
// through the TEST-ONLY overlay. Its single choice makes an observable, PURE
// state change (appends a completed objective — no wall-clock, no RNG).
const CHOICE_EVENT: StoryEvent = {
  id: 'test-choice-event',
  check: () => true,
  titleKey: 'app.title',
  bodyKey: 'app.subtitle',
  choices: [
    {
      id: 'accept',
      labelKey: 'app.confirm',
      descKey: 'app.continue',
      apply: (state) => ({
        ...state,
        objectives: [
          ...state.objectives,
          { id: 'story-choice-taken', status: 'complete' as const },
        ],
      }),
    },
  ],
};

afterEach(() => {
  clearTestStoryEvents();
  clearTestObjectives();
});

describe('story store integration', () => {
  it('advanceDays routes to the story screen and freezes time when a story event is pending', () => {
    // Story Mode Chapter 1 game, then inject a pending story event so the
    // very next tick is owed to the player (mirrors how a fired StoryEvent
    // leaves GameState). tickDays must break immediately (Task 4 guard),
    // so no day/turn advances.
    newGame(SCENARIO_DONGZHUO, 'liubei', 1);
    gameStore.setState((s) => ({
      ...s,
      game: {
        ...s.game!,
        storyMode: STORY_MODE,
        pendingStoryEvent: { eventId: 'test-event', scenarioId: 's1-dongzhuo' },
      },
    }));
    const before = gameStore.getState().game!;

    advanceDays(30);

    const after = gameStore.getState();
    expect(after.ui.screen).toEqual({ kind: 'story', eventId: 'test-event' });
    // Time is frozen: the calendar and the pending event are untouched.
    expect(after.game!.turn).toBe(before.turn);
    expect(after.game!.day).toBe(before.day);
    expect(after.game!.pendingStoryEvent).toEqual({ eventId: 'test-event', scenarioId: 's1-dongzhuo' });
  });

  it('resolveStoryChoice applies the branch, records the command, clears the pending event, and returns to main', () => {
    // Register a real choice-event in the overlay so applyStoryChoice's lookup
    // resolves the branch (the production s1 table is empty until Task 10).
    setTestStoryEvents('s1-dongzhuo', [CHOICE_EVENT]);
    const choiceEvent = storyEventsFor('s1-dongzhuo', STORY_MODE).find((e) => e.choices.length > 0);
    expect(choiceEvent, 's1 overlay must provide at least one story choice-event').toBeDefined();
    const choice = choiceEvent!.choices[0];

    newGame(SCENARIO_DONGZHUO, 'liubei', 1);
    gameStore.setState((s) => ({
      ...s,
      game: {
        ...s.game!,
        storyMode: STORY_MODE,
        pendingStoryEvent: { eventId: choiceEvent!.id, scenarioId: 's1-dongzhuo' },
      },
      ui: { ...s.ui, screen: { kind: 'story', eventId: choiceEvent!.id } },
    }));
    const beforeActionLen = gameStore.getState().game!.actionLog.length;

    resolveStoryChoice(choiceEvent!.id, choice.id);

    const st = gameStore.getState();
    expect(st.game!.pendingStoryEvent).toBeUndefined();
    expect(st.ui.screen.kind).toBe('main');
    expect(st.game!.actionLog.length).toBe(beforeActionLen + 1);
    const last = st.game!.actionLog[st.game!.actionLog.length - 1];
    expect(last.command).toEqual({ kind: 'storyChoice', eventId: choiceEvent!.id, choiceId: choice.id });
    expect(last.factionId).toBe('liubei');
  });

  it('resolveStoryChoice with an unknown event id is a full no-op (no command, screen/pending unchanged)', () => {
    // No overlay event registered for this id -> applyStoryChoice returns the
    // state unchanged (identity), so resolveStoryChoice must NOT log a phantom
    // command or navigate away, and must leave the pause standing.
    newGame(SCENARIO_DONGZHUO, 'liubei', 1);
    gameStore.setState((s) => ({
      ...s,
      game: {
        ...s.game!,
        storyMode: STORY_MODE,
        pendingStoryEvent: { eventId: 'still-pending', scenarioId: 's1-dongzhuo' },
      },
      ui: { ...s.ui, screen: { kind: 'story', eventId: 'still-pending' } },
    }));
    const beforeGame = gameStore.getState().game!;
    const beforeActionLen = beforeGame.actionLog.length;

    resolveStoryChoice('no-such-event', 'accept');

    const st = gameStore.getState();
    // Nothing was logged and the store did not move off the story screen.
    expect(st.game!.actionLog.length).toBe(beforeActionLen);
    expect(st.ui.screen).toEqual({ kind: 'story', eventId: 'still-pending' });
    expect(st.game!.pendingStoryEvent).toEqual({ eventId: 'still-pending', scenarioId: 's1-dongzhuo' });
    expect(st.game).toBe(beforeGame); // untouched reference
  });

  it('resolveStoryChoice evaluates objectives immediately (no one-tick lag)', () => {
    // An objective seeded 'active' whose check passes only once the chosen
    // branch's apply has run. Because resolveStoryChoice now evaluates
    // objectives right after applyStoryChoice, the objective must read
    // 'complete' immediately — with no extra advanceDays tick.
    setTestObjectives('s1-dongzhuo', [
      {
        id: 'obj-after-choice',
        titleKey: 'app.title',
        descKey: 'app.subtitle',
        // Passes once the choice's apply has planted the marker below.
        check: (state) => state.objectives.some((o) => o.id === 'choice-marker'),
      },
    ]);
    setTestStoryEvents('s1-dongzhuo', [
      {
        id: 'marker-event',
        check: () => true,
        titleKey: 'app.title',
        bodyKey: 'app.subtitle',
        choices: [
          {
            id: 'go',
            labelKey: 'app.confirm',
            descKey: 'app.continue',
            apply: (state) => ({
              ...state,
              objectives: [
                ...state.objectives,
                { id: 'choice-marker', status: 'complete' as const },
              ],
            }),
          },
        ],
      },
    ]);

    newGame(SCENARIO_DONGZHUO, 'liubei', 1);
    gameStore.setState((s) => ({
      ...s,
      game: {
        ...s.game!,
        storyMode: STORY_MODE,
        objectives: [{ id: 'obj-after-choice', status: 'active' as const }],
        pendingStoryEvent: { eventId: 'marker-event', scenarioId: 's1-dongzhuo' },
      },
      ui: { ...s.ui, screen: { kind: 'story', eventId: 'marker-event' } },
    }));

    resolveStoryChoice('marker-event', 'go');

    const st = gameStore.getState();
    const objAfter = st.game!.objectives.find((o) => o.id === 'obj-after-choice');
    expect(objAfter?.status).toBe('complete');
  });

  it('resolveStoryChoice surfaces an objective-complete entry in the turn digest', () => {
    // A choice that completes an objective WITHOUT winning the chapter: two
    // non-optional objectives, one that completes when the choice plants a
    // marker and one that never does — so the arc is unfinished (routes to
    // {kind:'main'}, not chapterComplete). The completed objective logs an
    // 'objective.completed' entry, which the main-screen branch must lift into
    // ui.turnDigest so the "Objective complete" toast fires on this path.
    setTestObjectives('s1-dongzhuo', [
      {
        id: 'obj-digest-done',
        titleKey: 'app.title',
        descKey: 'app.subtitle',
        check: (state) => state.objectives.some((o) => o.id === 'digest-marker'),
      },
      {
        id: 'obj-digest-pending',
        titleKey: 'app.title',
        descKey: 'app.subtitle',
        check: () => false, // never completes -> chapter stays unwon
      },
    ]);
    setTestStoryEvents('s1-dongzhuo', [
      {
        id: 'digest-event',
        check: () => true,
        titleKey: 'app.title',
        bodyKey: 'app.subtitle',
        choices: [
          {
            id: 'do',
            labelKey: 'app.confirm',
            descKey: 'app.continue',
            apply: (state) => ({
              ...state,
              objectives: [
                ...state.objectives,
                { id: 'digest-marker', status: 'complete' as const },
              ],
            }),
          },
        ],
      },
    ]);

    newGame(SCENARIO_DONGZHUO, 'liubei', 1);
    gameStore.setState((s) => ({
      ...s,
      game: {
        ...s.game!,
        storyMode: STORY_MODE,
        objectives: [
          { id: 'obj-digest-done', status: 'active' as const },
          { id: 'obj-digest-pending', status: 'active' as const },
        ],
        pendingStoryEvent: { eventId: 'digest-event', scenarioId: 's1-dongzhuo' },
      },
      ui: { ...s.ui, screen: { kind: 'story', eventId: 'digest-event' } },
    }));

    resolveStoryChoice('digest-event', 'do');

    const st = gameStore.getState();
    // Routed back to the main screen (not a chapter win) with the digest set.
    expect(st.ui.screen.kind).toBe('main');
    expect(st.ui.turnDigest.some((e) => e.key === 'objective.completed')).toBe(true);
  });

  it('Story-Mode Chapter-1 victory routes to the Chapter Transition screen (a next chapter exists)', () => {
    // A single non-optional objective that completes once the chosen branch
    // plants a marker. Because setTestObjectives overrides the objective table
    // for the scenario, completing it is a full historic (chapter) win. Chapter 1
    // has a following chapter (Chapter 2 / s2-junxiong), so the win bridges into
    // the "...years pass" transition rather than terminating the campaign.
    setTestObjectives('s1-dongzhuo', [
      {
        id: 'chapter-win',
        titleKey: 'app.title',
        descKey: 'app.subtitle',
        check: (state) => state.objectives.some((o) => o.id === 'win-marker'),
      },
    ]);
    setTestStoryEvents('s1-dongzhuo', [
      {
        id: 'win-event',
        check: () => true,
        titleKey: 'app.title',
        bodyKey: 'app.subtitle',
        choices: [
          {
            id: 'seal',
            labelKey: 'app.confirm',
            descKey: 'app.continue',
            apply: (state) => ({
              ...state,
              objectives: [...state.objectives, { id: 'win-marker', status: 'complete' as const }],
            }),
          },
        ],
      },
    ]);

    newGame(SCENARIO_DONGZHUO, 'liubei', 1);
    gameStore.setState((s) => ({
      ...s,
      game: {
        ...s.game!,
        storyMode: STORY_MODE, // chapter 1
        objectives: [{ id: 'chapter-win', status: 'active' as const }],
        pendingStoryEvent: { eventId: 'win-event', scenarioId: 's1-dongzhuo' },
      },
      ui: { ...s.ui, screen: { kind: 'story', eventId: 'win-event' } },
    }));

    resolveStoryChoice('win-event', 'seal');

    // A Chapter-1 win bridges into the next chapter, not the terminal complete.
    expect(gameStore.getState().ui.screen).toEqual({ kind: 'chapterTransition' });
  });

  it('Story-Mode FINAL-chapter victory routes to the Chapter Complete screen (no next chapter)', () => {
    // Same win pipeline, but the game is tagged as Chapter 3 — the last chapter
    // in Liu Bei's arc — so there is no chapter to transition into and the win is
    // the campaign's terminal celebration.
    setTestObjectives('s1-dongzhuo', [
      {
        id: 'chapter-win',
        titleKey: 'app.title',
        descKey: 'app.subtitle',
        check: (state) => state.objectives.some((o) => o.id === 'win-marker'),
      },
    ]);
    setTestStoryEvents('s1-dongzhuo', [
      {
        id: 'win-event',
        check: () => true,
        titleKey: 'app.title',
        bodyKey: 'app.subtitle',
        choices: [
          {
            id: 'seal',
            labelKey: 'app.confirm',
            descKey: 'app.continue',
            apply: (state) => ({
              ...state,
              objectives: [...state.objectives, { id: 'win-marker', status: 'complete' as const }],
            }),
          },
        ],
      },
    ]);

    newGame(SCENARIO_DONGZHUO, 'liubei', 1);
    gameStore.setState((s) => ({
      ...s,
      game: {
        ...s.game!,
        storyMode: { protagonistFactionId: 'liubei', chapter: 3 },
        objectives: [{ id: 'chapter-win', status: 'active' as const }],
        pendingStoryEvent: { eventId: 'win-event', scenarioId: 's1-dongzhuo' },
      },
      ui: { ...s.ui, screen: { kind: 'story', eventId: 'win-event' } },
    }));

    resolveStoryChoice('win-event', 'seal');

    // No Chapter 4 exists -> terminal chapter-complete celebration.
    expect(gameStore.getState().ui.screen).toEqual({ kind: 'chapterComplete' });
  });

  it('Free-Play victory (no storyMode) routes to the normal game-over, not Chapter Complete', () => {
    // A no-op story choice on a Free-Play game whose board already meets the
    // unify condition (player owns every city). Only the routing is under test.
    setTestStoryEvents('s1-dongzhuo', [
      {
        id: 'free-win',
        check: () => true,
        titleKey: 'app.title',
        bodyKey: 'app.subtitle',
        choices: [{ id: 'go', labelKey: 'app.confirm', descKey: 'app.continue', apply: (s) => s }],
      },
    ]);

    newGame(SCENARIO_DONGZHUO, 'liubei', 1); // Free Play: storyMode stays undefined
    gameStore.setState((s) => {
      const cities = { ...s.game!.cities };
      for (const c of Object.values(cities)) cities[c.id] = { ...c, factionId: 'liubei' };
      return {
        ...s,
        game: {
          ...s.game!,
          cities,
          pendingStoryEvent: { eventId: 'free-win', scenarioId: 's1-dongzhuo' },
        },
        ui: { ...s.ui, screen: { kind: 'story', eventId: 'free-win' } },
      };
    });

    resolveStoryChoice('free-win', 'go');

    expect(gameStore.getState().ui.screen).toEqual({ kind: 'gameOver', outcome: 'victory' });
  });

  it('Story-Mode defeat routes to the normal game-over (only wins reach Chapter Complete)', () => {
    setTestStoryEvents('s1-dongzhuo', [
      {
        id: 'grim-event',
        check: () => true,
        titleKey: 'app.title',
        bodyKey: 'app.subtitle',
        choices: [{ id: 'go', labelKey: 'app.confirm', descKey: 'app.continue', apply: (s) => s }],
      },
    ]);

    newGame(SCENARIO_DONGZHUO, 'liubei', 1);
    gameStore.setState((s) => ({
      ...s,
      game: {
        ...s.game!,
        storyMode: STORY_MODE,
        // The protagonist faction is gone -> checkOutcome returns 'defeat'.
        factions: {
          ...s.game!.factions,
          liubei: { ...s.game!.factions['liubei']!, alive: false },
        },
        pendingStoryEvent: { eventId: 'grim-event', scenarioId: 's1-dongzhuo' },
      },
      ui: { ...s.ui, screen: { kind: 'story', eventId: 'grim-event' } },
    }));

    resolveStoryChoice('grim-event', 'go');

    expect(gameStore.getState().ui.screen).toEqual({ kind: 'gameOver', outcome: 'defeat' });
  });

  it('loadGame with a pending story event resumes on the story screen', () => {
    const base = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 7,
    });
    const game = {
      ...base,
      storyMode: STORY_MODE,
      pendingStoryEvent: { eventId: 'briefing-beat', scenarioId: 's1-dongzhuo' },
    };
    loadGame({ game, locale: 'zh' });
    expect(gameStore.getState().ui.screen).toEqual({ kind: 'story', eventId: 'briefing-beat' });
  });
});
