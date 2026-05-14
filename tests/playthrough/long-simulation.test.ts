import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { advanceMonth, checkOutcome } from '../../src/engine/turn.js';
import { makeDefaultAgent } from '../../src/engine/ai/index.js';
import type { FactionAgent } from '../../src/engine/types.js';

function buildAgents(state: ReturnType<typeof buildInitialState>) {
  const agents: Record<string, FactionAgent> = {};
  for (const f of Object.values(state.factions)) {
    if (f.id === state.playerFactionId) continue;
    agents[f.id] = makeDefaultAgent(f.id, f.personality);
  }
  return agents;
}

describe('multi-month simulation', () => {
  it('60-month run produces no crashes and progresses the calendar', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 101,
    });
    for (let i = 0; i < 60; i++) {
      state = advanceMonth(state, buildAgents(state));
    }
    expect(state.turn).toBe(60);
    // 9 + 60 = 69 -> 189 + floor(68/12) = 194, month = ((69-1)%12)+1 = 9
    expect(state.year).toBeGreaterThanOrEqual(193);
    expect(state.year).toBeLessThanOrEqual(195);
  });

  it('all four sample factions complete a 24-month playthrough', () => {
    for (const fid of ['dongzhuo', 'caocao', 'liubei', 'sunjian']) {
      let state = buildInitialState({
        scenario: SCENARIO_DONGZHUO,
        playerFactionId: fid,
        refData: REF_DATA,
        seed: 200 + fid.length,
      });
      for (let i = 0; i < 24; i++) {
        state = advanceMonth(state, buildAgents(state));
      }
      expect(state.turn).toBe(24);
      // Player faction should still be valid (alive or not, but state intact).
      expect(state.factions[fid]).toBeDefined();
    }
  });

  it('Guandong coalition fires once, exactly', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 102,
    });
    for (let i = 0; i < 24; i++) {
      state = advanceMonth(state, buildAgents(state));
    }
    const coalition = state.events.filter((e) => e.id === 'guandong_coalition');
    expect(coalition.length).toBe(1);
  });

  it('AI produces variety of actions over time', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 103,
    });
    for (let i = 0; i < 18; i++) {
      state = advanceMonth(state, buildAgents(state));
    }
    const cmdKinds = new Set(state.actionLog.map((a) => a.command.kind));
    // We expect a mix of internal-affairs and military commands across the
    // run; at minimum more than just endTurn.
    expect(cmdKinds.size).toBeGreaterThan(1);
  });

  it('an empty-handed faction is marked dead when it loses every city', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 104,
    });
    // Forcibly strip Kong Rong of his city.
    state = {
      ...state,
      cities: {
        ...state.cities,
        beihai: { ...state.cities['beihai']!, factionId: null },
      },
    };
    state = advanceMonth(state, buildAgents(state));
    expect(state.factions['kongrong']!.alive).toBe(false);
  });

  it('checkOutcome reports defeat once the player faction holds no cities', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'gongsundu',
      refData: REF_DATA,
      seed: 105,
    });
    state = {
      ...state,
      cities: {
        ...state.cities,
        xiangping: { ...state.cities['xiangping']!, factionId: null },
      },
    };
    state = advanceMonth(state, buildAgents(state));
    expect(checkOutcome(state)).toBe('defeat');
  });

  it('checkOutcome reports victory when player holds every city', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 106,
    });
    // Hand every city to Dong Zhuo.
    const conquered = { ...state.cities };
    for (const c of Object.values(conquered)) {
      conquered[c.id] = { ...c, factionId: 'dongzhuo' };
    }
    state = { ...state, cities: conquered };
    expect(checkOutcome(state)).toBe('victory');
  });

  it('AI factions run multi-month campaigns (a target persists >= 3 months)', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 303,
    });
    // Track, per faction, the longest run of identical non-null targetCityId.
    const streak: Record<string, number> = {};
    const best: Record<string, number> = {};
    const lastTarget: Record<string, string | null> = {};
    for (let i = 0; i < 36; i++) {
      state = advanceMonth(state, buildAgents(state));
      for (const [fid, strat] of Object.entries(state.aiStrategies)) {
        const tgt = strat.targetCityId;
        if (tgt && lastTarget[fid] === tgt) {
          streak[fid] = (streak[fid] ?? 1) + 1;
        } else {
          streak[fid] = tgt ? 1 : 0;
        }
        lastTarget[fid] = tgt;
        best[fid] = Math.max(best[fid] ?? 0, streak[fid] ?? 0);
      }
    }
    const longest = Math.max(0, ...Object.values(best));
    expect(longest).toBeGreaterThanOrEqual(3);
  });

  it('AI concentrates force (emits move commands over a long run)', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 304,
    });
    for (let i = 0; i < 36; i++) {
      state = advanceMonth(state, buildAgents(state));
    }
    const aiMoves = state.actionLog.filter(
      (a) => a.factionId !== 'liubei' && a.command.kind === 'move',
    );
    expect(aiMoves.length).toBeGreaterThan(0);
  });
});
