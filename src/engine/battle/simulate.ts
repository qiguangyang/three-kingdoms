// Deterministic one-day battle step. Phases run in a fixed order so results
// are reproducible: default-orders -> move -> ranged -> melee -> charge-shock
// -> duel -> fire -> flood -> ambush -> rally -> morale/rout -> end-check.
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

// Leadership multiplier from the unit's general snapshot (mirrors combat.ts's
// (wu*0.4 + tong*0.5 + zhi*0.1)/50, with zhi folded into a flat term).
function unitLeadership(u: BattleUnit): number {
  if (u.wu === undefined || u.command === undefined) return 0.6; // unled mob
  return (u.wu * 0.45 + u.command * 0.55) / 50;
}

function meleePower(battle: Battle, u: BattleUnit, orders: Map<string, TacticalCommand>): number {
  const t = cellTerrain(cellAt(battle, u.pos));
  const mod = COMBAT_MODIFIER[u.troopType]?.[t] ?? 1.0;
  const order = orders.get(u.id)?.kind;
  const charging = order === 'charge' ? BATTLE_TUNING.chargeBonus : 1.0;
  const holding = order === 'hold' ? BATTLE_TUNING.holdBonus : 1.0;
  const elev = 1 + heightAt(battle, u.pos) * BATTLE_TUNING.elevationPerLevel;
  return u.troops * mod * unitLeadership(u) * charging * holding * elev;
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
// blocked by impassable cells (deep river for land units) or by a cell an
// active unit already held at the start of this phase. The occupancy check
// keeps two closing forces from stepping through one another onto each
// other's starting cell in the same day (which would otherwise let them
// swap places and perpetually miss each other); they instead stop adjacent
// and fight next phase.
function stepToward(battle: Battle, u: BattleUnit, target: Vec2, blocked: Vec2[] = []): Vec2 {
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
    if (blocked.some((p) => p.x === nxt.x && p.y === nxt.y)) break; // occupied: halt adjacent
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
  // Snapshot of active units' cells before anyone moves this phase; passed to
  // stepToward as the occupancy set (see its comment for why this matters).
  const occupiedAtPhaseStart: Vec2[] = units.filter(isActive).map((u) => ({ ...u.pos }));
  for (const u of units) {
    if (!isActive(u)) continue;
    const order = orders.get(u.id);
    if (order && (order.kind === 'hold' || order.kind === 'meleeAttack' || order.kind === 'rangedAttack')) {
      continue; // holding or attacking in place: no move
    }
    let target: Vec2 | undefined;
    let feinting = false;
    if (order && order.kind === 'march') target = order.target;
    else if (order && order.kind === 'charge') {
      const t = byId(order.targetUnitId);
      target = t?.pos;
    } else if (order && order.kind === 'retreat') {
      const homeY = u.factionId === input.battle.attackerFactionId ? input.battle.field.height - 1 : 0;
      target = { x: u.pos.x, y: homeY };
      feinting = true;
    } else {
      const enemy = nearestEnemy(u, units);
      target = enemy?.pos;
    }
    if (!target) continue;
    const from = { ...u.pos };
    const to = stepToward(input.battle, u, target, occupiedAtPhaseStart);
    if (to.x !== from.x || to.y !== from.y) {
      u.pos = to;
      events.push({ kind: 'move', unitId: u.id, from, to });
    }
    if (feinting) events.push({ kind: 'feint', unitId: u.id });
  }

  // ---------------- RANGED PHASE ----------------
  for (const u of units) {
    if (!isActive(u) || u.troopType !== 'archer') continue;
    const order = orders.get(u.id);
    let target: BattleUnit | undefined;
    if (order && order.kind === 'rangedAttack') target = byId(order.targetUnitId);
    if (!target || !isActive(target)) {
      target = units.find((e) => e.factionId !== u.factionId && isActive(e) && chebyshev(u.pos, e.pos) <= BATTLE_TUNING.volleyRange && chebyshev(u.pos, e.pos) > 1);
    }
    if (!target || chebyshev(u.pos, target.pos) > BATTLE_TUNING.volleyRange) continue;
    const jitter = 0.85 + rint(0, 30) / 100;
    const loss = Math.min(target.troops, Math.floor(BATTLE_TUNING.volleyBaseLoss * u.troops * unitLeadership(u) * jitter));
    target.troops -= loss;
    events.push({ kind: 'volley', unitId: u.id, targetUnitId: target.id, casualties: loss });
  }

  // ---------------- MELEE PHASE ----------------
  // Each active unit adjacent (Chebyshev<=1) to an enemy fights it once.
  // Casualties: loser loses meleeBaseLoss * powerRatio of engaged troops.
  const resolvedPairs = new Set<string>();
  for (const u of units) {
    if (!isActive(u)) continue;
    // Prefer an explicitly ordered target when it is adjacent (focus fire);
    // otherwise fall back to the first adjacent enemy (unchanged default).
    const order = orders.get(u.id);
    let enemy: BattleUnit | undefined;
    if (order && order.kind === 'meleeAttack') {
      const t = byId(order.targetUnitId);
      if (t && t.factionId !== u.factionId && isActive(t) && chebyshev(u.pos, t.pos) <= 1) enemy = t;
    }
    if (!enemy) enemy = units.find((e) => e.factionId !== u.factionId && isActive(e) && chebyshev(u.pos, e.pos) <= 1);
    if (!enemy) continue;
    const key = [u.id, enemy.id].sort().join('|');
    if (resolvedPairs.has(key)) continue;
    resolvedPairs.add(key);

    const pa = meleePower(input.battle, u, orders);
    const pb = meleePower(input.battle, enemy, orders);
    // Independent per-side luck: evenly matched forces should NOT annihilate each
    // other identically. A single shared jitter makes a mirror-image clash perfectly
    // symmetric (both sides lose the same each day and rout together), which erases
    // tactical variance and lets a defender's uncommitted reserve always break the
    // tie. Two draws give each side its own daily luck.
    const jitterB = 0.85 + rint(0, 30) / 100; // 0.85..1.15 — enemy's (u's target) casualties
    const jitterA = 0.85 + rint(0, 30) / 100; // 0.85..1.15 — u's own casualties
    const bLoss = Math.min(enemy.troops, Math.floor(BATTLE_TUNING.meleeBaseLoss * (pa / Math.max(pb, 1)) * enemy.troops * jitterB));
    const aLoss = Math.min(u.troops, Math.floor(BATTLE_TUNING.meleeBaseLoss * (pb / Math.max(pa, 1)) * u.troops * jitterA));
    u.troops -= aLoss;
    enemy.troops -= bLoss;
    events.push({ kind: 'clash', unitId: u.id, targetUnitId: enemy.id, casualties: bLoss, defCasualties: aLoss });
  }

  // ---------------- CHARGE SHOCK ----------------
  // A charging unit that reached its target shakes the target's morale (beyond
  // casualties). Command-driven + order-independent, so a defender's charge is
  // not silently dropped by the melee loop's pair-dedup ordering.
  for (const c of input.commands) {
    if (c.kind !== 'charge') continue;
    const src = byId(c.unitId);
    const tgt = byId(c.targetUnitId);
    if (!src || !tgt || !isActive(src) || src.factionId === tgt.factionId) continue;
    if (chebyshev(src.pos, tgt.pos) > 1) continue; // never reached contact
    tgt.morale = Math.max(0, tgt.morale - BATTLE_TUNING.chargeMoraleShock);
    events.push({ kind: 'charge', unitId: src.id, targetUnitId: tgt.id });
  }

  // ---------------- DUEL PHASE ----------------
  // Explicit challengeDuel, or auto-trigger between two adjacent high-wu
  // generals. Loser's unit loses half its troops + a big morale hit.
  const dueled = new Set<string>();
  const tryDuelPair = (a: BattleUnit, e: BattleUnit): void => {
    if (dueled.has(a.id) || dueled.has(e.id)) return;
    if (a.wu === undefined || e.wu === undefined) return;
    if (a.wu < BATTLE_TUNING.duelWuMin || e.wu < BATTLE_TUNING.duelWuMin) return;
    dueled.add(a.id); dueled.add(e.id);
    const margin = a.wu - e.wu;
    const swing = rint(-8, 8);
    const aWins = margin + swing >= 0;
    const winner = aWins ? a : e;
    const loser = aWins ? e : a;
    loser.troops = Math.floor(loser.troops * 0.5);
    loser.morale = Math.max(0, loser.morale - BATTLE_TUNING.moraleDuelLoss);
    events.push({ kind: 'duel', a: a.generalId, b: e.generalId, winner: winner.generalId });
  };
  for (const c of input.commands) {
    if (c.kind === 'challengeDuel') {
      const a = byId(c.unitId), e = byId(c.targetUnitId);
      if (a && e && isActive(a) && isActive(e) && chebyshev(a.pos, e.pos) <= 1) tryDuelPair(a, e);
    }
  }
  for (const u of units) {
    if (!isActive(u) || u.wu === undefined || u.wu < BATTLE_TUNING.duelWuMin) continue;
    const foe = units.find((e) => e.factionId !== u.factionId && isActive(e) && e.wu !== undefined && e.wu >= BATTLE_TUNING.duelWuMin && chebyshev(u.pos, e.pos) <= 1);
    if (foe) tryDuelPair(u, foe);
  }

  // ---------------- FIRE PHASE ----------------
  // Handles the fireAttack gambit command. Gate-checking (forest + wind) is
  // the caller's job (see gambit detection); the sim trusts the command.
  for (const c of input.commands) {
    if (c.kind !== 'gambit' || c.gambitId !== 'fireAttack') continue;
    for (const uid of c.unitIds) {
      const src = byId(uid);
      if (!src || !isActive(src)) continue;
      const at = { ...src.pos };
      const wind = input.battle.wind;
      const reach = wind ? 2 + Math.round(wind.strength * 3) : 2;
      events.push({ kind: 'fire', at, spread: reach });
      for (const e of units) {
        if (e.factionId === src.factionId || !isActive(e)) continue;
        const dx = e.pos.x - at.x;
        const dy = e.pos.y - at.y;
        const cheb = Math.max(Math.abs(dx), Math.abs(dy));
        // Base blaze, or caught downwind within the extended reach.
        const downwind = wind ? dx * wind.dir.x + dy * wind.dir.y > 0 : false;
        if (cheb <= 2 || (downwind && cheb <= reach)) {
          const loss = Math.min(e.troops, Math.floor(e.troops * 0.2));
          e.troops -= loss;
          e.morale = Math.max(0, e.morale - 20);
        }
      }
    }
  }

  // ---------------- FLOOD PHASE ----------------
  // Handles the floodAttack gambit: breach the adjacent river bank and send water
  // across the low ground, drowning enemy units caught in the flooded cells.
  // Gate-checking (unit beside a river) is the caller's job; the sim trusts it.
  {
    const field = input.battle.field;
    const W = field.width;
    const H = field.height;
    const inBounds = (p: Vec2): boolean => p.x >= 0 && p.x < W && p.y >= 0 && p.y < H;
    const cellOf = (p: Vec2): BattleCell => field.cells[p.y * W + p.x] ?? 'plain';
    const heightOf = (p: Vec2): number => field.heights[p.y * W + p.x] ?? 0;
    const adjacentRiver = (p: Vec2): Vec2 | null => {
      for (const d of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
        const q = { x: p.x + d.x, y: p.y + d.y };
        if (inBounds(q) && cellOf(q) === 'river') return q;
      }
      return null;
    };
    // River channel + surrounding low ground within a fixed radius of the breach.
    const FLOOD_RADIUS = 3;
    const floodCells = (breach: Vec2): Vec2[] => {
      const bh = heightOf(breach);
      const out: Vec2[] = [];
      for (let dy = -FLOOD_RADIUS; dy <= FLOOD_RADIUS; dy++) {
        for (let dx = -FLOOD_RADIUS; dx <= FLOOD_RADIUS; dx++) {
          const q = { x: breach.x + dx, y: breach.y + dy };
          if (!inBounds(q)) continue;
          if (Math.max(Math.abs(dx), Math.abs(dy)) > FLOOD_RADIUS) continue;
          const cell = cellOf(q);
          if (cell === 'river' || cell === 'ford' || heightOf(q) <= bh + 0.15) out.push(q);
        }
      }
      return out;
    };
    for (const c of input.commands) {
      if (c.kind !== 'gambit' || c.gambitId !== 'floodAttack') continue;
      for (const uid of c.unitIds) {
        const src = byId(uid);
        if (!src || !isActive(src)) continue;
        const breach = adjacentRiver(src.pos);
        if (!breach) continue;
        const cells = floodCells(breach);
        events.push({ kind: 'flood', from: breach, cells });
        const flooded = new Set(cells.map((p) => p.y * W + p.x));
        for (const e of units) {
          if (e.factionId === src.factionId || !isActive(e)) continue;
          if (flooded.has(e.pos.y * W + e.pos.x)) {
            const loss = Math.min(e.troops, Math.floor(e.troops * 0.3));
            e.troops -= loss;
            e.morale = Math.max(0, e.morale - 35);
          }
        }
      }
    }
  }

  // ---------------- AMBUSH PHASE ----------------
  // A concealed forest unit springs a surprise strike: modest casualties but a
  // heavy morale shock to nearby enemies (gate-checking is the caller's job).
  for (const c of input.commands) {
    if (c.kind !== 'gambit' || c.gambitId !== 'ambush') continue;
    for (const uid of c.unitIds) {
      const src = byId(uid);
      if (!src || !isActive(src)) continue;
      const at = { ...src.pos };
      events.push({ kind: 'ambushSprung', at, unitId: src.id });
      for (const e of units) {
        if (e.factionId === src.factionId || !isActive(e)) continue;
        if (chebyshev(e.pos, at) <= 2) {
          e.troops -= Math.min(e.troops, Math.floor(e.troops * 0.15));
          e.morale = Math.max(0, e.morale - 30);
        }
      }
    }
  }

  // ---------------- RALLY PHASE ----------------
  // A led unit steadies a wavering same-faction ally within range, restoring
  // morale scaled by the rallying general's leadership. Runs before morale/rout
  // so a rallied block can survive the day's casualties instead of breaking.
  for (const c of input.commands) {
    if (c.kind !== 'rally') continue;
    const src = byId(c.unitId);
    const tgt = byId(c.targetUnitId);
    if (!src || !tgt || !isActive(src) || !isActive(tgt)) continue;
    if (src.factionId !== tgt.factionId) continue;
    if (chebyshev(src.pos, tgt.pos) > 3) continue;
    const gain = Math.round(BATTLE_TUNING.rallyBaseMorale * unitLeadership(src));
    if (gain <= 0) continue;
    const before = tgt.morale;
    tgt.morale = Math.min(100, tgt.morale + gain);
    if (tgt.morale !== before) events.push({ kind: 'rally', unitId: src.id, targetUnitId: tgt.id, morale: tgt.morale - before });
  }

  // ---------------- MORALE / ROUT PHASE ----------------
  // Apply casualty-driven morale using the day's clash/volley losses. A unit
  // annihilated this turn (troops driven to 0 by clash/duel/fire) is folded
  // into the same pass as a 100%-loss case, so it still gets a moraleBreak +
  // rout event on its way to 'gone' instead of silently vanishing.
  const lossById = new Map<string, number>();
  for (const ev of events) {
    if (ev.kind === 'clash') {
      lossById.set(ev.targetUnitId, (lossById.get(ev.targetUnitId) ?? 0) + ev.casualties);
      lossById.set(ev.unitId, (lossById.get(ev.unitId) ?? 0) + ev.defCasualties);
    } else if (ev.kind === 'volley') {
      lossById.set(ev.targetUnitId, (lossById.get(ev.targetUnitId) ?? 0) + ev.casualties);
    }
  }
  units = units.map((u) => {
    if (u.state !== 'fielded') return u;
    if (u.troops <= 0) {
      events.push({ kind: 'moraleBreak', unitId: u.id });
      events.push({ kind: 'rout', unitId: u.id });
      return { ...u, troops: 0, morale: 0, state: 'gone' as const };
    }
    const lost = lossById.get(u.id) ?? 0;
    const before = lost + u.troops;
    if (before <= 0 || lost <= 0) return u;
    const pctLost = (lost / before) * 100;
    const drop = Math.round((pctLost / 10) * BATTLE_TUNING.moralePer10pctLoss);
    const morale = Math.max(0, u.morale - drop);
    if (morale <= BATTLE_TUNING.routMoraleThreshold) {
      events.push({ kind: 'moraleBreak', unitId: u.id });
      events.push({ kind: 'rout', unitId: u.id });
      // Flee toward the unit's home edge.
      const homeY = u.factionId === input.battle.attackerFactionId ? input.battle.field.height - 1 : 0;
      const fleeY = u.pos.y + Math.sign(homeY - u.pos.y);
      return { ...u, morale, state: 'routing' as const, pos: { ...u.pos, y: fleeY } };
    }
    return { ...u, morale };
  });
  // Routing units that reach their home edge leave the field.
  units = units.map((u) => {
    if (u.state !== 'routing') return u;
    const homeY = u.factionId === input.battle.attackerFactionId ? input.battle.field.height - 1 : 0;
    if (u.pos.y === homeY) return { ...u, state: 'gone' as const };
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

  // Only fielded/reserve units with troops count as "still fighting"; a side
  // that is entirely routing/gone has lost even if some troops remain.
  const stillFighting = (fid: string): boolean =>
    units.some((u) => u.factionId === fid && (u.state === 'fielded' || u.state === 'reserve') && u.troops > 0);
  const attackerAlive = stillFighting(next.attackerFactionId);
  const defenderAlive = stillFighting(next.defenderFactionId);
  if (!attackerAlive || !defenderAlive) {
    events.push({ kind: 'end', attackerWon: attackerAlive && !defenderAlive, reason: 'destroyed' });
  } else if (daysElapsed >= BATTLE_DAY_LIMIT) {
    events.push({ kind: 'end', attackerWon: false, reason: 'timeout' });
  }

  return { battle: next, events };
}
