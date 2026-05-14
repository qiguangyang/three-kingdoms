import { useStore } from 'zustand';
import { gameStore } from '../../state/store.js';
import type { SessionState } from '../../state/store.js';

// Thin React adapter for the framework-agnostic vanilla store.
export function useSession<T>(selector: (s: SessionState) => T): T {
  return useStore(gameStore, selector);
}
