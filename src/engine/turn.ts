import { resolveQuickBattle } from './combat.js';
import { runScenarioEvents } from './events.js';
import { applyStoryChoice } from './story/events.js';
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
import { aliveFactions, factionTotals, hasVictory } from './selectors.js';
import type {
  AgentContext,
  FactionAgent,
  GameState,
  StrategicCommand,
} from './types.js';

// Execute a single strategic command from any faction. Returns the
// post-command state. `endTurn` is a no-op marker.
export function applyCommand(
  state: GameState,
  factionId: string,
  cmd: StrategicCommand,
): GameState {
  switch (cmd.kind) {
    case 'develop':
      return develop(state, { cityId: cmd.cityId, generalId: cmd.generalId });
    case 'commerce':
      return commerce(state, { cityId: cmd.cityId, generalId: cmd.generalId });
    case 'govern':
      return govern(state, { cityId: cmd.cityId, generalId: cmd.generalId });
    case 'patrol':
      return patrol(state, { cityId: cmd.cityId, generalId: cmd.generalId });
    case 'search':
      return search(state, { cityId: cmd.cityId, generalId: cmd.generalId });
    case 'recruit':
      return recruit(state, { cityId: cmd.cityId, count: cmd.count });
    case 'plunder':
      return plunder(state, { cityId: cmd.cityId });
    case 'hireWild':
      // Hiring is its own engine command not wired through here in MVP.
      return state;
    case 'move':
      return applyMove(state, factionId, cmd);
    case 'attack':
      return applyAttack(state, factionId, cmd);
    case 'defect': {
      const result = applyDefect(state, factionId, {
        fromCityId: cmd.fromCityId,
        targetGeneralId: cmd.targetGeneralId,
        gold: cmd.gold,
      });
      return result.state;
    }
    case 'endTurn':
      return state;
    case 'storyChoice':
      // A story choice is applied immediately (never scheduled as a
      // PendingOp). resolveStoryChoice records it into actionLog, so replay
      // routes it back through here.
      return applyStoryChoice(state, cmd.eventId, cmd.choiceId);
  }
}

function applyMove(
  state: GameState,
  factionId: string,
  cmd: Extract<StrategicCommand, { kind: 'move' }>,
): GameState {
  const from = state.cities[cmd.fromCityId];
  const to = state.cities[cmd.toCityId];
  if (!from || !to || from.factionId !== factionId || to.factionId !== factionId) return state;
  const troops = Math.min(cmd.troops, from.garrison);
  return {
    ...state,
    cities: {
      ...state.cities,
      [from.id]: {
        ...from,
        garrison: from.garrison - troops,
        generals: from.generals.filter((id) => !cmd.generalIds.includes(id)),
      },
      [to.id]: {
        ...to,
        garrison: to.garrison + troops,
        generals: [...to.generals, ...cmd.generalIds],
      },
    },
    generals: cmd.generalIds.reduce(
      (acc, id) => {
        const g = acc[id];
        if (!g) return acc;
        return { ...acc, [id]: { ...g, locationCityId: to.id } };
      },
      { ...state.generals },
    ),
  };
}

function applyAttack(
  state: GameState,
  factionId: string,
  cmd: Extract<StrategicCommand, { kind: 'attack' }>,
): GameState {
  const from = state.cities[cmd.fromCityId];
  const to = state.cities[cmd.toCityId];
  if (!from || !to) return state;
  if (from.factionId !== factionId) return state;
  if (to.factionId === factionId) return state;
  const defenderFactionId = to.factionId ?? '__neutral__';
  const result = resolveQuickBattle({
    state,
    attackerFactionId: factionId,
    defenderFactionId,
    attackingGeneralIds: cmd.generalIds,
    attackingTroops: cmd.troops,
    cityId: to.id,
  });

  // Remove troops + dispatched generals from the origin city. Successful
  // attackers are already relocated to the captured city by
  // resolveQuickBattle. On failure, surviving generals retreat back to the
  // origin city so they aren't stranded with no garrison and no city link.
  const origin = result.state.cities[from.id];
  if (!origin) return result.state;
  const lost = cmd.troops;
  const updatedOrigin = {
    ...origin,
    garrison: Math.max(0, origin.garrison - lost),
    generals: origin.generals.filter((id) => !cmd.generalIds.includes(id)),
  };

  let nextGenerals = result.state.generals;
  if (!result.attackerWon) {
    // Restore retreating attackers to the origin city.
    const retreatedIds: string[] = [];
    nextGenerals = { ...nextGenerals };
    for (const gid of cmd.generalIds) {
      const g = nextGenerals[gid];
      if (!g) continue;
      if (g.status === 'active') {
        nextGenerals[gid] = { ...g, locationCityId: from.id };
        retreatedIds.push(gid);
      }
    }
    updatedOrigin.generals = [...updatedOrigin.generals, ...retreatedIds];
  }

  return {
    ...result.state,
    cities: { ...result.state.cities, [from.id]: updatedOrigin },
    generals: nextGenerals,
  };
}

// Advance one month. Order:
//   1. Run AI strategic decisions for every non-player faction
//   2. Execute their commands
//   3. Run scenario event triggers
//   4. Apply monthly economy + rebellion check
//   5. Tick calendar; on month 1 run yearly aging
//   6. Mark dead factions
export function advanceMonth(
  state: GameState,
  agents: Record<string, FactionAgent>,
): GameState {
  let next = state;

  // AI strategic phase. Skip the player's faction — the UI dispatches
  // player commands directly.
  for (const faction of aliveFactions(next)) {
    if (faction.id === next.playerFactionId) continue;
    const agent = agents[faction.id];
    if (!agent) continue;
    const current = next.aiStrategies[faction.id] ?? null;
    const strategy = agent.reassess({ state: next, factionId: faction.id }, current);
    next = {
      ...next,
      aiStrategies: { ...next.aiStrategies, [faction.id]: strategy },
    };
    const ctx: AgentContext = { state: next, factionId: faction.id, strategy };
    const cmds = agent.decideStrategic(ctx);
    for (const cmd of cmds) {
      next = applyCommand(next, faction.id, cmd);
      next = {
        ...next,
        actionLog: [...next.actionLog, { turn: next.turn, command: cmd, factionId: faction.id }],
      };
    }
  }

  // Scripted events.
  next = runScenarioEvents(next);

  // Economy + rebellion.
  next = applyMonthlySettlement(next);

  // Wounded generals slowly return to active duty.
  next = applyWoundedRecovery(next);

  // Calendar tick.
  let month = next.month + 1;
  let year = next.year;
  if (month > 12) {
    month = 1;
    year += 1;
    next = applyYearlyAging(next);
  }
  next = { ...next, month, year, turn: next.turn + 1 };

  // Mark dead factions (lost all cities).
  const factions = { ...next.factions };
  for (const f of Object.values(factions)) {
    const totals = factionTotals(next, f.id);
    if (f.alive && totals.cities === 0) {
      factions[f.id] = { ...f, alive: false };
    }
  }
  next = { ...next, factions };
  return next;
}

// Victory check for the player's faction. Returns 'victory' | 'defeat' | null.
export function checkOutcome(state: GameState): 'victory' | 'defeat' | null {
  const player = state.factions[state.playerFactionId];
  if (!player || !player.alive) return 'defeat';
  if (hasVictory(state, state.playerFactionId)) return 'victory';
  return null;
}
