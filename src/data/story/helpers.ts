// Shared, pure helpers for the authored Liu Bei story chapters (s1/s2).
//
// These were previously copy-pasted verbatim in s1-liubei.ts and s2-liubei.ts;
// they are extracted here so both chapters share one implementation. All logic
// is pure and deterministic (no wall-clock, no RNG). Identifiers and comments
// are English.

import type { City, FactionId, GameState, General } from '../../engine/types.js';

// Has a scripted/story event with this id already fired (been recorded in
// state.events)? Used both to gate objective completion and to keep a
// story event from re-firing after it has been seen/decided.
export function hasEvent(state: GameState, id: string): boolean {
  return state.events.some((e) => e.id === id);
}

// Flip a city to a new owner AND move its stationed generals with it, so the
// state never strands dead-faction officers inside a city they'd otherwise
// still defend (resolveQuickBattle reads defenders from city.generals). Pure:
// mutates only the FRESH cities/generals maps the caller owns (shallow copies
// of state.cities/state.generals) — the original maps are never touched, and
// each city/general is replaced by a spread copy. Historically apt: a province's
// officers (Mi Zhu, Chen Deng, ...) threw in with whoever held it.
export function transferCityWithGenerals(
  cities: Record<string, City>,
  generals: Record<string, General>,
  cityId: string,
  newOwner: FactionId,
): void {
  const city = cities[cityId];
  if (!city) return;
  cities[cityId] = { ...city, factionId: newOwner };
  for (const generalId of city.generals) {
    const g = generals[generalId];
    // Keep the general at the same city; only its allegiance changes.
    if (g) generals[generalId] = { ...g, factionId: newOwner };
  }
}
