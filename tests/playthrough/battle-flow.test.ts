import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { adjacentCities } from '../../src/engine/map.js';
import {
  advanceDays,
  finishBattle,
  gameStore,
  loadGame,
  quickResolveBattle,
  schedulePlayer,
} from '../../src/state/store.js';

describe('battle flow — schedule attack -> battle screen -> resolve -> map', () => {
  it('a player attack routes through the battle screen and applies the outcome', () => {
    // Seed a state where caocao borders a weak enemy city.
    const s = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 55 });
    const home = Object.values(s.cities).find((c) => c.factionId === 'caocao' && c.generals.length > 0)!;
    const target = adjacentCities(s, home.id).find((c) => c.factionId && c.factionId !== 'caocao');
    if (!target) return; // scenario-dependent; skip if no adjacent enemy
    const weak = {
      ...s,
      cities: {
        ...s.cities,
        [target.id]: { ...s.cities[target.id]!, garrison: 400, generals: [] },
        [home.id]: { ...home, garrison: 25000 },
      },
    };
    loadGame({ game: weak, locale: 'zh' });

    // Schedule the attack via the same command the UI issues, then advance.
    schedulePlayer({ kind: 'attack', fromCityId: home.id, toCityId: target.id, generalIds: home.generals.slice(0, 2), troops: 20000 });
    // Advance enough days for the march + siege to complete.
    for (let i = 0; i < 20 && gameStore.getState().ui.screen.kind !== 'battle'; i++) advanceDays(7);

    expect(gameStore.getState().ui.screen.kind).toBe('battle');
    quickResolveBattle();
    finishBattle();
    const st = gameStore.getState();
    expect(st.ui.screen.kind === 'main' || st.ui.screen.kind === 'gameOver').toBe(true);
    expect(st.game!.pendingBattle).toBeUndefined();
  });
});
