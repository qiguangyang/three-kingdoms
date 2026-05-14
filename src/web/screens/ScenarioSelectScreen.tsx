import React, { useState } from 'react';
import { SCENARIO_LIST } from '../../data/scenarios/index.js';
import { setScreen, toggleLocale } from '../../state/store.js';
import { pickName, t } from '../../i18n/locale.js';
import { useSession } from '../hooks/useSession.js';
import { selectLocale } from '../../state/selectors.js';
import { useMenuKeys } from '../hooks/useMenuKeys.js';

export const ScenarioSelectScreen: React.FC = () => {
  useSession(selectLocale);
  const [active, setActive] = useState(0);

  function selectActive(i: number) {
    const sc = SCENARIO_LIST[i];
    if (sc && !sc.todo) setScreen({ kind: 'factionSelect', scenarioId: sc.id });
  }

  useMenuKeys({
    count: SCENARIO_LIST.length,
    active,
    setActive,
    onSelect: selectActive,
    onBack: () => setScreen({ kind: 'title' }),
  });

  // Locale toggle remains available with 'g'.
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

  const scenario = SCENARIO_LIST[active];
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col gap-4 px-6 py-8">
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl tracking-widest text-ink-800">
          {t('scenarioSelect.heading')}
        </h2>
        <div className="flex gap-2">
          <button className="btn-ghost text-sm" onClick={toggleLocale}>
            中 / EN
          </button>
          <button className="btn-ghost text-sm" onClick={() => setScreen({ kind: 'title' })}>
            {t('app.back')}
          </button>
        </div>
      </header>
      <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2">
        <ul className="panel divide-y divide-ink-300/30">
          {SCENARIO_LIST.map((sc, i) => (
            <li
              key={sc.id}
              className={`flex cursor-pointer items-center justify-between px-2 py-3 ${
                i === active ? 'bg-seal-500/10' : ''
              } ${sc.todo ? 'opacity-50' : ''}`}
              onClick={() => setActive(i)}
              onDoubleClick={() => selectActive(i)}
            >
              <div>
                <div className="font-display text-xs uppercase tracking-widest text-ink-500">
                  {sc.startYear} CE
                </div>
                <div className="font-serif text-base font-semibold text-ink-800">
                  {pickName(sc.name)}
                </div>
              </div>
              {sc.todo && (
                <span className="text-xs italic text-ink-500">{t('scenarioSelect.todoBadge')}</span>
              )}
            </li>
          ))}
        </ul>
        <div className="panel">
          {scenario && (
            <>
              <h3 className="font-serif text-lg font-semibold">{pickName(scenario.name)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-700">
                {pickName(scenario.description)}
              </p>
              <div className="mt-4">
                <button
                  className="btn btn-primary"
                  disabled={scenario.todo}
                  onClick={() => selectActive(active)}
                >
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
