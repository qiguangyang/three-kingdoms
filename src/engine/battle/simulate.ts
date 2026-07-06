// Deterministic one-day battle step. Phases run in a fixed order so results
// are reproducible: default-orders -> move -> ranged -> melee -> morale/rout
// -> end-check. Ranged/duel/reserve/end handling is layered in Task 0.5.
import { BATTLE_DAY_LIMIT, COMBAT_MODIFIER } from '../constants.js';
import { rollInt } from '../rng.js';
import type {
  Battle,
  BattleUnit,
  TacticalCommand,
  Terrain,
} from '../types.js';
import type { BattleCell, BattleEvent, Vec2 } from './types.js';
import { BATTLE_TUNING } from './constants.js';

export interface StepInput {
  battle: Battle;
  commands: TacticalCommand[];
}
export interface StepResult {
  battle: Battle;
  events: BattleEvent[];
}

const chebyshev = (a: Vec2, b: Vec2): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// Battlefield cell -> the engine's world Terrain vocabulary, so we can reuse
// COMBAT_MODIFIER. 'hill' maps to 'mountain', wall/gate/ramp to 'city',
// ford to 'plain' (crossable), river stays 'river'.
function cellTerrain(cell: BattleCell): Terrain {
  switch (cell) {
    case 'hill': return 'mountain';
    case 'forest': return 'forest';
    case 'river': return 'river';
    case 'wall':
    case 'gate':
    case 'ramp': return 'city';
    case 'ford':
    case 'plain':
    default: return 'plain';
  }
}

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

function isActive(u: BattleUnit): boolean {
  return u.state === 'fielded' && u.troops > 0;
}

