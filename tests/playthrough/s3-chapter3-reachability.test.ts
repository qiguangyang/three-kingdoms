import { afterEach, describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_CHIBI } from '../../src/data/scenarios/s3-chibi.js';
import { SCENARIO_JUNXIONG } from '../../src/data/scenarios/s2-junxiong.js';
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
import { citiesOf } from '../../src/engine/map.js';
import { gameStore, newGame, resolveStoryChoice, startChapter } from '../../src/state/store.js';
import type { FactionAgent, GameState } from '../../src/engine/types.js';
import type { StoryMode } from '../../src/engine/story/types.js';

// Deterministic reachability + transition guard for Liu Bei's Chapter 3
// (赤壁之战 / s3-chibi, 208 CE) — the Chapter-3 counterpart of the shipped
// tests/playthrough/s2-chapter2-reachability.test.ts. It proves three things the
// Phase-4 content depends on:
//
//   (a) TRANSITION WIRING — a Story-Mode Chapter-2 *victory* routes (via the
//       store's outcomeScreen) to the "...years pass" chapterTransition, and
//       startChapter('liubei', 3) then builds a valid Chapter-3 game (scenario
//       s3-chibi, the four s3 objectives seeded, the briefing open).
//   (b) SURVIVAL — cornered at the lone city of Jiangxia beside Cao Cao's 22
//       cities / 250k troops, Liu Bei is NOT eliminated in the opening; he lives
//       past turn 3, by when the sun_liu_alliance beat has injected +8000 Jiangxia
//       garrison.
//   (c) ARC COMPLETES — the scripted Red Cliffs beats fire IN ORDER
//       (longzhong_plan → sun_liu_alliance → red_cliffs), so the jing_borrow
//       event's check becomes satisfiable and claimJing's gate is reachable; with
//       the Borrow-Jing choice taken every mandatory objective completes and
//       checkOutcome reports 'victory' — the chapter is winnable.
//
// Fully deterministic: fixed seeds, the pure engine, no RNG/wall-clock. Unlike
// Chapter 2 (whose win gate demanded an offensive campaign) Chapter 3's win gate
// is reached by the scripted DIPLOMATIC beats, not by combat — so we deliberately
// do NOT drive Liu Bei at all. A purely defensive protagonist surviving is the
// strongest possible survival guarantee. The sim's one non-obvious duty: story
// beats PAUSE the tick (advanceMonth leaves state.pendingStoryEvent set and the
// beat's apply un-run), so — exactly like the store's resolveStoryChoice — we
// RESOLVE each pending beat with applyStoryChoice so its apply (e.g. the +8000
// alliance garrison) actually lands before the next month. A naive advanceMonth
// loop that never resolved would drop those applies.

const SEEDS = [1, 2, 3, 7, 42];
const MAX_TURNS = 30;

function buildAgents(state: GameState): Record<string, FactionAgent> {
  const agents: Record<string, FactionAgent> = {};
  for (const f of Object.values(state.factions)) {
    if (f.id === state.playerFactionId) continue;
    agents[f.id] = makeDefaultAgent(f.id, f.personality);
  }
  return agents;
}

// Build Chapter 3 as Liu Bei in Story Mode (mirrors s2 reachability's
// buildChapter2): the s3-chibi scenario + a chapter-3 storyMode tag, with the
// four s3 objectives seeded.
function buildChapter3(seed: number): GameState {
  return seedObjectives({
    ...buildInitialState({
      scenario: SCENARIO_CHIBI,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed,
    }),
    storyMode: { protagonistFactionId: 'liubei', chapter: 3 },
  });
}

interface SimResult {
  aliveThroughTurn3: boolean;
  aliveThroughout: boolean;
  finalAlive: boolean;
  beatTurns: Record<string, number>;
  finalOutcome: 'victory' | 'defeat' | null;
  finalCityCount: number;
}

