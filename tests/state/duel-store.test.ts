import { afterEach, describe, expect, it } from 'vitest';
import { newGame, gameStore, resolveDuel } from '../../src/state/store.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import type { GameState } from '../../src/engine/types.js';

afterEach(() => {
  // reset store to a clean game between tests
  newGame(SCENARIO_DONGZHUO, 'liubei', 1);
});

function setPendingDuel(): void {
  newGame(SCENARIO_DONGZHUO, 'liubei', 1);
  gameStore.setState((s) => ({
    ...s,
    game: { ...(s.game as GameState), pendingDuel: { duelId: 'hulaoguan' } },
    ui: { ...s.ui, screen: { kind: 'duel' } },
  }));
}

describe('resolveDuel', () => {
  it('records a win, clears the pending duel, and leaves the campaign screen', () => {
    setPendingDuel();
    resolveDuel('win');
    const s = gameStore.getState();
    expect((s.game as GameState).duelResults.hulaoguan).toBe('win');
    expect((s.game as GameState).pendingDuel).toBeUndefined();
    expect(s.ui.screen.kind).not.toBe('duel'); // routed back into the campaign
  });
  it('records a loss without dead-ending (still returns to the campaign)', () => {
    setPendingDuel();
    resolveDuel('lose');
    const s = gameStore.getState();
    expect((s.game as GameState).duelResults.hulaoguan).toBe('lose');
    expect((s.game as GameState).pendingDuel).toBeUndefined();
    expect(['main', 'story', 'chapterTransition', 'chapterComplete', 'gameOver']).toContain(s.ui.screen.kind);
  });
});
