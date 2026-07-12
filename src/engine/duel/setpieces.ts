import type { GameState } from '../types.js';
import type { MessageKey } from '../../i18n/types.js';

// A scripted 1v1 duel that punctuates the campaign. onWin/onLose are pure
// state transforms applied by resolveDuel; for the first slice the narrative
// aftermath is carried by story events, so these are identity (kept as hooks
// for future per-duel state effects like reputation or casualties).
export interface DuelSetpiece {
  id: string;
  bossId: string; // GeneralId of the boss
  playerHeroId: string; // GeneralId of the player hero
  arenaKey: MessageKey;
  onWin: (state: GameState) => GameState;
  onLose: (state: GameState) => GameState;
}

export const DUEL_SETPIECES: Record<string, DuelSetpiece> = {
  hulaoguan: {
    id: 'hulaoguan',
    // Lü Bu's canonical general id in this codebase is `lvbu` (see
    // src/data/generals/index.ts), not `lubu`.
    bossId: 'lvbu',
    playerHeroId: 'liubei',
    arenaKey: 'duel.arena.hulaoguan',
    onWin: (s) => s,
    onLose: (s) => s,
  },
};

export function findSetpiece(id: string): DuelSetpiece | undefined {
  return DUEL_SETPIECES[id];
}
