import { describe, expect, it } from 'vitest';
import { catalogsForTesting } from '../../src/i18n/locale.js';

describe('i18n catalog parity', () => {
  it('both locales have identical key sets', () => {
    const zhKeys = Object.keys(catalogsForTesting.zh).sort();
    const enKeys = Object.keys(catalogsForTesting.en).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it('no entry is empty', () => {
    for (const [k, v] of Object.entries(catalogsForTesting.zh)) {
      expect(v, `zh ${k} is empty`).toBeTruthy();
    }
    for (const [k, v] of Object.entries(catalogsForTesting.en)) {
      expect(v, `en ${k} is empty`).toBeTruthy();
    }
  });
});
