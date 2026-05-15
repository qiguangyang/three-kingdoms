import type {
  AgentContext,
  Battle,
  FactionAgent,
  FactionStrategy,
  Personality,
  StrategicCommand,
  TacticalCommand,
} from '../types.js';
import { reassessStrategy } from './strategy.js';
import { strategicRules } from './strategic.js';
import { tacticalRules } from './tactical.js';
import { PERSONALITY_PRESETS } from './personality.js';

// Default rule-based agent. The same FactionAgent interface is what an
// LLM-backed implementation would satisfy; the store accepts any factory.
export function makeDefaultAgent(factionId: string, personality: Personality): FactionAgent {
  const params = PERSONALITY_PRESETS[personality];
  return {
    reassess(ctx: AgentContext, current: FactionStrategy | null): FactionStrategy {
      return reassessStrategy({ ...ctx, factionId }, current, params);
    },
    decideStrategic(ctx: AgentContext): StrategicCommand[] {
      return strategicRules({ ...ctx, factionId }, personality);
    },
    decideTactical(battle: Battle, ctx: AgentContext): TacticalCommand[] {
      void ctx;
      return tacticalRules(battle, factionId, personality);
    },
  };
}

export type { FactionAgent, AgentContext } from '../types.js';
export { strategicRules } from './strategic.js';
export { tacticalRules } from './tactical.js';
export { reassessStrategy } from './strategy.js';
export { PERSONALITY_PRESETS } from './personality.js';
