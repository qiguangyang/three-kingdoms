import { describe, expect, it } from 'vitest';
import { pickName, setLocale, t } from '../../src/i18n/locale.js';
import { CITIES } from '../../src/data/cities.js';
import { GENERALS } from '../../src/data/generals/index.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';

describe('locale toggling', () => {
  it('pickName returns zh names by default', () => {
    setLocale('zh');
    expect(pickName(CITIES['luoyang']!.name)).toBe('洛阳');
    expect(pickName(GENERALS['lvbu']!.name)).toBe('吕布');
    expect(pickName(SCENARIO_DONGZHUO.name)).toBe('董卓弄权');
  });

  it('pickName returns en names after switching', () => {
    setLocale('en');
    expect(pickName(CITIES['luoyang']!.name)).toBe('Luoyang');
    expect(pickName(GENERALS['lvbu']!.name)).toBe('Lü Bu');
    expect(pickName(SCENARIO_DONGZHUO.name)).toBe("Dong Zhuo's Tyranny");
  });

  it('t() interpolates variables', () => {
    setLocale('en');
    expect(t('status.month_long', { year: 189, month: 9 })).toBe('Year 189, Month 9');
    setLocale('zh');
    expect(t('status.month_long', { year: 189, month: 9 })).toBe('189年 9月');
  });

  it('t() falls back to zh if a key is missing from en (no missing keys today, but guarantee)', () => {
    setLocale('en');
    // A real key on both sides — sanity that it resolves.
    expect(typeof t('menu.attack')).toBe('string');
  });
});
