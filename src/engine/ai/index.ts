import type {
  AgentContext,
  Battle,
  FactionAgent,
  Personality,
  StrategicCommand,
  TacticalCommand,
} from '../types.js';
import { strategicRules } from './strategic.js';
import { tacticalRules } from './tactical.js';

// Default rule-based agent. The same FactionAgent interface is what an
// LLM-backed implementation would satisfy; the store accepts any factory.
export function makeDefaultAgent(factionId: string, personality: Personality): FactionAgent {
  return {
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
export { PERSONALITY_PRESETS } from './personality.js';
