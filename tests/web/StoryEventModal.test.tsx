import { describe, expect, it, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';

// Hoisted so the vi.mock factories (which hoist above imports) can reference
// them without a temporal-dead-zone error. CHOICE_EVENT is a 2-choice decision;
// BEAT_EVENT is a pure-narrative beat (no choices -> single "continue").
const { CHOICE_EVENT, BEAT_EVENT, resolveMock } = vi.hoisted(() => {
  const identity = (s: unknown): unknown => s;
  const CHOICE_EVENT = {
    id: 'test-choice',
    check: () => true,
    titleKey: 'story.ch1.title',
    bodyKey: 'story.ch1.briefing',
    choices: [
      { id: 'accept', labelKey: 'title.newGame', descKey: 'title.about', apply: identity },
      { id: 'decline', labelKey: 'title.loadGame', descKey: 'app.continue', apply: identity },
    ],
  };
  const BEAT_EVENT = {
    id: 'test-beat',
    check: () => true,
    titleKey: 'story.ch1.title',
    bodyKey: 'story.ch1.transition',
    choices: [],
  };
  return { CHOICE_EVENT, BEAT_EVENT, resolveMock: vi.fn() };
});

// Return a controlled event so this UI test never couples to authored content.
vi.mock('../../src/engine/story/events.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/story/events.js')>();
  return {
    ...actual,
    findStoryEvent: vi.fn((_scenarioId: string, _mode: unknown, eventId: string) =>
      eventId === 'test-beat' ? BEAT_EVENT : CHOICE_EVENT,
    ),
  };
});

// Spy on the store action while keeping gameStore + everything else real.
vi.mock('../../src/state/store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state/store.js')>();
  return { ...actual, resolveStoryChoice: resolveMock };
});

import { StoryEventModal } from '../../src/web/screens/StoryEventModal.js';
import { gameStore, newGame, setInitialLocale } from '../../src/state/store.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { t } from '../../src/i18n/locale.js';
import type { StoryMode } from '../../src/engine/story/types.js';

beforeEach(() => {
  resolveMock.mockClear();
  setInitialLocale('zh');
  newGame(SCENARIO_DONGZHUO, 'liubei', 1);
  const storyMode: StoryMode = { protagonistFactionId: 'liubei', chapter: 1 };
  gameStore.setState((s) => ({
    ...s,
    game: s.game ? { ...s.game, storyMode } : s.game,
    ui: { ...s.ui, screen: { kind: 'story', eventId: 'test-choice' }, locale: 'zh' },
  }));
});

describe('StoryEventModal', () => {
  it('renders the event title, body, and both choice labels', () => {
    const { getByText } = render(<StoryEventModal />);
    expect(getByText(t('story.ch1.title'))).toBeInTheDocument();
    expect(getByText(t('story.ch1.briefing'))).toBeInTheDocument();
    expect(getByText(t('title.newGame'))).toBeInTheDocument(); // choice A label
    expect(getByText(t('title.loadGame'))).toBeInTheDocument(); // choice B label
  });

  it('clicking a choice dispatches resolveStoryChoice with the event + choice ids', () => {
    const { getByText } = render(<StoryEventModal />);
    fireEvent.click(getByText(t('title.loadGame'))); // choice B == 'decline'
    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(resolveMock).toHaveBeenCalledWith('test-choice', 'decline');
  });

  it('a narrative beat (no choices) shows a single continue that clears with empty choiceId', () => {
    gameStore.setState((s) => ({
      ...s,
      ui: { ...s.ui, screen: { kind: 'story', eventId: 'test-beat' } },
    }));
    const { getByText } = render(<StoryEventModal />);
    fireEvent.click(getByText(t('app.continue')));
    expect(resolveMock).toHaveBeenCalledWith('test-beat', '');
  });
});
