import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { scheduleOp, tickDays } from '../../src/engine/pendingOp.js';
import { makeDefaultAgent } from '../../src/engine/ai/index.js';
import type { FactionAgent, GameState } from '../../src/engine/types.js';

function agentsFor(s: GameState): Record<string, FactionAgent> {
  const a: Record<string, FactionAgent> = {};
  for (const f of Object.values(s.factions)) a[f.id] = makeDefaultAgent(f.id, f.personality);
  return a;
}

// Force a siege op that completes on the next day for the given attacker.
// scheduleOp expects kind-specific fields nested under `payload` (matching
// the real NewOp shape used throughout pendingOp.ts); it computes
// `daysRemaining` from `durationDays` itself, so durationDays: 1 is enough
// to make the op complete on the next tick.
function withImminentSiege(s: GameState, attacker: string, targetCityId: string, generalIds: string[]): GameState {
  return scheduleOp(s, {
    kind: 'siege',
    factionId: attacker,
    durationDays: 1,
    payload: { targetCityId, generalIds, troops: 12000 },
  });
}

describe('player-siege deferral', () => {
  it('sets pendingBattle and halts ticking when the player is the attacker (defer on)', () => {
    const s0 = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 7 });
    const enemyCity = Object.values(s0.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
    const s = withImminentSiege(s0, 'caocao', enemyCity.id, ['caocao']);
    const next = tickDays(s, 3, agentsFor(s), { deferPlayerBattles: true });
    expect(next.pendingBattle).toBeDefined();
    expect(next.pendingBattle!.cityId).toBe(enemyCity.id);
    // Ownership NOT yet flipped — the battle screen owes the resolution.
    expect(next.cities[enemyCity.id]!.factionId).toBe(enemyCity.factionId);
  });

  it('does NOT defer when the flag is off (existing behavior preserved)', () => {
    const s0 = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 7 });
    const enemyCity = Object.values(s0.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
    const s = withImminentSiege(s0, 'caocao', enemyCity.id, ['caocao']);
    const next = tickDays(s, 3, agentsFor(s)); // no options
    expect(next.pendingBattle).toBeUndefined();
  });

  it('AI-vs-AI siege never defers even with the flag on', () => {
    const s0 = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 7 });
    const aiA = Object.values(s0.factions).find((f) => f.id !== 'caocao')!;
    const targetCity = Object.values(s0.cities).find((c) => c.factionId && c.factionId !== 'caocao' && c.factionId !== aiA.id)!;
    const s = withImminentSiege(s0, aiA.id, targetCity.id, [aiA.lordId]);
    const next = tickDays(s, 3, agentsFor(s), { deferPlayerBattles: true });
    expect(next.pendingBattle).toBeUndefined();
  });
});
