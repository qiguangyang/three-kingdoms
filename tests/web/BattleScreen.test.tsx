import { describe, expect, it } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { createBattle } from '../../src/engine/battle/setup.js';
import { gameStore, loadGame } from '../../src/state/store.js';
import { BattleScreen } from '../../src/web/battle/BattleScreen.js';
import { pendingPivotalDecision } from '../../src/state/battleSession.js';
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

// Seed a battle where the player is DEFENDING with a small garrison held partly
// in reserve, against a much larger Cao Cao expedition. That gives the player a
// reserve in hand while advantage < 1.0, so pendingPivotalDecision (Commit
// Reserves) is salient — the exact condition that must pause auto-play.
function enterSalientBattle(): void {
  const s = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 100 });
  const target = Object.values(s.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
  const held = {
    ...s,
    playerFactionId: target.factionId!,
    cities: { ...s.cities, [target.id]: { ...target, garrison: 800, generals: [] } },
  };
  const battle = createBattle(held, {
    cityId: target.id, attackerFactionId: 'caocao', defenderFactionId: target.factionId!,
    attackingGeneralIds: ['caocao', 'xiahoudun'], attackingTroops: 20000,
  });
  loadGame({ game: { ...held, pendingBattle: battle }, locale: 'zh' });
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

  it('renders a hero lever (Challenge Duel) when a hero decision is offered', () => {
    enterBattle();
    // The maneuver tray renders ANY OfferedDecision. Inject a hero (Challenge
    // Duel) lever the way the tactics detector surfaces one and assert its label
    // shows (zh 'Challenge Duel' == 单挑).
    const session = gameStore.getState().battle!;
    gameStore.setState((s) => ({
      ...s,
      battle: {
        ...session,
        offeredDecisions: [
          { id: 'challengeDuel:foe', family: 'hero', labelKey: 'battle.decision.challengeDuel', salient: true, commands: [] },
        ],
      },
    }));
    const { getAllByText } = render(<BattleScreen />);
    expect(getAllByText(t('battle.decision.challengeDuel')).length).toBeGreaterThan(0);
  });

  it('narrates a rally on a day whose events include a rally', () => {
    enterBattle();
    // Stage a resolved day whose events include a rally (a general steadying a
    // wavering block). The per-day effect must surface the rally narration line
    // (battle.narr.rally) rather than falling back to the generic deploy line.
    const session = gameStore.getState().battle!;
    const unitId = session.battle.units[0]?.id ?? 'u0';
    gameStore.setState((s) => ({
      ...s,
      battle: {
        ...session,
        phase: 'awaitingOrders',
        lastEvents: [{ kind: 'rally', unitId, targetUnitId: unitId, morale: 5 }],
      },
    }));
    const { getByText } = render(<BattleScreen />);
    // Close the intro card so the documentary narration subtitle is on screen.
    fireEvent.click(getByText(t('battle.intro.begin')));
    expect(getByText(t('battle.narr.rally'))).toBeInTheDocument();
  });

  it('shows the pivotal prompt (Continue watching) while auto-playing on a salient decision', async () => {
    enterSalientBattle();
    const session = gameStore.getState().battle!;
    // Precondition: the seeded battle really does have a salient pending decision.
    expect(pendingPivotalDecision(session)).not.toBeNull();
    const { getByText, findByText } = render(<BattleScreen />);
    // Begin the battle to turn on auto-play (zh 'Begin' — battle.intro.begin).
    fireEvent.click(getByText(t('battle.intro.begin')));
    // Auto-play pauses on the salient decision and surfaces the "Continue
    // watching" resume (zh '继续观战' — battle.decision.continue).
    expect(await findByText(t('battle.decision.continue'))).toBeInTheDocument();
  });
});
