// Pure detector: surfaces the player's contextual maneuver levers for the
// current battle state, each with compiled orders and a salience flag (whether
// it is pivotal enough to pause auto-play). Reads only battle state.
import { BATTLE_TUNING } from '../../battle/constants.js';
import type { Battle, BattleUnit, FactionId, TacticalCommand } from '../../types.js';
import type { BattleCell, Vec2 } from '../../battle/types.js';
import { assessBattle } from './assessment.js';

export interface OfferedDecision {
  id: string; // 'commitReserves' | 'holdLine' | `focusFire:${targetUnitId}`
  family: 'maneuver' | 'hero';
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

  // HERO — Challenge Duel: a high-wu player general beside a high-wu enemy general.
  const myGeneral = mine.find((u) => u.wu !== undefined && u.wu >= BATTLE_TUNING.duelWuMin);
  if (myGeneral) {
    const foeGeneral = enemies.find((e) => e.wu !== undefined && e.wu >= BATTLE_TUNING.duelWuMin && chebyshev(myGeneral.pos, e.pos) <= 1);
    if (foeGeneral) {
      out.push({ id: `challengeDuel:${foeGeneral.id}`, family: 'hero', labelKey: 'battle.decision.challengeDuel', salient: true,
        commands: [{ kind: 'challengeDuel', unitId: myGeneral.id, targetUnitId: foeGeneral.id }] });
    }
  }

  // HERO — Rally: a wavering ally with a friendly general within reach.
  const wavering = mine.find((u) => u.morale <= BATTLE_TUNING.routMoraleThreshold + 10);
  if (wavering) {
    const gen = mine.find((u) => u.command !== undefined && u.id !== wavering.id && chebyshev(u.pos, wavering.pos) <= 3);
    if (gen) {
      out.push({ id: `rally:${wavering.id}`, family: 'hero', labelKey: 'battle.decision.rally', salient: true,
        commands: [{ kind: 'rally', unitId: gen.id, targetUnitId: wavering.id }] });
    }
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

  return out;
}
