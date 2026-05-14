import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { TurnDigest } from '../../src/web/components/TurnDigest.js';
import type { LogEntry } from '../../src/engine/types.js';

const fell: LogEntry = {
  turn: 3, year: 190, month: 3, key: 'event.cityFell',
  vars: { city: { zh: '陈留', en: 'Chenliu' }, faction: { zh: '曹操', en: 'Cao Cao' } },
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
});
