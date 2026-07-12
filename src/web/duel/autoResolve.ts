import { GENERALS } from '../../data/generals/index.js';
import { findSetpiece } from '../../engine/duel/setpieces.js';
import { nextRng } from '../../duel/types.js';
import type { DuelOutcome } from '../../duel/types.js';

// Fallback when WebGL is unavailable: compare the hero's martial (wu) — plus a
// "brothers at his side" bias so the canon win is likely — against the boss's
// wu, with a seeded roll. Keeps the campaign playable without a GPU.
export function autoResolveDuel(duelId: string, seed: number): DuelOutcome {
  const sp = findSetpiece(duelId);
  if (!sp) return 'lose';
  const heroWu = GENERALS[sp.playerHeroId]?.stats.wu ?? 50;
  const bossWu = GENERALS[sp.bossId]?.stats.wu ?? 50;
  const heroScore = heroWu + 40; // Guan Yu + Zhang Fei
  const pWin = heroScore / (heroScore + bossWu);
  const { value } = nextRng(seed);
  return value < pWin ? 'win' : 'lose';
}
