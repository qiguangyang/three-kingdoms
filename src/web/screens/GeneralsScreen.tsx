import React, { useEffect, useMemo, useState } from 'react';
import { useSession } from '../hooks/useSession.js';
import { selectGame, selectLocale } from '../../state/selectors.js';
import { setScreen } from '../../state/store.js';
import { pickName, t } from '../../i18n/locale.js';
import type {
  City,
  GameState,
  General,
  StrategicCommand,
} from '../../engine/types.js';
import { factionGenerals } from '../../engine/selectors.js';
import { GeneralCard } from '../components/GeneralCard.js';

// A roster view: lists every player-controlled general grouped by their
// current city, with a right pane showing recent strategic-command
// history for whichever general is focused.
export const GeneralsScreen: React.FC = () => {
  useSession(selectLocale);
  const game = useSession(selectGame);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'i' || e.key === 'Backspace') {
        e.preventDefault();
        setScreen({ kind: 'main' });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const grouped = useMemo(() => groupByCity(game), [game]);
  const active = game && activeId ? game.generals[activeId] : null;

  if (!game) return null;

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-3 px-6 py-6">
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl tracking-widest text-ink-800">
          {t('generals.title')}
        </h2>
        <button className="btn-ghost text-sm" onClick={() => setScreen({ kind: 'main' })}>
          {t('app.back')}
        </button>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden md:grid-cols-[1.6fr,1fr]">
        <div className="overflow-y-auto">
          {grouped.length === 0 ? (
            <div className="panel text-sm text-ink-500">—</div>
          ) : (
            grouped.map(({ city, generals }) => (
              <section key={city?.id ?? '__nowhere__'} className="mb-3">
                <div className="panel-heading">
                  {city
                    ? t('generals.atCity', { city: city.name })
                    : t('sidebar.empty')}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {generals.map((g) => (
                    <button
                      key={g.id}
                      className={`text-left ${
                        g.id === activeId ? 'ring-2 ring-seal-500/40' : ''
                      } rounded`}
                      onClick={() => setActiveId(g.id)}
                    >
                      <GeneralCard general={g} compact />
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        <aside className="overflow-y-auto">
          <div className="panel">
            <div className="panel-heading">{t('generals.recentActivity')}</div>
            {active ? (
              <ActivityList game={game} general={active} />
            ) : (
              <div className="text-xs text-ink-500">{t('help.select')}</div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

// Compose a city-grouped roster of the player's generals.
interface RosterGroup {
  city: City | null;
  generals: General[];
}

function groupByCity(game: GameState | null): RosterGroup[] {
  if (!game) return [];
  const groups = new Map<string | null, General[]>();
  for (const g of factionGenerals(game, game.playerFactionId)) {
    const key = g.locationCityId;
    const list = groups.get(key) ?? [];
    list.push(g);
    groups.set(key, list);
  }
  const out: RosterGroup[] = [];
  // Player-owned cities first, in the order they appear in the cities map.
  for (const city of Object.values(game.cities)) {
    if (city.factionId !== game.playerFactionId) continue;
    const list = groups.get(city.id);
    if (list && list.length > 0) {
      out.push({ city, generals: list });
      groups.delete(city.id);
    }
  }
  // Generals stuck without a city (e.g., wounded retreating) go at the end.
  for (const [key, list] of groups.entries()) {
    if (key === null && list.length > 0) {
      out.push({ city: null, generals: list });
    }
  }
  return out;
}

// Render the last ~10 strategic commands issued by this general's faction
// that referenced this general specifically.
const ActivityList: React.FC<{ game: GameState; general: General }> = ({ game, general }) => {
  const entries = useMemo(
    () => filterActionLog(game, general).slice(-10).reverse(),
    [game, general],
  );
  if (entries.length === 0) {
    return <div className="text-xs italic text-ink-500">{t('generals.noActivity')}</div>;
  }
  return (
    <ul className="flex flex-col gap-1 text-xs text-ink-800">
      {entries.map((e, i) => (
        <li key={i} className="flex gap-2">
          <span className="font-mono text-[10px] text-ink-500">T{e.turn}</span>
          <span>{e.summary}</span>
        </li>
      ))}
    </ul>
  );
};

interface ActivityEntry {
  turn: number;
  summary: string;
}

function filterActionLog(game: GameState, general: General): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (const log of game.actionLog) {
    if (log.factionId !== general.factionId) continue;
    const summary = summarizeForGeneral(log.command, general.id, game);
    if (summary) out.push({ turn: log.turn, summary });
  }
  return out;
}

function summarizeForGeneral(
  command: StrategicCommand,
  generalId: string,
  game: GameState,
): string | null {
  // Map each command kind into a localized one-liner if it references this
  // general. Returns null when the command doesn't involve this general so
  // we can skip it.
  const city = (id: string): string => {
    const c = game.cities[id];
    return c ? pickName(c.name) : id;
  };
  switch (command.kind) {
    case 'develop':
      return command.generalId === generalId
        ? t('generals.action.develop', { city: city(command.cityId) })
        : null;
    case 'commerce':
      return command.generalId === generalId
        ? t('generals.action.commerce', { city: city(command.cityId) })
        : null;
    case 'govern':
      return command.generalId === generalId
        ? t('generals.action.govern', { city: city(command.cityId) })
        : null;
    case 'patrol':
      return command.generalId === generalId
        ? t('generals.action.patrol', { city: city(command.cityId) })
        : null;
    case 'search':
      return command.generalId === generalId
        ? t('generals.action.search', { city: city(command.cityId) })
        : null;
    case 'attack':
      return command.generalIds.includes(generalId)
        ? t('generals.action.attack', { city: city(command.toCityId) })
        : null;
    case 'move':
      return command.generalIds.includes(generalId)
        ? t('generals.action.move', { city: city(command.toCityId) })
        : null;
    case 'defect': {
      const target = game.generals[command.targetGeneralId];
      // The bribe is initiated by the faction, not an individual; we
      // surface it on every general roster so the player can see the
      // diplomatic move.
      return target
        ? t('generals.action.defect', { target: pickName(target.name) })
        : null;
    }
    case 'recruit':
      // Recruit lacks a per-general anchor; skip to avoid noise.
      return null;
    case 'plunder':
    case 'hireWild':
    case 'endTurn':
      return null;
  }
}
