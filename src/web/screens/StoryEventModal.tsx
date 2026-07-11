import React, { useState } from 'react';
import { useSession } from '../hooks/useSession.js';
import { selectGame, selectScreen, selectLocale } from '../../state/selectors.js';
import { clearContinuousSave, resolveStoryChoice, setScreen } from '../../state/store.js';
import { findStoryEvent } from '../../engine/story/events.js';
import type { StoryChoice } from '../../engine/story/types.js';
import { t } from '../../i18n/locale.js';
import { useMenuKeys } from '../hooks/useMenuKeys.js';

// Full-screen paper card that renders the pending StoryEvent addressed by the
// current { kind: 'story'; eventId } screen. A pure-narrative beat (choices: [])
// shows a single "continue"; a decision shows 1-3 choice buttons, each with a
// label and a one-line consequence preview. Selecting resolves via the store.
export const StoryEventModal: React.FC = () => {
  // Subscribe to locale so the modal re-renders when the language toggles.
  useSession(selectLocale);
  const screen = useSession(selectScreen);
  const game = useSession(selectGame);
  const [active, setActive] = useState(0);

  const eventId = screen.kind === 'story' ? screen.eventId : '';
  const event = game ? findStoryEvent(game.scenarioId, game.storyMode, eventId) : undefined;

  const isBeat = !event || event.choices.length === 0;
  const optionCount = isBeat ? 1 : event.choices.length;

  const select = (index: number): void => {
    if (isBeat) {
      // No branch to apply; resolveStoryChoice clears the pending event.
      resolveStoryChoice(eventId, '');
      return;
    }
    const choice = event.choices[index];
    if (choice) resolveStoryChoice(eventId, choice.id);
  };

  // Hooks must run unconditionally, so wire keyboard nav before any early return.
  useMenuKeys({ count: optionCount, active, setActive, onSelect: select });

  if (!event) return null;

  return (
    <div className="flex h-full w-full items-center justify-center px-6 py-10">
      <div className="panel w-full max-w-2xl p-8">
        <h2 className="font-serif text-3xl font-bold text-seal-700">{t(event.titleKey)}</h2>
        <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-ink-800">
          {t(event.bodyKey)}
        </p>
        <div className="mt-8 flex flex-col gap-3">
          {isBeat ? (
            <button
              className={`btn py-3 ${active === 0 ? 'btn-primary' : ''}`}
              onClick={() => select(0)}
            >
              {t('app.continue')}
            </button>
          ) : (
            event.choices.map((choice: StoryChoice, i: number) => (
              <button
                key={choice.id}
                className={`btn flex flex-col items-start gap-1 py-3 text-left ${
                  i === active ? 'btn-primary' : ''
                }`}
                onClick={() => {
                  setActive(i);
                  select(i);
                }}
              >
                <span className="font-serif text-lg font-semibold">{t(choice.labelKey)}</span>
                <span className="text-sm text-ink-600">{t(choice.descKey)}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// Story-Mode opening briefing — a narrative beat (single "continue") reading the
// protagonist chapter's briefing keys, then returns to the campaign map. Phase 1
// wires Chapter 1 only; later chapters extend the key lookup.
export const BriefingScreen: React.FC = () => {
  useSession(selectLocale);
  const [active, setActive] = useState(0);
  const onContinue = (): void => setScreen({ kind: 'main' });
  useMenuKeys({ count: 1, active, setActive, onSelect: onContinue });
  return (
    <div className="flex h-full w-full items-center justify-center px-6 py-10">
      <div className="panel w-full max-w-2xl p-8">
        <h2 className="font-serif text-3xl font-bold text-seal-700">{t('story.ch1.title')}</h2>
        <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-ink-800">
          {t('story.ch1.briefing')}
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <button className="btn btn-primary py-3" onClick={onContinue}>
            {t('app.continue')}
          </button>
        </div>
      </div>
    </div>
  );
};

// "...years pass" interstitial shown after a Story-Mode historic chapter win.
// Phase 1 wires the minimal version (Continue returns to the campaign map);
// Phase 3 replaces the action with a clean re-seed of the next chapter.
export const ChapterTransitionScreen: React.FC = () => {
  useSession(selectLocale);
  const [active, setActive] = useState(0);
  const onContinue = (): void => setScreen({ kind: 'main' });
  useMenuKeys({ count: 1, active, setActive, onSelect: onContinue });
  return (
    <div className="flex h-full w-full items-center justify-center px-6 py-10">
      <div className="panel w-full max-w-2xl p-8 text-center">
        <p className="whitespace-pre-line text-lg italic leading-relaxed text-ink-700">
          {t('story.ch1.transition')}
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <button className="btn btn-primary py-3" onClick={onContinue}>
            {t('app.continue')}
          </button>
        </div>
      </div>
    </div>
  );
};

// Terminal celebration shown when a Story-Mode chapter is WON (all objectives
// complete). Mirrors ChapterTransitionScreen's paper styling but ENDS the run:
// Continue wipes the continuous autosave and returns to the title, like
// GameOverScreen's button — Chapter Ⅱ isn't built yet, so there's nothing to
// transition into. Distinct from the (unrouted) chapterTransition bridge.
export const ChapterCompleteScreen: React.FC = () => {
  useSession(selectLocale);
  const [active, setActive] = useState(0);
  const onDone = (): void => {
    clearContinuousSave();
    setScreen({ kind: 'title' });
  };
  useMenuKeys({ count: 1, active, setActive, onSelect: onDone });
  return (
    <div className="flex h-full w-full items-center justify-center px-6 py-10">
      <div className="panel w-full max-w-2xl p-8 text-center">
        <h2 className="font-serif text-3xl font-bold text-seal-700">{t('story.ch1.complete.title')}</h2>
        <p className="mt-4 whitespace-pre-line text-base italic leading-relaxed text-ink-700">
          {t('story.ch1.complete.body')}
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <button className="btn btn-primary py-3" onClick={onDone}>
            {t('app.continue')}
          </button>
        </div>
      </div>
    </div>
  );
};
