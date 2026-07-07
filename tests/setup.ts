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

// jsdom does not implement canvas getContext (it throws a noisy "Not
// implemented" error). Stub it to return null so WebGL-capability detection
// (hasWebGL) resolves cleanly to "unavailable" and the battle view falls back
// to its SVG renderer under test, with no console noise.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as unknown as HTMLCanvasElement['getContext'];
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