// Run Chapter 3 deterministically for `seed`, driving every non-player faction
// with the default agent and RESOLVING each scripted beat the tick it pauses on
// (narrative beats dismiss with choiceId ''; the Borrow-Jing choice takes Jing).
function runChapter3Sim(seed: number): SimResult {
  let state = buildChapter3(seed);
  const beatTurns: Record<string, number> = {};
  let aliveThroughTurn3 = true;
  let aliveThroughout = true;

  for (let i = 0; i < MAX_TURNS; i++) {
    state = advanceMonth(state, buildAgents(state));

    // Resolve any beat the month paused on — like the store's resolveStoryChoice.
    // advanceMonth fires at most one beat per tick, but a bounded loop is safe.
    let guard = 0;
    while (state.pendingStoryEvent && guard++ < 8) {
      const eventId = state.pendingStoryEvent.eventId;
      // A narrative beat has no choices (choiceId ''); the Borrow-Jing choice
      // takes Jing — the branch that hands Liu Bei his long-lacked base.
      const choiceId = eventId === 'jing_borrow' ? 'take' : '';
      if (!(eventId in beatTurns)) beatTurns[eventId] = state.turn;
      state = applyStoryChoice(state, eventId, choiceId);
    }

    const alive = state.factions['liubei']?.alive === true;
    if (!alive) aliveThroughout = false;
    if (state.turn <= 3 && !alive) aliveThroughTurn3 = false;
  }

  return {
    aliveThroughTurn3,
    aliveThroughout,
    finalAlive: state.factions['liubei']?.alive === true,
    beatTurns,
    finalOutcome: checkOutcome(state),
    finalCityCount: citiesOf(state, 'liubei').length,
  };
}

afterEach(() => {
  clearTestObjectives();
  clearTestStoryEvents();
});

