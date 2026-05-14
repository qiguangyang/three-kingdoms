// Persistent-game scheduling primitives.
//
// Player and AI commands no longer apply instantly — instead they enqueue
// a PendingOp with a kind-specific duration. tickDays(state, n) advances
// the calendar n days, decrements every op, and invokes the right
// engine-side function the moment an op's daysRemaining hits zero.
//
// applyCommand (in turn.ts) remains as the "apply once, fully" entry
// point used by completion handlers, replay tests, and AI internals
// that need synchronous state transitions.

import { resolveQuickBattle } from './combat.js';
import { runScenarioEvents } from './events.js';
import {
  applyMonthlySettlement,
  applyWoundedRecovery,
  applyYearlyAging,
  commerce,
  develop,
  govern,
  patrol,
  plunder,
  recruit,
  search,
} from './politics.js';
import { applyDefect } from './recruit.js';
import { aliveFactions, factionTotals } from './selectors.js';
import { adjacentCities } from './map.js';
import type {
  AgentContext,
  City,
  FactionAgent,
  FactionId,
  GameState,
  LogEntry,
  OpKind,
  PendingOp,
  StrategicCommand,
} from './types.js';

// ----- duration table (in-game days) -----
//
// Commercially balanced so that low-overhead commands ship within a
// game-week and large military operations span a quarter. The numbers
// are conservative; tune later.

export const OP_DURATION_DAYS: Record<OpKind, number> = {
  develop: 14,
  commerce: 14,
  govern: 10,
  patrol: 7,
  search: 21,
  recruit: 14,
  plunder: 5,
  defect: 10,
  march: 0, // computed from distance
  siege: 0, // computed from engagement scale
};

// March duration from grid distance — 0.5 day per cell of manhattan
// distance, with a 4-day minimum so even neighbors take a beat.
export function marchDuration(from: City, to: City): number {
  const dx = Math.abs(from.pos.x - to.pos.x);
  const dy = Math.abs(from.pos.y - to.pos.y);
  return Math.max(4, Math.ceil((dx + dy) * 0.5));
}

// Siege duration grows with the defender's troop pool: 1 day per ~1200
// defenders, capped to the engine's 30-day timeout.
export function siegeDuration(defenderTroops: number): number {
  return Math.min(30, Math.max(6, Math.ceil(defenderTroops / 1200)));
}

// ----- scheduling -----

interface NewOp {
  kind: OpKind;
  factionId: FactionId;
  // Kind-specific payload. The caller is responsible for matching the
  // discriminated PendingOp shape; we trust the type system here.
  payload: Record<string, unknown>;
  durationDays: number;
}

// Add an op to the pending queue. Returns the new state.
export function scheduleOp(state: GameState, op: NewOp): GameState {
  const id = state.nextOpId;
  const newOp = {
    id,
    kind: op.kind,
    factionId: op.factionId,
    durationDays: op.durationDays,
    daysRemaining: op.durationDays,
    ...op.payload,
  } as PendingOp;
  return {
    ...state,
    pendingOps: [...state.pendingOps, newOp],
    nextOpId: id + 1,
  };
}

