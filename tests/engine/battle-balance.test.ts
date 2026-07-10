import { describe, expect, it } from 'vitest';
import { simulateHeadless, runBalanceSweep, type Matchup } from '../../src/engine/ai/tactics/balance.js';

const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('battle balance harness', () => {
  it('every battle terminates within the 30-day limit', () => {
    for (const seed of seeds) {
      const r = simulateHeadless({ seed,
        attacker: { troops: 6000, wu: 80, zhi: 60, command: 75, personality: 'balanced' },
        defender: { troops: 6000, wu: 80, zhi: 60, command: 75, personality: 'balanced' } });
      expect(r.days).toBeLessThanOrEqual(30);
    }
  });

  it('a 2x quality+numbers advantage wins the clear majority of seeds', () => {
    const matchups: Matchup[] = seeds.map((seed) => ({ seed,
      attacker: { troops: 12000, wu: 95, zhi: 80, command: 90, personality: 'active' },
      defender: { troops: 6000, wu: 60, zhi: 55, command: 60, personality: 'balanced' } }));
    const sweep = runBalanceSweep(matchups);
    expect(sweep.attackerWinRate).toBeGreaterThanOrEqual(0.7);
  });

  it('an even matchup is not a foregone conclusion (upsets happen both ways)', () => {
    const matchups: Matchup[] = seeds.map((seed) => ({ seed,
      attacker: { troops: 6000, wu: 78, zhi: 60, command: 72, personality: 'balanced' },
      defender: { troops: 6000, wu: 78, zhi: 60, command: 72, personality: 'balanced' } }));
    const sweep = runBalanceSweep(matchups);
    expect(sweep.attackerWinRate).toBeGreaterThan(0.1);
    expect(sweep.attackerWinRate).toBeLessThan(0.9);
  });

  it('the maneuver levers are reachable: hold, commitReserves, and charge each fire somewhere in a sweep', () => {
    // A cautious defender with reserves on a hill vs an aggressive cavalry attacker
    // exercises hold (defender), commitReserves (loser), and charge (attacker).
    const matchups: Matchup[] = seeds.map((seed) => ({ seed,
      attacker: { troops: 14000, troopType: 'cavalry', wu: 96, zhi: 30, command: 70, personality: 'active' },
      defender: { troops: 5000, wu: 55, zhi: 90, command: 92, personality: 'turtle' } }));
    const sweep = runBalanceSweep(matchups);
    expect(sweep.leverTotals.hold ?? 0).toBeGreaterThan(0);
    expect(sweep.leverTotals.charge ?? 0).toBeGreaterThan(0);
    expect(sweep.leverTotals.commitReserves ?? 0).toBeGreaterThan(0);
  });

  it('is deterministic for a given matchup', () => {
    const m: Matchup = { seed: 42,
      attacker: { troops: 8000, wu: 85, zhi: 70, command: 80, personality: 'active' },
      defender: { troops: 7000, wu: 70, zhi: 75, command: 85, personality: 'turtle' } };
    expect(simulateHeadless(m)).toEqual(simulateHeadless(m));
  });

  it('duels are reachable: two high-wu commanders in a sweep produce at least one duel', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const matchups = seeds.map((seed) => ({ seed,
      attacker: { troops: 8000, wu: 98, zhi: 40, command: 75, personality: 'active' as const },
      defender: { troops: 8000, wu: 96, zhi: 60, command: 80, personality: 'active' as const } }));
    const sweep = runBalanceSweep(matchups);
    expect(sweep.leverTotals.challengeDuel ?? 0).toBeGreaterThan(0);
  });

  it('stratagems are reachable: a guileful commander springs a fire/flood/ambush gambit in a sweep', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const matchups = seeds.map((seed) => ({ seed,
      attacker: { troops: 8000, wu: 55, zhi: 98, command: 85, personality: 'balanced' as const },
      defender: { troops: 8000, wu: 70, zhi: 60, command: 80, personality: 'balanced' as const } }));
    const sweep = runBalanceSweep(matchups);
    expect(sweep.leverTotals.gambit ?? 0).toBeGreaterThan(0);
  });

  it('a 1.5x quality advantage wins a clear majority', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const sweep = runBalanceSweep(seeds.map((seed) => ({ seed,
      attacker: { troops: 9000, wu: 88, zhi: 70, command: 82, personality: 'active' as const },
      defender: { troops: 6000, wu: 68, zhi: 60, command: 70, personality: 'balanced' as const } })));
    expect(sweep.attackerWinRate).toBeGreaterThanOrEqual(0.6);
  });

  it('battles resolve in a sane length band (not instant, not always the day cap)', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const sweep = runBalanceSweep(seeds.map((seed) => ({ seed,
      attacker: { troops: 7000, wu: 80, zhi: 65, command: 78, personality: 'balanced' as const },
      defender: { troops: 7000, wu: 78, zhi: 65, command: 76, personality: 'balanced' as const } })));
    expect(sweep.avgDays).toBeGreaterThan(2);
    expect(sweep.avgDays).toBeLessThan(28);
  });
});
