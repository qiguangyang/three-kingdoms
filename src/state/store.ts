import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { makeDefaultAgent } from '../engine/ai/index.js';
import type { FactionAgent, GameState, LogEntry, Scenario, StrategicCommand } from '../engine/types.js';
import { buildInitialState } from '../engine/scenario.js';
import { advanceMonth, applyCommand, checkOutcome } from '../engine/turn.js';
import { schedulePlayerCommand, tickDays } from '../engine/pendingOp.js';
import { CONTINUOUS_SLOT, loadFromSlot, saveToSlot } from './persistence.js';
import { REF_DATA } from '../data/index.js';
import type { Locale } from '../i18n/types.js';
import { setLocale } from '../i18n/locale.js';

// ----- UI state slice -----
//
// Everything not part of GameState belongs here. Cursor position, current
// screen, transient dialogs, etc. Keeping it inside Zustand means the entire
// session is observable from anywhere (engine never reads UI state).
export type Screen =
  | { kind: 'title' }
  | { kind: 'scenarioSelect' }
  | { kind: 'factionSelect'; scenarioId: string }
  | { kind: 'main' }
  | { kind: 'commandMenu' }
  | { kind: 'battle' }
  | { kind: 'help' }
  | { kind: 'save' }
  | { kind: 'load' }
  | { kind: 'generals' }
  | { kind: 'gameOver'; outcome: 'victory' | 'defeat' }
  | { kind: 'about' };

export interface UIState {
  screen: Screen;
  cursor: { x: number; y: number };
  selectedCityId: string | null;
  menuIndex: number;
  message: string | null;
  locale: Locale;
  // Significant world events that occurred during the last time-advance.
  // Rendered by <TurnDigest>; empty when nothing significant happened.
  turnDigest: LogEntry[];
}

export interface SessionState {
  game: GameState | null;
  ui: UIState;
  agents: Record<string, FactionAgent>;
}

const initialUI: UIState = {
  screen: { kind: 'title' },
  cursor: { x: 30, y: 17 }, // start over Luoyang
  selectedCityId: null,
  menuIndex: 0,
  message: null,
  locale: 'zh',
  turnDigest: [],
};

export const gameStore: StoreApi<SessionState> = createStore<SessionState>(() => ({
  game: null,
  ui: initialUI,
  agents: {},
}));

// ----- Helpers used by the UI to drive the engine -----

// Log message keys worth surfacing in the between-turn digest. Everything
// else (routine internal-affairs results) stays in the news feed only.
const DIGEST_KEYS = new Set<string>([
  'event.cityFell',
  'event.rebellion',
  'event.attackerRetreated',
  'event.guandongCoalition',
  'event.qianduChangan',
  'event.generalDied',
  'event.defected',
]);

// Pure: significant log entries appended at or after `beforeLen`.
export function extractDigest(beforeLen: number, log: LogEntry[]): LogEntry[] {
  return log.slice(beforeLen).filter((e) => DIGEST_KEYS.has(e.key));
}

export function newGame(scenario: Scenario, playerFactionId: string, seed: number): void {
  const game = buildInitialState({
    scenario,
    playerFactionId,
    refData: REF_DATA,
    seed,
  });
  const agents: Record<string, FactionAgent> = {};
  for (const f of scenario.factions) {
    if (f.id === playerFactionId) continue;
    agents[f.id] = makeDefaultAgent(f.id, f.personality);
  }
  gameStore.setState({
    game,
    agents,
    ui: { ...initialUI, screen: { kind: 'main' }, locale: gameStore.getState().ui.locale },
  });
}

// Legacy: end-turn = advance a full month at once. Retained for callers
// that want the original behavior (and for tests). The new persistent
// game uses advanceDays(7) for a week or advanceDays(30) for a month.
export function endTurn(): void {
  advanceDays(30);
}

// Advance the calendar by `days` in-game days, ticking every pending
// op and rolling over months / years on boundaries.
export function advanceDays(days: number): void {
  const { game, agents } = gameStore.getState();
  if (!game) return;
  const logLenBefore = game.log.length;
  // Use the new tickDays which knows how to apply pending ops; AI
  // strategic decisions fire at the top of each month from inside
  // tickDays. Note: advanceMonth is no longer the canonical path.
  const next = tickDays(game, days, agents);
  void advanceMonth; // keep import alive for tests that use it directly
  const digest = extractDigest(logLenBefore, next.log);
  const outcome = checkOutcome(next);
  gameStore.setState((s) => ({
    ...s,
    game: next,
    ui: outcome
      ? { ...s.ui, screen: { kind: 'gameOver', outcome }, turnDigest: digest }
      : { ...s.ui, turnDigest: digest },
  }));
}

// Legacy: synchronously apply a command. Kept for places that still
// want instant effect (e.g., defect dialog confirming negotiations
// already complete via the modal). Most player UI now uses
// schedulePlayer instead.
export function dispatchPlayer(command: StrategicCommand): void {
  const { game } = gameStore.getState();
  if (!game) return;
  const next = applyCommand(game, game.playerFactionId, command);
  gameStore.setState((s) => ({
    ...s,
    game: { ...next, actionLog: [...next.actionLog, { turn: next.turn, command, factionId: next.playerFactionId }] },
  }));
}

