import { afterEach, describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DINGLI } from '../../src/data/scenarios/s4-dingli.js';
import { SCENARIO_CHIBI } from '../../src/data/scenarios/s3-chibi.js';
import { REF_DATA } from '../../src/data/index.js';
import { advanceMonth, checkOutcome } from '../../src/engine/turn.js';
import { makeDefaultAgent } from '../../src/engine/ai/index.js';
import {
  seedObjectives,
  setTestObjectives,
  clearTestObjectives,
} from '../../src/engine/story/objectives.js';
import {
  applyStoryChoice,
  setTestStoryEvents,
  clearTestStoryEvents,
} from '../../src/engine/story/events.js';
import { nextChapter } from '../../src/engine/story/chapters.js';
import { hasEvent } from '../../src/data/story/helpers.js';
import { citiesOf } from '../../src/engine/map.js';
import { gameStore, newGame, resolveStoryChoice, startChapter } from '../../src/state/store.js';
import type { FactionAgent, GameState } from '../../src/engine/types.js';
import type { StoryMode } from '../../src/engine/story/types.js';

// Deterministic reachability + transition guard for Liu Bei's Chapter 4 — the
// GRAND FINALE (三国鼎立 / s4-dingli, 220 CE). The last playthrough test of the
// Story-Campaign arc, modelled on the shipped
// tests/playthrough/s3-chapter3-reachability.test.ts (same AI-driving +
// beat-pause-resolution pattern). It proves three things the finale depends on:
//
//   (a) TRANSITION WIRING — because Chapter 4 now exists, a Story-Mode
//       Chapter-3 *victory* stops being terminal and instead routes (via the
//       store's outcomeScreen) to the "...years pass" chapterTransition; and
//       startChapter('liubei', 4) then builds a valid Chapter-4 game (scenario
//       s4-dingli, the four s4 objectives seeded, the briefing open).
//   (b) FINALE REACHED (BOTH Yiling branches) — driving s4 as Liu Bei with the
//       scripted beats resolved, the arc plays out proclaim_han → (yiling_march
//       resolved) → northern_expedition IN ORDER; completing the terminal
//       northern beat makes the three MANDATORY objectives (proclaim / yiling /
//       northern) complete, so checkOutcome reports 'victory'. Because Chapter 4
//       is the terminal chapter (no next chapter), that win routes to the
//       terminal chapterComplete — the finale — NOT chapterTransition. Proven for
//       BOTH the 'launch' and 'restraint' Yiling branches.
//   (c) OPTIONAL unify does NOT gate — the finale is reached WITHOUT owning all
//       42 cities: at the win Liu Bei owns far fewer than 42 and the OPTIONAL
//       unify objective is still 'active' while checkOutcome is already 'victory'.
//
// Fully deterministic: fixed seeds, the pure engine, no RNG/wall-clock. Liu Bei
// is a POWER in s4 (7 cities, 120k troops), and the finale arc is reached purely
// through the scripted turn/event-keyed beats — never through combat — so, like
// the Chapter-3 test, we deliberately do NOT drive Liu Bei at all. The sim's one
// non-obvious duty: story beats PAUSE the tick (advanceMonth leaves
// state.pendingStoryEvent set and the beat's apply un-run), so — exactly like the
// store's resolveStoryChoice — we RESOLVE each pending beat with applyStoryChoice
// (beats dismiss with choiceId ''; the yiling_march choice takes 'launch' or
// 'restraint') so the arc progresses. A naive advanceMonth loop would FREEZE on
// the first beat and never reach the finale.

const SEEDS = [1, 7, 42];
const YILING_BRANCHES = ['launch', 'restraint'] as const;
const MAX_TURNS = 12;

function buildAgents(state: GameState): Record<string, FactionAgent> {
  const agents: Record<string, FactionAgent> = {};
  for (const f of Object.values(state.factions)) {
    if (f.id === state.playerFactionId) continue;
    agents[f.id] = makeDefaultAgent(f.id, f.personality);
  }
  return agents;
}

// Build Chapter 4 as Liu Bei in Story Mode (mirrors s3 reachability's
// buildChapter3): the s4-dingli scenario + a chapter-4 storyMode tag, with the
// four s4 objectives seeded.
function buildChapter4(seed: number): GameState {
  return seedObjectives({
    ...buildInitialState({
      scenario: SCENARIO_DINGLI,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed,
    }),
    storyMode: { protagonistFactionId: 'liubei', chapter: 4 },
  });
}

interface SimResult {
  beatTurns: Record<string, number>;
  reachedVictory: boolean;
  winState: GameState | null;
}

