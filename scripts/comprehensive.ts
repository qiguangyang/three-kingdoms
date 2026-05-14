// Run six playthroughs side-by-side so we can see how each faction fares.
// One-shot script that compresses the per-faction snapshots into a table.

import { buildInitialState } from '../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../src/data/index.js';
import { advanceMonth, applyCommand, checkOutcome } from '../src/engine/turn.js';
import { makeDefaultAgent } from '../src/engine/ai/index.js';
import { factionGenerals, factionTotals } from '../src/engine/selectors.js';
import { adjacentCities, citiesOf } from '../src/engine/map.js';
import { pickName, setLocale } from '../src/i18n/locale.js';
import type {
  FactionAgent,
  GameState,
  General,
  StrategicCommand,
} from '../src/engine/types.js';

setLocale('en');

const FACTIONS = ['dongzhuo', 'yuanshao', 'caocao', 'liubei', 'sunjian', 'liubiao'];
const MONTHS = 60;
const SEED = 31337;

function policy(state: GameState): StrategicCommand[] {
  const out: StrategicCommand[] = [];
  const mine = citiesOf(state, state.playerFactionId);
  const generals = factionGenerals(state, state.playerFactionId);
  for (const city of mine) {
    const here = generals.filter((g) => g.locationCityId === city.id);
    const governor = here.sort((a, b) => b.stats.zheng - a.stats.zheng)[0];
    if (!governor) continue;
    if (city.loyalty < 40) out.push({ kind: 'govern', cityId: city.id, generalId: governor.id });
    else if (city.agriculture < 70) out.push({ kind: 'develop', cityId: city.id, generalId: governor.id });
    else if (city.commerce < 70) out.push({ kind: 'commerce', cityId: city.id, generalId: governor.id });
    else out.push({ kind: 'patrol', cityId: city.id, generalId: governor.id });
    if (city.money > city.garrison * 2 && city.garrison < 15000) {
      out.push({ kind: 'recruit', cityId: city.id, count: 1500 });
    }
  }
  for (const city of mine) {
    const targets = adjacentCities(state, city.id).filter(
      (n) => n.factionId === null && city.garrison > 3500,
    );
    for (const target of targets) {
      const here = generals.filter((g) => g.locationCityId === city.id);
      const lead = here
        .sort((a: General, b: General) => b.stats.wu + b.stats.tong - (a.stats.wu + a.stats.tong))
        .slice(0, 2);
      if (lead.length === 0) continue;
      out.push({
        kind: 'attack',
        fromCityId: city.id,
        toCityId: target.id,
        generalIds: lead.map((g) => g.id),
        troops: Math.min(city.garrison - 2000, 5000),
      });
      break;
    }
  }
  out.push({ kind: 'endTurn' });
  return out;
}

function play(factionId: string) {
  let state = buildInitialState({
    scenario: SCENARIO_DONGZHUO,
    playerFactionId: factionId,
    refData: REF_DATA,
    seed: SEED,
  });
  const agents: Record<string, FactionAgent> = {};
  for (const f of Object.values(state.factions)) {
    if (f.id === factionId) continue;
    agents[f.id] = makeDefaultAgent(f.id, f.personality);
  }
  let endedAt = MONTHS;
  let outcome: 'victory' | 'defeat' | 'ongoing' = 'ongoing';
  for (let m = 0; m < MONTHS; m++) {
    for (const cmd of policy(state)) {
      state = applyCommand(state, factionId, cmd);
      state = {
        ...state,
        actionLog: [...state.actionLog, { turn: state.turn, command: cmd, factionId }],
      };
    }
    state = advanceMonth(state, agents);
    const o = checkOutcome(state);
    if (o === 'victory') {
      outcome = 'victory';
      endedAt = m + 1;
      break;
    }
    if (o === 'defeat') {
      outcome = 'defeat';
      endedAt = m + 1;
      break;
    }
  }
  const totals = factionTotals(state, factionId);
  return {
    factionId,
    factionName: pickName(state.factions[factionId]!.name),
    outcome,
    endedAt,
    cities: totals.cities,
    generals: totals.generals,
    troops: totals.troops,
    money: totals.money,
    food: totals.food,
    events: state.events.map((e) => e.id),
    actionLogSize: state.actionLog.length,
    aliveFactions: Object.values(state.factions).filter((f) => f.alive).length,
  };
}

const results = FACTIONS.map(play);

console.log('THREE KINGDOMS — comprehensive playthrough  (seed=' + SEED + ', up to ' + MONTHS + ' months)\n');
const header = ['Faction', 'Outcome', 'Months', 'Cities', 'Generals', 'Troops', 'Gold', 'Food', 'EventsFired'];
function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
const rows: string[][] = [header];
for (const r of results) {
  rows.push([
    r.factionName,
    r.outcome,
    String(r.endedAt),
    String(r.cities),
    String(r.generals),
    fmt(r.troops),
    fmt(r.money),
    fmt(r.food),
    String(r.events.length),
  ]);
}
const widths = header.map((_, c) => Math.max(...rows.map((row) => row[c]!.length)));
for (const row of rows) {
  console.log(row.map((cell, c) => cell.padEnd(widths[c]!)).join('  '));
}

console.log('\nEvent log (all factions):');
const allEvents = new Set<string>();
for (const r of results) for (const e of r.events) allEvents.add(e);
for (const e of allEvents) console.log('  •', e);
