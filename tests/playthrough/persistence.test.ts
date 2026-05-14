import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { advanceMonth } from '../../src/engine/turn.js';
import { makeDefaultAgent } from '../../src/engine/ai/index.js';
import {
  autosave,
  listSlots,
  loadFromSlot,
  saveToSlot,
} from '../../src/state/persistence.js';

describe('save / load / autosave (localStorage)', () => {
  it('save then load round-trips the full GameState', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'sunjian',
      refData: REF_DATA,
      seed: 401,
    });
    const agents: Record<string, ReturnType<typeof makeDefaultAgent>> = {};
    for (const f of Object.values(state.factions)) {
      if (f.id === 'sunjian') continue;
      agents[f.id] = makeDefaultAgent(f.id, f.personality);
    }
    for (let i = 0; i < 6; i++) state = advanceMonth(state, agents);

    saveToSlot('slot1', state, 'zh');
    const loaded = loadFromSlot('slot1');
    expect(loaded.state.turn).toBe(state.turn);
    expect(loaded.state.year).toBe(state.year);
    expect(loaded.state.month).toBe(state.month);
    expect(loaded.state.rngState).toBe(state.rngState);
    expect(Object.keys(loaded.state.cities).length).toBe(Object.keys(state.cities).length);
    expect(loaded.locale).toBe('zh');
  });

  it('listSlots reports the file we just wrote', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 402,
    });
    saveToSlot('slot3', state, 'en');
    const slots = listSlots();
    const found = slots.find((s) => s.slot === 'slot3');
    expect(found?.exists).toBe(true);
    expect(found?.scenarioId).toBe('s1-dongzhuo');
  });

  it('autosave keeps at most the five most recent autosaves', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 403,
    });
    for (let i = 0; i < 8; i++) {
      state = { ...state, year: 180 + i };
      autosave(state, 'zh');
      // Vary savedAt by introducing a small async gap implicitly through Date.now.
    }
    const autos = listSlots().filter((s) => s.slot.startsWith('autosave-'));
    expect(autos.length).toBeLessThanOrEqual(5);
  });
});

describe('replay determinism', () => {
  it('two runs with the same seed produce identical states', () => {
    function play(seed: number) {
      let state = buildInitialState({
        scenario: SCENARIO_DONGZHUO,
        playerFactionId: 'dongzhuo',
        refData: REF_DATA,
        seed,
      });
      const agents: Record<string, ReturnType<typeof makeDefaultAgent>> = {};
      for (const f of Object.values(state.factions)) {
        if (f.id === 'dongzhuo') continue;
        agents[f.id] = makeDefaultAgent(f.id, f.personality);
      }
      for (let i = 0; i < 18; i++) state = advanceMonth(state, agents);
      return state;
    }
    const a = play(999);
    const b = play(999);
    expect(a.turn).toBe(b.turn);
    expect(a.rngState).toBe(b.rngState);
    expect(JSON.stringify(a.cities)).toBe(JSON.stringify(b.cities));
    expect(JSON.stringify(a.generals)).toBe(JSON.stringify(b.generals));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });
});
