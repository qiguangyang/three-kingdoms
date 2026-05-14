import React from 'react';
import type { General, TroopType } from '../../engine/types.js';
import { pickName, t } from '../../i18n/locale.js';
import type { MessageKey } from '../../i18n/types.js';

const TROOP_KEY: Record<TroopType, MessageKey> = {
  infantry: 'troop.infantry',
  archer: 'troop.archer',
  cavalry: 'troop.cavalry',
  heavyCav: 'troop.heavyCav',
  navy: 'troop.navy',
  xuan: 'troop.xuan',
};

// Statistical heat color used for the four-stat bars.
function statTone(v: number): string {
  if (v >= 95) return 'bg-seal-500';
  if (v >= 85) return 'bg-amber-600';
  if (v >= 75) return 'bg-emerald-600';
  if (v >= 60) return 'bg-stone-500';
  return 'bg-stone-300';
}

interface GeneralCardProps {
  general: General;
  compact?: boolean;
  // Optional action slot rendered at the bottom (e.g., defect / transfer
  // buttons). Sidebar populates this based on whether the selected city
  // belongs to the player or to a rival.
  actions?: React.ReactNode;
}

export const GeneralCard: React.FC<GeneralCardProps> = ({
  general,
  compact = false,
  actions,
}) => {
  const s = general.stats;
  return (
    <div className={`panel ${compact ? 'p-2' : ''}`}>
      <div className="flex items-baseline justify-between">
        <div className="font-serif text-base font-semibold text-ink-800">
          {pickName(general.name)}
        </div>
        <div className="font-display text-[10px] uppercase tracking-widest text-ink-500">
          {t(TROOP_KEY[general.troopType])} · {general.age}{t('general.age')}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <StatBar label={t('general.wu')} value={s.wu} tone={statTone(s.wu)} />
        <StatBar label={t('general.zhi')} value={s.zhi} tone={statTone(s.zhi)} />
        <StatBar label={t('general.tong')} value={s.tong} tone={statTone(s.tong)} />
        <StatBar label={t('general.zheng')} value={s.zheng} tone={statTone(s.zheng)} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {general.troops > 0 && !compact ? (
          <span className="text-xs text-ink-600">
            {t('general.troops')}:{' '}
            <span className="font-semibold">{general.troops}</span>
          </span>
        ) : (
          <span />
        )}
        {actions && <div className="flex gap-1">{actions}</div>}
      </div>
    </div>
  );
};

const StatBar: React.FC<{ label: string; value: number; tone: string }> = ({ label, value, tone }) => (
  <div className="flex items-center gap-2">
    <span className="w-5 font-serif text-xs text-ink-600">{label}</span>
    <div className="stat-bar flex-1">
      <span className={tone} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
    <span className="w-7 text-right font-mono text-xs tabular-nums text-ink-700">{value}</span>
  </div>
);
