// Decaying camera-shake offset for hit juice. Deterministic: a fixed sinusoid
// dither scaled by an energy value that add() bumps and sample() bleeds down.
// No Math.random so it stays reproducible.
export function makeShake() {
  let energy = 0;
  let t = 0;
  return {
    add(intensity: number): void {
      energy = Math.min(1.5, energy + intensity);
    },
    sample(dtMs: number): { x: number; y: number } {
      if (energy <= 1e-4) {
        energy = 0;
        return { x: 0, y: 0 };
      }
      t += dtMs;
      const amp = energy * 0.15;
      const x = Math.sin(t * 0.08) * amp;
      const y = Math.cos(t * 0.11) * amp;
      energy = Math.max(0, energy - dtMs / 260); // ~260ms to settle
      return { x, y };
    },
  };
}
