import { describe, expect, it } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { DuelHud } from '../../../src/web/duel/DuelScreen.js';
import { createDuelState } from '../../../src/duel/simulate.js';
import { t } from '../../../src/i18n/locale.js';

// DuelHud is the pure, presentational slice of the duel UI — the part that can
// render under jsdom without a WebGL context. It takes a DuelState and a boss
// name key and paints the HP / stamina / boss-HP bars plus the boss name.
describe('DuelHud', () => {
  it('renders HP, stamina, and the boss name from a DuelState', () => {
    const s = createDuelState(1);
    render(<DuelHud state={s} bossNameKey="duel.boss.lvbu" />);
    expect(screen.getByText(t('duel.hud.hp'))).toBeInTheDocument();
    expect(screen.getByText(t('duel.hud.stamina'))).toBeInTheDocument();
    expect(screen.getByText(t('duel.boss.lvbu'))).toBeInTheDocument();
  });
});
