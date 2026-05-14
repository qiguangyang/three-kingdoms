import type { Personality } from '../types.js';

// Personality presets tune the strategic-layer aggression knobs.
export interface PersonalityParams {
  // Probability of invading a hostile-controlled neighbor when our army
  // exceeds theirs. Empty (uncontrolled) neighbors are always invaded.
  attackHostileProb: number;
  // Minimum army-strength advantage required to invade.
  minAdvantageRatio: number;
  // Probability of running an internal-affairs command in a quiet month.
  internalAffairsProb: number;
  // Whether to enable battlefield niceties (terrain awareness, retreats).
  // Default rule-based agent leaves these mostly off to evoke the original
  // game's behavior.
  smartTactics: boolean;
  // 0..1 — how strongly to prefer attacking the current power leader.
  leaderBiasWeight: number;
  // Staging-force advantage ratio required before launching an assault.
  concentrationThreshold: number;
  // 0..1 — fraction of an interior city's garrison sent to the staging city.
  reinforceAggressiveness: number;
}

export const PERSONALITY_PRESETS: Record<Personality, PersonalityParams> = {
  active: {
    attackHostileProb: 0.5,
    minAdvantageRatio: 1.05,
    internalAffairsProb: 0.8,
    smartTactics: false,
    leaderBiasWeight: 0.6,
    concentrationThreshold: 1.1,
    reinforceAggressiveness: 0.6,
  },
  balanced: {
    attackHostileProb: 0.2,
    minAdvantageRatio: 1.2,
    internalAffairsProb: 0.9,
    smartTactics: false,
    leaderBiasWeight: 0.35,
    concentrationThreshold: 1.4,
    reinforceAggressiveness: 0.4,
  },
  turtle: {
    attackHostileProb: 0.05,
    minAdvantageRatio: 1.5,
    internalAffairsProb: 1.0,
    smartTactics: false,
    leaderBiasWeight: 0.15,
    concentrationThreshold: 2.0,
    reinforceAggressiveness: 0.25,
  },
};
