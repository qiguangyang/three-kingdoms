import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { GRID_SCALE } from '../../src/engine/constants.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { PERSONALITY_PRESETS } from '../../src/engine/ai/personality.js';
import {
  threatenedCityIds,
  isFactionThreatened,
  selectExpansionTarget,
  reassessStrategy,
  isStrategyStillValid,
} from '../../src/engine/ai/strategy.js';
import { makeTopology, siegeOp, attackMarchOp } from './_ai-fixtures.js';
import { factionPower, powerLeader, factionRankings } from '../../src/engine/selectors.js';
import type { FactionAgent, FactionStrategy, GameState } from '../../src/engine/types.js';
import { makeDefaultAgent } from '../../src/engine/ai/index.js';
import { advanceMonth } from '../../src/engine/turn.js';
import { tickDays } from '../../src/engine/pendingOp.js';
import { develop } from '../../src/engine/politics.js';

describe('GameState.aiStrategies', () => {
  it('buildInitialState seeds an empty aiStrategies map', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 1,
    });
    expect(state.aiStrategies).toEqual({});
  });
});

describe('personality presets', () => {
  it('expose the goal-oriented tuning knobs with sane ordering', () => {
    for (const key of ['active', 'balanced', 'turtle'] as const) {
      const p = PERSONALITY_PRESETS[key];
      expect(p.leaderBiasWeight).toBeGreaterThanOrEqual(0);
      expect(p.concentrationThreshold).toBeGreaterThan(1);
      expect(p.reinforceAggressiveness).toBeGreaterThan(0);
    }
    // Aggressive factions attack with less of an edge and gang up on #1 more.
    expect(PERSONALITY_PRESETS.active.concentrationThreshold).toBeLessThan(
      PERSONALITY_PRESETS.turtle.concentrationThreshold,
    );
    expect(PERSONALITY_PRESETS.active.leaderBiasWeight).toBeGreaterThan(
      PERSONALITY_PRESETS.turtle.leaderBiasWeight,
    );
  });
});

describe('threat detection', () => {
  it('flags a city that is under siege', () => {
    let state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 8000 },
    ]);
    state = { ...state, pendingOps: [siegeOp('luoyang', 'caocao')] };
    expect(threatenedCityIds(state, 'dongzhuo')).toContain('luoyang');
    expect(isFactionThreatened(state, 'dongzhuo')).toBe(true);
  });

  it('flags a city targeted by an inbound enemy attack-march', () => {
    let state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 8000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 8000 },
    ]);
    state = { ...state, pendingOps: [attackMarchOp('chenliu', 'luoyang', 'caocao')] };
    expect(threatenedCityIds(state, 'dongzhuo')).toContain('luoyang');
  });

  it('flags a city with a hostile neighbor holding a big garrison edge', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 2000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 9000 },
    ]);
    expect(threatenedCityIds(state, 'dongzhuo')).toContain('luoyang');
  });

  it('reports no threat for a quiet faction', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 8000 },
    ]);
    expect(isFactionThreatened(state, 'dongzhuo')).toBe(false);
  });

  it('does not flag a city targeted by a friendly reinforce-march', () => {
    let state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 8000 },
      { id: 'chenliu', factionId: 'dongzhuo', pos: { x: 12 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 8000 },
    ]);
    const op = { ...attackMarchOp('chenliu', 'luoyang', 'dongzhuo'), intent: 'reinforce' as const };
    state = { ...state, pendingOps: [op] };
    expect(isFactionThreatened(state, 'dongzhuo')).toBe(false);
  });

  it('does not flag garrison-overmatch for a far (base distance > 12) enemy neighbor', () => {
    // chenliu is within ADJACENCY_THRESHOLD (manhattan 16*GRID_SCALE <=
    // 18*GRID_SCALE) but beyond DIRECT_BORDER_DISTANCE (16*GRID_SCALE >
    // 12*GRID_SCALE), so its big garrison is not an imminent threat — it's a
    // multi-month march away, not on the doorstep. Both coords and thresholds
    // scale by GRID_SCALE, so the boundary classification is unchanged.
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 2000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 24 * GRID_SCALE, y: 12 * GRID_SCALE }, garrison: 9000 },
    ]);
    expect(isFactionThreatened(state, 'dongzhuo')).toBe(false);
  });
});

