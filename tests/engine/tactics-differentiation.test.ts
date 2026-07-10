import { describe, expect, it } from 'vitest';
import { planTactical } from '../../src/engine/ai/tactics/plan.js';
import { simulateHeadless, type Matchup } from '../../src/engine/ai/tactics/balance.js';
import type { Battle, BattleUnit } from '../../src/engine/types.js';
import type { BattleField } from '../../src/engine/battle/types.js';

function fieldWithHill(): BattleField {
  const w = 12, h = 12;
  const heights = new Array(w * h).fill(0);
  const cells = new Array(w * h).fill('plain');
  cells[4 * w + 6] = 'hill';
  heights[4 * w + 6] = 0.8;
  return { width: w, height: h, heights, cells, seed: 2 };
}
function unit(over: Partial<BattleUnit> & Pick<BattleUnit, 'id' | 'factionId' | 'pos'>): BattleUnit {
  return { generalId: over.id, troops: 5000, troopType: 'infantry', morale: 100, hasActed: false,
    state: 'fielded', formationRole: 'center', ...over } as BattleUnit;
}
function battle(units: BattleUnit[]): Battle {
  return { cityId: 'c', attackerFactionId: 'A', defenderFactionId: 'B', daysElapsed: 0,
    units, field: fieldWithHill(), seed: 2, rngCursor: 2, log: [] };
}

describe('doctrine changes how an army fights', () => {
  it('a disciplined defender on the hill holds where an aggressive one presses', () => {
    // Defender block sits on the hill (6,4); enemy is 3 cells south (not adjacent).
    const mk = (wu: number, zhi: number, command: number) => battle([
      unit({ id: 'd', factionId: 'A', pos: { x: 6, y: 4 }, wu, zhi, command, troops: 5000 }),
      unit({ id: 'e', factionId: 'B', pos: { x: 6, y: 7 }, troops: 5000 }),
    ]);
    const disciplined = planTactical(mk(55, 92, 95), 'A', 'turtle');
    const aggressive = planTactical(mk(99, 25, 60), 'A', 'active');
    const holds = (cs: ReturnType<typeof planTactical>) => cs.filter((c) => c.kind === 'hold').length;
    expect(holds(disciplined)).toBeGreaterThan(holds(aggressive));
  });

  it('an aggressive cavalry commander charges more than a cautious one over a full battle', () => {
    const base: Omit<Matchup, 'attacker'> = { seed: 11,
      defender: { troops: 6000, wu: 70, zhi: 70, command: 80, personality: 'balanced' } };
    const aggressive = simulateHeadless({ ...base,
      attacker: { troops: 9000, troopType: 'cavalry', wu: 98, zhi: 25, command: 70, personality: 'active' } });
    const cautious = simulateHeadless({ ...base,
      attacker: { troops: 9000, troopType: 'cavalry', wu: 55, zhi: 80, command: 85, personality: 'turtle' } });
    expect(aggressive.leverCounts.charge ?? 0).toBeGreaterThan(cautious.leverCounts.charge ?? 0);
  });
});
