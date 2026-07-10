// Pure predicates that surface contextual tactical opportunities. Both sides'
// gambits are returned; the battle session filters to the player's side.
import type { Battle, BattleUnit } from '../types.js';
import type { BattleCell, Gambit, Vec2 } from './types.js';
import { BATTLE_TUNING } from './constants.js';

const chebyshev = (a: Vec2, b: Vec2): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const active = (u: BattleUnit): boolean => u.state === 'fielded' && u.troops > 0;

function cellAt(battle: Battle, p: Vec2): BattleCell {
  const { width, height } = battle.field;
  if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) return 'plain';
  return battle.field.cells[p.y * width + p.x] ?? 'plain';
}

export function detectGambits(battle: Battle): Gambit[] {
  const out: Gambit[] = [];
  const units = battle.units;

  // cavalryCharge: a cavalry/heavyCav unit with an enemy within 2 cells.
  for (const u of units) {
    if (!active(u) || (u.troopType !== 'cavalry' && u.troopType !== 'heavyCav')) continue;
    const foe = units.find((e) => e.factionId !== u.factionId && active(e) && chebyshev(u.pos, e.pos) <= 2 && chebyshev(u.pos, e.pos) >= 1);
    if (foe) out.push({ id: 'cavalryCharge', unitIds: [u.id], labelKey: 'battle.gambit.cavalryCharge' });
  }

  // fireAttack: a unit standing in/next to forest with wind up.
  if (battle.wind && battle.wind.strength > 0) {
    for (const u of units) {
      if (!active(u)) continue;
      const inForest = cellAt(battle, u.pos) === 'forest' ||
        [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }].some((d) => cellAt(battle, { x: u.pos.x + d.x, y: u.pos.y + d.y }) === 'forest');
      if (inForest) out.push({ id: 'fireAttack', unitIds: [u.id], labelKey: 'battle.gambit.fireAttack' });
    }
  }

  // floodAttack: a land unit next to a river bank, with an enemy in flood range
  // downstream to drown. (Water spread itself is computed in the sim.)
  for (const u of units) {
    if (!active(u) || u.troopType === 'navy') continue;
    const nextToRiver = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
      .some((d) => cellAt(battle, { x: u.pos.x + d.x, y: u.pos.y + d.y }) === 'river');
    if (!nextToRiver) continue;
    const foe = units.find((e) => e.factionId !== u.factionId && active(e) && chebyshev(u.pos, e.pos) <= 4);
    if (foe) out.push({ id: 'floodAttack', unitIds: [u.id], labelKey: 'battle.gambit.floodAttack' });
  }

  // duelChallenge: two adjacent generals both above the wu threshold.
  for (const u of units) {
    if (!active(u) || u.wu === undefined || u.wu < BATTLE_TUNING.duelWuMin) continue;
    const foe = units.find((e) => e.factionId !== u.factionId && active(e) && e.wu !== undefined && e.wu >= BATTLE_TUNING.duelWuMin && chebyshev(u.pos, e.pos) <= 1);
    if (foe) out.push({ id: 'duelChallenge', unitIds: [u.id, foe.id], labelKey: 'battle.gambit.duelChallenge' });
  }

  // fordCrossing: a land unit adjacent to a ford cell.
  for (const u of units) {
    if (!active(u) || u.troopType === 'navy') continue;
    const nextToFord = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 0, y: 0 }]
      .some((d) => cellAt(battle, { x: u.pos.x + d.x, y: u.pos.y + d.y }) === 'ford');
    if (nextToFord) out.push({ id: 'fordCrossing', unitIds: [u.id], labelKey: 'battle.gambit.fordCrossing' });
  }

  // ambush: a unit standing in forest with an enemy at striking distance.
  for (const u of units) {
    if (!active(u)) continue;
    if (cellAt(battle, u.pos) !== 'forest') continue;
    const foe = units.find((e) => e.factionId !== u.factionId && active(e) && chebyshev(u.pos, e.pos) <= 2 && chebyshev(u.pos, e.pos) >= 1);
    if (foe) out.push({ id: 'ambush', unitIds: [u.id], labelKey: 'battle.gambit.ambush' });
  }

  return out;
}
