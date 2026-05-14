import React from 'react';
import type { City, GameState, General, PendingOp } from '../../engine/types.js';
import { adjacentCities } from '../../engine/map.js';
import { defectionCost, isLord } from '../../engine/recruit.js';
import { pickName, t } from '../../i18n/locale.js';
import type { MessageKey } from '../../i18n/types.js';
import { factionColor } from '../theme.js';
import { useSession } from '../hooks/useSession.js';
import { selectLocale } from '../../state/selectors.js';
import { GeneralCard } from './GeneralCard.js';

interface SidebarProps {
  game: GameState;
  selectedCityId: string | null;
  // Optional handler invoked when the player clicks a per-general action
  // button. Sidebar is otherwise read-only; the host screen handles the
  // dispatch + modal.
  onDefect?: (target: General) => void;
  onTransfer?: (general: General) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  game,
  selectedCityId,
  onDefect,
  onTransfer,
}) => {
  useSession(selectLocale);
  const city = selectedCityId ? game.cities[selectedCityId] : undefined;
  return (
    <aside className="flex h-full w-80 flex-col gap-2 overflow-y-auto border-l border-ink-300/40 bg-parchment-100/60 px-3 py-3">
      <PendingOpsPanel game={game} />
      {city ? (
        <CityPanel
          game={game}
          city={city}
          onDefect={onDefect}
          onTransfer={onTransfer}
        />
      ) : (
        <div className="panel">
          <div className="panel-heading">{t('sidebar.city')}</div>
          <div className="text-sm text-ink-500">{t('sidebar.empty')}</div>
          <p className="mt-2 text-xs text-ink-500">
            {t('help.select')} · {t('help.move')}
          </p>
        </div>
      )}
    </aside>
  );
};

