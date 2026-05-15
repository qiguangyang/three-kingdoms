import type { Personality } from '../types.js';

// Personality presets tune the strategic-layer aggression knobs.
export interface PersonalityParams {
  // Whether to enable battlefield niceties (terrain awareness, retreats).
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
    smartTactics: false,
    leaderBiasWeight: 0.6,
    concentrationThreshold: 1.1,
    reinforceAggressiveness: 0.6,
  },
  balanced: {
    smartTactics: false,
    leaderBiasWeight: 0.35,
    concentrationThreshold: 1.4,
    reinforceAggressiveness: 0.4,
  },
  turtle: {
    smartTactics: false,
    leaderBiasWeight: 0.15,
    concentrationThreshold: 2.0,
    reinforceAggressiveness: 0.25,
  },
};
