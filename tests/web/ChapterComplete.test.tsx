import { describe, expect, it, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { App } from '../../src/web/App.js';
import { ChapterCompleteScreen } from '../../src/web/screens/StoryEventModal.js';
import { gameStore, setInitialLocale } from '../../src/state/store.js';
import { CONTINUOUS_SLOT } from '../../src/state/persistence.js';
import { t } from '../../src/i18n/locale.js';

const CONTINUOUS_KEY = `tk-save:${CONTINUOUS_SLOT}`;

beforeEach(() => {
  // Clean title-screen store + an empty continuous slot so App's restore-on-mount
  // is a no-op and never navigates away from the screen under test.
  try {
    localStorage.removeItem(CONTINUOUS_KEY);
  } catch {
    // ignore (jsdom always has localStorage)
  }
  gameStore.setState((s) => ({
    ...s,
    game: null,
    agents: {},
    ui: { ...s.ui, screen: { kind: 'chapterComplete' }, locale: 'zh' },
  }));
  setInitialLocale('zh');
});

describe('ChapterCompleteScreen', () => {
  it('renders the chapter-complete title and body', () => {
    const { getByText } = render(<ChapterCompleteScreen />);
    expect(getByText(t('story.ch1.complete.title'))).toBeInTheDocument();
    expect(getByText(t('story.ch1.complete.body'))).toBeInTheDocument();
  });

  it('Continue clears the continuous save and returns to the title screen', () => {
    // Seed a continuous autosave so we can prove the button wipes it.
    localStorage.setItem(CONTINUOUS_KEY, JSON.stringify({ version: 1, state: {} }));
    const { getByText } = render(<ChapterCompleteScreen />);

    fireEvent.click(getByText(t('app.continue')));

    expect(localStorage.getItem(CONTINUOUS_KEY)).toBeNull();
    expect(gameStore.getState().ui.screen).toEqual({ kind: 'title' });
  });

  it('App routes the chapterComplete screen to ChapterCompleteScreen', () => {
    const { getByText } = render(<App />);
    expect(getByText(t('story.ch1.complete.title'))).toBeInTheDocument();
  });
});