function nearestEnemy(u: BattleUnit, units: BattleUnit[]): BattleUnit | undefined {
  let best: BattleUnit | undefined;
  let bestD = Infinity;
  for (const e of units) {
    if (e.factionId === u.factionId || !isActive(e)) continue;
    const d = chebyshev(u.pos, e.pos);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// One step of movement toward `target`, capped by the unit's daily range and
// blocked by impassable cells (deep river for land units).
function stepToward(battle: Battle, u: BattleUnit, target: Vec2): Vec2 {
  const range = BATTLE_TUNING.moveRange[u.troopType] ?? 2;
  let cur = { ...u.pos };
  for (let s = 0; s < range; s++) {
    const dx = Math.sign(target.x - cur.x);
    const dy = Math.sign(target.y - cur.y);
    if (dx === 0 && dy === 0) break;
    const nxt = { x: cur.x + dx, y: cur.y + dy };
    const cell = cellAt(battle, nxt);
    const landUnit = u.troopType !== 'navy';
    if (cell === 'river' && landUnit) break; // must go around / use a ford
    if (cell === 'wall') break; // cannot walk through a wall
    cur = nxt;
  }
  return cur;
}

export function stepBattle(input: StepInput): StepResult {
  const events: BattleEvent[] = [];
  let rng = input.battle.rngCursor >>> 0;
  const rint = (min: number, max: number): number => {
    const r = rollInt(rng, min, max);
    rng = r.state;
    return r.value;
  };

  // Deep-clone the units we will mutate (immutable outward contract).
  let units: BattleUnit[] = input.battle.units.map((u) => ({ ...u, pos: { ...u.pos }, hasActed: false }));
  const byId = (id: string): BattleUnit | undefined => units.find((u) => u.id === id);

  // --- Order map: unitId -> command (explicit orders win; default otherwise).
  const orders = new Map<string, TacticalCommand>();
  for (const c of input.commands) {
    if ('unitId' in c) orders.set(c.unitId, c);
  }

  // --- Reserve commit (from a commitReserves command).
  for (const c of input.commands) {
    if (c.kind === 'commitReserves') {
      const committed: string[] = [];
      units = units.map((u) => {
        if (u.factionId === c.factionId && u.state === 'reserve') {
          committed.push(u.id);
          return { ...u, state: 'fielded' as const, pos: { ...u.pos, y: Math.min(input.battle.field.height - 1, u.pos.y + 1) } };
        }
        return u;
      });
      if (committed.length > 0) {
        events.push({ kind: 'reserveCommitted', factionId: c.factionId, unitIds: committed });
      }
    }
  }

  // ---------------- MOVEMENT PHASE ----------------
  for (const u of units) {
    if (!isActive(u)) continue;
    const order = orders.get(u.id);
    if (order && (order.kind === 'hold' || order.kind === 'meleeAttack' || order.kind === 'rangedAttack')) {
      continue; // holding or attacking in place: no move
    }
    let target: Vec2 | undefined;
    if (order && order.kind === 'march') target = order.target;
    else if (order && (order.kind === 'charge')) {
      const t = byId(order.targetUnitId);
      target = t?.pos;
    } else {
      const enemy = nearestEnemy(u, units);
      target = enemy?.pos;
    }
    if (!target) continue;
    const from = { ...u.pos };
    const to = stepToward(input.battle, u, target);
    if (to.x !== from.x || to.y !== from.y) {
      u.pos = to;
      events.push({ kind: 'move', unitId: u.id, from, to });
    }
  }

  // ---------------- MELEE PHASE ----------------
  // Each active unit adjacent (Chebyshev<=1) to an enemy fights it once.
  // Casualties: loser loses meleeBaseLoss * powerRatio of engaged troops.
  const meleePower = (u: BattleUnit): number => {
    const t = cellTerrain(cellAt(input.battle, u.pos));
    const mod = COMBAT_MODIFIER[u.troopType]?.[t] ?? 1.0;
    const lead = u.generalId ? 1.0 : 0.6; // led blocks hit harder than mobs
    const charging = orders.get(u.id)?.kind === 'charge' ? BATTLE_TUNING.chargeBonus : 1.0;
    const elev = 1 + heightAt(input.battle, u.pos) * BATTLE_TUNING.elevationPerLevel;
    return u.troops * mod * lead * charging * elev;
  };

  const resolvedPairs = new Set<string>();
  for (const u of units) {
    if (!isActive(u)) continue;
    const enemy = units.find((e) => e.factionId !== u.factionId && isActive(e) && chebyshev(u.pos, e.pos) <= 1);
    if (!enemy) continue;
    const key = [u.id, enemy.id].sort().join('|');
    if (resolvedPairs.has(key)) continue;
    resolvedPairs.add(key);

    const pa = meleePower(u);
    const pb = meleePower(enemy);
    const jitter = 0.85 + rint(0, 30) / 100; // 0.85..1.15
    const bLoss = Math.min(enemy.troops, Math.floor(BATTLE_TUNING.meleeBaseLoss * (pa / Math.max(pb, 1)) * enemy.troops * jitter));
    const aLoss = Math.min(u.troops, Math.floor(BATTLE_TUNING.meleeBaseLoss * (pb / Math.max(pa, 1)) * u.troops * jitter));
    u.troops -= aLoss;
    enemy.troops -= bLoss;
    events.push({ kind: 'clash', unitId: u.id, targetUnitId: enemy.id, casualties: bLoss, defCasualties: aLoss });
  }

  // ---------------- MORALE / ROUT PHASE ----------------
  units = units.map((u) => {
    if (u.state === 'gone' || u.state === 'reserve') return u;
    // (casualty-driven morale is applied in Task 0.5's fuller model; here we
    //  drop units to 'gone' when annihilated.)
    if (u.troops <= 0) {
      return { ...u, troops: 0, state: 'gone' as const };
    }
    return u;
  });

  // ---------------- DAY / END ----------------
  const daysElapsed = input.battle.daysElapsed + 1;
  events.push({ kind: 'dayAdvanced', day: daysElapsed });

  const next: Battle = {
    ...input.battle,
    units,
    daysElapsed,
    rngCursor: rng,
  };

  // End detection is completed in Task 0.5; here we only stamp the timeout
  // flag via an event when the limit is hit so the loop can terminate.
  const attackerAlive = units.some((u) => u.factionId === next.attackerFactionId && (u.state === 'fielded' || u.state === 'reserve') && u.troops > 0);
  const defenderAlive = units.some((u) => u.factionId === next.defenderFactionId && (u.state === 'fielded' || u.state === 'reserve') && u.troops > 0);
  if (!attackerAlive || !defenderAlive) {
    events.push({ kind: 'end', attackerWon: defenderAlive ? false : true, reason: 'destroyed' });
  } else if (daysElapsed >= BATTLE_DAY_LIMIT) {
    events.push({ kind: 'end', attackerWon: false, reason: 'timeout' });
  }

  return { battle: next, events };
}
