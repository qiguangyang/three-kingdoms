import React, { useEffect } from 'react';
import { pickName, t } from '../../i18n/locale.js';
import type { City, General, LocalizedString } from '../../engine/types.js';
import type { MessageKey } from '../../i18n/types.js';

export type ActionKind = 'develop' | 'commerce' | 'govern' | 'patrol' | 'search' | 'recruit';

export interface StatDelta {
  label: string;
  before: number;
  after: number;
  // Higher is better by default. Set negative=true when a drop is desirable
  // (rare for these commands but kept for symmetry).
  negative?: boolean;
}

export interface ActionResultData {
  kind: ActionKind;
  city: City;
  general: General | null;
  // Numeric stat changes (agriculture/commerce/loyalty/garrison/money/food).
  deltas: StatDelta[];
  // Optional recruit found via search (LocalizedString name).
  found?: LocalizedString | null;
}

interface Props {
  data: ActionResultData;
  onClose: () => void;
}

const TITLE_KEY: Record<ActionKind, MessageKey> = {
  develop: 'action.develop.title',
  commerce: 'action.commerce.title',
  govern: 'action.govern.title',
  patrol: 'action.patrol.title',
  search: 'action.search.title',
  recruit: 'action.recruit.title',
};

export const ActionResult: React.FC<Props> = ({ data, onClose }) => {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const meaningful = data.deltas.filter((d) => d.after !== d.before);
  const isSearchEmpty = data.kind === 'search' && !data.found;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/30 backdrop-blur-sm">
      <div className="panel w-[min(28rem,90vw)]" role="dialog" aria-modal="true">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-lg tracking-widest text-ink-800">
            {t(TITLE_KEY[data.kind])}
          </h3>
          <span className="font-display text-[10px] uppercase tracking-widest text-ink-500">
            {t('action.report')}
          </span>
        </div>
        <div className="ink-divider my-2" />

        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-500">{t('action.target')}</dt>
          <dd className="font-serif font-semibold">{pickName(data.city.name)}</dd>
          {data.general && (
            <>
              <dt className="text-ink-500">{t('action.executor')}</dt>
              <dd className="font-serif">
                {pickName(data.general.name)}{' '}
                <span className="text-[11px] text-ink-500">
                  (W{data.general.stats.wu}/I{data.general.stats.zhi}/P{data.general.stats.zheng})
                </span>
              </dd>
            </>
          )}
        </dl>

        <div className="ink-divider my-2" />

        {data.found && (
          <div className="mb-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-sm text-emerald-800">
            {t('action.found', { target: data.found })}
          </div>
        )}

        {isSearchEmpty && (
          <div className="text-sm italic text-ink-500">{t('action.nothingFound')}</div>
        )}

        {meaningful.length > 0 ? (
          <ul className="space-y-1.5">
            {meaningful.map((d) => (
              <DeltaRow key={d.label} delta={d} />
            ))}
          </ul>
        ) : !isSearchEmpty && !data.found ? (
          <div className="text-sm italic text-ink-500">{t('action.noChange')}</div>
        ) : null}

        <div className="mt-3 flex justify-end">
          <button className="btn btn-primary" onClick={onClose} autoFocus>
            {t('app.continue')}
          </button>
        </div>
      </div>
    </div>
  );
};

// --------------------------------------------------- before/after row

const DeltaRow: React.FC<{ delta: StatDelta }> = ({ delta }) => {
  const change = delta.after - delta.before;
  const isPositive = delta.negative ? change < 0 : change > 0;
  const tone = isPositive ? 'text-emerald-700' : change === 0 ? 'text-ink-600' : 'text-seal-700';
  const sign = change > 0 ? '+' : '';
  // Cap the bar at 100 for percentage-like stats; for absolute counters
  // (garrison/money/food), the bar is proportional within the row's own
  // range.
  const max = Math.max(delta.after, delta.before, 100);
  const beforePct = clampPct((delta.before / max) * 100);
  const afterPct = clampPct((delta.after / max) * 100);
  return (
    <li className="grid grid-cols-[6rem,1fr,auto] items-center gap-2 text-xs">
      <span className="text-ink-600">{delta.label}</span>
      <div className="relative h-2 overflow-hidden rounded bg-ink-100">
        <div
          className="absolute inset-y-0 left-0 bg-ink-400/50"
          style={{ width: `${beforePct}%` }}
        />
        <div
          className={`absolute inset-y-0 left-0 ${
            isPositive ? 'bg-emerald-500/70' : 'bg-seal-500/70'
          }`}
          style={{ width: `${afterPct}%` }}
        />
      </div>
      <span className={`font-mono ${tone}`}>
        {delta.before.toLocaleString()}
        <span className="mx-1 text-ink-400">→</span>
        {delta.after.toLocaleString()}{' '}
        <span className="ml-1">
          ({sign}
          {change.toLocaleString()})
        </span>
      </span>
    </li>
  );
};

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}