describe('expansion target selection', () => {
  // dongzhuo borders a weak caocao city and a strong yuanshao city.
  function bordersState() {
    return makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 10000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 500 },
      { id: 'puyang', factionId: 'yuanshao', pos: { x: 14 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 14000 },
    ]);
  }

  it('picks the softest bordering enemy city as the target', () => {
    const state = bordersState();
    const target = selectExpansionTarget(state, 'dongzhuo', PERSONALITY_PRESETS.turtle);
    expect(target?.targetCityId).toBe('chenliu');
    expect(target?.stagingCityId).toBe('luoyang');
  });

  it('biases toward the power leader when the bias weight is high', () => {
    const state = bordersState();
    // yuanshao holds the 14k-garrison city; its factionPower (19000) exceeds
    // dongzhuo's (15000) and caocao's (5500), so it is the current power leader.
    expect(powerLeader(state)).toBe('yuanshao');
    const target = selectExpansionTarget(state, 'dongzhuo', {
      ...PERSONALITY_PRESETS.active,
      leaderBiasWeight: 1,
    });
    expect(target?.targetFactionId).toBe('yuanshao');
  });

  it('returns null when the faction has no enemy-adjacent cities', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 10000 },
    ]);
    expect(selectExpansionTarget(state, 'dongzhuo', PERSONALITY_PRESETS.balanced)).toBeNull();
  });
});

describe('reassessStrategy', () => {
  function healthyBorders() {
    return makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 30000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 4000 },
    ]);
  }

  it('returns defend when a city is under siege', () => {
    let state = healthyBorders();
    state = { ...state, pendingOps: [siegeOp('luoyang', 'caocao')] };
    const s = reassessStrategy(
      { state, factionId: 'dongzhuo' },
      null,
      PERSONALITY_PRESETS.balanced,
    );
    expect(s.posture).toBe('defend');
  });

  it('returns consolidate when a city has collapsed loyalty', () => {
    let state = healthyBorders();
    state = {
      ...state,
      cities: {
        ...state.cities,
        luoyang: { ...state.cities['luoyang']!, loyalty: 10 },
      },
    };
    const s = reassessStrategy(
      { state, factionId: 'dongzhuo' },
      null,
      PERSONALITY_PRESETS.balanced,
    );
    expect(s.posture).toBe('consolidate');
  });

  it('returns expand with a target when healthy and bordering an enemy', () => {
    const state = healthyBorders();
    const s = reassessStrategy(
      { state, factionId: 'dongzhuo' },
      null,
      PERSONALITY_PRESETS.balanced,
    );
    expect(s.posture).toBe('expand');
    expect(s.targetCityId).toBe('chenliu');
    expect(s.stagingCityId).toBe('luoyang');
  });

  it('persists a still-valid expand strategy across reassessment', () => {
    const state = healthyBorders();
    const first = reassessStrategy(
      { state, factionId: 'dongzhuo' },
      null,
      PERSONALITY_PRESETS.balanced,
    );
    const second = reassessStrategy(
      { state, factionId: 'dongzhuo' },
      first,
      PERSONALITY_PRESETS.balanced,
    );
    expect(second).toBe(first);
  });

  it('drops a strategy whose target city we have already captured', () => {
    const state = healthyBorders();
    const stale: FactionStrategy = {
      posture: 'expand',
      targetFactionId: 'caocao',
      targetCityId: 'chenliu',
      stagingCityId: 'luoyang',
      updatedTurn: 0,
    };
    const captured = {
      ...state,
      cities: {
        ...state.cities,
        chenliu: { ...state.cities['chenliu']!, factionId: 'dongzhuo' },
      },
    };
    const s = reassessStrategy(
      { state: captured, factionId: 'dongzhuo' },
      stale,
      PERSONALITY_PRESETS.balanced,
    );
    expect(s.targetCityId).not.toBe('chenliu');
  });

  it('drops an expand strategy when staging and target are no longer adjacent', () => {
    // staging luoyang (base 10,10) and target chenliu (base 40,10) are
    // 30*GRID_SCALE apart — well beyond ADJACENCY_THRESHOLD (18*GRID_SCALE),
    // so no assault is possible.
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 30000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 40 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 4000 },
    ]);
    const stale: FactionStrategy = {
      posture: 'expand',
      targetFactionId: 'caocao',
      targetCityId: 'chenliu',
      stagingCityId: 'luoyang',
      updatedTurn: 0,
    };
    expect(isStrategyStillValid(state, 'dongzhuo', stale)).toBe(false);
  });
});

