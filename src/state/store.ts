import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { makeDefaultAgent } from '../engine/ai/index.js';
import type { FactionAgent, GameState, LogEntry, Personality, Scenario, StrategicCommand, TacticalCommand } from '../engine/types.js';
// GambitId lives in the battle-local types module, not the engine barrel
// (../engine/types.js imports it internally but does not re-export it).
import type { GambitId } from '../engine/battle/types.js';
import { buildInitialState } from '../engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../data/scenarios/s1-dongzhuo.js';
import { evaluateObjectives, seedObjectives } from '../engine/story/objectives.js';
import { advanceMonth, applyCommand, checkOutcome } from '../engine/turn.js';
import { schedulePlayerCommand, tickDays } from '../engine/pendingOp.js';
import { CONTINUOUS_SLOT, loadFromSlot, saveToSlot } from './persistence.js';
import { applyStoryChoice } from '../engine/story/events.js';
import { REF_DATA } from '../data/index.js';
import type { Locale } from '../i18n/types.js';
import { setLocale } from '../i18n/locale.js';
import {
  autoResolveSession, chooseDecision, chooseGambit, queuePlayerCommand, resolveDay, sessionResult, setSpeed, startSession,
} from './battleSession.js';
import type { BattleSession } from './battleSession.js';

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
  | { kind: 'about' }
  | { kind: 'story'; eventId: string }
  | { kind: 'briefing' } // Story-Mode opening briefing (reuses the StoryEvent modal in beat mode)
  | { kind: 'chapterTransition' }; // "...years pass" interstitial

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
  battle: BattleSession | null;
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
  battle: null,
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
  'objective.completed',
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

// Launch the guided Story Mode campaign at Liu Bei's Chapter 1. Builds the
// Chapter-1 scenario (s1-dongzhuo) with Liu Bei as the player faction, tags
// the game with storyMode so objective tables / briefings / choice-events
// become protagonist-specific, seeds the chapter's objectives, wires up AI
// agents for every other faction, and opens the opening briefing before the
// campaign map. A fixed seed keeps the launch deterministic.
export function startStoryMode(): void {
  const scenario = SCENARIO_DONGZHUO;
  const built = buildInitialState({
    scenario,
    playerFactionId: 'liubei',
    refData: REF_DATA,
    seed: 1,
  });
  const withStory: GameState = {
    ...built,
    storyMode: { protagonistFactionId: 'liubei', chapter: 1 },
  };
  const game = seedObjectives(withStory);
  const agents: Record<string, FactionAgent> = {};
  for (const f of scenario.factions) {
    if (f.id === 'liubei') continue;
    agents[f.id] = makeDefaultAgent(f.id, f.personality);
  }
  gameStore.setState((s) => ({
    ...s,
    game,
    agents,
    ui: { ...initialUI, screen: { kind: 'briefing' }, locale: s.ui.locale },
  }));
}

// Legacy: end-turn = advance a full month at once. Retained for callers
// that want the original behavior (and for tests). The new persistent
// game uses advanceDays(7) for a week or advanceDays(30) for a month.
export function endTurn(): void {
  advanceDays(30);
}

