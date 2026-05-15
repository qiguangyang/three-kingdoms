// Browser-side save/load via Web Storage. The Node-fs implementation is
// gone — Vite ships this as part of the web bundle and `localStorage` is the
// natural store. Tests run under jsdom which provides a working
// `localStorage` polyfill out of the box.

import type { GameState } from '../engine/types.js';
import type { Locale } from '../i18n/types.js';

const SAVE_FORMAT_VERSION = 1;
const STORAGE_PREFIX = 'tk-save:';
const AUTOSAVE_PREFIX = 'tk-save:autosave-';
// Reserved slot name used for the always-on continuous autosave that
// resurrects the game after a browser refresh. Hidden from manual save
// listings — see listSlots().
export const CONTINUOUS_SLOT = '__continuous';

export interface SaveFile {
  version: number;
  savedAt: string;
  scenarioId: string;
  year: number;
  month: number;
  playerFactionId: string;
  locale?: Locale;
  state: GameState;
}

export interface PersistenceConfig {
  storage?: Storage; // injectable for tests
}

function storage(cfg: PersistenceConfig): Storage {
  if (cfg.storage) return cfg.storage;
  if (typeof localStorage !== 'undefined') return localStorage;
  throw new Error('No localStorage available; pass cfg.storage explicitly.');
}

export interface SaveSlot {
  slot: string;
  key: string;
  exists: boolean;
  savedAt?: string;
  scenarioId?: string;
  year?: number;
  month?: number;
}

export function listSlots(cfg: PersistenceConfig = {}): SaveSlot[] {
  const s = storage(cfg);
  const slots: SaveSlot[] = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    const slot = key.substring(STORAGE_PREFIX.length);
    // Hide the continuous autosave from the save/load UI — it's
    // managed by the runtime, not the player.
    if (slot === CONTINUOUS_SLOT) continue;
    try {
      const raw = s.getItem(key);
      if (!raw) {
        slots.push({ slot, key, exists: false });
        continue;
      }
      const parsed = JSON.parse(raw) as SaveFile;
      slots.push({
        slot,
        key,
        exists: true,
        savedAt: parsed.savedAt,
        scenarioId: parsed.scenarioId,
        year: parsed.year,
        month: parsed.month,
      });
    } catch {
      slots.push({ slot, key, exists: false });
    }
  }
  return slots.sort((a, b) => a.slot.localeCompare(b.slot));
}

export function saveToSlot(
  slot: string,
  state: GameState,
  locale: Locale,
  cfg: PersistenceConfig = {},
): string {
  const s = storage(cfg);
  const file: SaveFile = {
    version: SAVE_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    scenarioId: state.scenarioId,
    year: state.year,
    month: state.month,
    playerFactionId: state.playerFactionId,
    locale,
    state,
  };
  const key = STORAGE_PREFIX + slot;
  s.setItem(key, JSON.stringify(file));
  return key;
}

export function loadFromSlot(slot: string, cfg: PersistenceConfig = {}): SaveFile {
  const s = storage(cfg);
  const raw = s.getItem(STORAGE_PREFIX + slot);
  if (!raw) throw new Error(`No save in slot "${slot}".`);
  const parsed = JSON.parse(raw) as SaveFile;
  if (parsed.version !== SAVE_FORMAT_VERSION) {
    throw new Error(`Unsupported save format version: ${parsed.version}`);
  }
  // Back-compat: saves written before aiStrategies existed load without it.
  // SAVE_FORMAT_VERSION is intentionally not bumped — an empty map is a
  // complete, lossless default for this field, so old saves stay loadable
  // with no real migration needed.
  if (!parsed.state.aiStrategies) {
    parsed.state.aiStrategies = {};
  }
  return parsed;
}

export function deleteSlot(slot: string, cfg: PersistenceConfig = {}): void {
  storage(cfg).removeItem(STORAGE_PREFIX + slot);
}

// Autosave at the start of each calendar year. Keeps the five most recent.
export function autosave(
  state: GameState,
  locale: Locale,
  cfg: PersistenceConfig = {},
): string {
  const slot = `autosave-${state.year}`;
  const key = saveToSlot(slot, state, locale, cfg);
  pruneAutosaves(5, cfg);
  return key;
}

function pruneAutosaves(keep: number, cfg: PersistenceConfig): void {
  const s = storage(cfg);
  const keys: { key: string; savedAt: string }[] = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (!key || !key.startsWith(AUTOSAVE_PREFIX)) continue;
    try {
      const raw = s.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as SaveFile;
      keys.push({ key, savedAt: parsed.savedAt });
    } catch {
      // skip
    }
  }
  keys.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  for (const old of keys.slice(keep)) {
    s.removeItem(old.key);
  }
}
