import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { createBattle } from '../../src/engine/battle/setup.js';
import { gameStore, loadGame, finishBattle, quickResolveBattle, chooseBattleDecision } from '../../src/state/store.js';

function seedWithPendingBattle() {
  const s = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 100 });
  const target = Object.values(s.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
  const weak = { ...s, cities: { ...s.cities, [target.id]: { ...target, garrison: 500, generals: [] } } };
  const battle = createBattle(weak, {
    cityId: target.id, attackerFactionId: 'caocao', defenderFactionId: target.factionId!,
    attackingGeneralIds: ['caocao', 'xiahoudun'], attackingTroops: 20000,
  });
  return { game: { ...weak, pendingBattle: battle }, targetId: target.id };
}

describe('battle store integration', () => {
  it('loadGame with a pending battle routes to the battle screen + sets the slice', () => {
    const { game } = seedWithPendingBattle();
    loadGame({ game, locale: 'zh' });
    expect(gameStore.getState().ui.screen.kind).toBe('battle');
    expect(gameStore.getState().battle).not.toBeNull();
  });

  it('quickResolve then finishBattle applies the outcome and returns to main/gameOver', () => {
    const { game } = seedWithPendingBattle();
    loadGame({ game, locale: 'zh' });
    quickResolveBattle();
    expect(gameStore.getState().battle!.phase).toBe('resolved');
    finishBattle();
    const st = gameStore.getState();
    expect(st.battle).toBeNull();
    expect(st.game!.pendingBattle).toBeUndefined();
    expect(['main', 'gameOver']).toContain(st.ui.screen.kind);
  });

  it('chooseBattleDecision queues the chosen decision\'s orders into the live session', () => {
    const { game } = seedWithPendingBattle();
    loadGame({ game, locale: 'zh' });
    const before = gameStore.getState().battle!;
    // The seeded siege always offers at least a focus-fire decision; prefer it,
    // but fall back to any offered decision so the assertion stays meaningful.
    expect(before.offeredDecisions.length).toBeGreaterThan(0);
    const decision = before.offeredDecisions.find((d) => d.id.startsWith('focusFire')) ?? before.offeredDecisions[0];
    chooseBattleDecision(decision.id);
    const after = gameStore.getState().battle!;
    expect(after.queuedPlayerCommands.length).toBeGreaterThan(before.queuedPlayerCommands.length);
  });
});
