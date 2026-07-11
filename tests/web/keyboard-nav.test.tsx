import { describe, expect, it, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../../src/web/App.js';
import { gameStore, setInitialLocale } from '../../src/state/store.js';

beforeEach(() => {
  gameStore.setState((s) => ({
    ...s,
    game: null,
    agents: {},
    ui: { ...s.ui, screen: { kind: 'title' }, locale: 'zh', selectedCityId: null },
  }));
  setInitialLocale('zh');
});

describe('keyboard navigation', () => {
  it('Title screen: ArrowDown + Enter selects the highlighted option', () => {
    render(<App />);
    // Options are [story, freePlay, load, about]. Start on "剧情模式" (active=0).
    // ArrowDown twice moves to "读取存档" (active=2), then Enter opens load.
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(gameStore.getState().ui.screen.kind).toBe('load');
  });

  it('Title screen: j and k mirror ArrowDown / ArrowUp', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'Enter' });
    // Pressed j three times (→ active=3 = about), then k once (→ active=2 = load).
    expect(gameStore.getState().ui.screen.kind).toBe('load');
  });

  it('Title screen: Enter on default highlight launches Story Mode (briefing)', () => {
    render(<App />);
    // The default highlight is now "剧情模式" (Story Mode), which opens the
    // Chapter-1 opening briefing before the campaign map.
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(gameStore.getState().ui.screen.kind).toBe('briefing');
  });

  it('Scenario screen: Esc returns to title', () => {
    gameStore.setState((s) => ({ ...s, ui: { ...s.ui, screen: { kind: 'scenarioSelect' } } }));
    render(<App />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(gameStore.getState().ui.screen.kind).toBe('title');
  });

  it('Title screen: g toggles locale', () => {
    render(<App />);
    expect(screen.getByText('剧情模式')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'g' });
    // The display text flips.
    expect(screen.getByText('Story Mode')).toBeInTheDocument();
  });
});
