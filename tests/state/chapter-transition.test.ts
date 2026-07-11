import { afterEach, describe, expect, it } from 'vitest';
import {
  CHAPTERS,
  chapterScenarioId,
  nextChapter,
} from '../../src/engine/story/chapters.js';
import { clearTestObjectives } from '../../src/engine/story/objectives.js';
import { clearTestStoryEvents } from '../../src/engine/story/events.js';
import { SCENARIO_JUNXIONG } from '../../src/data/scenarios/s2-junxiong.js';
import { gameStore, startChapter, startStoryMode } from '../../src/state/store.js';

afterEach(() => {
  clearTestObjectives();
  clearTestStoryEvents();
});

describe('chapter registry', () => {
  it('registers Liu Bei chapters 1, 2 and 3 with their scenarios', () => {
    expect(CHAPTERS.liubei).toEqual([
      { chapter: 1, scenarioId: 's1-dongzhuo' },
      { chapter: 2, scenarioId: 's2-junxiong' },
      { chapter: 3, scenarioId: 's3-chibi' },
    ]);
  });

  it('chapterScenarioId maps a protagonist + chapter to its scenario id', () => {
    expect(chapterScenarioId('liubei', 1)).toBe('s1-dongzhuo');
    expect(chapterScenarioId('liubei', 2)).toBe('s2-junxiong');
    expect(chapterScenarioId('liubei', 3)).toBe('s3-chibi');
  });

  it('nextChapter returns the following chapter def, or undefined at the end of the arc', () => {
    expect(nextChapter('liubei', 1)).toEqual({ chapter: 2, scenarioId: 's2-junxiong' });
    expect(nextChapter('liubei', 2)).toEqual({ chapter: 3, scenarioId: 's3-chibi' });
    expect(nextChapter('liubei', 3)).toBeUndefined();
  });

  it('returns undefined for unknown protagonists / chapters', () => {
    expect(chapterScenarioId('caocao', 1)).toBeUndefined();
    expect(nextChapter('caocao', 1)).toBeUndefined();
    expect(chapterScenarioId('liubei', 9)).toBeUndefined();
    expect(nextChapter('liubei', 9)).toBeUndefined();
  });
});

describe('startChapter', () => {
  it('startChapter("liubei", 2) builds Scenario 2 tagged as chapter 2, seeds objectives, registers non-protagonist agents, and opens the briefing', () => {
    startChapter('liubei', 2);

    const { game, agents, ui } = gameStore.getState();
    expect(game).not.toBeNull();
    expect(game!.scenarioId).toBe('s2-junxiong');
    expect(game!.storyMode).toEqual({ protagonistFactionId: 'liubei', chapter: 2 });
    expect(game!.playerFactionId).toBe('liubei');
    // Objectives are seeded (an array; empty until Task 5 authors the s2 table).
    expect(Array.isArray(game!.objectives)).toBe(true);
    // Agents wired for every faction EXCEPT the protagonist.
    expect(agents['liubei']).toBeUndefined();
    expect(agents['caocao']).toBeDefined();
    expect(agents['lvbu']).toBeDefined();
    expect(Object.keys(agents)).toHaveLength(SCENARIO_JUNXIONG.factions.length - 1);
    // Opens the chapter briefing before the campaign map.
    expect(ui.screen).toEqual({ kind: 'briefing' });
  });

  it('startChapter is deterministic (fixed seed) across runs', () => {
    startChapter('liubei', 2);
    const a = gameStore.getState().game!;
    startChapter('liubei', 2);
    const b = gameStore.getState().game!;
    expect(b.generals['sunce']!.stats).toEqual(a.generals['sunce']!.stats);
  });
});

describe('startStoryMode', () => {
  it('still launches Chapter 1 (s1-dongzhuo) identically', () => {
    startStoryMode();

    const { game, agents, ui } = gameStore.getState();
    expect(game!.scenarioId).toBe('s1-dongzhuo');
    expect(game!.storyMode).toEqual({ protagonistFactionId: 'liubei', chapter: 1 });
    expect(game!.playerFactionId).toBe('liubei');
    expect(agents['liubei']).toBeUndefined();
    expect(agents['caocao']).toBeDefined();
    expect(ui.screen).toEqual({ kind: 'briefing' });
  });
});