// Advance the calendar by `days` in-game days, ticking every pending
// op and rolling over months / years on boundaries. Player-involved
// sieges are deferred: if one comes due mid-advance, the calendar
// pauses and control hands off to the battle screen instead of
// auto-resolving.
export function advanceDays(days: number): void {
  const { game, agents } = gameStore.getState();
  if (!game) return;
  const logLenBefore = game.log.length;
  // Use the new tickDays which knows how to apply pending ops; AI
  // strategic decisions fire at the top of each month from inside
  // tickDays. Note: advanceMonth is no longer the canonical path.
  const next = tickDays(game, days, agents, { deferPlayerBattles: true });
  void advanceMonth; // keep import alive for tests that use it directly
  if (next.pendingBattle) {
    const personalities: Record<string, Personality> = {};
    for (const f of Object.values(next.factions)) personalities[f.id] = f.personality;
    gameStore.setState((s) => ({
      ...s,
      game: next,
      battle: startSession(next.pendingBattle!, next.playerFactionId, personalities),
      ui: { ...s.ui, screen: { kind: 'battle' } },
    }));
    return;
  }
  // A story event fired mid-advance and froze the tick (mirrors pendingBattle).
  // Commit the frozen state and route to the StoryEvent modal for a decision.
  // The pause is INTENTIONALLY taken at the MONTH BOUNDARY (non-atomic vs.
  // pendingBattle): the firing month's settlement/AI/turn have already
  // completed exactly once inside tickDays before the freeze — do NOT try to
  // freeze earlier, or that month would be re-run when the player resumes.
  if (next.pendingStoryEvent) {
    const eventId = next.pendingStoryEvent.eventId;
    gameStore.setState((s) => ({
      ...s,
      game: next,
      ui: { ...s.ui, screen: { kind: 'story', eventId } },
    }));
    return;
  }
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

// Resolve a pending story-event choice. Runs the branch's pure state change
// via the engine (which also clears pendingStoryEvent), records the decision
// on actionLog as a { kind:'storyChoice' } command so the branch is replayable
// and persisted, then returns to the main screen (or game-over if the branch
// happened to settle the scenario). Called by the StoryEventModal.
export function resolveStoryChoice(eventId: string, choiceId: string): void {
  const { game } = gameStore.getState();
  if (!game) return;
  const applied = applyStoryChoice(game, eventId, choiceId);
  // An identity no-op (unknown event/invalid choice) changed nothing: don't
  // log a phantom storyChoice command or navigate away while the pause stands.
  // A beat DOES change state (clears pendingStoryEvent) so it isn't skipped.
  if (applied === game) return;
  // Reflect any objective the choice satisfied (e.g. a chapter's terminal
  // objective) BEFORE checkOutcome, so a chapter-completing choice wins/routes
  // in the same beat instead of one tick later.
  const evaluated = evaluateObjectives(applied);
  const command: StrategicCommand = { kind: 'storyChoice', eventId, choiceId };
  const next: GameState = {
    ...evaluated,
    actionLog: [
      ...evaluated.actionLog,
      { turn: evaluated.turn, command, factionId: evaluated.playerFactionId },
    ],
  };
  const outcome = checkOutcome(next);
  gameStore.setState((s) => ({
    ...s,
    game: next,
    ui: outcome
      ? { ...s.ui, screen: { kind: 'gameOver', outcome } }
      : { ...s.ui, screen: { kind: 'main' } },
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

// ----- Battle screen mutators -----
//
// A BattleSession wraps the pure battle sim (see battleSession.ts) with
// player-facing state: queued orders, offered gambits, playback speed.
// These mutators route UI intents into that session and never touch the
// engine's Battle directly.

function sessionFromGame(game: GameState): BattleSession {
  const personalities: Record<string, Personality> = {};
  for (const f of Object.values(game.factions)) personalities[f.id] = f.personality;
  return startSession(game.pendingBattle!, game.playerFactionId, personalities);
}

// Keep game.pendingBattle in sync with the live session's battle, so an autosave
// taken mid-battle reloads at the current day (not day 0).
function withPendingBattle(s: SessionState, session: BattleSession): SessionState {
  return { ...s, battle: session, game: s.game ? { ...s.game, pendingBattle: session.battle } : s.game };
}

// Route to the battle screen for the game's current pendingBattle (used on
// load/restore and by advanceDays when a siege defers).
export function enterPendingBattle(): void {
  gameStore.setState((s) => {
    if (!s.game?.pendingBattle) return s;
    return { ...s, battle: sessionFromGame(s.game), ui: { ...s.ui, screen: { kind: 'battle' } } };
  });
}

export function submitBattleOrders(cmds: TacticalCommand[]): void {
  gameStore.setState((s) => {
    if (!s.battle) return s;
    let sess = s.battle;
    for (const c of cmds) sess = queuePlayerCommand(sess, c);
    return { ...s, battle: sess };
  });
}

export function chooseBattleGambit(gambitId: GambitId): void {
  gameStore.setState((s) => (s.battle ? { ...s, battle: chooseGambit(s.battle, gambitId) } : s));
}

export function chooseBattleDecision(id: string): void {
  gameStore.setState((s) => (s.battle ? { ...s, battle: chooseDecision(s.battle, id) } : s));
}

export function resolveBattleDay(): void {
  gameStore.setState((s) => (s.battle ? withPendingBattle(s, resolveDay(s.battle)) : s));
}

export function setBattleSpeed(speed: 1 | 2 | 4): void {
  gameStore.setState((s) => (s.battle ? { ...s, battle: setSpeed(s.battle, speed) } : s));
}

export function quickResolveBattle(): void {
  gameStore.setState((s) => (s.battle ? withPendingBattle(s, autoResolveSession(s.battle)) : s));
}

// Fold the resolved battle's outcome back into GameState (casualties,
// city capture, general fates), clear the pendingBattle + battle slice,
// and route to game-over or back to the main screen.
export function finishBattle(): void {
  const { game, battle } = gameStore.getState();
  if (!game || !battle) return;
  const result = sessionResult(game, battle);
  const cleared: GameState = { ...result.state, pendingBattle: undefined };
  const outcome = checkOutcome(cleared);
  gameStore.setState((s) => ({
    ...s,
    game: cleared,
    battle: null,
    ui: outcome ? { ...s.ui, screen: { kind: 'gameOver', outcome } } : { ...s.ui, screen: { kind: 'main' } },
  }));
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
  // If the restored game was mid-battle or mid-story-event, resume that screen.
  const restored = gameStore.getState().game;
  if (restored?.pendingBattle) {
    enterPendingBattle();
  } else if (restored?.pendingStoryEvent) {
    setScreen({ kind: 'story', eventId: restored.pendingStoryEvent.eventId });
  }
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