describe('makeDefaultAgent.reassess', () => {
  it('produces a strategy for the faction', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 30000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 4000 },
    ]);
    const agent = makeDefaultAgent('dongzhuo', 'balanced');
    const strategy = agent.reassess({ state, factionId: 'dongzhuo' }, null);
    // dongzhuo is strong, not threatened, has an adjacent weak enemy → expand.
    // A wrong factionId or params in the delegation would not produce this.
    expect(strategy.posture).toBe('expand');
    expect(strategy.targetCityId).toBe('chenliu');
  });
});

function buildAgents(state: GameState): Record<string, FactionAgent> {
  const agents: Record<string, FactionAgent> = {};
  for (const f of Object.values(state.factions)) {
    if (f.id === state.playerFactionId) continue;
    agents[f.id] = makeDefaultAgent(f.id, f.personality);
  }
  return agents;
}

describe('AI lifecycle wiring', () => {
  it('advanceMonth populates aiStrategies for non-player factions', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 12,
    });
    state = advanceMonth(state, buildAgents(state));
    const aiFactionIds = Object.values(state.factions)
      .filter((f) => f.id !== state.playerFactionId && f.alive)
      .map((f) => f.id);
    const populated = aiFactionIds.filter((id) => state.aiStrategies[id]);
    // Every alive non-player faction must get a strategy — not just some.
    expect(populated.length).toBe(aiFactionIds.length);
    expect(aiFactionIds.length).toBeGreaterThan(0);
  });

  it('tickDays populates aiStrategies on month rollover', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 12,
    });
    const agents = buildAgents(state);
    state = tickDays(state, 31, agents); // cross one month boundary
    const aiFactionIds = Object.values(state.factions)
      .filter((f) => f.id !== state.playerFactionId && f.alive)
      .map((f) => f.id);
    const populated = aiFactionIds.filter((id) => state.aiStrategies[id]);
    expect(populated.length).toBe(aiFactionIds.length);
    expect(aiFactionIds.length).toBeGreaterThan(0);
  });
});

describe('factionRankings', () => {
  it('ranks every faction by power, strongest first, with 1-based rank', () => {
    const state = makeTopology([
      { id: 'luoyang', factionId: 'dongzhuo', pos: { x: 10 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 90000 },
      { id: 'chenliu', factionId: 'caocao', pos: { x: 12 * GRID_SCALE, y: 10 * GRID_SCALE }, garrison: 1000 },
    ]);
    const rankings = factionRankings(state);
    expect(rankings.length).toBe(Object.keys(state.factions).length);
    expect(rankings[0]!.factionId).toBe('dongzhuo');
    expect(rankings[0]!.rank).toBe(1);
    // Power must be non-increasing down the list.
    for (let i = 1; i < rankings.length; i++) {
      expect(rankings[i - 1]!.power).toBeGreaterThanOrEqual(rankings[i]!.power);
    }
  });
});

describe('log faction tagging', () => {
  it('tags an internal-affairs log entry with the city owner faction', () => {
    const base = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 13,
    });
    const luoyang = base.cities['luoyang']!;
    const governor = luoyang.generals[0]!;
    const next = develop(base, { cityId: 'luoyang', generalId: governor });
    const entry = next.log[next.log.length - 1]!;
    expect(entry.key).toBe('result.developed');
    expect(entry.factionId).toBe(luoyang.factionId);
  });
});
