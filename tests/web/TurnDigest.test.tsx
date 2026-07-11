import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { TurnDigest } from '../../src/web/components/TurnDigest.js';
import { t } from '../../src/i18n/locale.js';
import type { LogEntry } from '../../src/engine/types.js';

const fell: LogEntry = {
  turn: 3, year: 190, month: 3, key: 'event.cityFell',
  vars: { city: { zh: '陈留', en: 'Chenliu' }, faction: { zh: '曹操', en: 'Cao Cao' } },
};

// evaluateObjectives logs objective.completed with vars.title = def.titleKey,
// which is itself a MessageKey (the engine stays locale-agnostic). The render
// layer must resolve that key through t() before interpolating.
const objectiveDone: LogEntry = {
  turn: 5, year: 191, month: 2, key: 'objective.completed',
  vars: { title: 'app.title' },
};

describe('TurnDigest', () => {
  it('renders nothing when there are no entries', () => {
    const { container } = render(<TurnDigest entries={[]} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a dialog listing the entries', () => {
    const { container } = render(<TurnDigest entries={[fell]} onDismiss={() => {}} />);
    expect(container.querySelectorAll('li').length).toBe(1);
  });

  it('resolves an objective.completed title MessageKey instead of rendering the raw key', () => {
    const { container } = render(<TurnDigest entries={[objectiveDone]} onDismiss={() => {}} />);
    const text = container.textContent ?? '';
    // The localized title (e.g. 三国 / Three Kingdoms) is shown...
    expect(text).toContain(t('app.title'));
    // ...never the raw MessageKey string that vars.title carried.
    expect(text).not.toContain('app.title');
  });
});
