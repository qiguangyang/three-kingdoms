// End-to-end playthrough simulator. Loads scenario 1, picks a player faction,
// then drives a mix of player commands + AI months and prints a readable log
// so a human can confirm the game actually progresses.
//
// Run: npx tsx scripts/playthrough.ts [--faction <id>] [--months 60] [--lang en|zh]

import { buildInitialState } from '../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../src/data/index.js';
import { advanceMonth, applyCommand, checkOutcome } from '../src/engine/turn.js';
import { makeDefaultAgent } from '../src/engine/ai/index.js';
import { factionGenerals, factionTotals } from '../src/engine/selectors.js';
import { adjacentCities, citiesOf } from '../src/engine/map.js';
import { pickName, setLocale, t } from '../src/i18n/locale.js';
import type {
  FactionAgent,
  GameState,
  General,
  StrategicCommand,
} from '../src/engine/types.js';
import type { MessageKey } from '../src/i18n/types.js';

interface Args {
  factionId: string;
  months: number;
  lang: 'zh' | 'en';
  seed: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { factionId: 'caocao', months: 60, lang: 'zh', seed: 12345 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--faction') args.factionId = argv[++i] ?? args.factionId;
    else if (a === '--months') args.months = Number(argv[++i] ?? args.months);
    else if (a === '--lang') {
      const v = argv[++i];
      if (v === 'en' || v === 'zh') args.lang = v;
    } else if (a === '--seed') args.seed = Number(argv[++i] ?? args.seed);
  }
  return args;
}

function buildAgents(state: GameState): Record<string, FactionAgent> {
  const agents: Record<string, FactionAgent> = {};
  for (const f of Object.values(state.factions)) {
    if (f.id === state.playerFactionId) continue;
    agents[f.id] = makeDefaultAgent(f.id, f.personality);
  }
  return agents;
}

// Player policy: a deterministic rule that mirrors what a sensible human might
// do — develop the weakest city, recruit when wealthy, attack obvious soft
// targets. Returns the commands to run for this month.
function playerPolicy(state: GameState): StrategicCommand[] {
  const out: StrategicCommand[] = [];
  const mine = citiesOf(state, state.playerFactionId);
  const generals = factionGenerals(state, state.playerFactionId);

  for (const city of mine) {
    const governor = pickGovernor(generals, city.id);
    if (!governor) continue;
    if (city.loyalty < 40) out.push({ kind: 'govern', cityId: city.id, generalId: governor.id });
    else if (city.agriculture < 70) out.push({ kind: 'develop', cityId: city.id, generalId: governor.id });
    else if (city.commerce < 70) out.push({ kind: 'commerce', cityId: city.id, generalId: governor.id });
    else if (governor.stats.zheng >= 75) out.push({ kind: 'search', cityId: city.id, generalId: governor.id });
    else out.push({ kind: 'patrol', cityId: city.id, generalId: governor.id });

    if (city.money > city.garrison * 2 && city.garrison < 15000) {
      out.push({ kind: 'recruit', cityId: city.id, count: 1500 });
    }
  }

  // Conservative offensives: grab adjacent unowned (neutral) cities.
  for (const city of mine) {
    const targets = adjacentCities(state, city.id).filter(
      (n) => n.factionId === null && city.garrison > 3000,
    );
    for (const target of targets) {
      const lead = pickLeads(generals, city.id, 2);
      if (lead.length === 0) continue;
      out.push({
        kind: 'attack',
        fromCityId: city.id,
        toCityId: target.id,
        generalIds: lead.map((g) => g.id),
        troops: Math.min(city.garrison - 1500, 4500),
      });
      break;
    }
  }

  out.push({ kind: 'endTurn' });
  return out;
}

function pickGovernor(generals: General[], cityId: string): General | undefined {
  const here = generals.filter((g) => g.locationCityId === cityId && g.status === 'active');
  return here.sort((a, b) => b.stats.zheng - a.stats.zheng)[0];
}

function pickLeads(generals: General[], cityId: string, count: number): General[] {
  const here = generals.filter((g) => g.locationCityId === cityId && g.status === 'active');
  return here
    .sort((a, b) => b.stats.wu + b.stats.tong - (a.stats.wu + a.stats.tong))
    .slice(0, count);
}

