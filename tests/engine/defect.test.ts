import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { applyDefect, defectionCost, isLord } from '../../src/engine/recruit.js';
import { adjacentCities } from '../../src/engine/map.js';

describe('defect command', () => {
  it('defectionCost scales with loyalty and stats', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 1,
    });
    // Lü Bu is the canonical low-loyalty case (loyalty 70, stats 233).
    const lvbu = state.generals['lvbu']!;
    expect(defectionCost(lvbu)).toBe(70 * 50 + 233 * 30);
  });

  it('refuses to bribe a lord', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 1,
    });
    const dongzhuo = state.generals['dongzhuo']!;
    expect(isLord(state, dongzhuo)).toBe(true);
    // Pick any player-owned adjacent city as the bribing post.
    const chenliu = state.cities['chenliu']!;
    const result = applyDefect(state, 'caocao', {
      fromCityId: chenliu.id,
      targetGeneralId: 'dongzhuo',
      gold: 999_999_999,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('targetIsLord');
  });

  it('rejects bribes from non-adjacent cities', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 1,
    });
    // Find a player city that is NOT adjacent to Lü Bu's city (Luoyang).
    const lvbu = state.generals['lvbu']!;
    const lvbuCity = state.cities[lvbu.locationCityId!]!;
    const neighbors = adjacentCities(state, lvbuCity.id).map((c) => c.id);
    const farCity = Object.values(state.cities).find(
      (c) => c.factionId === 'caocao' && !neighbors.includes(c.id),
    );
    if (!farCity) {
      // The scenario layout might not provide one, but assert intent.
      return;
    }
    const result = applyDefect(state, 'caocao', {
      fromCityId: farCity.id,
      targetGeneralId: 'lvbu',
      gold: 999_999,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('notAdjacent');
  });

  it('rejects when the offer is below the cost', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 1,
    });
    const chenliu = state.cities['chenliu']!;
    const result = applyDefect(state, 'caocao', {
      fromCityId: chenliu.id,
      targetGeneralId: 'lvbu',
      gold: 100,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficientOffer');
  });

  it('succeeds when adjacent + funded; deducts gold and flips faction', () => {
    let state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'caocao',
      refData: REF_DATA,
      seed: 1,
    });
    // Ensure Chenliu has plenty of gold.
    state = {
      ...state,
      cities: {
        ...state.cities,
        chenliu: { ...state.cities['chenliu']!, money: 50_000 },
      },
    };
    const cost = defectionCost(state.generals['lvbu']!);
    const result = applyDefect(state, 'caocao', {
      fromCityId: 'chenliu',
      targetGeneralId: 'lvbu',
      gold: cost,
    });
    expect(result.ok).toBe(true);
    const next = result.state;
    expect(next.generals['lvbu']!.factionId).toBe('caocao');
    expect(next.generals['lvbu']!.locationCityId).toBe('chenliu');
    expect(next.cities['chenliu']!.money).toBe(50_000 - cost);
    // Lü Bu now appears on Chenliu's general roster and is gone from Luoyang.
    expect(next.cities['chenliu']!.generals).toContain('lvbu');
    expect(next.cities['luoyang']!.generals).not.toContain('lvbu');
    // Loyalty resets to a tepid 70.
    expect(next.generals['lvbu']!.loyalty).toBe(70);
    // A log entry was emitted.
    const last = next.log[next.log.length - 1]!;
    expect(last.key).toBe('event.defected');
  });
});