// Build a pending op from a StrategicCommand. Returns null for commands
// that aren't yet routed through the scheduler (e.g., endTurn).
export function schedulePlayerCommand(
  state: GameState,
  factionId: FactionId,
  cmd: StrategicCommand,
): GameState {
  switch (cmd.kind) {
    case 'develop':
    case 'commerce':
    case 'govern':
    case 'patrol':
    case 'search':
      return scheduleOp(state, {
        kind: cmd.kind,
        factionId,
        durationDays: OP_DURATION_DAYS[cmd.kind],
        payload: { cityId: cmd.cityId, generalId: cmd.generalId },
      });
    case 'recruit':
      return scheduleOp(state, {
        kind: 'recruit',
        factionId,
        durationDays: OP_DURATION_DAYS.recruit,
        payload: { cityId: cmd.cityId, count: cmd.count },
      });
    case 'plunder':
      return scheduleOp(state, {
        kind: 'plunder',
        factionId,
        durationDays: OP_DURATION_DAYS.plunder,
        payload: { cityId: cmd.cityId },
      });
    case 'defect':
      return scheduleOp(state, {
        kind: 'defect',
        factionId,
        durationDays: OP_DURATION_DAYS.defect,
        payload: {
          fromCityId: cmd.fromCityId,
          targetGeneralId: cmd.targetGeneralId,
          gold: cmd.gold,
        },
      });
    case 'move': {
      const from = state.cities[cmd.fromCityId];
      const to = state.cities[cmd.toCityId];
      if (!from || !to) return state;
      const next = detachExpeditionForce(state, cmd.fromCityId, cmd.generalIds, cmd.troops);
      return scheduleOp(next, {
        kind: 'march',
        factionId,
        durationDays: marchDuration(from, to),
        payload: {
          fromCityId: cmd.fromCityId,
          toCityId: cmd.toCityId,
          generalIds: cmd.generalIds,
          troops: cmd.troops,
          intent: 'reinforce',
        },
      });
    }
    case 'attack': {
      const from = state.cities[cmd.fromCityId];
      const to = state.cities[cmd.toCityId];
      if (!from || !to) return state;
      const next = detachExpeditionForce(state, cmd.fromCityId, cmd.generalIds, cmd.troops);
      return scheduleOp(next, {
        kind: 'march',
        factionId,
        durationDays: marchDuration(from, to),
        payload: {
          fromCityId: cmd.fromCityId,
          toCityId: cmd.toCityId,
          generalIds: cmd.generalIds,
          troops: cmd.troops,
          intent: 'attack',
        },
      });
    }
    case 'hireWild':
    case 'endTurn':
      return state;
  }
}

// ----- tickDays: advance the calendar -----

// Ticks N in-game days. Each day:
//   1. Decrement every pending op's daysRemaining
//   2. For ops that hit zero, fire their completion handler (which may
//      spawn follow-up ops, e.g., march -> siege)
//   3. Roll over the day; on day 31 advance the month and run monthly
//      settlement / scenario events / wounded recovery
//   4. On the new year (month 1) run aging + mark dead factions
//
// AI strategic decisions also fire at the top of each month so AI ops
// queue up alongside the player's.
export function tickDays(
  state: GameState,
  daysToAdvance: number,
  agents: Record<string, FactionAgent>,
): GameState {
  let next = state;
  for (let i = 0; i < daysToAdvance; i++) {
    next = tickOneDay(next, agents);
  }
  return next;
}

function tickOneDay(
  state: GameState,
  agents: Record<string, FactionAgent>,
): GameState {
  let next = state;

  // Step 1: decrement ops and apply completions. Completion handlers
  // may spawn follow-up ops (e.g., march → siege) via scheduleOp, which
  // append to next.pendingOps. We snapshot the original op list, then
  // merge "surviving" (decremented) entries with any newly-scheduled
  // ones at the end so the follow-ups aren't lost.
  const beforeOps = next.pendingOps;
  const beforeIds = new Set(beforeOps.map((op) => op.id));
  const surviving: PendingOp[] = [];
  for (const op of beforeOps) {
    const ticked = { ...op, daysRemaining: op.daysRemaining - 1 } as PendingOp;
    if (ticked.daysRemaining <= 0) {
      next = applyCompletedOp(next, ticked);
    } else {
      surviving.push(ticked);
    }
  }
  const newlyScheduled = next.pendingOps.filter((op) => !beforeIds.has(op.id));
  next = { ...next, pendingOps: [...surviving, ...newlyScheduled] };

  // Step 2: advance the calendar.
  if (next.day < 30) {
    next = { ...next, day: next.day + 1 };
  } else {
    // Month roll-over.
    next = { ...next, day: 1 };
    next = runScenarioEvents(next);
    next = applyMonthlySettlement(next);
    next = applyWoundedRecovery(next);
    let month = next.month + 1;
    let year = next.year;
    if (month > 12) {
      month = 1;
      year += 1;
      next = applyYearlyAging(next);
    }
    next = { ...next, month, year, turn: next.turn + 1 };

    // AI strategic decisions fire at the start of each month so the AI
    // queues ops alongside the player.
    next = runAiMonthlyDecisions(next, agents);

    // Mark dead factions.
    const factions = { ...next.factions };
    for (const f of Object.values(factions)) {
      const totals = factionTotals(next, f.id);
      if (f.alive && totals.cities === 0) {
        factions[f.id] = { ...f, alive: false };
      }
    }
    next = { ...next, factions };
  }
  return next;
}

