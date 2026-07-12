import { describe, expect, it, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { ChapterTransitionScreen } from '../../src/web/screens/StoryEventModal.js';
import { gameStore, startStoryMode, setInitialLocale } from '../../src/state/store.js';
import { t } from '../../src/i18n/locale.js';
import type { StoryMode } from '../../src/engine/story/types.js';

beforeEach(() => {
  setInitialLocale('zh');
});

describe('ChapterTransitionScreen', () => {
  it('Continue starts the NEXT chapter (Ch1 transition -> Chapter 2 briefing on Scenario 2)', () => {
    // Put the store in a Chapter-1 story game and simulate the "...years pass"
    // interstitial shown right after Ch1 was won.
    startStoryMode();
    const storyMode: StoryMode = { protagonistFactionId: 'liubei', chapter: 1 };
    gameStore.setState((s) => ({
      ...s,
      game: s.game ? { ...s.game, storyMode } : s.game,
      ui: { ...s.ui, screen: { kind: 'chapterTransition' } },
    }));

    const { getByText } = render(<ChapterTransitionScreen />);
    fireEvent.click(getByText(t('app.continue')));

    const { game, ui } = gameStore.getState();
    expect(game!.scenarioId).toBe('s2-junxiong');
    expect(game!.storyMode).toEqual({ protagonistFactionId: 'liubei', chapter: 2 });
    expect(ui.screen).toEqual({ kind: 'briefing' });
  });
});
