import React, { useEffect, useRef } from 'react';
import { useSession } from './hooks/useSession.js';
import { selectScreen } from '../state/selectors.js';
import { tryRestoreContinuous } from '../state/store.js';
import { TitleScreen } from './screens/TitleScreen.js';
import { ScenarioSelectScreen } from './screens/ScenarioSelectScreen.js';
import { FactionSelectScreen } from './screens/FactionSelectScreen.js';
import { MainScreen } from './screens/MainScreen.js';
import { GameOverScreen } from './screens/GameOverScreen.js';
import { SaveLoadScreen } from './screens/SaveLoadScreen.js';
import { AboutScreen } from './screens/AboutScreen.js';
import { GeneralsScreen } from './screens/GeneralsScreen.js';
import { BattleScreen } from './battle/BattleScreen.js';
import { StoryEventModal, BriefingScreen, ChapterTransitionScreen, ChapterCompleteScreen } from './screens/StoryEventModal.js';

export const App: React.FC = () => {
  // On first mount, try to restore the continuous autosave so a browser
  // refresh resumes the in-flight game. useRef gate ensures this fires
  // exactly once, even under React StrictMode double-mounting.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    tryRestoreContinuous();
  }, []);

  const screen = useSession(selectScreen);
  let body: React.ReactNode = null;
  switch (screen.kind) {
    case 'title':
      body = <TitleScreen />;
      break;
    case 'scenarioSelect':
      body = <ScenarioSelectScreen />;
      break;
    case 'factionSelect':
      body = <FactionSelectScreen scenarioId={screen.scenarioId} />;
      break;
    case 'main':
      body = <MainScreen />;
      break;
    case 'gameOver':
      body = <GameOverScreen outcome={screen.outcome} />;
      break;
    case 'save':
      body = <SaveLoadScreen mode="save" />;
      break;
    case 'load':
      body = <SaveLoadScreen mode="load" />;
      break;
    case 'about':
      body = <AboutScreen />;
      break;
    case 'generals':
      body = <GeneralsScreen />;
      break;
    case 'battle':
      body = <BattleScreen />;
      break;
    case 'story':
      body = <StoryEventModal />;
      break;
    case 'briefing':
      body = <BriefingScreen />;
      break;
    case 'chapterTransition':
      body = <ChapterTransitionScreen />;
      break;
    case 'chapterComplete':
      body = <ChapterCompleteScreen />;
      break;
    default:
      body = null;
  }
  return <div className="h-screen w-screen overflow-hidden">{body}</div>;
};
