// Deterministic headless balance harness. Builds synthetic two-block battles,
// runs both sides through the planner to completion, and reports the outcome,
// length, and how often each command kind was used. Pure — no I/O.
import { BATTLE_DAY_LIMIT } from '../../constants.js';
import { stepBattle } from '../../battle/simulate.js';
import type { Battle, BattleUnit, Personality, TroopType } from '../../types.js';
import type { BattleField } from '../../battle/types.js';
import { planTactical } from './plan.js';

export interface SideSpec {
  troops: number;
  troopType?: TroopType;
  wu?: number;
  zhi?: number;
  command?: number;
  personality: Personality;
}
export interface Matchup {
  seed: number;
  attacker: SideSpec;
  defender: SideSpec;
}
export interface BattleReport {
  attackerWon: boolean;
  days: number;
  leverCounts: Record<string, number>;
}
export interface SweepReport {
  n: number;
  attackerWinRate: number;
  avgDays: number;
  leverTotals: Record<string, number>;
}

const A = 'A';
const B = 'B';

function openField(seed: number): BattleField {
  const w = 12;
  const h = 12;
  const heights = new Array(w * h).fill(0);
  const cells = new Array(w * h).fill('plain');
  // A defensible hill in front of the defender, so the hold lever is reachable.
  cells[3 * w + 6] = 'hill';
  heights[3 * w + 6] = 0.8;
  return { width: w, height: h, heights, cells, seed };
}

function block(id: string, factionId: string, spec: SideSpec, y: number): BattleUnit {
  return {
    id, generalId: id === 'gar' ? '' : id, factionId, troops: spec.troops,
    troopType: spec.troopType ?? 'infantry', pos: { x: 6, y }, morale: 100, hasActed: false,
    state: 'fielded', formationRole: 'center', wu: spec.wu, command: spec.command, zhi: spec.zhi,
  };
}

function buildBattle(m: Matchup): Battle {
  const units: BattleUnit[] = [
    block('atk', A, m.attacker, 10),
    block('def', B, m.defender, 3),
    // A small defender reserve so commitReserves is reachable.
    { id: 'res', generalId: '', factionId: B, troops: Math.round(m.defender.troops * 0.4),
      troopType: 'infantry', pos: { x: 6, y: 1 }, morale: 100, hasActed: false,
      state: 'reserve', formationRole: 'rear' },
  ];
  return { cityId: 'c', attackerFactionId: A, defenderFactionId: B, daysElapsed: 0,
    units, field: openField(m.seed), seed: m.seed, rngCursor: m.seed >>> 0, log: [] };
}

export function simulateHeadless(m: Matchup): BattleReport {
  let cur = buildBattle(m);
  const leverCounts: Record<string, number> = {};
  let attackerWon = false;
  let days = 0;
  for (let day = 0; day < BATTLE_DAY_LIMIT; day++) {
    const atkCmds = planTactical(cur, A, m.attacker.personality);
    const defCmds = planTactical(cur, B, m.defender.personality);
    for (const c of [...atkCmds, ...defCmds]) leverCounts[c.kind] = (leverCounts[c.kind] ?? 0) + 1;
    const stepped = stepBattle({ battle: cur, commands: [...atkCmds, ...defCmds] });
    cur = stepped.battle;
    days = cur.daysElapsed;
    const end = stepped.events.find((e) => e.kind === 'end');
    if (end && end.kind === 'end') { attackerWon = end.attackerWon; break; }
  }
  return { attackerWon, days, leverCounts };
}

export function runBalanceSweep(matchups: Matchup[]): SweepReport {
  let wins = 0;
  let totalDays = 0;
  const leverTotals: Record<string, number> = {};
  for (const m of matchups) {
    const r = simulateHeadless(m);
    if (r.attackerWon) wins++;
    totalDays += r.days;
    for (const [k, v] of Object.entries(r.leverCounts)) leverTotals[k] = (leverTotals[k] ?? 0) + v;
  }
  const n = matchups.length;
  return { n, attackerWinRate: n ? wins / n : 0, avgDays: n ? totalDays / n : 0, leverTotals };
}
