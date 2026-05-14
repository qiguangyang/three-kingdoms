import React, { useEffect, useMemo, useState } from 'react';
import type { City, GameState, General } from '../../engine/types.js';
import { adjacentCities } from '../../engine/map.js';
import { defectionCost } from '../../engine/recruit.js';
import { pickName, t } from '../../i18n/locale.js';

interface Props {
  game: GameState;
  target: General;
  onClose: () => void;
  // Confirmed dispatch with the chosen origin city. The caller is
  // responsible for actually issuing the engine command and surfacing
  // any post-action report.
  onConfirm: (origin: City, cost: number) => void;
}

export const DefectDialog: React.FC<Props> = ({ game, target, onClose, onConfirm }) => {
  const cost = defectionCost(target);
  const targetCity = target.locationCityId ? game.cities[target.locationCityId] : null;

  // Friendly cities that are both adjacent to the target's city and
  // capable of fronting the bribe.
  const eligibleOrigins = useMemo<City[]>(() => {
    if (!targetCity) return [];
    return adjacentCities(game, targetCity.id).filter(
      (c) => c.factionId === game.playerFactionId,
    );
  }, [game, targetCity]);

  const [originId, setOriginId] = useState<string | null>(
    eligibleOrigins.find((c) => c.money >= cost)?.id ?? eligibleOrigins[0]?.id ?? null,
  );
  const origin = originId ? game.cities[originId] : null;
  const canAfford = origin ? origin.money >= cost : false;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && origin && canAfford) {
        e.preventDefault();
        onConfirm(origin, cost);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onConfirm, origin, canAfford, cost]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/30 backdrop-blur-sm">
      <div className="panel w-[min(28rem,90vw)]" role="dialog" aria-modal="true">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-lg tracking-widest text-ink-800">
            {t('defect.title')}
          </h3>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="ink-divider my-2" />

        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-500">{t('action.target')}</dt>
          <dd className="font-serif font-semibold">
            {pickName(target.name)}{' '}
            <span className="text-[11px] text-ink-500">
              (W{target.stats.wu}/I{target.stats.zhi}/C{target.stats.tong}/P{target.stats.zheng}
              {' · Loy '}{target.loyalty})
            </span>
          </dd>
          <dt className="text-ink-500">{t('defect.cost')}</dt>
          <dd className="font-mono text-seal-700">¥ {cost.toLocaleString()}</dd>
        </dl>

        <div className="ink-divider my-2" />
        <div className="text-xs text-ink-500">{t('defect.offer')}</div>
        {eligibleOrigins.length === 0 ? (
          <div className="mt-1 text-sm italic text-ink-500">
            {t('defect.notAdjacent', {
              from: '—',
              target: targetCity ? pickName(targetCity.name) : '—',
            })}
          </div>
        ) : (
          <ul className="mt-1 grid gap-1">
            {eligibleOrigins.map((c) => {
              const ok = c.money >= cost;
              return (
                <li key={c.id}>
                  <label
                    className={`flex cursor-pointer items-center justify-between rounded border px-2 py-1.5 ${
                      c.id === originId
                        ? 'border-seal-500 bg-seal-500/10'
                        : 'border-ink-300/40 bg-parchment-50/60'
                    } ${ok ? '' : 'opacity-60'}`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="defect-origin"
                        className="accent-seal-500"
                        checked={c.id === originId}
                        onChange={() => setOriginId(c.id)}
                      />
                      <span className="font-serif">{pickName(c.name)}</span>
                    </span>
                    <span className={`font-mono text-xs ${ok ? 'text-ink-700' : 'text-seal-700'}`}>
                      ¥ {c.money.toLocaleString()}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {origin && !canAfford && (
          <div className="mt-2 text-xs italic text-seal-700">
            {t('defect.notEnoughGold', {
              city: pickName(origin.name),
              have: origin.money.toLocaleString(),
              need: cost.toLocaleString(),
            })}
          </div>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>{t('app.cancel')}</button>
          <button
            className="btn btn-primary"
            disabled={!origin || !canAfford}
            onClick={() => origin && canAfford && onConfirm(origin, cost)}
          >
            {t('app.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};
