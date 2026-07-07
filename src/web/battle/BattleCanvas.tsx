import React from 'react';
import type { BattleSession } from '../../state/battleSession.js';
import { BattleField2D } from './BattleField2D.js';

// STUB (Task 2.1): renders the SVG fallback until the Three.js scene lands in
// Task 2.3. Kept as its own component so BattleView's WebGL switch is stable.
export const BattleCanvas: React.FC<{ session: BattleSession }> = ({ session }) => {
  return <BattleField2D session={session} />;
};
