import React from 'react';
import type { GameState } from '../../engine/types.js';
import { t } from '../../i18n/locale.js';
import type { MessageKey } from '../../i18n/types.js';
import { useSession } from '../hooks/useSession.js';
import { selectLocale } from '../../state/selectors.js';

interface EventLogProps {
  game: GameState;
  lines?: number;
}

export const EventLog: React.FC<EventLogProps> = ({ game, lines = 6 }) => {
  useSession(selectLocale);
  const tail = game.log.slice(-lines);
  return (
    <div className="panel mt-2 max-h-44 overflow-y-auto bamboo">
      <div className="panel-heading">Log</div>
      {tail.length === 0 ? (
        <div className="text-xs text-ink-500">—</div>
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
