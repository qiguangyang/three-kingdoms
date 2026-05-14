import { describe, expect, it, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { GeneralCard } from '../../src/web/components/GeneralCard.js';
import { GENERALS } from '../../src/data/generals/index.js';
import { setLocale } from '../../src/i18n/locale.js';

beforeEach(() => setLocale('zh'));

describe('GeneralCard', () => {
  it('renders the four-stat bars and a Chinese name by default', () => {
    setLocale('zh');
    const { container, getByText } = render(<GeneralCard general={GENERALS['lvbu']!} />);
    expect(getByText('吕布')).toBeInTheDocument();
    const bars = container.querySelectorAll('.stat-bar');
    expect(bars.length).toBe(4);
  });

  it('uses the English name when locale is en', () => {
    setLocale('en');
    const { getByText } = render(<GeneralCard general={GENERALS['lvbu']!} />);
    expect(getByText('Lü Bu')).toBeInTheDocument();
  });
});
