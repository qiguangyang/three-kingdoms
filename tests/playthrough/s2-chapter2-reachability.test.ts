import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_JUNXIONG } from '../../src/data/scenarios/s2-junxiong.js';
import { REF_DATA } from '../../src/data/index.js';
import { advanceMonth, applyCommand } from '../../src/engine/turn.js';
import { makeDefaultAgent } from '../../src/engine/ai/index.js';
import { seedObjectives } from '../../src/engine/story/objectives.js';
import { citiesAdjacent, citiesOf } from '../../src/engine/map.js';
import { outlastLvbuMet } from '../../src/data/story/s2-liubei.js';
import type {
  AgentContext,
  FactionAgent,
  FactionStrategy,
  GameState,
} from '../../src/engine/types.js';

// Deterministic reachability proof for Liu Bei's Chapter 2 (群雄逐鹿 / s2-junxiong).
//
// The whole-branch review flagged two Chapter-2 risks: (1) a soft-stall where
// the plum_wine gate could never fire (fixed in s2-liubei.ts by sharing the
// outlastLvbuMet predicate), and (2) Liu Bei's tiny start (2,000 troops beside
// Lü Bu's 30k) possibly being an un-survivable death trap that makes the chapter
// unwinnable. This test guards BOTH by simulating the chapter to completion of
// its win GATE:
//   (a) Liu Bei survives past turn 3 (long enough for the shelter_xudu beat,
//       which arms at turn >= 2), and
//   (b) the chapter is reachably winnable — outlastLvbuMet() (the exact
//       predicate gating both the outlastLvbu objective and the plum_wine event)
//       becomes true within a bounded run.
//
// Fully deterministic (fixed seed 1, pure engine, no RNG/wall-clock). The turn
// loop mirrors tests/playthrough/long-simulation.test.ts, with one addition:
// Liu Bei is the "player" faction, so advanceMonth never drives him. We stand in
// for the player with a COMMITTED campaign against Lü Bu — the very thing the
// "outlast Lü Bu" objective asks of the player — using the aggressive ('active')
// preset. This models a motivated player, not the passive default; a player who
// simply idles would of course lose Xiaopei, which is why the chapter is a
// campaign and not a cutscene.

const SEED = 1;
const MAX_TURNS = 36;

function buildAgents(state: GameState): Record<string, FactionAgent> {
  const agents: Record<string, FactionAgent> = {};
  for (const f of Object.values(state.factions)) {
    if (f.id === state.playerFactionId) continue;
    agents[f.id] = makeDefaultAgent(f.id, f.personality);
  }
  return agents;
}

// A committed player's standing order: while a live Lü Bu seat (xiapi/pengcheng)
// borders a city Liu Bei holds, mass at that border city and assault the seat;
// otherwise fall back to the agent's own reassessment (consolidate / expand).
function liubeiStrategy(state: GameState, agent: FactionAgent): FactionStrategy {
  const owned = citiesOf(state, 'liubei');
  for (const seatId of ['xiapi', 'pengcheng']) {
    const seat = state.cities[seatId];
    if (!seat || seat.factionId !== 'lvbu') continue;
    const staging = owned.find((c) => citiesAdjacent(c, seat));
    if (staging) {
      return {
        posture: 'expand',
        targetFactionId: 'lvbu',
        targetCityId: seatId,
        stagingCityId: staging.id,
        updatedTurn: state.turn,
      };
    }
  }
  return agent.reassess({ state, factionId: 'liubei' }, state.aiStrategies['liubei'] ?? null);
}

// Drive Liu Bei for one month like a player would: set the standing order, then
// execute the strategic commands it yields. Mirrors advanceMonth's AI phase.
function runLiubeiTurn(state: GameState, agent: FactionAgent): GameState {
  let next = state;
  const strategy = liubeiStrategy(next, agent);
  next = { ...next, aiStrategies: { ...next.aiStrategies, liubei: strategy } };
  const ctx: AgentContext = { state: next, factionId: 'liubei', strategy };
  for (const cmd of agent.decideStrategic(ctx)) {
    next = applyCommand(next, 'liubei', cmd);
    next = {
      ...next,
      actionLog: [...next.actionLog, { turn: next.turn, command: cmd, factionId: 'liubei' }],
    };
  }
  return next;
}

function buildChapter2(): GameState {
  return seedObjectives({
    ...buildInitialState({
      scenario: SCENARIO_JUNXIONG,
      playerFactionId: 'liubei',
      refData: REF_DATA,
      seed: SEED,
    }),
    storyMode: { protagonistFactionId: 'liubei', chapter: 2 },
  });
}

describe('Chapter 2 (s2-junxiong) reachability — Liu Bei can outlast Lü Bu', () => {
  it('Liu Bei survives to the shelter beat and the win gate reachably closes', () => {
    let state = buildChapter2();
    // Sanity: the tuned underdog start (weakest faction, but survivable).
    expect(state.factions['liubei']?.alive).toBe(true);
    const liubeiTroops = SCENARIO_JUNXIONG.factions.find((f) => f.id === 'liubei')!.resources.troops;
    const weakest = Math.min(...SCENARIO_JUNXIONG.factions.map((f) => f.resources.troops));
    expect(liubeiTroops).toBe(weakest); // still the weakest faction

    const agent = makeDefaultAgent('liubei', 'active');
    let aliveThroughTurn3 = true;
    let gateTurn = -1;

    for (let i = 0; i < MAX_TURNS; i++) {
      if (state.factions['liubei']?.alive) state = runLiubeiTurn(state, agent);
      state = advanceMonth(state, buildAgents(state));

      // (a) Liu Bei must not be routed before the shelter_xudu beat (turn >= 2).
      // We check through turn 3 so the beat has a live faction to shelter.
      if (state.turn <= 3 && state.factions['liubei']?.alive === false) {
        aliveThroughTurn3 = false;
      }
      // (b) First moment the shared win-gate predicate closes.
      if (gateTurn < 0 && outlastLvbuMet(state)) gateTurn = state.turn;
    }

    // (a) Liu Bei survived the opening — the chapter isn't lost before it starts.
    expect(aliveThroughTurn3).toBe(true);
    expect(state.factions['liubei']?.alive).toBe(true);

    // (b) The gate reachably closes within the bound — so plum_wine/plumWine can
    // fire and Chapter 2 can be won. (At seed 1 this happens at turn 6, when Liu
    // Bei takes Xiapi while Lü Bu still lives — exactly the case TOUCH-1 unstuck.)
    expect(gateTurn).toBeGreaterThan(0);
    expect(gateTurn).toBeLessThanOrEqual(MAX_TURNS);
    expect(outlastLvbuMet(state)).toBe(true);
  });
});
