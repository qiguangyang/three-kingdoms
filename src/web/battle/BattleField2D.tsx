import React from 'react';
import type { BattleSession } from '../../state/battleSession.js';
import type { BattleCell } from '../../engine/battle/types.js';
import { factionColor } from '../theme.js';

const CELL = 26;

const CELL_FILL: Record<BattleCell, string> = {
  plain: '#e9e0c8',
  hill: '#cdbb92',
  forest: '#9bad7a',
  river: '#8fb7c9',
  ford: '#bcd0cf',
  wall: '#8a7a5c',
  gate: '#5c4a2c',
  ramp: '#c2b083',
};

// SVG placeholder battlefield. Plan 2 replaces this component with a Three.js
// canvas behind the same `session` prop.
export const BattleField2D: React.FC<{ session: BattleSession }> = ({ session }) => {
  const { field } = session.battle;
  const w = field.width * CELL;
  const h = field.height * CELL;
  const fires = session.lastEvents.filter((e) => e.kind === 'fire');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" role="img" aria-label="battlefield">
      {field.cells.map((cell, i) => {
        const x = (i % field.width) * CELL;
        const y = Math.floor(i / field.width) * CELL;
        return <rect key={i} x={x} y={y} width={CELL} height={CELL} fill={CELL_FILL[cell] ?? '#e9e0c8'} stroke="#00000010" />;
      })}
      {session.battle.units
        .filter((u) => u.state === 'fielded' || u.state === 'routing')
        .map((u) => {
          const size = Math.max(8, Math.min(CELL, Math.sqrt(u.troops) / 4));
          const cx = u.pos.x * CELL + CELL / 2;
          const cy = u.pos.y * CELL + CELL / 2;
          const routing = u.state === 'routing';
          return (
            <g key={u.id} opacity={routing ? 0.5 : 1}>
              <rect x={cx - size / 2} y={cy - size / 2} width={size} height={size} rx={2}
                fill={factionColor(u.factionId)} stroke="#2a2016" strokeWidth={1} />
              <rect x={cx - size / 2} y={cy + size / 2 + 1} width={size} height={2} fill="#2a2016" opacity={0.2} />
              <rect x={cx - size / 2} y={cy + size / 2 + 1} width={(size * u.morale) / 100} height={2} fill="#3a7a3a" />
            </g>
          );
        })}
      {fires.map((e, i) => e.kind === 'fire' ? (
        <circle key={`fire${i}`} cx={e.at.x * CELL + CELL / 2} cy={e.at.y * CELL + CELL / 2} r={CELL * 0.7} fill="#d9531e" opacity={0.4} />
      ) : null)}
    </svg>
  );
};
