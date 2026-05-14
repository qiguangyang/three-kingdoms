import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { FactionPanel } from '../../src/web/components/FactionPanel.js';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';

describe('FactionPanel', () => {
  it('lists factions in power order, strongest first', () => {
    const base = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 1,
    });
    // Make Dong Zhuo overwhelmingly the strongest.
    const cities = { ...base.cities };
    for (const c of Object.values(cities)) {
      if (c.factionId === 'dongzhuo') cities[c.id] = { ...c, garrison: 200000 };
    }
    const game = { ...base, cities };
    const { container } = render(<FactionPanel game={game} />);
    const rows = container.querySelectorAll('li[data-faction]');
    expect(rows.length).toBe(Object.keys(game.factions).length);
    expect(rows[0]!.getAttribute('data-faction')).toBe('dongzhuo');
  });
});
