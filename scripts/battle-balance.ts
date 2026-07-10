// Balance sweep report. Run: npx tsx scripts/battle-balance.ts
// Prints attacker win-rate, average length, and lever usage across a matrix of
// troop ratios, commanders, and personalities. Deterministic (seeded).
import { runBalanceSweep, type Matchup } from '../src/engine/ai/tactics/balance.js';

const personalities = ['active', 'balanced', 'turtle'] as const;
const ratios = [0.6, 0.8, 1, 1.25, 1.6];
const matchups: Matchup[] = [];
let seed = 1;
for (const r of ratios) {
  for (const ap of personalities) {
    for (const dp of personalities) {
      for (let rep = 0; rep < 6; rep++) {
        matchups.push({
          seed: seed++,
          attacker: { troops: Math.round(6000 * r), wu: 85, zhi: 70, command: 80, personality: ap },
          defender: { troops: 6000, wu: 75, zhi: 75, command: 80, personality: dp },
        });
      }
    }
  }
}

const report = runBalanceSweep(matchups);
// eslint-disable-next-line no-console
console.log(JSON.stringify(report, null, 2));
