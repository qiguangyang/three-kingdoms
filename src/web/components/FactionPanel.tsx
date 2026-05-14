import React from 'react';
import type { GameState } from '../../engine/types.js';
import { factionRankings } from '../../engine/selectors.js';
import { pickName, t } from '../../i18n/locale.js';
import { factionColor } from '../theme.js';
import { useSession } from '../hooks/useSession.js';
import { selectLocale } from '../../state/selectors.js';

interface FactionPanelProps {
  game: GameState;
}

// Power ranking of every faction — tells the player where they stand and
// who the threats are.
export const FactionPanel: React.FC<FactionPanelProps> = ({ game }) => {
  useSession(selectLocale);
  const rankings = factionRankings(game);
  return (
    <div className="panel">
      <div className="panel-heading">{t('faction.rankHeading')}</div>
      <ul className="flex flex-col gap-1 text-xs">
        {rankings.map((r) => (
          <li
            key={r.factionId}
            data-faction={r.factionId}
            className={`flex items-center gap-2 ${r.alive ? '' : 'opacity-40'}`}
          >
            <span className="w-4 text-right font-mono text-ink-500">{r.rank}</span>
            <span
              className="stamp-square text-[10px]"
              style={{ backgroundColor: factionColor(r.factionId) }}
              aria-hidden
            >
              {pickName(r.name)[0] ?? '·'}
            </span>
            <span className="flex-1 font-serif text-ink-800">
              {pickName(r.name)}
              {r.factionId === game.playerFactionId && (
                <span className="ml-1 text-seal-500">{t('faction.you')}</span>
              )}
            </span>
            {r.alive ? (
              <span className="font-mono tabular-nums text-ink-600">
                {t('status.cities')} {r.cities} · {r.troops.toLocaleString()}
              </span>
            ) : (
              <span className="italic text-ink-500">{t('faction.eliminated')}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
