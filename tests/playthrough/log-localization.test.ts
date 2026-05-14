import { describe, expect, it, beforeEach } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { develop } from '../../src/engine/politics.js';
import { applyCommand } from '../../src/engine/turn.js';
import { setLocale, t } from '../../src/i18n/locale.js';
import type { MessageKey } from '../../src/i18n/types.js';

beforeEach(() => setLocale('zh'));

describe('log entries respect the active locale', () => {
  it('result.developed renders Chinese city names in zh and English in en', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 71,
    });
    const after = develop(s0, { cityId: 'chenliu', generalId: 'caocao' });
    const last = after.log[after.log.length - 1];
    expect(last).toBeDefined();
    setLocale('zh');
    const zhText = t(last!.key as MessageKey, last!.vars);
    expect(zhText).toContain('陈留');
    expect(zhText).not.toContain('Chenliu');
    setLocale('en');
    const enText = t(last!.key as MessageKey, last!.vars);
    expect(enText).toContain('Chenliu');
    expect(enText).not.toContain('陈留');
  });

  it('event.cityFell substitutes both city and faction in the active locale', () => {
    const s0 = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 72,
    });
    // Drop Puyang to neutral so the player's attack succeeds.
    const synthetic = {
      ...s0,
      cities: {
        ...s0.cities,
        puyang: { ...s0.cities['puyang']!, factionId: null, garrison: 500, generals: [] },
      },
    };
    const after = applyCommand(synthetic, 'caocao', {
      kind: 'attack',
      fromCityId: 'chenliu',
      toCityId: 'puyang',
      generalIds: ['caocao', 'xiahoudun', 'xiahouyuan'],
      troops: 7000,
    });
    const cityFell = after.log.find((l) => l.key === 'event.cityFell');
    expect(cityFell).toBeDefined();

    setLocale('en');
    const enLine = t(cityFell!.key as MessageKey, cityFell!.vars);
    expect(enLine).toContain('Puyang');
    expect(enLine).toContain('Cao Cao');
    expect(enLine).not.toContain('濮阳');
    expect(enLine).not.toContain('caocao'); // no raw faction id leak

    setLocale('zh');
    const zhLine = t(cityFell!.key as MessageKey, cityFell!.vars);
    expect(zhLine).toContain('濮阳');
    expect(zhLine).toContain('曹操');
  });
});
