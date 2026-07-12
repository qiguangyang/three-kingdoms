import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ObjectivesHud } from '../../src/web/components/ObjectivesHud.js';
import {
  clearTestObjectives,
  objectivesFor,
  setTestObjectives,
} from '../../src/engine/story/objectives.js';
import { newGame, gameStore } from '../../src/state/store.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { t } from '../../src/i18n/locale.js';
import type { GameState } from '../../src/engine/types.js';
import type { ObjectiveDef, ObjectiveState, StoryMode } from '../../src/engine/story/types.js';

// Production objectivesFor() returns [] for real scenarios until Task 10 authors
// the s1-dongzhuo content. Drive the HUD deterministically through the TEST-ONLY
// overlay so this test tracks the objective-join pipeline (objectivesFor +
// hidden filtering) rather than any not-yet-authored narrative content.
afterEach(() => clearTestObjectives());

describe('ObjectivesHud', () => {
  it('lists active objectives and marks the completed one', () => {
    // A real Liu Bei Chapter 1 game gives us a valid base GameState to clone.
    newGame(SCENARIO_DONGZHUO, 'liubei', 1);
    const base = gameStore.getState().game as GameState;

    // Register a deterministic objective table: three visible objectives plus a
    // hidden one (which the HUD must never surface). Titles/descriptions reuse
    // existing distinct MessageKeys so getByText finds unique matches.
    const testDefs: ObjectiveDef[] = [
      {
        id: 'obj-a',
        titleKey: 'menu.internalAffairs',
        descKey: 'menu.develop',
        check: () => false,
      },
      { id: 'obj-b', titleKey: 'menu.attack', descKey: 'menu.recruit', check: () => false },
      { id: 'obj-c', titleKey: 'menu.diplomacy', descKey: 'menu.patrol', check: () => false },
      {
        id: 'obj-hidden',
        titleKey: 'menu.plunder',
        descKey: 'menu.move',
        check: () => false,
        hidden: true,
      },
    ];
    setTestObjectives(SCENARIO_DONGZHUO.id, testDefs);

    // Read the defs back through the same lookup the component uses, so the test
    // tracks the join path (no hard-coded key names beyond the registered table).
    const storyMode: StoryMode = { protagonistFactionId: 'liubei', chapter: 1 };
    const allDefs = objectivesFor(SCENARIO_DONGZHUO.id, storyMode);
    const visible = allDefs.filter((d) => !d.hidden);
    const hidden = allDefs.find((d) => d.hidden) as ObjectiveDef;
    expect(visible.length).toBeGreaterThanOrEqual(3);
    const [first, second, third] = visible;

    // Two active + one complete (plus the hidden one, also seeded to prove it is
    // filtered out of both the list and the completed-of-total count).
    const objectives: ObjectiveState[] = [
      { id: first.id, status: 'active' },
      { id: second.id, status: 'active' },
      { id: third.id, status: 'complete', completedTurn: 4 },
      { id: hidden.id, status: 'active' },
    ];
    const game: GameState = { ...base, scenarioId: SCENARIO_DONGZHUO.id, storyMode, objectives };

    render(<ObjectivesHud game={game} />);
    // The story guide is expanded by default (see the dedicated test below), so
    // the objective list is visible without interaction.

    // Both active objectives are listed by title, with no completion check.
    const firstTitle = screen.getByText(t(first.titleKey));
    const secondTitle = screen.getByText(t(second.titleKey));
    expect(firstTitle.closest('li')).not.toHaveTextContent('✓');
    expect(secondTitle.closest('li')).not.toHaveTextContent('✓');

    // The completed objective is listed and marked with a check.
    const thirdTitle = screen.getByText(t(third.titleKey));
    expect(thirdTitle.closest('li')).toHaveTextContent('✓');

    // The hidden objective is never surfaced.
    expect(screen.queryByText(t(hidden.titleKey))).toBeNull();

    // The pill header shows a 1/3 completed-of-total count (hidden excluded).
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  // Regression: the objectives HUD is the Story-Mode "guide". It must be visible
  // the moment the campaign map opens — not hidden behind a collapsed pill the
  // player has to discover and click. It stays user-collapsible.
  it('shows the objective list expanded by default, and stays collapsible', () => {
    newGame(SCENARIO_DONGZHUO, 'liubei', 1);
    const base = gameStore.getState().game as GameState;
    setTestObjectives(SCENARIO_DONGZHUO.id, [
      { id: 'obj-a', titleKey: 'menu.internalAffairs', descKey: 'menu.develop', check: () => false },
    ]);
    const storyMode: StoryMode = { protagonistFactionId: 'liubei', chapter: 1 };
    const objectives: ObjectiveState[] = [{ id: 'obj-a', status: 'active' }];
    const game: GameState = { ...base, scenarioId: SCENARIO_DONGZHUO.id, storyMode, objectives };

    render(<ObjectivesHud game={game} />);

    // No click needed: the objective title is on screen and the toggle reads open.
    expect(screen.getByText(t('menu.internalAffairs'))).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');

    // The player can still collapse it to clear the map.
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText(t('menu.internalAffairs'))).toBeNull();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });
});
