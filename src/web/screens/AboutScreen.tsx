import React, { useEffect } from 'react';
import { setScreen } from '../../state/store.js';
import { t } from '../../i18n/locale.js';
import { useSession } from '../hooks/useSession.js';
import { selectLocale } from '../../state/selectors.js';

export const AboutScreen: React.FC = () => {
  useSession(selectLocale);

  // Esc / Enter / Backspace all return to the title screen.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Backspace') {
        e.preventDefault();
        setScreen({ kind: 'title' });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 px-6 py-8">
      <header className="flex items-baseline justify-between">
        <h2 className="font-display text-2xl tracking-widest text-ink-800">
          {t('title.about')}
        </h2>
        <button className="btn-ghost text-sm" onClick={() => setScreen({ kind: 'title' })}>
          {t('app.back')}
        </button>
      </header>
      <article className="panel space-y-3 text-sm leading-relaxed text-ink-800">
        <p>
          Three Kingdoms — a tribute to the BBK Electronic Dictionary classic
          《三国霸业》. All numerical data, general profiles, city stats, and
          scenarios are original designs based on《三国志》and《三国演义》.
        </p>
        <p className="text-ink-600">
          致敬步步高电子词典《三国霸业》的四章节叙事结构、搜寻玩法、兵符 / 神兵 /
          隐藏武将系统。所有数据均为原创设计,不复制原游戏。
        </p>
        <p className="text-ink-600">
          Engine: TypeScript · React 19 · Vite · Tailwind · Zustand.
        </p>
      </article>
    </div>
  );
};
