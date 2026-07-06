import type { SessionState } from './store.js';

// Selector helpers for React. Keep these tiny so Zustand's shallow-equality
// fast-path stays effective.
export const selectGame = (s: SessionState) => s.game;
export const selectUI = (s: SessionState) => s.ui;
export const selectScreen = (s: SessionState) => s.ui.screen;
export const selectCursor = (s: SessionState) => s.ui.cursor;
export const selectLocale = (s: SessionState) => s.ui.locale;
export const selectMessage = (s: SessionState) => s.ui.message;
export const selectMenuIndex = (s: SessionState) => s.ui.menuIndex;
export const selectBattle = (s: SessionState) => s.battle;
