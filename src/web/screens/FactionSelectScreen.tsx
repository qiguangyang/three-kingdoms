import React, { useState } from 'react';
import { SCENARIOS } from '../../data/scenarios/index.js';
import { newGame, setScreen, toggleLocale } from '../../state/store.js';
import { pickName, t } from '../../i18n/locale.js';
import { useSession } from '../hooks/useSession.js';
import { selectLocale } from '../../state/selectors.js';
import { factionColor } from '../theme.js';
import { useMenuKeys } from '../hooks/useMenuKeys.js';

interface Props {
  scenarioId: string;
}

export const FactionSelectScreen: React.FC<Props> = ({ scenarioId }) => {
  useSession(selectLocale);
  const scenario = SCENARIOS[scenarioId];
  const [active, setActive] = useState(0);

  function selectActive(i: number) {
    if (!scenario) return;
    const f = scenario.factions[i];
    if (!f) return;
    newGame(scenario, f.id, Date.now() & 0xffffffff);
  }

  useMenuKeys({
    count: scenario?.factions.length ?? 0,
    active,
    setActive,
    onSelect: selectActive,
    onBack: () => setScreen({ kind: 'scenarioSelect' }),
  });

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'g') {
        e.preventDefault();
        toggleLocale();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Auto-scroll the active list item into view (helps with long lists).
  const listRef = React.useRef<HTMLUListElement | null>(null);
  React.useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!scenario) {
    return <div className="p-6">Scenario not found.</div>;
  }
  const f = scenario.factions[active];
  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 px-6 py-8">
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl tracking-widest text-ink-800">
          {t('factionSelect.heading')} ·{' '}
          <span className="font-serif text-ink-600">{pickName(scenario.name)}</span>
        </h2>
        <div className="flex gap-2">
          <button className="btn-ghost text-sm" onClick={toggleLocale}>
            中 / EN
          </button>
          <button
            className="btn-ghost text-sm"
            onClick={() => setScreen({ kind: 'scenarioSelect' })}
          >
            {t('app.back')}
          </button>
        </div>
      </header>
      <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-[1fr,1.4fr]">
        <ul
          ref={listRef}
          className="panel grid max-h-[60vh] grid-cols-1 gap-1 overflow-y-auto"
        >
          {scenario.factions.map((fac, i) => (
            <li
              key={fac.id}
              className={`flex cursor-pointer items-center gap-2 rounded px-2 py-2 ${
                i === active ? 'bg-seal-500/10 ring-1 ring-seal-500/30' : 'hover:bg-parchment-200/60'
              }`}
              onClick={() => setActive(i)}
              onDoubleClick={() => selectActive(i)}
            >
              <span
                className="stamp-square text-xs"
                style={{ backgroundColor: factionColor(fac.id) }}
                aria-hidden
              >
                {pickName(fac.name)[0] ?? '·'}
              </span>
              <div className="flex-1">
                <div className="font-serif text-sm font-semibold">{pickName(fac.name)}</div>
                <div className="text-[11px] text-ink-500">
                  {t('factionSelect.cities')}: {fac.cityIds.length} ·{' '}
                  {t('factionSelect.generals')}: {fac.generalIds.length}
                </div>
              </div>
              <span className="font-mono text-xs text-ink-500">
                {'★'.repeat(fac.difficulty)}
              </span>
            </li>
          ))}
        </ul>
        <div className="panel">
          {f && (
            <>
              <div className="flex items-center gap-3">
                <span
                  className="stamp-square text-base"
                  style={{
                    backgroundColor: factionColor(f.id),
                    width: '2.5rem',
                    height: '2.5rem',
                  }}
                  aria-hidden
                >
                  {pickName(f.name)[0] ?? '·'}
                </span>
                <div>
                  <h3 className="font-serif text-xl font-semibold">{pickName(f.name)}</h3>
                  <div className="text-xs text-ink-500">
                    {t('factionSelect.difficulty')}: {'★'.repeat(f.difficulty)} ·{' '}
                    {t(`personality.${f.personality}`)}
                  </div>
                </div>
              </div>
              <div className="ink-divider my-3" />
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Info label={t('factionSelect.cities')} value={f.cityIds.length} />
                <Info label={t('factionSelect.generals')} value={f.generalIds.length} />
                <Info label={t('status.money')} value={f.resources.money.toLocaleString()} />
                <Info label={t('status.food')} value={f.resources.food.toLocaleString()} />
                <Info
                  label={t('status.troops')}
                  value={f.resources.troops.toLocaleString()}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-1 text-xs">
                {f.generalIds.slice(0, 8).map((id) => (
                  <span
                    key={id}
                    className="rounded border border-ink-300/40 bg-parchment-50 px-2 py-0.5"
                  >
                    {id}
                  </span>
                ))}
                {f.generalIds.length > 8 && (
                  <span className="text-ink-500">+{f.generalIds.length - 8}</span>
                )}
              </div>
              <div className="mt-4">
                <button className="btn btn-primary" onClick={() => selectActive(active)}>
                  {t('app.continue')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="font-mono text-[10px] text-ink-500">
        ↑↓ / j k · Enter · Esc · g
      </div>
    </div>
  );
};

const Info: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <div className="flex items-baseline justify-between rounded border border-ink-300/40 bg-parchment-50 px-2 py-1">
    <span className="font-display text-[10px] uppercase tracking-widest text-ink-500">
      {label}
    </span>
    <span className="font-serif text-sm font-semibold">{value}</span>
  </div>
);