function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function snapshot(state: GameState): string {
  const me = state.factions[state.playerFactionId];
  const t = factionTotals(state, state.playerFactionId);
  const alive = Object.values(state.factions).filter((f) => f.alive).length;
  return [
    `[Y${state.year}.M${String(state.month).padStart(2, '0')} T${state.turn}]`,
    me ? pickName(me.name) : '-',
    `Cities=${t.cities}  Gen=${t.generals}  Troops=${fmtMoney(t.troops)}  Gold=${fmtMoney(t.money)}  Food=${fmtMoney(t.food)}`,
    `AliveFactions=${alive}/${Object.keys(state.factions).length}`,
  ].join(' | ');
}

function describeCmd(cmd: StrategicCommand): string {
  switch (cmd.kind) {
    case 'attack':
      return `attack ${cmd.fromCityId} -> ${cmd.toCityId} w/ ${cmd.troops}`;
    case 'recruit':
      return `recruit ${cmd.count} at ${cmd.cityId}`;
    case 'develop':
    case 'commerce':
    case 'govern':
    case 'patrol':
    case 'search':
      return `${cmd.kind} ${cmd.cityId} (${cmd.generalId})`;
    default:
      return cmd.kind;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  setLocale(args.lang);

  console.log('='.repeat(78));
  console.log(
    `THREE KINGDOMS — playthrough  ·  faction=${args.factionId}  ·  months=${args.months}  ·  seed=${args.seed}  ·  lang=${args.lang}`,
  );
  console.log('='.repeat(78));

  let state = buildInitialState({
    scenario: SCENARIO_DONGZHUO,
    playerFactionId: args.factionId,
    refData: REF_DATA,
    seed: args.seed,
  });

  console.log('Initial state:');
  console.log(' ', snapshot(state));
  const playerFaction = state.factions[args.factionId];
  if (playerFaction) {
    const cities = citiesOf(state, args.factionId)
      .map((c) => pickName(c.name))
      .join(', ');
    console.log(` Player cities: ${cities}`);
    const generals = factionGenerals(state, args.factionId)
      .map((g) => `${pickName(g.name)}(${g.stats.wu}/${g.stats.zhi}/${g.stats.tong}/${g.stats.zheng})`)
      .join(', ');
    console.log(` Generals: ${generals}`);
  }
  console.log('');

  let playerCommandsTotal = 0;
  for (let m = 0; m < args.months; m++) {
    // Player phase
    const policy = playerPolicy(state);
    for (const cmd of policy) {
      state = applyCommand(state, args.factionId, cmd);
      state = {
        ...state,
        actionLog: [...state.actionLog, { turn: state.turn, command: cmd, factionId: args.factionId }],
      };
      if (cmd.kind !== 'endTurn') playerCommandsTotal++;
    }

    const beforeEvents = state.events.length;
    // AI phase + events + settlement + tick
    state = advanceMonth(state, buildAgents(state));
    const newEvents = state.events.slice(beforeEvents);

    if (m < 6 || m % 6 === 0 || newEvents.length > 0) {
      console.log(snapshot(state));
      const lastPlayerCmds = policy.filter((c) => c.kind !== 'endTurn').slice(0, 4);
      if (lastPlayerCmds.length > 0) {
        console.log('  player:', lastPlayerCmds.map(describeCmd).join('; '));
      }
      for (const ev of newEvents) {
        console.log('  EVENT:', ev.id);
      }
      // Echo the latest 3 log lines so we see qualitative results
      const tail = state.log.slice(-3);
      for (const line of tail) {
        console.log('  log:', t(line.key as MessageKey, line.vars).slice(0, 120));
      }
    }

    const outcome = checkOutcome(state);
    if (outcome === 'victory') {
      console.log('');
      console.log('### VICTORY @', `${state.year}.${state.month} (turn ${state.turn})`);
      break;
    }
    if (outcome === 'defeat') {
      console.log('');
      console.log('### DEFEAT @', `${state.year}.${state.month} (turn ${state.turn})`);
      break;
    }
  }

  console.log('');
  console.log('-'.repeat(78));
  console.log('FINAL  ', snapshot(state));
  console.log('Events fired:', state.events.map((e) => `${e.id}@${e.year}.${e.month}`).join('  ') || '(none)');
  console.log(`Player commands run: ${playerCommandsTotal}`);
  const alive = Object.values(state.factions).filter((f) => f.alive);
  console.log('Surviving factions:', alive.map((f) => pickName(f.name)).join(', '));
  console.log('Action log size:', state.actionLog.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
