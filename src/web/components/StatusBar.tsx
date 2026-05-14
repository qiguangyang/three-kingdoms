import React from 'react';
import type { GameState } from '../../engine/types.js';
import { factionTotals } from '../../engine/selectors.js';
import { pickName, t } from '../../i18n/locale.js';
import { useSession } from '../hooks/useSession.js';
import { selectLocale } from '../../state/selectors.js';
import { factionColor } from '../theme.js';

interface StatusBarProps {
  game: GameState;
}

// Top banner: showing the calendar, the active faction's seal, and the
// pooled resources. The colorful chips on the right are deliberately small
// so they don't compete with the map for attention.
export const StatusBar: React.FC<StatusBarProps> = ({ game }) => {
  useSession(selectLocale); // re-render on locale change
  const faction = game.factions[game.playerFactionId];
  const totals = faction
    ? factionTotals(game, faction.id)
    : { money: 0, food: 0, troops: 0, cities: 0, generals: 0 };
  return (
    <header className="flex items-center gap-4 border-b border-ink-300/40 bg-parchment-100/70 px-4 py-2 shadow-sm">
      <div className="font-display text-lg tracking-widest text-ink-700">
        {t('status.month_long', { year: game.year, month: game.month })}
        <span className="ml-2 font-mono text-xs text-ink-500">
          D{game.day}/30
        </span>
      </div>
      <div className="ink-divider mx-2 hidden h-6 w-px bg-ink-300/50 sm:block" />
      {faction && (
        <div className="flex items-center gap-2">
          <span
            className="stamp-square"
            style={{ backgroundColor: factionColor(faction.id) }}
            aria-hidden
          >
            {faction.id === '__neutral__' ? '·' : (pickName(faction.name)[0] ?? '·')}
          </span>
          <span className="font-serif text-base font-semibold text-ink-800">
            {pickName(faction.name)}
          </span>
        </div>
      )}
      <div className="ml-auto flex items-center gap-3 text-sm">
        <Chip label={t('status.cities')} value={totals.cities} accent="amber" />
        <Chip label={t('status.troops')} value={formatNum(totals.troops)} accent="rose" />
        <Chip label={t('status.money')} value={formatNum(totals.money)} accent="yellow" />
        <Chip label={t('status.food')} value={formatNum(totals.food)} accent="green" />
      </div>
    </header>
  );
};

const Chip: React.FC<{ label: string; value: string | number; accent: 'amber' | 'rose' | 'yellow' | 'green' }> = ({
  label,
  value,
  accent,
}) => {
  const tone = {
    amber: 'text-amber-800',
    rose: 'text-seal-700',
    yellow: 'text-yellow-800',
    green: 'text-emerald-800',
  }[accent];
  return (
    <span className="inline-flex items-center gap-1 rounded border border-ink-300/40 bg-parchment-50 px-2 py-0.5 shadow-sm">
      <span className="font-display text-[10px] uppercase tracking-widest text-ink-500">
        {label}
      </span>
      <span className={`font-serif font-semibold ${tone}`}>{value}</span>
    </span>
  );
};

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}
