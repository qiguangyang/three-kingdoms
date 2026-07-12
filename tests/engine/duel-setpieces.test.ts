import { describe, expect, it } from 'vitest';
import { DUEL_SETPIECES, findSetpiece } from '../../src/engine/duel/setpieces.js';
import { GENERALS } from '../../src/data/generals/index.js';

describe('duel set-pieces', () => {
  it('registers the Hulao Pass duel vs Lü Bu', () => {
    const sp = findSetpiece('hulaoguan');
    expect(sp).toBeDefined();
    // Lü Bu's canonical general id in this codebase is `lvbu` (not `lubu`).
    expect(sp!.bossId).toBe('lvbu');
    expect(sp!.playerHeroId).toBe('liubei');
  });
  it('references real generals for boss and hero', () => {
    for (const sp of Object.values(DUEL_SETPIECES)) {
      expect(GENERALS[sp.bossId], `boss ${sp.bossId} must exist`).toBeDefined();
      expect(GENERALS[sp.playerHeroId], `hero ${sp.playerHeroId} must exist`).toBeDefined();
    }
  });
  it('onWin/onLose are pure identity-or-transform functions returning a state', () => {
    const sp = findSetpiece('hulaoguan')!;
    const fake = { duelResults: {} } as never;
    expect(sp.onWin(fake)).toBeDefined();
    expect(sp.onLose(fake)).toBeDefined();
  });
});
