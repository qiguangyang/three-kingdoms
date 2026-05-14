import { describe, expect, it } from 'vitest';
import {
  extractDigest,
  gameStore,
  newGame,
  dismissTurnDigest,
} from '../../src/state/store.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import type { LogEntry } from '../../src/engine/types.js';

function entry(key: string): LogEntry {
  return { turn: 1, year: 190, month: 1, key };
}

describe('extractDigest', () => {
  it('keeps only significant entries appended after the cutoff', () => {
    const log: LogEntry[] = [
      entry('result.developed'),
      entry('result.patrolled'),
      entry('event.cityFell'),
      entry('result.recruited'),
      entry('event.rebellion'),
    ];
    const digest = extractDigest(2, log);
    expect(digest.map((e) => e.key)).toEqual(['event.cityFell', 'event.rebellion']);
  });

  it('ignores significant entries from before the cutoff', () => {
    const log: LogEntry[] = [entry('event.cityFell'), entry('result.developed')];
    expect(extractDigest(1, log)).toEqual([]);
  });
});

describe('dismissTurnDigest', () => {
  it('clears the turn digest', () => {
    newGame(SCENARIO_DONGZHUO, 'caocao', 1);
    gameStore.setState((s) => ({
      ...s,
      ui: { ...s.ui, turnDigest: [entry('event.cityFell')] },
    }));
    dismissTurnDigest();
    expect(gameStore.getState().ui.turnDigest).toEqual([]);
  });
});
