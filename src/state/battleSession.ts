// Drives a live battle: steps the pure sim, pauses for the player, and folds
// player orders/gambits into the same stepBattle the AI feeds. No React here.
import {
  battleToResult,
  defaultTacticalCommands,
  detectGambits,
  stepBattle,
} from '../engine/battle/index.js';
import type { QuickBattleResult } from '../engine/combat.js';
import type {
  Battle,
  BattleUnit,
  FactionId,
  GameState,
  Personality,
  TacticalCommand,
} from '../engine/types.js';
// Gambit / GambitId / Vec2 live in the battle-local types module, not the
// engine barrel (../engine/types.js does not re-export them).
import type { Gambit, GambitId, Vec2 } from '../engine/battle/types.js';
import { offerPlayerDecisions } from '../engine/ai/tactics/index.js';
import type { OfferedDecision } from '../engine/ai/tactics/index.js';

export type BattlePhase = 'awaitingOrders' | 'resolving' | 'resolved';

export interface BattleSession {
  battle: Battle;
  phase: BattlePhase;
  speed: 1 | 2 | 4;
  playerFactionId: FactionId;
  playerIsAttacker: boolean;
  personalities: Record<FactionId, Personality>;
  queuedPlayerCommands: TacticalCommand[];
  lastEvents: ReturnType<typeof stepBattle>['events'];
  gambits: Gambit[];
  offeredDecisions: OfferedDecision[];
  attackerWon: boolean | null;
  endReason: 'destroyed' | 'timeout' | null;
}

const chebyshev = (a: Vec2, b: Vec2): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const isPlayerUnit = (u: BattleUnit, fid: FactionId): boolean => u.factionId === fid;

function filterPlayerGambits(battle: Battle, gambits: Gambit[], playerFactionId: FactionId): Gambit[] {
  return gambits.filter((g) =>
    g.unitIds.some((id) => {
      const u = battle.units.find((x) => x.id === id);
      return u ? isPlayerUnit(u, playerFactionId) : false;
    }),
  );
}

function nearestEnemyId(battle: Battle, unit: BattleUnit): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const e of battle.units) {
    if (e.factionId === unit.factionId || e.state !== 'fielded' || e.troops <= 0) continue;
    const d = chebyshev(unit.pos, e.pos);
    if (d < bestD) { bestD = d; best = e.id; }
  }
  return best;
}

function compileGambit(battle: Battle, g: Gambit, playerFactionId: FactionId): TacticalCommand[] {
  switch (g.id) {
    case 'cavalryCharge':
      return g.unitIds.map((id) => {
        const u = battle.units.find((x) => x.id === id)!;
        const t = nearestEnemyId(battle, u);
        return t
          ? ({ kind: 'charge', unitId: id, targetUnitId: t } as TacticalCommand)
          : ({ kind: 'hold', unitId: id } as TacticalCommand);
      });
    case 'duelChallenge': {
      const a = g.unitIds.find((id) => battle.units.find((u) => u.id === id)?.factionId === playerFactionId);
      const e = g.unitIds.find((id) => id !== a);
      return a && e ? [{ kind: 'challengeDuel', unitId: a, targetUnitId: e }] : [];
    }
    case 'fireAttack':
      return [{ kind: 'gambit', gambitId: 'fireAttack', unitIds: g.unitIds.filter((id) => battle.units.find((u) => u.id === id)?.factionId === playerFactionId) }];
    case 'floodAttack':
      return [{ kind: 'gambit', gambitId: 'floodAttack', unitIds: g.unitIds.filter((id) => battle.units.find((u) => u.id === id)?.factionId === playerFactionId) }];
    case 'fordCrossing':
      return g.unitIds.map((id) => ({ kind: 'march', unitId: id, target: battle.field.river?.fords[0] ?? { x: 0, y: 0 } } as TacticalCommand));
    case 'ambush':
      return [{ kind: 'gambit', gambitId: 'ambush', unitIds: g.unitIds.filter((id) => battle.units.find((u) => u.id === id)?.factionId === playerFactionId) }];
    default:
      return [];
  }
}

export function startSession(
  battle: Battle,
  playerFactionId: FactionId,
  personalities: Record<FactionId, Personality>,
): BattleSession {
  return {
    battle,
    phase: 'awaitingOrders',
    speed: 1,
    playerFactionId,
    playerIsAttacker: battle.attackerFactionId === playerFactionId,
    personalities,
    queuedPlayerCommands: [],
    lastEvents: [],
    gambits: filterPlayerGambits(battle, detectGambits(battle), playerFactionId),
    offeredDecisions: offerPlayerDecisions(battle, playerFactionId),
    attackerWon: null,
    endReason: null,
  };
}

