import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { resolveQuickBattle, tryDuel } from '../../src/engine/combat.js';
import { advanceMonth, applyCommand } from '../../src/engine/turn.js';
import { makeDefaultAgent } from '../../src/engine/ai/index.js';
import type { FactionAgent } from '../../src/engine/types.js';

describe('combat flow', () => {
  it('overwhelming force on an empty city captures it', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 31,
    });
    // Make Pingyuan a neutral, near-empty city for a clean capture.
    const tampered = {
      ...s0,
      cities: {
        ...s0.cities,
        pingyuan: {
          ...s0.cities['pingyuan']!,
          factionId: null,
          garrison: 500,
          generals: [],
        },
      },
    };
    const result = resolveQuickBattle({
      state: tampered,
      attackerFactionId: 'caocao',
      defenderFactionId: '__neutral__',
      attackingGeneralIds: ['caocao', 'xiahoudun', 'xiahouyuan'],
      attackingTroops: 8000,
      cityId: 'pingyuan',
    });
    expect(result.attackerWon).toBe(true);
    expect(result.state.cities['pingyuan']!.factionId).toBe('caocao');
  });

  it('hopelessly outnumbered attack fails (Liu Bei vs fortified Luoyang)', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 32,
    });
    const result = resolveQuickBattle({
      state: s0,
      attackerFactionId: 'liubei',
      defenderFactionId: 'dongzhuo',
      attackingGeneralIds: ['liubei', 'guanyu', 'zhangfei'],
      attackingTroops: 1500,
      cityId: 'luoyang',
    });
    expect(result.attackerWon).toBe(false);
    expect(result.state.cities['luoyang']!.factionId).toBe('dongzhuo');
  });

  it('duel between high-wu generals can fire and produce a winner', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 33,
    });
    // Re-roll the duel until it triggers (probability is 0.8).
    let state = s0;
    let triggered = false;
    for (let i = 0; i < 50 && !triggered; i++) {
      const r = tryDuel({ state, a: 'lvbu', b: 'zhangfei' });
      if (r && r.triggered) {
        triggered = true;
        // Lu Bu has wu 100, Zhang Fei wu 96 — Lu Bu wins more often than not.
        expect(['lvbu', 'zhangfei']).toContain(r.winner);
        break;
      }
      if (r) state = r.state;
    }
    expect(triggered).toBe(true);
  });

  it('applyCommand attack reduces origin garrison and moves generals out', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 34,
    });
    // Reset target to be capturable.
    const tampered = {
      ...s0,
      cities: {
        ...s0.cities,
        puyang: { ...s0.cities['puyang']!, factionId: null, garrison: 500, generals: [] },
      },
    };
    const after = applyCommand(tampered, 'caocao', {
      kind: 'attack',
      fromCityId: 'chenliu',
      toCityId: 'puyang',
      generalIds: ['caocao', 'xiahoudun'],
      troops: 4000,
    });
    expect(after.cities['chenliu']!.garrison).toBeLessThan(tampered.cities['chenliu']!.garrison);
    expect(after.cities['chenliu']!.generals).not.toContain('caocao');
  });

  it('retreating attackers return to the origin city after a failed assault', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 36,
    });
    // Force the target to be a strong defender so the attack fails.
    const tampered = {
      ...s0,
      cities: {
        ...s0.cities,
        yecheng: { ...s0.cities['yecheng']!, garrison: 50000 },
      },
    };
    const after = applyCommand(tampered, 'liubei', {
      kind: 'attack',
      fromCityId: 'pingyuan',
      toCityId: 'yecheng',
      generalIds: ['guanyu', 'zhangfei'],
      troops: 2000,
    });
    // Generals shouldn't be stranded — they retreat to pingyuan.
    const guanyu = after.generals['guanyu']!;
    const zhangfei = after.generals['zhangfei']!;
    expect(guanyu.locationCityId).toBe('pingyuan');
    expect(zhangfei.locationCityId).toBe('pingyuan');
    expect(after.cities['pingyuan']!.generals).toContain('guanyu');
    expect(after.cities['pingyuan']!.generals).toContain('zhangfei');
    // Yecheng remains Yuan Shao's.
    expect(after.cities['yecheng']!.factionId).toBe('yuanshao');
  });

  it('wounded generals recover to active duty within a few months', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: 37,
    });
    // Wound a general directly.
    state = {
      ...state,
      generals: {
        ...state.generals,
        guanyu: { ...state.generals['guanyu']!, status: 'wounded', locationCityId: null },
      },
    };
    const agents: Record<string, FactionAgent> = {};
    for (const f of Object.values(state.factions)) {
      if (f.id === 'liubei') continue;
      agents[f.id] = makeDefaultAgent(f.id, f.personality);
    }
    let recovered = false;
    for (let i = 0; i < 12 && !recovered; i++) {
      state = advanceMonth(state, agents);
      if (state.generals['guanyu']!.status === 'active') recovered = true;
    }
    expect(recovered).toBe(true);
    // And they should be re-stationed at a faction-owned city.
    expect(state.generals['guanyu']!.locationCityId).not.toBeNull();
  });

  it('player cannot attack their own city (no-op)', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 35,
    });
    const after = applyCommand(s0, 'dongzhuo', {
      kind: 'attack',
      fromCityId: 'luoyang',
      toCityId: 'changan',
      generalIds: ['lvbu'],
      troops: 5000,
    });
    expect(after.cities['changan']!.factionId).toBe('dongzhuo');
    expect(after.cities['luoyang']!.garrison).toBe(s0.cities['luoyang']!.garrison);
  });
});
