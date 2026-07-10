// The utility planner: turns doctrine + assessment into a coherent set of
// maneuver commands for one side. Pure and deterministic. Consumed by
// defaultTacticalCommands, so it drives the enemy, the player's auto-line, and
// (Phase 1b) the player's offered levers.
import { BATTLE_TUNING } from '../../battle/constants.js';
import type { Battle, BattleUnit, FactionId, Personality, TacticalCommand } from '../../types.js';
import type { BattleCell, Vec2 } from '../../battle/types.js';
import { deriveDoctrine } from './doctrine.js';
import { assessBattle } from './assessment.js';

const chebyshev = (a: Vec2, b: Vec2): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const isFielded = (u: BattleUnit): boolean => u.state === 'fielded' && u.troops > 0;

function cellAt(battle: Battle, p: Vec2): BattleCell {
  const { width, height } = battle.field;
  if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) return 'plain';
  return battle.field.cells[p.y * width + p.x] ?? 'plain';
}
function heightAt(battle: Battle, p: Vec2): number {
  const { width, height } = battle.field;
  if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) return 0;
  return battle.field.heights[p.y * width + p.x] ?? 0;
}
// Chokepoints and high ground worth holding.
function isFavorableGround(battle: Battle, p: Vec2): boolean {
  const cell = cellAt(battle, p);
  if (cell === 'ford' || cell === 'gate' || cell === 'hill' || cell === 'wall' || cell === 'ramp') return true;
  return heightAt(battle, p) >= 0.4;
}
function nearestEnemy(u: BattleUnit, enemies: BattleUnit[]): BattleUnit | undefined {
  let best: BattleUnit | undefined;
  let bestD = Infinity;
  for (const e of enemies) {
    const d = chebyshev(u.pos, e.pos);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}
// The side's lead general block: the highest-command fielded led unit.
function leadGeneralUnit(units: BattleUnit[], factionId: FactionId): BattleUnit | undefined {
  let best: BattleUnit | undefined;
  for (const u of units) {
    if (u.factionId !== factionId || !isFielded(u) || u.command === undefined) continue;
    if (!best || (u.command ?? 0) > (best.command ?? 0)) best = u;
  }
  return best;
}

export function planTactical(battle: Battle, factionId: FactionId, personality: Personality): TacticalCommand[] {
  const enemies = battle.units.filter((e) => e.factionId !== factionId && isFielded(e));
  if (enemies.length === 0) return [];

  const doc = deriveDoctrine(battle, factionId, personality);
  const a = assessBattle(battle, factionId);
  const cmds: TacticalCommand[] = [];

  // --- Battle-level: commit reserves when shoring up a losing line OR when an
  // aggressive doctrine presses a clear advantage.
  const losing = a.advantage < 0.85;
  const pressingOpening = a.advantage > 1.3 && doc.aggression > 0.5;
  if (a.reserveUnitIds.length > 0 && (losing || pressingOpening)) {
    cmds.push({ kind: 'commitReserves', factionId });
  }

  const priority = a.priorityTargetId ? battle.units.find((x) => x.id === a.priorityTargetId) : undefined;
  // An overwhelming attacker must always press, or it could hold and time out.
  const mustPress = a.advantage > 1.5;
  // Disciplined/cautious doctrines value holding favorable ground.
  const holdInclination = (doc.discipline + doc.caution) / 2;

  // RALLY: the lead general steadies a badly-wavering fielded ally within reach.
  const myFieldedAll = battle.units.filter((u) => u.factionId === factionId && isFielded(u));
  const wavering = myFieldedAll.find((u) => u.morale <= BATTLE_TUNING.routMoraleThreshold + 10);
  const rallier = leadGeneralUnit(battle.units, factionId);
  const rallied = new Set<string>();
  if (wavering && rallier && rallier.id !== wavering.id && chebyshev(rallier.pos, wavering.pos) <= 3) {
    cmds.push({ kind: 'rally', unitId: rallier.id, targetUnitId: wavering.id });
    rallied.add(rallier.id);
  }

  const myUnits = battle.units.filter((u) => u.factionId === factionId && isFielded(u));
  for (const u of myUnits) {
    const near = nearestEnemy(u, enemies);
    if (!near) continue;
    const dist = chebyshev(u.pos, near.pos);

    if (rallied.has(u.id)) continue;
    // CHALLENGE DUEL: an aggressive high-wu general beside an enemy general.
    if (doc.aggression > 0.6 && u.wu !== undefined && u.wu >= BATTLE_TUNING.duelWuMin && dist <= 1) {
      const enemyGeneral = enemies.find((e) => e.wu !== undefined && e.wu >= BATTLE_TUNING.duelWuMin && chebyshev(u.pos, e.pos) <= 1);
      if (enemyGeneral) { cmds.push({ kind: 'challengeDuel', unitId: u.id, targetUnitId: enemyGeneral.id }); continue; }
    }

    // HOLD: hang back on favorable ground, letting the enemy come, when the
    // doctrine prefers defense and we are not adjacent and not obliged to press.
    if (!mustPress && dist > 1 && holdInclination > doc.aggression && isFavorableGround(battle, u.pos)) {
      cmds.push({ kind: 'hold', unitId: u.id });
      continue;
    }

    if (dist <= 1) {
      // FOCUS FIRE: prefer the priority (weakest) enemy when it is adjacent.
      const focusAdjacent = priority && isFielded(priority) && chebyshev(u.pos, priority.pos) <= 1;
      const targetId = focusAdjacent ? priority!.id : near.id;
      cmds.push({ kind: 'meleeAttack', unitId: u.id, targetUnitId: targetId });
    } else if (u.troopType === 'archer' && dist <= BATTLE_TUNING.volleyRange) {
      const focusInRange = priority && isFielded(priority) && chebyshev(u.pos, priority.pos) <= BATTLE_TUNING.volleyRange;
      const targetId = focusInRange ? priority!.id : near.id;
      cmds.push({ kind: 'rangedAttack', unitId: u.id, targetUnitId: targetId });
    } else if ((u.troopType === 'cavalry' || u.troopType === 'heavyCav') && doc.aggression > 0.6
      && dist <= (BATTLE_TUNING.moveRange[u.troopType] ?? 4)) {
      // Aggressive cavalry charges into contact (base charge bonus already in the sim).
      cmds.push({ kind: 'charge', unitId: u.id, targetUnitId: near.id });
    } else {
      // MARCH: a disciplined side converges on the priority target; others advance on the nearest.
      const dest = doc.discipline > 0.6 && priority && isFielded(priority) ? priority.pos : near.pos;
      cmds.push({ kind: 'march', unitId: u.id, target: { x: dest.x, y: dest.y } });
    }
  }

  return cmds;
}
