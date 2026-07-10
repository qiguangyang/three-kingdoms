// Derive a tactical Doctrine from the commanding general's stat snapshots plus
// the faction personality. The lead general (highest command among a side's
// led blocks) sets the tone; personality nudges aggression/caution. Pure and
// deterministic — reads only the battle's unit snapshots, never GameState.
import type { Battle, BattleUnit, FactionId, Personality } from '../../types.js';

export interface Doctrine {
  aggression: number; // 0..1 — press, charge, accept melee
  guile: number; // 0..1 — stratagems, feints, target the general (used from Phase 3)
  discipline: number; // 0..1 — hold chokepoints, focus-fire, time reserves
  caution: number; // 0..1 — retreat when losing, avoid overextension
}

const AGGRO_BY_PERSONALITY: Record<Personality, number> = { active: 1, balanced: 0.5, turtle: 0.15 };
const CAUTION_BY_PERSONALITY: Record<Personality, number> = { active: 0.1, balanced: 0.4, turtle: 1 };

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

// Pick the side's lead general block: the led unit (has stat snapshots) with
// the highest command. Returns default mid-stats when a side is unled.
function leadStats(battle: Battle, factionId: FactionId): { wu: number; zhi: number; command: number } {
  let best: BattleUnit | undefined;
  for (const u of battle.units) {
    if (u.factionId !== factionId) continue;
    if (u.state === 'gone') continue;
    if (u.command === undefined || u.wu === undefined) continue; // unled mob
    if (!best || (u.command ?? 0) > (best.command ?? 0)) best = u;
  }
  if (!best) return { wu: 60, zhi: 60, command: 60 };
  return { wu: best.wu ?? 60, zhi: best.zhi ?? 60, command: best.command ?? 60 };
}

export function deriveDoctrine(battle: Battle, factionId: FactionId, personality: Personality): Doctrine {
  const { wu, zhi, command } = leadStats(battle, factionId);
  const aggression = clamp01(0.7 * (wu / 100) + 0.3 * AGGRO_BY_PERSONALITY[personality]);
  const guile = clamp01(zhi / 100);
  const discipline = clamp01(command / 100);
  const caution = clamp01(0.5 * ((100 - wu) / 100) + 0.5 * CAUTION_BY_PERSONALITY[personality]);
  return { aggression, guile, discipline, caution };
}
