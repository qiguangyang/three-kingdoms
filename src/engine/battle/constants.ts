// Battle simulation tuning. Values are deliberately gentle so a clear
// stat/terrain/numbers advantage wins reliably while upsets stay possible.
import type { TroopType } from '../types.js';

export const BATTLE_TUNING = {
  // Cells a unit may traverse per day, by troop type.
  moveRange: {
    infantry: 2,
    archer: 2,
    cavalry: 4,
    heavyCav: 3,
    navy: 3,
    xuan: 3,
  } as Record<TroopType, number>,
  // Archer volley range in cells (Chebyshev).
  volleyRange: 3,
  // Fraction of the loser's engaged troops removed in a base melee exchange,
  // before power ratio scaling.
  meleeBaseLoss: 0.18,
  // Ranged volley base loss fraction.
  volleyBaseLoss: 0.06,
  // Extra melee multiplier when a unit spends the day charging.
  chargeBonus: 1.4,
  // Extra melee multiplier for a unit that spends the day holding (braced defense).
  holdBonus: 1.3,
  // Per-cell elevation combat multiplier: attacking downhill helps.
  elevationPerLevel: 0.25,
  // Morale lost per 10% of a unit's troops killed in a day.
  moralePer10pctLoss: 8,
  // Morale lost when a friendly general loses a duel adjacent to the unit.
  moraleDuelLoss: 15,
  // A unit routs when morale drops to or below this.
  routMoraleThreshold: 20,
  // Duel auto-triggers when two enemy generals of at least this wu (martial)
  // stat stand adjacent (mirrors DUEL_TRIGGER_WU_MIN in engine constants).
  duelWuMin: 85,
  // Starting morale.
  startMorale: 100,
} as const;
