// Pure detector: surfaces the player's contextual maneuver levers for the
// current battle state, each with compiled orders and a salience flag (whether
// it is pivotal enough to pause auto-play). Reads only battle state.
import { BATTLE_TUNING } from '../../battle/constants.js';
import type { Battle, BattleUnit, FactionId, TacticalCommand } from '../../types.js';
import type { BattleCell, Vec2 } from '../../battle/types.js';
import { assessBattle } from './assessment.js';

export interface OfferedDecision {
  id: string; // 'commitReserves' | 'holdLine' | `focusFire:${targetUnitId}`
  family: 'maneuver' | 'hero' | 'stratagem';
  labelKey: string; // i18n MessageKey
  salient: boolean; // pause auto-play for this decision
  commands: TacticalCommand[];
}

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
function isFavorableGround(battle: Battle, p: Vec2): boolean {
  const cell = cellAt(battle, p);
  if (cell === 'ford' || cell === 'gate' || cell === 'hill' || cell === 'wall' || cell === 'ramp') return true;
  return heightAt(battle, p) >= 0.4;
}

export function offerPlayerDecisions(battle: Battle, factionId: FactionId): OfferedDecision[] {
  const enemies = battle.units.filter((e) => e.factionId !== factionId && isFielded(e));
  if (enemies.length === 0) return [];
  const a = assessBattle(battle, factionId);
  const mine = battle.units.filter((u) => u.factionId === factionId && isFielded(u));
  const out: OfferedDecision[] = [];

  // Commit Reserves — pivotal (pause-worthy) when you are not already winning.
  if (a.reserveUnitIds.length > 0) {
    out.push({
      id: 'commitReserves', family: 'maneuver', labelKey: 'battle.commitReserves',
      salient: a.advantage < 1.0, commands: [{ kind: 'commitReserves', factionId }],
    });
  }

  // Hold the Line — units on favorable ground with no adjacent enemy dig in.
  const holdUnits = mine.filter(
    (u) => isFavorableGround(battle, u.pos) && !enemies.some((e) => chebyshev(u.pos, e.pos) <= 1),
  );
  if (holdUnits.length > 0) {
    out.push({
      id: 'holdLine', family: 'maneuver', labelKey: 'battle.decision.holdLine',
      salient: false, commands: holdUnits.map((u) => ({ kind: 'hold', unitId: u.id })),
    });
  }

  // Focus Fire — concentrate the whole force on the weakest enemy block.
  if (a.priorityTargetId) {
    const target = battle.units.find((x) => x.id === a.priorityTargetId);
    if (target) {
      const commands: TacticalCommand[] = mine.map((u) => {
        const dist = chebyshev(u.pos, target.pos);
        if (dist <= 1) return { kind: 'meleeAttack', unitId: u.id, targetUnitId: target.id };
        if (u.troopType === 'archer' && dist <= BATTLE_TUNING.volleyRange) {
          return { kind: 'rangedAttack', unitId: u.id, targetUnitId: target.id };
        }
        return { kind: 'march', unitId: u.id, target: { x: target.pos.x, y: target.pos.y } };
      });
      out.push({ id: `focusFire:${target.id}`, family: 'maneuver', labelKey: 'battle.decision.focusFire', salient: false, commands });
    }
  }

  // HERO — Challenge Duel: the first of my high-wu generals that stands beside an
  // enemy general (best-match across all my generals, not just the first one).
  let duelMine: BattleUnit | undefined;
  let duelFoe: BattleUnit | undefined;
  for (const g of mine) {
    if (g.wu === undefined || g.wu < BATTLE_TUNING.duelWuMin) continue;
    const foe = enemies.find((e) => e.wu !== undefined && e.wu >= BATTLE_TUNING.duelWuMin && chebyshev(g.pos, e.pos) <= 1);
    if (foe) { duelMine = g; duelFoe = foe; break; }
  }
  if (duelMine && duelFoe) {
    out.push({ id: `challengeDuel:${duelFoe.id}`, family: 'hero', labelKey: 'battle.decision.challengeDuel', salient: true,
      commands: [{ kind: 'challengeDuel', unitId: duelMine.id, targetUnitId: duelFoe.id }] });
  }

  // HERO — Rally: the first wavering ally that has a friendly general within reach
  // (best-match across all wavering units).
  let rallyWaver: BattleUnit | undefined;
  let rallyGen: BattleUnit | undefined;
  for (const w of mine) {
    if (w.morale > BATTLE_TUNING.routMoraleThreshold + 10) continue;
    const gen = mine.find((u2) => u2.command !== undefined && u2.id !== w.id && chebyshev(u2.pos, w.pos) <= 3);
    if (gen) { rallyWaver = w; rallyGen = gen; break; }
  }
  if (rallyWaver && rallyGen) {
    out.push({ id: `rally:${rallyWaver.id}`, family: 'hero', labelKey: 'battle.decision.rally', salient: true,
      commands: [{ kind: 'rally', unitId: rallyGen.id, targetUnitId: rallyWaver.id }] });
  }

  // HERO — Hero Charge: a cavalry unit that can reach an enemy this turn.
  const cav = mine.find((u) => (u.troopType === 'cavalry' || u.troopType === 'heavyCav'));
  if (cav) {
    let target: typeof enemies[number] | undefined;
    let best = Infinity;
    for (const e of enemies) { const d = chebyshev(cav.pos, e.pos); if (d < best) { best = d; target = e; } }
    if (target && best <= (BATTLE_TUNING.moveRange[cav.troopType] ?? 4)) {
      out.push({ id: `heroCharge:${target.id}`, family: 'hero', labelKey: 'battle.decision.heroCharge', salient: false,
        commands: [{ kind: 'charge', unitId: cav.id, targetUnitId: target.id }] });
    }
  }

  // STRATAGEM — Feign Retreat: pull a pressed unit back to bait the enemy on.
  const pressed = mine.find((u) => enemies.some((e) => chebyshev(u.pos, e.pos) <= 1));
  if (pressed) {
    out.push({ id: `feignRetreat:${pressed.id}`, family: 'stratagem', labelKey: 'battle.decision.feignRetreat', salient: false,
      commands: [{ kind: 'retreat', unitId: pressed.id }] });
  }

  return out;
}
