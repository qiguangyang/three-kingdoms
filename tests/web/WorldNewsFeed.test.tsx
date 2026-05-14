import { describe, expect, it } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { WorldNewsFeed } from '../../src/web/components/WorldNewsFeed.js';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import type { LogEntry } from '../../src/engine/types.js';

function stateWithLog(playerFactionId: string, entries: LogEntry[]) {
  const base = buildInitialState({
    scenario: SCENARIO_DONGZHUO,
    playerFactionId,
    refData: REF_DATA,
    seed: 1,
  });
  return { ...base, log: entries };
}

const mineEntry: LogEntry = {
  turn: 1, year: 190, month: 1, key: 'result.developed',
  vars: { city: { zh: '洛阳', en: 'Luoyang' }, amount: 3 }, factionId: 'caocao',
};
const worldEntry: LogEntry = {
  turn: 1, year: 190, month: 1, key: 'result.governed',
  vars: { city: { zh: '陈留', en: 'Chenliu' }, amount: 4 }, factionId: 'yuanshao',
};

describe('WorldNewsFeed', () => {
  it('shows all entries under the All filter', () => {
    const game = stateWithLog('caocao', [mineEntry, worldEntry]);
    const { container } = render(<WorldNewsFeed game={game} />);
    expect(container.querySelectorAll('li').length).toBe(2);
  });

  it('shows only other factions under the World filter', () => {
    const game = stateWithLog('caocao', [mineEntry, worldEntry]);
    const { container, getByRole } = render(<WorldNewsFeed game={game} />);
    fireEvent.click(getByRole('tab', { name: /realm|天下/i }));
    const items = container.querySelectorAll('li');
    expect(items.length).toBe(1);
  });
});
