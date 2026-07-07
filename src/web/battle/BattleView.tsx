import React from 'react';
import type { BattleSession } from '../../state/battleSession.js';
import { BattleField2D } from './BattleField2D.js';
import { BattleCanvas } from './BattleCanvas.js';
import { hasWebGL } from './webglSupport.js';

// Picks the Three.js 3D battlefield when WebGL is available, else the SVG
// fallback (jsdom tests, WebGL-disabled browsers). Decided once per mount so
// the choice can't flip mid-battle.
export const BattleView: React.FC<{ session: BattleSession }> = ({ session }) => {
  const [webgl] = React.useState(() => hasWebGL());
  return webgl ? <BattleCanvas session={session} /> : <BattleField2D session={session} />;
};
