// Seedable RNG (mulberry32). State is a single 32-bit integer, fully
// serializable into save files so replays are deterministic.

export function createSeed(seed: number): number {
  // Normalize any number to a 32-bit unsigned integer.
  return seed >>> 0;
}

// Advance the state once, returning the new state. The caller is responsible
// for storing it back into GameState.rngState so the next call uses the
// updated seed.
export function nextState(state: number): number {
  let s = state;
  s = (s + 0x6d2b79f5) >>> 0;
  return s;
}

// Convert a state to a float in [0, 1). Pure given state — does not mutate.
export function toFloat(state: number): number {
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (((t ^ (t >>> 14)) >>> 0) % 0x100000000) / 0x100000000;
}

// One-shot helper: returns { value, nextState } so the engine threads RNG
// through immutable updates.
export function roll(state: number): { value: number; state: number } {
  const advanced = nextState(state);
  return { value: toFloat(advanced), state: advanced };
}

// Integer in [min, max] inclusive.
export function rollInt(
  state: number,
  min: number,
  max: number,
): { value: number; state: number } {
  const r = roll(state);
  return { value: min + Math.floor(r.value * (max - min + 1)), state: r.state };
}

// Probability check.
export function rollChance(state: number, prob: number): { hit: boolean; state: number } {
  const r = roll(state);
  return { hit: r.value < prob, state: r.state };
}

// Deterministic seeded shuffle (Fisher-Yates). Returns a new array.
export function shuffle<T>(arr: readonly T[], state: number): { value: T[]; state: number } {
  const out = arr.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const r = rollInt(s, 0, i);
    s = r.state;
    const j = r.value;
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return { value: out, state: s };
}