describe('Chapter 3 (s3-chibi) — Ch2→Ch3 transition wiring', () => {
  it('a Chapter-2 victory has a next chapter, so it routes toward the transition (not the terminal complete)', () => {
    // outcomeScreen routes a Story-Mode win to chapterTransition IFF a next
    // chapter exists; for Chapter 2 that next chapter is Chapter 3 / s3-chibi.
    expect(nextChapter('liubei', 2)).toEqual({ chapter: 3, scenarioId: 's3-chibi' });
  });

  it('a Story-Mode Chapter-2 victory routes via outcomeScreen to the chapterTransition screen', () => {
    // Drive the REAL store path (resolveStoryChoice -> checkOutcome ->
    // outcomeScreen) on a Chapter-2-tagged game. A single mandatory test
    // objective, completed by a story choice, is a full historic (chapter) win;
    // because Chapter 3 follows Chapter 2, the win bridges into the "...years
    // pass" transition rather than the terminal chapterComplete. Modelled on the
    // shipped Chapter-1 case in tests/state/story-store.test.ts.
    const CH2_STORY: StoryMode = { protagonistFactionId: 'liubei', chapter: 2 };
    setTestObjectives('s2-junxiong', [
      {
        id: 'chapter-win',
        titleKey: 'app.title',
        descKey: 'app.subtitle',
        check: (s) => s.objectives.some((o) => o.id === 'win-marker'),
      },
    ]);
    setTestStoryEvents('s2-junxiong', [
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

    newGame(SCENARIO_JUNXIONG, 'liubei', 1);
    gameStore.setState((s) => ({
      ...s,
      game: {
        ...s.game!,
        storyMode: CH2_STORY,
        objectives: [{ id: 'chapter-win', status: 'active' as const }],
        pendingStoryEvent: { eventId: 'win-event', scenarioId: 's2-junxiong' },
      },
      ui: { ...s.ui, screen: { kind: 'story', eventId: 'win-event' } },
    }));

    resolveStoryChoice('win-event', 'seal');

    expect(gameStore.getState().ui.screen).toEqual({ kind: 'chapterTransition' });
  });

  it('startChapter("liubei", 3) builds a valid Story-Mode Chapter 3 game (s3-chibi, s3 objectives, briefing)', () => {
    startChapter('liubei', 3);

    const { game, agents, ui } = gameStore.getState();
    expect(game).not.toBeNull();
    expect(game!.scenarioId).toBe('s3-chibi');
    expect(game!.storyMode).toEqual({ protagonistFactionId: 'liubei', chapter: 3 });
    expect(game!.playerFactionId).toBe('liubei');
    // The four mandatory Chapter-3 objectives are seeded, all active.
    expect(game!.objectives.map((o) => o.id)).toEqual([
      'longzhong',
      'alliance',
      'burnFleet',
      'claimJing',
    ]);
    expect(game!.objectives.every((o) => o.status === 'active')).toBe(true);
    // Agents wired for every faction EXCEPT the protagonist.
    expect(agents['liubei']).toBeUndefined();
    expect(agents['caocao']).toBeDefined();
    expect(agents['sunquan']).toBeDefined();
    expect(Object.keys(agents)).toHaveLength(SCENARIO_CHIBI.factions.length - 1);
    // Opens the chapter briefing before the campaign map.
    expect(ui.screen).toEqual({ kind: 'briefing' });
  });
});

describe('Chapter 3 (s3-chibi) reachability — Liu Bei survives Red Cliffs and the arc is winnable', () => {
  it('the start keeps Liu Bei a clear underdog (lone city, far below Sun Quan and Cao Cao)', () => {
    const liubei = SCENARIO_CHIBI.factions.find((f) => f.id === 'liubei')!;
    const sunquan = SCENARIO_CHIBI.factions.find((f) => f.id === 'sunquan')!;
    const caocao = SCENARIO_CHIBI.factions.find((f) => f.id === 'caocao')!;
    // A single river-city and a fraction of the rival hosts — the cornered
    // underdog the chapter is built around. This invariant tolerates the brief's
    // allowed survival tuning (up to ~20k) but catches an egregious over-buff.
    expect(liubei.cityIds).toHaveLength(1);
    expect(liubei.cityIds).toEqual(['jiangxia']);
    expect(liubei.resources.troops).toBeLessThan(sunquan.resources.troops);
    expect(liubei.resources.troops).toBeLessThan(caocao.resources.troops / 10);
  });

  it.each(SEEDS)(
    'seed %i: Liu Bei survives Cao Cao\'s opening, the beats fire in order, and the chapter is winnable',
    (seed) => {
      const r = runChapter3Sim(seed);

      // (b) Survival — never routed in the opening, still alive at the end. The
      // sun_liu_alliance beat's +8000 Jiangxia garrison lands by turn 3.
      expect(r.aliveThroughTurn3).toBe(true);
      expect(r.aliveThroughout).toBe(true);
      expect(r.finalAlive).toBe(true);

      // (c) The three scripted Red Cliffs beats fired, IN ORDER.
      expect(r.beatTurns['longzhong_plan']).toBeGreaterThan(0);
      expect(r.beatTurns['sun_liu_alliance']).toBeGreaterThan(r.beatTurns['longzhong_plan']!);
      expect(r.beatTurns['red_cliffs']).toBeGreaterThan(r.beatTurns['sun_liu_alliance']!);

      // (c) claimJing's gate is reachable: red_cliffs firing makes the jing_borrow
      // event's check satisfiable, so the choice actually paused the tick (its
      // recorded fire-turn proves check() passed) after Red Cliffs.
      expect(r.beatTurns['jing_borrow']).toBeGreaterThan(r.beatTurns['red_cliffs']!);

      // (c) Chapter winnable: with Jing taken, every mandatory objective completes
      // and the historic victory condition is met.
      expect(r.finalOutcome).toBe('victory');
      // The Borrow-Jing reward materialised — Liu Bei grew past his lone start city.
      expect(r.finalCityCount).toBeGreaterThan(1);
    },
  );
});