// Run Chapter 4 deterministically for `seed`, driving every non-player faction
// with the default agent and RESOLVING each scripted beat the tick it pauses on.
// The yiling_march choice is answered with `yilingChoice`; every narrative beat
// dismisses with choiceId ''. Stops the tick the moment the historic victory is
// detected (mirroring the real game, which ends at the win) and snapshots that
// exact win state.
function runChapter4Sim(seed: number, yilingChoice: 'launch' | 'restraint'): SimResult {
  let state = buildChapter4(seed);
  const beatTurns: Record<string, number> = {};
  let winState: GameState | null = null;

  for (let i = 0; i < MAX_TURNS && winState === null; i++) {
    state = advanceMonth(state, buildAgents(state));

    // Resolve any beat the month paused on — like the store's resolveStoryChoice.
    // advanceMonth fires at most one beat per tick, but a bounded loop is safe.
    let guard = 0;
    while (state.pendingStoryEvent && guard++ < 8) {
      const eventId = state.pendingStoryEvent.eventId;
      // A narrative beat has no choices (choiceId ''); the Yiling decision takes
      // the requested branch (launch the campaign, or show restraint).
      const choiceId = eventId === 'yiling_march' ? yilingChoice : '';
      if (!(eventId in beatTurns)) beatTurns[eventId] = state.turn;
      state = applyStoryChoice(state, eventId, choiceId);
    }

    // checkOutcome turns 'victory' only after evaluateObjectives has flipped the
    // three mandatory objectives — which happens on the first tick AFTER the
    // terminal northern_expedition beat, when no story event fires and
    // advanceMonth runs objective evaluation.
    if (checkOutcome(state) === 'victory') winState = state;
  }

  return { beatTurns, reachedVictory: winState !== null, winState };
}

afterEach(() => {
  clearTestObjectives();
  clearTestStoryEvents();
});

describe('Chapter 4 (s4-dingli) — Ch3→Ch4 transition wiring', () => {
  it('registering Chapter 4 gives a Chapter-3 win a next chapter (so it transitions, not terminates)', () => {
    // outcomeScreen routes a Story-Mode win to chapterTransition IFF a next
    // chapter exists; for Chapter 3 that next chapter is now Chapter 4 / s4-dingli.
    expect(nextChapter('liubei', 3)).toEqual({ chapter: 4, scenarioId: 's4-dingli' });
  });

  it('a Story-Mode Chapter-3 victory routes via outcomeScreen to the chapterTransition (bridging into Ch4)', () => {
    // Drive the REAL store path (resolveStoryChoice -> checkOutcome ->
    // outcomeScreen) on a Chapter-3-tagged game. A single mandatory test
    // objective, completed by a story choice, is a full historic (chapter) win;
    // because Chapter 4 now follows Chapter 3, the win bridges into the "...years
    // pass" transition rather than the terminal chapterComplete. Mirrors the
    // shipped Chapter-2 case in s3-chapter3-reachability.test.ts.
    const CH3_STORY: StoryMode = { protagonistFactionId: 'liubei', chapter: 3 };
    setTestObjectives('s3-chibi', [
      {
        id: 'chapter-win',
        titleKey: 'app.title',
        descKey: 'app.subtitle',
        check: (s) => s.objectives.some((o) => o.id === 'win-marker'),
      },
    ]);
    setTestStoryEvents('s3-chibi', [
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
            apply: (s) => ({
              ...s,
              objectives: [...s.objectives, { id: 'win-marker', status: 'complete' as const }],
            }),
          },
        ],
      },
    ]);

    newGame(SCENARIO_CHIBI, 'liubei', 1);
    gameStore.setState((s) => ({
      ...s,
      game: {
        ...s.game!,
        storyMode: CH3_STORY,
        objectives: [{ id: 'chapter-win', status: 'active' as const }],
        pendingStoryEvent: { eventId: 'win-event', scenarioId: 's3-chibi' },
      },
      ui: { ...s.ui, screen: { kind: 'story', eventId: 'win-event' } },
    }));

    resolveStoryChoice('win-event', 'seal');

    expect(gameStore.getState().ui.screen).toEqual({ kind: 'chapterTransition' });
  });

  it('startChapter("liubei", 4) builds a valid Story-Mode Chapter 4 game (s4-dingli, s4 objectives, briefing)', () => {
    startChapter('liubei', 4);

    const { game, agents, ui } = gameStore.getState();
    expect(game).not.toBeNull();
    expect(game!.scenarioId).toBe('s4-dingli');
    expect(game!.storyMode).toEqual({ protagonistFactionId: 'liubei', chapter: 4 });
    expect(game!.playerFactionId).toBe('liubei');
    // The four Chapter-4 objectives are seeded, all active (three mandatory + the
    // optional unify).
    expect(game!.objectives.map((o) => o.id)).toEqual([
      'proclaim',
      'yiling',
      'northern',
      'unify',
    ]);
    expect(game!.objectives.every((o) => o.status === 'active')).toBe(true);
    // Agents wired for every faction EXCEPT the protagonist.
    expect(agents['liubei']).toBeUndefined();
    expect(agents['caopi']).toBeDefined();
    expect(agents['sunquan']).toBeDefined();
    expect(Object.keys(agents)).toHaveLength(SCENARIO_DINGLI.factions.length - 1);
    // Opens the chapter briefing before the campaign map.
    expect(ui.screen).toEqual({ kind: 'briefing' });
  });
});