function runAiMonthlyDecisions(
  state: GameState,
  agents: Record<string, FactionAgent>,
): GameState {
  let next = state;
  for (const faction of aliveFactions(next)) {
    if (faction.id === next.playerFactionId) continue;
    const agent = agents[faction.id];
    if (!agent) continue;
    // Reassess this faction's standing strategy, persist it, then let the
    // agent translate the strategy into concrete commands.
    const current = next.aiStrategies[faction.id] ?? null;
    const strategy = agent.reassess({ state: next, factionId: faction.id }, current);
    next = {
      ...next,
      aiStrategies: { ...next.aiStrategies, [faction.id]: strategy },
    };
    const ctx: AgentContext = { state: next, factionId: faction.id, strategy };
    const cmds = agent.decideStrategic(ctx);
    for (const cmd of cmds) {
      next = schedulePlayerCommand(next, faction.id, cmd);
      next = {
        ...next,
        actionLog: [
          ...next.actionLog,
          { turn: next.turn, command: cmd, factionId: faction.id },
        ],
      };
    }
  }
  return next;
}

// ----- op completion handlers -----
//
// Each handler routes through an existing engine function (so test
// coverage of the underlying logic carries over) and may spawn a
// follow-up op.

function applyCompletedOp(state: GameState, op: PendingOp): GameState {
  switch (op.kind) {
    case 'develop':
      return develop(state, { cityId: op.cityId, generalId: op.generalId });
    case 'commerce':
      return commerce(state, { cityId: op.cityId, generalId: op.generalId });
    case 'govern':
      return govern(state, { cityId: op.cityId, generalId: op.generalId });
    case 'patrol':
      return patrol(state, { cityId: op.cityId, generalId: op.generalId });
    case 'search':
      return search(state, { cityId: op.cityId, generalId: op.generalId });
    case 'recruit':
      return recruit(state, { cityId: op.cityId, count: op.count });
    case 'plunder':
      return plunder(state, { cityId: op.cityId });
    case 'defect': {
      const result = applyDefect(state, op.factionId, {
        fromCityId: op.fromCityId,
        targetGeneralId: op.targetGeneralId,
        gold: op.gold,
      });
      return result.state;
    }
    case 'march':
      return applyCompletedMarch(state, op);
    case 'siege':
      return applyCompletedSiege(state, op);
  }
}

