import React, { useState } from 'react';
import { setScreen, startStoryMode, toggleLocale } from '../../state/store.js';
import { t } from '../../i18n/locale.js';
import { useSession } from '../hooks/useSession.js';
import { selectLocale } from '../../state/selectors.js';
import { useMenuKeys } from '../hooks/useMenuKeys.js';

interface Option {
  id: 'story' | 'new' | 'load' | 'about';
  key: 'title.storyMode' | 'title.freePlay' | 'title.loadGame' | 'title.about';
  action: () => void;
}

export const TitleScreen: React.FC = () => {
  useSession(selectLocale);
  const [active, setActive] = useState(0);

  const options: Option[] = [
    { id: 'story', key: 'title.storyMode', action: () => startStoryMode() },
    { id: 'new', key: 'title.freePlay', action: () => setScreen({ kind: 'scenarioSelect' }) },
    { id: 'load', key: 'title.loadGame', action: () => setScreen({ kind: 'load' }) },
    { id: 'about', key: 'title.about', action: () => setScreen({ kind: 'about' }) },
  ];

  useMenuKeys({
    count: options.length,
    active,
    setActive,
    onSelect: (i) => options[i]?.action(),
  });

  // Allow 'g' to toggle the locale even before entering a game.
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

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-8 px-6 py-10">
      <div className="relative w-full max-w-xl text-center">
        <div className="font-display text-[10px] uppercase tracking-[0.4em] text-ink-500">
          A Tribute to <em>Three Kingdoms Hegemony</em>
        </div>
        <h1 className="mt-2 font-serif text-6xl font-bold leading-none text-seal-700 drop-shadow-sm">
          三 国
        </h1>
        <div className="mt-2 font-display text-base tracking-[0.3em] text-ink-700">
          THREE KINGDOMS
        </div>
        <div className="mt-3 text-sm italic text-ink-600">{t('app.subtitle')}</div>
      </div>

      <nav className="flex w-64 flex-col gap-3">
        {options.map((opt, i) => (
          <button
            key={opt.id}
            className={`btn py-2 ${
              i === active ? (opt.id === 'story' ? 'btn-primary' : 'ring-2 ring-seal-500/50') : ''
            }`}
            onClick={() => {
              setActive(i);
              opt.action();
            }}
          >
            {t(opt.key)}
          </button>
        ))}
        <button className="btn btn-ghost" onClick={toggleLocale}>
          中 / EN (g)
        </button>
      </nav>

      <div className="font-mono text-[10px] text-ink-500">
        ↑↓ / j k · Enter · g · ?
      </div>
    </div>
  );
};