// Schedule a command into the pending-ops queue. The op ticks down each
// day via tickDays() and applies its effect when its daysRemaining
// hits 0. This is the canonical player-facing entry point now.
export function schedulePlayer(command: StrategicCommand): void {
  const { game } = gameStore.getState();
  if (!game) return;
  const next = schedulePlayerCommand(game, game.playerFactionId, command);
  gameStore.setState((s) => ({
    ...s,
    game: {
      ...next,
      actionLog: [
        ...next.actionLog,
        { turn: next.turn, command, factionId: next.playerFactionId },
      ],
    },
  }));
}

// Pure preview: run the command through the engine without committing
// the result to the store. Returns the prospective post-state. Used by
// the battle animation flow to show the pre-state on screen while the
// post-state is animated to, then committed via commitPrecomputedGame.
export function previewPlayerCommand(command: StrategicCommand): GameState | null {
  const { game } = gameStore.getState();
  if (!game) return null;
  return applyCommand(game, game.playerFactionId, command);
}

// Commit a precomputed game state and append the command to the action
// log. Pair this with previewPlayerCommand for animations that need to
// hold the old state on screen until they finish.
export function commitPrecomputedGame(
  precomputed: GameState,
  command: StrategicCommand,
): void {
  gameStore.setState((s) => ({
    ...s,
    game: {
      ...precomputed,
      actionLog: [
        ...precomputed.actionLog,
        { turn: precomputed.turn, command, factionId: precomputed.playerFactionId },
      ],
    },
  }));
}

export function setScreen(screen: Screen): void {
  gameStore.setState((s) => ({ ...s, ui: { ...s.ui, screen } }));
}

export function setMessage(message: string | null): void {
  gameStore.setState((s) => ({ ...s, ui: { ...s.ui, message } }));
}

export function dismissTurnDigest(): void {
  gameStore.setState((s) => ({ ...s, ui: { ...s.ui, turnDigest: [] } }));
}

export function setCursor(x: number, y: number): void {
  gameStore.setState((s) => ({ ...s, ui: { ...s.ui, cursor: { x, y } } }));
}

export function setSelectedCity(id: string | null): void {
  gameStore.setState((s) => ({ ...s, ui: { ...s.ui, selectedCityId: id } }));
}

export function setMenuIndex(i: number): void {
  gameStore.setState((s) => ({ ...s, ui: { ...s.ui, menuIndex: i } }));
}

export function toggleLocale(): void {
  const cur = gameStore.getState().ui.locale;
  const next: Locale = cur === 'zh' ? 'en' : 'zh';
  setLocale(next);
  gameStore.setState((s) => ({ ...s, ui: { ...s.ui, locale: next } }));
}

export function setInitialLocale(locale: Locale): void {
  setLocale(locale);
  gameStore.setState((s) => ({ ...s, ui: { ...s.ui, locale } }));
}

export function loadGame(snapshot: { game: GameState; locale?: Locale }): void {
  const agents: Record<string, FactionAgent> = {};
  for (const f of Object.values(snapshot.game.factions)) {
    if (f.id === snapshot.game.playerFactionId) continue;
    if (!f.alive) continue;
    agents[f.id] = makeDefaultAgent(f.id, f.personality);
  }
  gameStore.setState((s) => ({
    ...s,
    game: snapshot.game,
    agents,
    ui: {
      ...s.ui,
      screen: { kind: 'main' },
      locale: snapshot.locale ?? s.ui.locale,
    },
  }));
}

// ----- Continuous autosave -----
//
// Subscribe to the store and persist the current game to a reserved
// "continuous" slot whenever the game changes. Throttled so rapid state
// updates (e.g. RAF-driven animations) don't thrash localStorage.
// Restored at app startup via tryRestoreContinuous() so a refresh
// resumes whatever the player was in the middle of.

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedGame: GameState | null = null;
const AUTOSAVE_THROTTLE_MS = 400;

// Wire the subscription once at module load. The store is a singleton.
gameStore.subscribe((state) => {
  const game = state.game;
  if (!game) return;
  if (game === lastSavedGame) return;
  lastSavedGame = game;
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    try {
      saveToSlot(CONTINUOUS_SLOT, game, state.ui.locale);
    } catch {
      // localStorage quota, private browsing, etc. — quietly drop.
      // The user can still save manually to a numbered slot.
    }
  }, AUTOSAVE_THROTTLE_MS);
});

// Try to restore the continuous save. Returns true if a game was
// successfully restored (and the store now shows the main screen).
export function tryRestoreContinuous(): boolean {
  try {
    const file = loadFromSlot(CONTINUOUS_SLOT);
    if (!file.state) return false;
    loadGame({ game: file.state, locale: file.locale });
    return true;
  } catch {
    return false;
  }
}

// Erase the continuous save — used when the player explicitly returns
// to the title from game-over so a refresh doesn't put them right back
// into the doomed game.
export function clearContinuousSave(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`tk-save:${CONTINUOUS_SLOT}`);
    }
  } catch {
    // ignore
  }
  lastSavedGame = null;
}
