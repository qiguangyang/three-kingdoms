import { describe, expect, it } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { createBattle } from '../../src/engine/battle/setup.js';
import { gameStore, loadGame } from '../../src/state/store.js';
import { BattleScreen } from '../../src/web/battle/BattleScreen.js';
import { t } from '../../src/i18n/locale.js';

function enterBattle() {
  const s = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 100 });
  const target = Object.values(s.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
  const weak = { ...s, cities: { ...s.cities, [target.id]: { ...target, garrison: 500, generals: [] } } };
  const battle = createBattle(weak, {
    cityId: target.id, attackerFactionId: 'caocao', defenderFactionId: target.factionId!,
    attackingGeneralIds: ['caocao', 'xiahoudun'], attackingTroops: 20000,
  });
  loadGame({ game: { ...weak, pendingBattle: battle }, locale: 'zh' });
}

describe('BattleScreen', () => {
  it('renders the HUD + decision controls for an active battle', () => {
    enterBattle();
    const { getAllByText } = render(<BattleScreen />);
    expect(getAllByText(t('battle.attackers')).length).toBeGreaterThan(0);
    expect(getAllByText(t('battle.quickResolve')).length).toBeGreaterThan(0);
    expect(getAllByText(t('battle.advanceDay')).length).toBeGreaterThan(0);
  });

  it('quick-resolve resolves the battle and reveals the finish control', () => {
    enterBattle();
    const { getByText, getAllByText } = render(<BattleScreen />);
    fireEvent.click(getByText(t('battle.quickResolve')));
    expect(gameStore.getState().battle!.phase).toBe('resolved');
    expect(getAllByText(t('battle.finish')).length).toBeGreaterThan(0);
  });

  it('renders the maneuver lever tray for the offered decisions', () => {
    enterBattle();
    const { getAllByText } = render(<BattleScreen />);
    // Focus Fire is always offered when the player has units and an enemy exists
    // (default test locale is zh -> '集火猛攻').
    expect(getAllByText(t('battle.decision.focusFire')).length).toBeGreaterThan(0);
  });
});
