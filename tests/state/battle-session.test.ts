import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { createBattle } from '../../src/engine/battle/setup.js';
import {
  startSession, resolveDay, autoResolveSession, sessionResult, queuePlayerCommand,
} from '../../src/state/battleSession.js';
import type { Personality } from '../../src/engine/types.js';

function setup() {
  const s = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 100 });
  const target = Object.values(s.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
  const weak = { ...s, cities: { ...s.cities, [target.id]: { ...target, garrison: 500, generals: [] } } };
  const battle = createBattle(weak, {
    cityId: target.id, attackerFactionId: 'caocao', defenderFactionId: target.factionId!,
    attackingGeneralIds: ['caocao', 'xiahoudun'], attackingTroops: 20000,
  });
  const personalities: Record<string, Personality> = {};
  for (const f of Object.values(weak.factions)) personalities[f.id] = f.personality;
  return { state: weak, battle, personalities };
}

describe('battle session driver', () => {
  it('starts awaiting orders on the player attacker side', () => {
    const { battle, personalities } = setup();
    const sess = startSession(battle, 'caocao', personalities);
    expect(sess.phase).toBe('awaitingOrders');
    expect(sess.playerIsAttacker).toBe(true);
  });

  it('resolveDay advances one day and yields events', () => {
    const { battle, personalities } = setup();
    const sess0 = startSession(battle, 'caocao', personalities);
    const sess1 = resolveDay(sess0);
    expect(sess1.battle.daysElapsed).toBe(sess0.battle.daysElapsed + 1);
    expect(['awaitingOrders', 'resolved']).toContain(sess1.phase);
    expect(sess1.lastEvents.length).toBeGreaterThan(0);
  });

  it('autoResolve reaches a resolved terminal state', () => {
    const { battle, personalities } = setup();
    const sess = autoResolveSession(startSession(battle, 'caocao', personalities));
    expect(sess.phase).toBe('resolved');
    expect(typeof sess.attackerWon).toBe('boolean');
  });

  it('sessionResult applies to the strategic state', () => {
    const { state, battle, personalities } = setup();
    const sess = autoResolveSession(startSession(battle, 'caocao', personalities));
    const result = sessionResult(state, sess);
    if (result.attackerWon) expect(result.state.cities[battle.cityId]!.factionId).toBe('caocao');
    expect(result.state.rngState).toBeDefined();
  });

  it('queuePlayerCommand replaces a prior order for the same unit', () => {
    const { battle, personalities } = setup();
    let sess = startSession(battle, 'caocao', personalities);
    const uid = battle.units.find((u) => u.factionId === 'caocao')!.id;
    sess = queuePlayerCommand(sess, { kind: 'hold', unitId: uid });
    sess = queuePlayerCommand(sess, { kind: 'march', unitId: uid, target: { x: 0, y: 0 } });
    const forUnit = sess.queuedPlayerCommands.filter((c) => 'unitId' in c && c.unitId === uid);
    expect(forUnit).toHaveLength(1);
    expect(forUnit[0]!.kind).toBe('march');
  });
});

import {
  chooseDecision, pendingPivotalDecision, chargeableUnitIds,
} from '../../src/state/battleSession.js';

describe('battle session — player decisions', () => {
  it('startSession computes offeredDecisions for the player side', () => {
    const { battle, personalities } = setup();
    const sess = startSession(battle, 'caocao', personalities);
    expect(Array.isArray(sess.offeredDecisions)).toBe(true);
    // The setup attacker has multiple blocks vs a weak garrison, so a focus-fire
    // decision on the weakest enemy is always available.
    expect(sess.offeredDecisions.some((d) => d.id.startsWith('focusFire'))).toBe(true);
  });

  it('chooseDecision queues the decision\'s commands (replacing per-unit orders)', () => {
    const { battle, personalities } = setup();
    let sess = startSession(battle, 'caocao', personalities);
    const focus = sess.offeredDecisions.find((d) => d.id.startsWith('focusFire'))!;
    sess = chooseDecision(sess, focus.id);
    // Every command in the chosen decision is now queued.
    for (const c of focus.commands) {
      expect(sess.queuedPlayerCommands).toContainEqual(c);
    }
  });

  it('chooseDecision is a no-op for an unknown id', () => {
    const { battle, personalities } = setup();
    const sess = startSession(battle, 'caocao', personalities);
    expect(chooseDecision(sess, 'nope').queuedPlayerCommands).toEqual(sess.queuedPlayerCommands);
  });

  it('pendingPivotalDecision returns a salient decision or null', () => {
    const { battle, personalities } = setup();
    const sess = startSession(battle, 'caocao', personalities);
    const pivotal = pendingPivotalDecision(sess);
    expect(pivotal === null || pivotal.salient === true).toBe(true);
  });

  it('chargeableUnitIds excludes units that already have a queued order', () => {
    const { battle, personalities } = setup();
    let sess = startSession(battle, 'caocao', personalities);
    const all = chargeableUnitIds(sess);
    expect(all.length).toBeGreaterThan(0);
    const held = all[0]!;
    sess = queuePlayerCommand(sess, { kind: 'hold', unitId: held });
    expect(chargeableUnitIds(sess)).not.toContain(held);
  });

  it('a defending player is offered maneuver levers too (symmetry)', () => {
    const { battle, personalities } = setup();
    // Flip: the player defends. (setup builds caocao as attacker; recompute a session
    //  with the DEFENDER faction as the player to prove the levers are side-agnostic.)
    const defender = battle.defenderFactionId;
    const sess = startSession(battle, defender, personalities);
    expect(sess.playerIsAttacker).toBe(false);
    expect(Array.isArray(sess.offeredDecisions)).toBe(true);
    // A focus-fire decision is offered to whichever side has units + an enemy.
    expect(sess.offeredDecisions.some((d) => d.id.startsWith('focusFire'))).toBe(true);
  });
});
