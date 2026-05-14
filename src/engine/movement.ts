import { COMBAT_MODIFIER, TERRAIN_MOVE_COST } from './constants.js';
import type { Terrain, TroopType } from './types.js';

// Per-tile travel cost for a unit of a given troop type on a given terrain.
// Mountains and forests slow cavalry; rivers stop ground troops without
// boats; navy fly across water.
export function moveCost(troopType: TroopType, terrain: Terrain): number {
  const base = TERRAIN_MOVE_COST[terrain] ?? 1;
  switch (troopType) {
    case 'cavalry':
    case 'heavyCav':
      if (terrain === 'mountain') return base * 2;
      if (terrain === 'forest') return base * 1.5;
      if (terrain === 'river') return Infinity;
      return base;
    case 'navy':
      if (terrain === 'river') return base * 0.5;
      if (terrain === 'plain') return base * 2;
      return base * 3;
    case 'infantry':
    case 'archer':
      if (terrain === 'river') return base * 3; // wades but slowly
      return base;
    case 'xuan':
      return base; // all-terrain
  }
}

// Combat damage modifier for a unit operating on a given tile's terrain.
export function combatModifier(troopType: TroopType, terrain: Terrain): number {
  const row = COMBAT_MODIFIER[troopType];
  if (!row) return 1.0;
  return row[terrain] ?? 1.0;
}
