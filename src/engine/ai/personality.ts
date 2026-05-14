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
}

export const PERSONALITY_PRESETS: Record<Personality, PersonalityParams> = {
  active: {
    attackHostileProb: 0.5,
    minAdvantageRatio: 1.05,
    internalAffairsProb: 0.8,
    smartTactics: false,
  },
  balanced: {
    attackHostileProb: 0.2,
    minAdvantageRatio: 1.2,
    internalAffairsProb: 0.9,
    smartTactics: false,
  },
  turtle: {
    attackHostileProb: 0.05,
    minAdvantageRatio: 1.5,
    internalAffairsProb: 1.0,
    smartTactics: false,
  },
};