const CityPanel: React.FC<{
  game: GameState;
  city: City;
  onDefect?: (target: General) => void;
  onTransfer?: (general: General) => void;
}> = ({ game, city, onDefect, onTransfer }) => {
  const faction = city.factionId ? game.factions[city.factionId] : undefined;
  const adjacent = adjacentCities(game, city.id);
  const playerFactionId = game.playerFactionId;
  const isPlayerCity = city.factionId === playerFactionId;
  const isEnemyCity = !isPlayerCity && city.factionId !== null;
  // Pre-compute whether any player-owned city neighbors this enemy city —
  // a bribe needs an adjacent staging post. If none, defection buttons are
  // disabled regardless of gold.
  const hasAdjacentFriendly = isEnemyCity
    ? adjacent.some((c) => c.factionId === playerFactionId)
    : false;
  return (
    <>
      <div className="panel">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-ink-900">
            {pickName(city.name)}
          </h2>
          <div className="flex items-center gap-2">
            <span
              className="stamp-square text-xs"
              style={{ backgroundColor: factionColor(city.factionId) }}
              aria-hidden
            >
              {faction ? pickName(faction.name)[0] ?? '·' : '·'}
            </span>
            <span className="font-serif text-sm text-ink-700">
              {faction ? pickName(faction.name) : t('sidebar.empty')}
            </span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
          <Bar label={t('sidebar.agriculture')} value={city.agriculture} tone="bg-emerald-600" />
          <Bar label={t('sidebar.commerce')} value={city.commerce} tone="bg-amber-600" />
          <Bar label={t('sidebar.defense')} value={city.defense} tone="bg-stone-600" />
          <Bar label={t('sidebar.loyalty')} value={city.loyalty} tone="bg-seal-500" />
        </div>
        <div className="mt-3 flex justify-between text-xs text-ink-600">
          <span>
            {t('sidebar.garrison')}:{' '}
            <span className="font-semibold text-ink-800">{city.garrison.toLocaleString()}</span>
          </span>
          <span>
            {t('common.gold')}: {city.money.toLocaleString()} ·{' '}
            {t('common.grain')}: {city.food.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading">{t('sidebar.generals')}</div>
        {city.generals.length === 0 ? (
          <div className="text-xs text-ink-500">—</div>
        ) : (
          <div className="flex flex-col gap-2">
            {city.generals.map((gid) => {
              const g = game.generals[gid];
              if (!g) return null;
              let actions: React.ReactNode = null;
              if (isPlayerCity && onTransfer) {
                actions = (
                  <button
                    className="btn btn-ghost px-2 py-0.5 text-[11px]"
                    onClick={() => onTransfer(g)}
                  >
                    {t('transfer.button')}
                  </button>
                );
              } else if (isEnemyCity && onDefect) {
                const cost = defectionCost(g);
                const lord = isLord(game, g);
                actions = lord ? (
                  <span className="text-[11px] italic text-ink-500">
                    {t('defect.cannotLord')}
                  </span>
                ) : (
                  <button
                    className="btn btn-ghost px-2 py-0.5 text-[11px]"
                    disabled={!hasAdjacentFriendly}
                    title={
                      hasAdjacentFriendly
                        ? undefined
                        : t('defect.notAdjacent', {
                            from: '—',
                            target: pickName(city.name),
                          })
                    }
                    onClick={() => onDefect(g)}
                  >
                    {t('defect.button', { cost: cost.toLocaleString() })}
                  </button>
                );
              }
              return <GeneralCard key={gid} general={g} compact actions={actions} />;
            })}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-heading">{t('sidebar.adjacent')}</div>
        <div className="flex flex-wrap gap-1">
          {adjacent.slice(0, 8).map((c) => (
            <span
              key={c.id}
              className="rounded border border-ink-300/40 bg-parchment-50 px-2 py-0.5 text-xs"
              style={{ borderColor: factionColor(c.factionId) }}
            >
              {pickName(c.name)}
            </span>
          ))}
        </div>
      </div>
    </>
  );
};

// Persistent-game pending operations: lists every op the player faction
// has in flight, with days-remaining out of total. Sieges and marches
// show their geography; internal ops show their target city.
const PendingOpsPanel: React.FC<{ game: GameState }> = ({ game }) => {
  const playerOps = game.pendingOps.filter((op) => op.factionId === game.playerFactionId);
  if (playerOps.length === 0) return null;
  return (
    <div className="panel">
      <div className="panel-heading">{t('op.heading')}</div>
      <ul className="flex flex-col gap-1.5 text-xs">
        {playerOps.map((op) => (
          <li key={op.id} className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-serif">{describeOp(op, game)}</span>
              <span className="font-mono text-[10px] text-ink-500">
                {t('op.daysRemaining', { days: op.daysRemaining })}
              </span>
            </div>
            <div className="stat-bar h-1">
              <span
                className="bg-seal-500"
                style={{
                  width: `${(1 - op.daysRemaining / Math.max(1, op.durationDays)) * 100}%`,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

function describeOp(op: PendingOp, game: GameState): string {
  const cityName = (id: string): string => {
    const c = game.cities[id];
    return c ? pickName(c.name) : id;
  };
  switch (op.kind) {
    case 'develop':
    case 'commerce':
    case 'govern':
    case 'patrol':
    case 'search':
      return t(`op.${op.kind}` as MessageKey, { city: cityName(op.cityId) });
    case 'recruit':
      return t('op.recruit', { city: cityName(op.cityId), count: op.count });
    case 'plunder':
      return t('op.plunder', { city: cityName(op.cityId) });
    case 'defect': {
      const target = game.generals[op.targetGeneralId];
      return t('op.defect', {
        target: target ? pickName(target.name) : op.targetGeneralId,
      });
    }
    case 'march': {
      const intent = op.intent === 'attack' ? t('op.intent.attack') : t('op.intent.reinforce');
      return `${intent}: ${t('op.march', { from: cityName(op.fromCityId), to: cityName(op.toCityId) })}`;
    }
    case 'siege':
      return t('op.siege', { city: cityName(op.targetCityId) });
  }
}

const Bar: React.FC<{ label: string; value: number; tone: string }> = ({ label, value, tone }) => (
  <div className="flex items-center gap-2">
    <span className="w-9 font-serif text-xs text-ink-600">{label}</span>
    <div className="stat-bar flex-1">
      <span className={tone} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
    <span className="w-7 text-right font-mono text-xs tabular-nums text-ink-700">{value}</span>
  </div>
);