export function queuePlayerCommand(session: BattleSession, cmd: TacticalCommand): BattleSession {
  const uid = 'unitId' in cmd ? cmd.unitId : undefined;
  const kept = uid
    ? session.queuedPlayerCommands.filter((c) => !('unitId' in c) || c.unitId !== uid)
    : session.queuedPlayerCommands;
  return { ...session, queuedPlayerCommands: [...kept, cmd] };
}

export function chooseGambit(session: BattleSession, gambitId: GambitId): BattleSession {
  const g = session.gambits.find((x) => x.id === gambitId);
  if (!g) return session;
  return { ...session, queuedPlayerCommands: [...session.queuedPlayerCommands, ...compileGambit(session.battle, g, session.playerFactionId)] };
}

export function setSpeed(session: BattleSession, speed: 1 | 2 | 4): BattleSession {
  return { ...session, speed };
}

function mergeCommands(session: BattleSession): TacticalCommand[] {
  const b = session.battle;
  const oppId = session.playerIsAttacker ? b.defenderFactionId : b.attackerFactionId;
  const oppPers = session.personalities[oppId] ?? 'balanced';
  const playerPers = session.personalities[session.playerFactionId] ?? 'balanced';
  const ordered = new Set(
    session.queuedPlayerCommands.filter((c) => 'unitId' in c).map((c) => (c as { unitId: string }).unitId),
  );
  const playerDefaults = defaultTacticalCommands(b, session.playerFactionId, playerPers)
    .filter((c) => !('unitId' in c) || !ordered.has((c as { unitId: string }).unitId));
  return [...defaultTacticalCommands(b, oppId, oppPers), ...playerDefaults, ...session.queuedPlayerCommands];
}

export function resolveDay(session: BattleSession): BattleSession {
  if (session.phase === 'resolved') return session;
  const { battle: next, events } = stepBattle({ battle: session.battle, commands: mergeCommands(session) });
  const end = events.find((e) => e.kind === 'end');
  if (end && end.kind === 'end') {
    return { ...session, battle: next, lastEvents: events, gambits: [], offeredDecisions: [], phase: 'resolved', attackerWon: end.attackerWon, endReason: end.reason, queuedPlayerCommands: [] };
  }
  return {
    ...session,
    battle: next,
    lastEvents: events,
    gambits: filterPlayerGambits(next, detectGambits(next), session.playerFactionId),
    offeredDecisions: offerPlayerDecisions(next, session.playerFactionId),
    phase: 'awaitingOrders',
    queuedPlayerCommands: [],
  };
}

export function autoResolveSession(session: BattleSession): BattleSession {
  let cur: BattleSession = { ...session, queuedPlayerCommands: [] };
  let guard = 0;
  while (cur.phase !== 'resolved' && guard < 60) {
    const b = cur.battle;
    const atkPers = cur.personalities[b.attackerFactionId] ?? 'balanced';
    const defPers = cur.personalities[b.defenderFactionId] ?? 'balanced';
    const commands = [
      ...defaultTacticalCommands(b, b.attackerFactionId, atkPers),
      ...defaultTacticalCommands(b, b.defenderFactionId, defPers),
    ];
    const { battle: nb, events } = stepBattle({ battle: b, commands });
    const end = events.find((e) => e.kind === 'end');
    cur = { ...cur, battle: nb, lastEvents: events };
    if (end && end.kind === 'end') {
      cur = { ...cur, phase: 'resolved', attackerWon: end.attackerWon, endReason: end.reason, gambits: [] };
      break;
    }
    guard++;
  }
  if (cur.phase !== 'resolved') cur = { ...cur, phase: 'resolved', attackerWon: false, endReason: 'timeout' };
  return cur;
}

export function sessionResult(state: GameState, session: BattleSession): QuickBattleResult {
  return battleToResult(state, session.battle);
}

export function chooseDecision(session: BattleSession, id: string): BattleSession {
  const d = session.offeredDecisions.find((x) => x.id === id);
  if (!d) return session;
  let next = session;
  for (const cmd of d.commands) next = queuePlayerCommand(next, cmd);
  return next;
}

export function pendingPivotalDecision(session: BattleSession): OfferedDecision | null {
  return session.offeredDecisions.find((d) => d.salient) ?? null;
}

export function chargeableUnitIds(session: BattleSession): string[] {
  const ordered = new Set(
    session.queuedPlayerCommands.filter((c) => 'unitId' in c).map((c) => (c as { unitId: string }).unitId),
  );
  return session.battle.units
    .filter((u) => u.factionId === session.playerFactionId && u.state === 'fielded' && u.troops > 0 && !ordered.has(u.id))
    .map((u) => u.id);
}
