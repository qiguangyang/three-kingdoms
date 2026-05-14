import type { Battle, Personality, TacticalCommand } from '../types.js';
import { PERSONALITY_PRESETS } from './personality.js';

// Tactical (battlefield) AI. Default behavior intentionally evokes the
// original game's "dripping advance" — each unit moves toward the nearest
// enemy independently, with no clustering, no troop-type counter-play, no
// terrain abuse, no retreats. Active personalities flip a single flag to
// gain rudimentary smart tactics.
export function tacticalRules(
  battle: Battle,
  factionId: string,
  personality: Personality,
): TacticalCommand[] {
  const params = PERSONALITY_PRESETS[personality];
  const myUnits = battle.units.filter((u) => u.factionId === factionId && !u.hasActed);
  const enemies = battle.units.filter((u) => u.factionId !== factionId && u.troops > 0);
  if (enemies.length === 0) return [];

  const commands: TacticalCommand[] = [];
  for (const unit of myUnits) {
    const nearest = closestEnemy(unit.pos, enemies);
    if (!nearest) continue;
    const dist = chebyshev(unit.pos, nearest.pos);
    if (dist <= 1) {
      commands.push({ kind: 'meleeAttack', unitId: unit.id, targetUnitId: nearest.id });
    } else if (unit.troopType === 'archer' && dist <= 3) {
      commands.push({ kind: 'rangedAttack', unitId: unit.id, targetUnitId: nearest.id });
    } else {
      // "Dripping advance": each unit picks its own target and creeps forward.
      // smartTactics could pick a coordinated rally point — left off here on
      // purpose for the default agent.
      void params;
      commands.push({ kind: 'march', unitId: unit.id, target: nearest.pos });
    }
  }
  return commands;
}

function closestEnemy(
  from: { x: number; y: number },
  enemies: Battle['units'],
): Battle['units'][number] | undefined {
  let best: Battle['units'][number] | undefined;
  let bestDist = Infinity;
  for (const e of enemies) {
    const d = chebyshev(from, e.pos);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
