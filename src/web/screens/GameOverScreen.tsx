import React from 'react';
import { clearContinuousSave, setScreen } from '../../state/store.js';
import { t } from '../../i18n/locale.js';
import { useSession } from '../hooks/useSession.js';
import { selectLocale } from '../../state/selectors.js';

interface Props {
  outcome: 'victory' | 'defeat';
}

export const GameOverScreen: React.FC<Props> = ({ outcome }) => {
  useSession(selectLocale);
  const isWin = outcome === 'victory';
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 px-6">
      <h2
        className={`font-serif text-6xl font-bold drop-shadow-sm ${
          isWin ? 'text-seal-600' : 'text-ink-700'
        }`}
      >
        {t(isWin ? 'over.victory' : 'over.defeat')}
      </h2>
      <p className="max-w-md text-center text-base text-ink-700">
        {t(isWin ? 'over.unifyAchieved' : 'over.defeat')}
      </p>
      <button
        className="btn btn-primary"
        onClick={() => {
          // Wipe the continuous autosave so a refresh after game-over
          // doesn't drop the player right back into the doomed game.
          clearContinuousSave();
          setScreen({ kind: 'title' });
        }}
      >
        {t('title.newGame')}
      </button>
    </div>
  );
};
