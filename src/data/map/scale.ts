// Pure geometry-scaling helpers for the hand-authored SVG map data.
//
// The campaign map's coastline, rivers, mountains and label positions are
// authored against a compact logical grid (100x40) for readability, then
// multiplied up to the runtime grid via `GRID_SCALE` at the data boundary.
// These helpers perform that multiply on SVG path strings and point arrays.
// They are deterministic and have no dependency on `three` or any game code.

// Round to ~6 decimal places to strip binary floating-point dust
// (e.g. 0.1 * 3 => 0.30000000000000004) while keeping legitimate precision.
function scaleNumber(n: number, k: number): number {
  return Math.round(n * k * 1e6) / 1e6;
}

// Match a single numeric token: optional sign, integer and/or fractional part,
// optional scientific-notation exponent. Whitespace, commas and the SVG command
// letters (M/L/C/Q/A/Z/... upper- and lower-case) are left untouched.
const NUMBER_TOKEN = /-?\d*\.?\d+(?:[eE][+-]?\d+)?/g;

/**
 * Multiply every numeric token in an SVG path string by `k`, leaving command
 * letters and whitespace/separators intact.
 *
 * Example: scalePath('M 10 20 L 5 5 Z', 5) => 'M 50 100 L 25 25 Z'.
 */
export function scalePath(d: string, k: number): string {
  return d.replace(NUMBER_TOKEN, (token) => String(scaleNumber(Number(token), k)));
}

/**
 * Scale each [x, y] pair by `k`, returning a fresh array (input is not mutated).
 *
 * Example: scalePoints([[1, 2], [3, 4]], 5) => [[5, 10], [15, 20]].
 */
export function scalePoints(pts: [number, number][], k: number): [number, number][] {
  return pts.map(([x, y]) => [scaleNumber(x, k), scaleNumber(y, k)]);
}
