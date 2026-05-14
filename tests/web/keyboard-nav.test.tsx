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
    // Start on "新游戏" (active=0). ArrowDown moves to "读取存档" (active=1),
    // then Enter triggers the load screen.
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(gameStore.getState().ui.screen.kind).toBe('load');
  });

  it('Title screen: j and k mirror ArrowDown / ArrowUp', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'Enter' });
    // Pressed j twice (→ active=2 = about), then k once (→ active=1 = load).
    expect(gameStore.getState().ui.screen.kind).toBe('load');
  });

  it('Title screen: Enter on default highlight goes to scenario select', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(gameStore.getState().ui.screen.kind).toBe('scenarioSelect');
  });

  it('Scenario screen: Esc returns to title', () => {
    gameStore.setState((s) => ({ ...s, ui: { ...s.ui, screen: { kind: 'scenarioSelect' } } }));
    render(<App />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(gameStore.getState().ui.screen.kind).toBe('title');
  });

  it('Title screen: g toggles locale', () => {
    render(<App />);
    expect(screen.getByText('新游戏')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'g' });
    // The display text flips.
    expect(screen.getByText('New Game')).toBeInTheDocument();
  });
});
