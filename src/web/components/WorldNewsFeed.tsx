import React, { useState } from 'react';
import type { GameState } from '../../engine/types.js';
import { t } from '../../i18n/locale.js';
import type { MessageKey } from '../../i18n/types.js';
import { useSession } from '../hooks/useSession.js';
import { selectLocale } from '../../state/selectors.js';

type NewsFilter = 'all' | 'mine' | 'world';

interface WorldNewsFeedProps {
  game: GameState;
  lines?: number;
}

// Filterable, scrollable chronicle of log entries. "World" shows only
// entries tagged with a faction other than the player's.
export const WorldNewsFeed: React.FC<WorldNewsFeedProps> = ({ game, lines = 50 }) => {
  useSession(selectLocale);
  const [filter, setFilter] = useState<NewsFilter>('all');
  const player = game.playerFactionId;
  const filtered = game.log.filter((entry) => {
    if (filter === 'all') return true;
    if (filter === 'mine') return entry.factionId === player;
    return entry.factionId !== undefined && entry.factionId !== player;
  });
  const tail = filtered.slice(-lines);
  return (
    <div className="panel bamboo max-h-44 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div className="panel-heading">{t('news.heading')}</div>
        <div className="flex gap-1" role="tablist">
          {(['all', 'mine', 'world'] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                filter === f
                  ? 'bg-seal-500 text-parchment-50'
                  : 'bg-parchment-50 text-ink-600'
              }`}
              onClick={() => setFilter(f)}
            >
              {t(`news.filter.${f}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>
      {tail.length === 0 ? (
        <div className="text-xs text-ink-500">{t('news.empty')}</div>
      ) : (
        <ul className="flex flex-col gap-0.5 text-xs text-ink-800">
          {tail.map((entry, i) => (
            <li key={`${entry.turn}-${i}`} className="flex gap-2">
              <span className="font-mono text-[10px] text-ink-500">
                {entry.year}.{String(entry.month).padStart(2, '0')}
              </span>
              <span>{t(entry.key as MessageKey, entry.vars)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
