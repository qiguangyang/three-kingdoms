// Vitest setup file: runs once before each test file.
//
// Polyfill ResizeObserver — jsdom doesn't ship it but several UI components
// observe their containers. The MapView wraps it in useEffect so the no-op
// shim is enough for tests.

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
}

// Always start each test with a clean localStorage so save/load tests don't
// leak across files.
beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

// React Testing Library normally auto-cleans-up via the global `afterEach`
// hook, but our vitest config sets `globals: false` which suppresses that
// auto-registration. Wire cleanup manually so renders don't accumulate.
afterEach(() => {
  cleanup();
});
