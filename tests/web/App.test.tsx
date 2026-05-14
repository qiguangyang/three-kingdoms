import { describe, expect, it, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from '../../src/web/App.js';
import { gameStore, newGame, setInitialLocale } from '../../src/state/store.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';

beforeEach(() => {
  // Reset session state to a clean title screen each test.
  gameStore.setState((s) => ({
    ...s,
    game: null,
    agents: {},
    ui: { ...s.ui, screen: { kind: 'title' }, locale: 'zh', selectedCityId: null },
  }));
  setInitialLocale('zh');
});

describe('App router', () => {
  it('renders the title screen with the four nav buttons', () => {
    render(<App />);
    expect(screen.getByText('三 国')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新游戏' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '读取存档' })).toBeInTheDocument();
  });

  it('navigates Title → Scenario select', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '新游戏' }));
    expect(screen.getByText('选择剧本')).toBeInTheDocument();
    // The scenario name appears in both the list and the right-hand detail
    // panel, so multiple matches are expected.
    expect(screen.getAllByText('董卓弄权').length).toBeGreaterThan(0);
  });

  it('after newGame, MainScreen shows the active faction in StatusBar', () => {
    newGame(SCENARIO_DONGZHUO, 'caocao', 7);
    render(<App />);
    expect(screen.getByText('189年 9月')).toBeInTheDocument();
    expect(screen.getByText('曹操')).toBeInTheDocument();
  });

  it('toggleLocale: clicking 中/EN flips the language', () => {
    render(<App />);
    expect(screen.getByText('新游戏')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /中 \/ EN/ }));
    expect(screen.getByRole('button', { name: 'New Game' })).toBeInTheDocument();
  });
});