function applyCompletedMarch(
  state: GameState,
  op: Extract<PendingOp, { kind: 'march' }>,
): GameState {
  const from = state.cities[op.fromCityId];
  const to = state.cities[op.toCityId];
  if (!from || !to) return state;

  // Pull the troops + generals out of the origin city; they're "in the
  // field" while the march was in flight, but we only fully detach them
  // on march completion to keep the model simple. (We pre-deducted the
  // garrison on schedule; here we just finalize the general locations.)
  const updatedGenerals = { ...state.generals };
  for (const gid of op.generalIds) {
    const g = updatedGenerals[gid];
    if (!g) continue;
    updatedGenerals[gid] = { ...g, locationCityId: op.toCityId };
  }
  let next: GameState = { ...state, generals: updatedGenerals };

  if (op.intent === 'reinforce' && to.factionId === op.factionId) {
    // Fold into the destination city's garrison + general roster.
    next = {
      ...next,
      cities: {
        ...next.cities,
        [op.toCityId]: {
          ...to,
          garrison: to.garrison + op.troops,
          generals: [...to.generals, ...op.generalIds.filter((id) => !to.generals.includes(id))],
        },
      },
    };
    next = addLog(next, 'event.generalMoved', {
      general: op.generalIds[0]
        ? state.generals[op.generalIds[0]]?.name ?? { zh: '?', en: '?' }
        : { zh: '?', en: '?' },
      from: from.name,
      to: to.name,
    });
    return next;
  }

  // Attack march: spawn a siege op at the target.
  return scheduleOp(next, {
    kind: 'siege',
    factionId: op.factionId,
    durationDays: siegeDuration(estimateDefenderTroops(state, to)),
    payload: {
      targetCityId: op.toCityId,
      generalIds: op.generalIds,
      troops: op.troops,
    },
  });
}

function estimateDefenderTroops(state: GameState, city: City): number {
  let total = city.garrison;
  for (const gid of city.generals) {
    const g = state.generals[gid];
    if (g) total += g.troops;
  }
  return total;
}

function applyCompletedSiege(
  state: GameState,
  op: Extract<PendingOp, { kind: 'siege' }>,
): GameState {
  const target = state.cities[op.targetCityId];
  if (!target) return state;
  const defenderFactionId = target.factionId ?? '__neutral__';
  const result = resolveQuickBattle({
    state,
    attackerFactionId: op.factionId,
    defenderFactionId,
    attackingGeneralIds: op.generalIds,
    attackingTroops: op.troops,
    cityId: op.targetCityId,
  });
  // On loss, restore retreating attackers to a friendly city neighbor of
  // the target. On win, the resolveQuickBattle already relocated them.
  if (!result.attackerWon) {
    const nearbyFriendly = adjacentCities(result.state, op.targetCityId).find(
      (c) => c.factionId === op.factionId,
    );
    if (nearbyFriendly) {
      const updatedGenerals = { ...result.state.generals };
      for (const gid of op.generalIds) {
        const g = updatedGenerals[gid];
        if (g && g.status === 'active') {
          updatedGenerals[gid] = { ...g, locationCityId: nearbyFriendly.id };
        }
      }
      const updatedCity = {
        ...nearbyFriendly,
        generals: [
          ...nearbyFriendly.generals,
          ...op.generalIds.filter(
            (id) =>
              !nearbyFriendly.generals.includes(id) &&
              updatedGenerals[id]?.status === 'active',
          ),
        ],
      };
      return {
        ...result.state,
        generals: updatedGenerals,
        cities: { ...result.state.cities, [nearbyFriendly.id]: updatedCity },
      };
    }
  }
  return result.state;
}

// Deduct troops and remove generals from the origin city when an
// expedition (march or attack) is scheduled. The generals keep their
// `locationCityId` pointing at the origin so they're listed on the
// march op's tooltip but aren't shown in the origin city's roster
// (we strip them from `cities[].generals`).
function detachExpeditionForce(
  state: GameState,
  fromCityId: string,
  generalIds: string[],
  troops: number,
): GameState {
  const city = state.cities[fromCityId];
  if (!city) return state;
  const detachedGarrison = Math.min(city.garrison, troops);
  return {
    ...state,
    cities: {
      ...state.cities,
      [fromCityId]: {
        ...city,
        garrison: city.garrison - detachedGarrison,
        generals: city.generals.filter((id) => !generalIds.includes(id)),
      },
    },
  };
}

function addLog(
  state: GameState,
  key: string,
  vars: Record<string, unknown>,
): GameState {
  const entry: LogEntry = {
    turn: state.turn,
    year: state.year,
    month: state.month,
    key,
    vars: vars as LogEntry['vars'],
  };
  return { ...state, log: [...state.log, entry] };
}
