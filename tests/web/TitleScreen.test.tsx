import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TitleScreen } from '../../src/web/screens/TitleScreen.js';
import { gameStore, startStoryMode, setInitialLocale } from '../../src/state/store.js';
import { clearTestObjectives, setTestObjectives } from '../../src/engine/story/objectives.js';
import type { ObjectiveDef } from '../../src/engine/story/types.js';

// The production s1-dongzhuo objective table is authored by Task 10; until then
// objectivesFor('s1-dongzhuo') returns []. To verify the WIRING here — that
// startStoryMode routes the built scenario/storyMode through seedObjectives — we
// register a deterministic TEST-ONLY objective for s1-dongzhuo. It only appears
// in game.objectives if startStoryMode actually seeds against scenarioId
// 's1-dongzhuo', so a non-empty seeded array is genuine evidence of the wiring.
const CH1_TEST_OBJECTIVE: ObjectiveDef = {
  id: 'test-ch1-survive',
  titleKey: 'story.ch1.title',
  descKey: 'story.ch1.briefing',
  check: () => false,
};

beforeEach(() => {
  setTestObjectives('s1-dongzhuo', [CH1_TEST_OBJECTIVE]);
  // Reset to a clean title screen (zh locale) before each test.
  gameStore.setState((s) => ({
    ...s,
    game: null,
    agents: {},
    ui: { ...s.ui, screen: { kind: 'title' }, locale: 'zh', selectedCityId: null },
  }));
  setInitialLocale('zh');
});

afterEach(() => {
  clearTestObjectives();
});

describe('startStoryMode (store)', () => {
  it('launches Liu Bei Chapter 1: sets storyMode, seeds objectives, routes to briefing', () => {
    startStoryMode();
    const st = gameStore.getState();
    expect(st.game).not.toBeNull();
    expect(st.game!.playerFactionId).toBe('liubei');
    expect(st.game!.storyMode).toEqual({ protagonistFactionId: 'liubei', chapter: 1 });
    // seedObjectives ran against scenarioId 's1-dongzhuo' + the Liu Bei arc.
    expect(st.game!.objectives.length).toBeGreaterThan(0);
    expect(st.game!.objectives.every((o) => o.status === 'active')).toBe(true);
    // Opening briefing is shown before the campaign map.
    expect(st.ui.screen).toEqual({ kind: 'briefing' });
  });

  it('registers AI agents for every non-protagonist faction', () => {
    startStoryMode();
    const st = gameStore.getState();
    expect(st.agents['liubei']).toBeUndefined();
    expect(Object.keys(st.agents).length).toBeGreaterThan(0);
  });

  it('is deterministic: two launches produce identical starting state', () => {
    startStoryMode();
    const first = gameStore.getState().game!;
    startStoryMode();
    const second = gameStore.getState().game!;
    expect(second.turn).toBe(first.turn);
    expect(second.objectives).toEqual(first.objectives);
  });
});

describe('TitleScreen story / free-play split', () => {
  it('lists Story Mode as the first entry and Free Play as the second', () => {
    render(<TitleScreen />);
    expect(screen.getByRole('button', { name: '剧情模式' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '自由模式' })).toBeInTheDocument();
    // The old "新游戏" label no longer appears.
    expect(screen.queryByRole('button', { name: '新游戏' })).toBeNull();
  });

  it('clicking Story Mode launches the campaign and routes to the briefing', () => {
    render(<TitleScreen />);
    fireEvent.click(screen.getByRole('button', { name: '剧情模式' }));
    const st = gameStore.getState();
    expect(st.game!.storyMode).toEqual({ protagonistFactionId: 'liubei', chapter: 1 });
    expect(st.ui.screen).toEqual({ kind: 'briefing' });
  });

  it('clicking Free Play routes to scenario select without starting a game', () => {
    render(<TitleScreen />);
    fireEvent.click(screen.getByRole('button', { name: '自由模式' }));
    const st = gameStore.getState();
    expect(st.ui.screen).toEqual({ kind: 'scenarioSelect' });
    expect(st.game).toBeNull();
  });
});
