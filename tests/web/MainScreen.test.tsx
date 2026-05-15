import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { MainScreen } from '../../src/web/screens/MainScreen.js';
import { newGame } from '../../src/state/store.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { t } from '../../src/i18n/locale.js';

describe('MainScreen visibility surfaces', () => {
  it('renders the world news feed and faction power panel', () => {
    newGame(SCENARIO_DONGZHUO, 'caocao', 1);
    const { getAllByText } = render(<MainScreen />);
    expect(getAllByText(t('news.heading')).length).toBeGreaterThan(0);
    expect(getAllByText(t('faction.rankHeading')).length).toBeGreaterThan(0);
  });
});
