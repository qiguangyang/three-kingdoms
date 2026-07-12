import { describe, expect, it, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DuelOutcome, DuelState } from '../../../src/duel/types.js';
import { t } from '../../../src/i18n/locale.js';

// Force the WebGL branch of DuelScreen and stub the heavy Three.js canvas so the
// React flow — scene NOTIFIES an outcome → Victory/Defeat overlay → Continue →
// resolveDuel — is exercisable under jsdom (which has no real WebGL context).
// The stub exposes a button that invokes onOutcome and otherwise ignores
// onFrame, standing in for the real DuelCanvas/DuelScene. Crucially, the stub
// does NOT itself call resolveDuel, mirroring the production scene: onOutcome is
// a one-shot notification, and routing back is deferred to the Continue press.
vi.mock('../../../src/web/gfx/hasWebGL.js', () => ({ hasWebGL: () => true }));
vi.mock('../../../src/web/duel/DuelCanvas.js', () => ({
  DuelCanvas: ({
    onOutcome,
  }: {
    onOutcome: (outcome: DuelOutcome) => void;
    onFrame: (state: DuelState) => void;
  }) => (
    <button data-testid="fire-outcome" onClick={() => onOutcome('win')}>
      fire outcome
    </button>
  ),
}));

// Imported AFTER the mocks so DuelScreen picks up the stubbed WebGL + canvas.
import { DuelScreen } from '../../../src/web/duel/DuelScreen.js';
import { gameStore, newGame } from '../../../src/state/store.js';
import { SCENARIO_DONGZHUO } from '../../../src/data/scenarios/s1-dongzhuo.js';
import type { GameState } from '../../../src/engine/types.js';

function armPendingDuel(): void {
  newGame(SCENARIO_DONGZHUO, 'liubei', 1);
  gameStore.setState((s) => ({
    ...s,
    game: { ...(s.game as GameState), pendingDuel: { duelId: 'hulaoguan' } },
    ui: { ...s.ui, screen: { kind: 'duel' } },
  }));
}

beforeEach(armPendingDuel);

describe('DuelScreen — WebGL result overlay flow', () => {
  it('shows no result overlay until the scene reports an outcome', () => {
    render(<DuelScreen />);
    expect(screen.queryByText(t('duel.result.win'))).not.toBeInTheDocument();
    expect(screen.queryByText(t('duel.result.lose'))).not.toBeInTheDocument();
  });

  it('raises the Victory overlay on outcome WITHOUT resolving the duel', () => {
    render(<DuelScreen />);

    // The scene reports the duel is decided (its one-shot onOutcome).
    fireEvent.click(screen.getByTestId('fire-outcome'));

    // The Victory card shows — but the duel is NOT yet resolved: pendingDuel is
    // still armed and the screen has not routed away, so the scene keeps
    // rendering the settled final pose behind the card until the player acts.
    expect(screen.getByText(t('duel.result.win'))).toBeInTheDocument();
    expect(gameStore.getState().game?.pendingDuel).toBeDefined();
    expect(gameStore.getState().ui.screen.kind).toBe('duel');
  });

  it('routes back into the campaign only when Continue is pressed', () => {
    render(<DuelScreen />);
    fireEvent.click(screen.getByTestId('fire-outcome'));

    // Deliberate dismissal: Continue resolves the duel and routes onward.
    fireEvent.click(screen.getByRole('button', { name: t('app.continue') }));

    const s = gameStore.getState();
    expect((s.game as GameState).duelResults.hulaoguan).toBe('win');
    expect((s.game as GameState).pendingDuel).toBeUndefined();
    expect(s.ui.screen.kind).not.toBe('duel'); // routed back into the campaign
  });
});
