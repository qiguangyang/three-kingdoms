import React, { useEffect, useMemo, useState } from 'react';
import type { City, GameState, General } from '../../engine/types.js';
import { marchDuration } from '../../engine/pendingOp.js';
import { pickName, t } from '../../i18n/locale.js';

interface Props {
  game: GameState;
  general: General;
  onClose: () => void;
  onConfirm: (origin: City, destination: City, troops: number) => void;
}

export const TransferDialog: React.FC<Props> = ({ game, general, onClose, onConfirm }) => {
  const originCity = general.locationCityId ? game.cities[general.locationCityId] : null;
  // Transfer is intra-faction movement — allow any friendly city, not
  // just adjacent neighbors. Distance just stretches march duration.
  // Sorted nearest-first so the most likely picks bubble to the top.
  const targets = useMemo<City[]>(() => {
    if (!originCity) return [];
    const candidates = Object.values(game.cities).filter(
      (c) => c.factionId === game.playerFactionId && c.id !== originCity.id,
    );
    candidates.sort((a, b) => marchDuration(originCity, a) - marchDuration(originCity, b));
    return candidates;
  }, [game, originCity]);

  const [destinationId, setDestinationId] = useState<string | null>(targets[0]?.id ?? null);
  const [troops, setTroops] = useState(0);

  const destination = destinationId ? game.cities[destinationId] : null;
  const maxTroops = originCity ? Math.max(0, originCity.garrison - 500) : 0; // keep 500 home garrison

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && originCity && destination) {
        e.preventDefault();
        onConfirm(originCity, destination, Math.min(troops, maxTroops));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onConfirm, originCity, destination, troops, maxTroops]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/30 backdrop-blur-sm">
      <div className="panel w-[min(28rem,90vw)]" role="dialog" aria-modal="true">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-lg tracking-widest text-ink-800">
            {t('transfer.title')}
          </h3>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="ink-divider my-2" />

        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-500">{t('action.executor')}</dt>
          <dd className="font-serif font-semibold">{pickName(general.name)}</dd>
          {originCity && (
            <>
              <dt className="text-ink-500">{t('action.target')}</dt>
              <dd className="font-serif">{pickName(originCity.name)}</dd>
            </>
          )}
        </dl>

        <div className="ink-divider my-2" />
        <div className="text-xs text-ink-500">{t('transfer.target')}</div>
        {targets.length === 0 ? (
          <div className="mt-1 text-sm italic text-ink-500">{t('transfer.noTarget')}</div>
        ) : (
          <ul className="mt-1 grid gap-1">
            {targets.map((c) => {
              const days = originCity ? marchDuration(originCity, c) : 0;
              return (
                <li key={c.id}>
                  <label
                    className={`flex cursor-pointer items-center justify-between rounded border px-2 py-1.5 ${
                      c.id === destinationId
                        ? 'border-seal-500 bg-seal-500/10'
                        : 'border-ink-300/40 bg-parchment-50/60'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="transfer-target"
                        className="accent-seal-500"
                        checked={c.id === destinationId}
                        onChange={() => setDestinationId(c.id)}
                      />
                      <span className="font-serif">{pickName(c.name)}</span>
                    </span>
                    <span className="font-mono text-xs text-ink-500">
                      {c.garrison.toLocaleString()} {t('status.troops')} ·{' '}
                      {t('op.daysRemaining', { days })}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {originCity && targets.length > 0 && (
          <div className="mt-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-ink-500">{t('transfer.troops')}</span>
              <input
                type="number"
                className="w-24 rounded border border-ink-300/60 bg-parchment-50 px-2 py-1 text-right font-mono text-sm"
                min={0}
                max={maxTroops}
                value={troops}
                onChange={(e) =>
                  setTroops(
                    Math.max(0, Math.min(maxTroops, Number(e.target.value) || 0)),
                  )
                }
              />
              <span className="text-[11px] text-ink-500">
                / {maxTroops.toLocaleString()}
              </span>
            </label>
          </div>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onClose}>{t('app.cancel')}</button>
          <button
            className="btn btn-primary"
            disabled={!originCity || !destination}
            onClick={() =>
              originCity &&
              destination &&
              onConfirm(originCity, destination, Math.min(troops, maxTroops))
            }
          >
            {t('app.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};
