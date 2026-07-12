import { describe, expect, it, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { FactionSelectScreen } from '../../src/web/screens/FactionSelectScreen.js';
import { TitleScreen } from '../../src/web/screens/TitleScreen.js';
import { setLocale, t } from '../../src/i18n/locale.js';

beforeEach(() => setLocale('zh'));

describe('FactionSelectScreen general name chips', () => {
  it('renders localized general names, not raw ids, for the selected faction', () => {
    setLocale('zh');
    const { getByText, queryByText } = render(
      <FactionSelectScreen scenarioId="s1-dongzhuo" />,
    );
    // Index 0 (Dong Zhuo) is active on mount; its detail panel does NOT list
    // Cao Cao's generals. Click the "曹操" faction row to select that faction.
    // At this point "曹操" appears exactly once (the faction list item), because
    // the active detail panel is still showing Dong Zhuo.
    fireEvent.click(getByText('曹操'));
    // The general chips must now show each general's localized name. Xiahou Dun
    // is a Cao Cao general whose Chinese name is distinct from the faction name,
    // so it unambiguously proves the chip is localized (not the raw id).
    expect(getByText('夏侯惇')).toBeInTheDocument();
    // ...and the raw general id must no longer leak into the UI.
    expect(queryByText('xiahoudun')).toBeNull();
  });

  it('shows English general names when locale is en', () => {
    setLocale('en');
    const { getByText, queryByText } = render(
      <FactionSelectScreen scenarioId="s1-dongzhuo" />,
    );
    fireEvent.click(getByText('Cao Cao'));
    expect(getByText('Xiahou Dun')).toBeInTheDocument();
    expect(queryByText('xiahoudun')).toBeNull();
  });
});

describe('Title subtitle copy', () => {
  it('app.subtitle drops the terminal/TUI leftover in both locales', () => {
    setLocale('zh');
    expect(t('app.subtitle')).not.toContain('终端');
    setLocale('en');
    expect(t('app.subtitle')).not.toMatch(/TUI/i);
  });

  it('TitleScreen renders the new web-appropriate subtitle', () => {
    setLocale('zh');
    const { getByText } = render(<TitleScreen />);
    expect(getByText('群雄逐鹿 · 谋定天下')).toBeInTheDocument();
  });
});