describe('Chapter 4 (s4-dingli) — the finale is TERMINAL (chapterComplete, not chapterTransition)', () => {
  it('Chapter 4 has no next chapter, so a Story-Mode win ends on the terminal chapterComplete', () => {
    // The sole difference from every earlier chapter: nextChapter is undefined —
    // this is what makes outcomeScreen return chapterComplete (the finale) rather
    // than bridging onward.
    expect(nextChapter('liubei', 4)).toBeUndefined();
  });

  it('a Story-Mode Chapter-4 victory routes via outcomeScreen to the terminal chapterComplete', () => {
    // Same real-store drive as the Ch3 case, but tagged Chapter 4: because no
    // fifth chapter exists, the historic win lands on the celebratory
    // chapterComplete — the grand finale — instead of a transition.
    const CH4_STORY: StoryMode = { protagonistFactionId: 'liubei', chapter: 4 };
    setTestObjectives('s4-dingli', [
      {
        id: 'chapter-win',
        titleKey: 'app.title',
        descKey: 'app.subtitle',
        check: (s) => s.objectives.some((o) => o.id === 'win-marker'),
      },
    ]);
    setTestStoryEvents('s4-dingli', [
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
            apply: (s) => ({
              ...s,
              objectives: [...s.objectives, { id: 'win-marker', status: 'complete' as const }],
            }),
          },
        ],
      },
    ]);

    newGame(SCENARIO_DINGLI, 'liubei', 1);
    gameStore.setState((s) => ({
      ...s,
      game: {
        ...s.game!,
        storyMode: CH4_STORY,
        objectives: [{ id: 'chapter-win', status: 'active' as const }],
        pendingStoryEvent: { eventId: 'win-event', scenarioId: 's4-dingli' },
      },
      ui: { ...s.ui, screen: { kind: 'story', eventId: 'win-event' } },
    }));

    resolveStoryChoice('win-event', 'seal');

    expect(gameStore.getState().ui.screen).toEqual({ kind: 'chapterComplete' });
  });
});

describe('Chapter 4 (s4-dingli) reachability — the grand finale is reached via the scripted beats', () => {
  it('the start seats Liu Bei as a Shu-Han power (7 cities, 120k troops) — not an underdog', () => {
    const liubei = SCENARIO_DINGLI.factions.find((f) => f.id === 'liubei')!;
    // The finale board: Liu Bei is a settled power, so mere survival is never in
    // doubt and the finale turns on the scripted arc, not on combat.
    expect(liubei.cityIds).toHaveLength(7);
    expect(liubei.resources.troops).toBe(120000);
  });

  for (const branch of YILING_BRANCHES) {
    it.each(SEEDS)(
      `Yiling '${branch}', seed %i: the beats fire in order, the finale is reached, and unify does not gate`,
      (seed) => {
        const r = runChapter4Sim(seed, branch);

        // (b) The finale was reached — the historic victory closed.
        expect(r.reachedVictory).toBe(true);
        const win = r.winState!;

        // (b) The three scripted beats fired, IN ORDER: proclaim -> yiling -> northern.
        expect(r.beatTurns['proclaim_han']).toBeGreaterThan(0);
        expect(r.beatTurns['yiling_march']).toBeGreaterThan(r.beatTurns['proclaim_han']!);
        expect(r.beatTurns['northern_expedition']).toBeGreaterThan(r.beatTurns['yiling_march']!);

        // (b) The requested Yiling branch actually resolved (its decision flag was
        // recorded), and the beats' objectives all completed.
        const yilingFlag = branch === 'launch' ? 'yiling_launched' : 'yiling_restrained';
        expect(hasEvent(win, yilingFlag)).toBe(true);
        expect(hasEvent(win, 'proclaim_han')).toBe(true);
        expect(hasEvent(win, 'northern_expedition')).toBe(true);
        const status = (id: string) => win.objectives.find((o) => o.id === id)?.status;
        expect(status('proclaim')).toBe('complete');
        expect(status('yiling')).toBe('complete');
        expect(status('northern')).toBe('complete');

        // (b) Liu Bei survived to the win and the historic victory holds. Chapter 4
        // is terminal, so this win routes to chapterComplete (the finale), not a
        // transition — see the dedicated store-driven test above.
        expect(win.factions['liubei']?.alive).toBe(true);
        expect(checkOutcome(win)).toBe('victory');
        expect(nextChapter('liubei', win.storyMode!.chapter)).toBeUndefined();

        // (c) The OPTIONAL unify objective did NOT gate the finale: Liu Bei owns
        // far fewer than all 42 cities, and unify is still active/incomplete even
        // though checkOutcome is already 'victory'.
        const totalCities = Object.keys(win.cities).length;
        expect(totalCities).toBe(42);
        expect(citiesOf(win, 'liubei').length).toBeLessThan(totalCities);
        expect(status('unify')).toBe('active');
      },
    );
  }
});
