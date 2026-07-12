import { GENERALS } from '../../data/generals/index.js';
import { findSetpiece } from '../../engine/duel/setpieces.js';
import { nextRng } from '../../duel/types.js';
import type { DuelOutcome } from '../../duel/types.js';

// A "brothers at his side" bias added to the hero's martial (wu). Guan Yu +
// Zhang Fei fighting at Liu Bei's side make him a strong favorite, but Lü Bu can
// still win. Chosen so that with the canon matchup (hero wu=65, boss wu=100) the
// win probability lands at a deliberate ~0.70 — a clear favorite, not a lock:
//   pWin = (65 + 168) / (65 + 168 + 100) = 233 / 333 ≈ 0.70.
const BROTHERS_BIAS = 168;

// Fallback when WebGL is unavailable: compare the hero's martial (wu) — plus the
// brothers bias so the canon win is a documented favorite — against the boss's
// wu, with a seeded roll. Keeps the campaign playable without a GPU.
export function autoResolveDuel(duelId: string, seed: number): DuelOutcome {
  const sp = findSetpiece(duelId);
  if (!sp) return 'lose';
  const heroWu = GENERALS[sp.playerHeroId]?.stats.wu ?? 50;
  const bossWu = GENERALS[sp.bossId]?.stats.wu ?? 50;
  const heroScore = heroWu + BROTHERS_BIAS;
  const pWin = heroScore / (heroScore + bossWu);
  // nextRng is a Math.imul avalanche hash, but a single call on a small
  // sequential seed clusters near 0 (weak avalanche on low-entropy input), which
  // would make the outcome ride that clustering instead of the odds. Advance the
  // PRNG a few iterations first so the decision value is well-distributed even
  // for the production small seed (DUEL_CONFIG.seed = 1).
  let s = seed | 0;
  for (let i = 0; i < 5; i++) s = nextRng(s).state;
  const roll = nextRng(s).value;
  return roll < pWin ? 'win' : 'lose';
}
