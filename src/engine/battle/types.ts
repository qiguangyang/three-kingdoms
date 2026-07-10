// Battle-local domain types. Kept separate from the global engine types.ts so
// that file stays focused; re-exported through the engine barrel.
import type {
  CityId,
  FactionId,
  GeneralId,
  LogEntry,
  TroopType,
} from '../types.js';

export type Vec2 = { x: number; y: number };

// One battlefield cell's terrain class. Drives movement cost, combat
// modifiers, line-of-sight, and (in Plan 2) the 3D mesh.
export type BattleCell =
  | 'plain'
  | 'hill'
  | 'forest'
  | 'river'
  | 'ford'
  | 'wall'
  | 'gate'
  | 'ramp';

export type FormationRole = 'van' | 'center' | 'rear' | 'flank';

// A unit is fielded (drawn, fighting), reserve (off-field until committed),
// routing (fleeing, morale broken), or gone (destroyed / left the field).
export type BattleUnitState = 'fielded' | 'reserve' | 'routing' | 'gone';

export interface BattleField {
  width: number; // battlefield-local grid width (cells)
  height: number; // battlefield-local grid height (cells)
  // Row-major (index = y*width + x), length === width*height. Stored as plain
  // number[] (not Float32Array) so it serializes into save files cleanly.
  heights: number[]; // per-cell elevation, ~0..1
  cells: BattleCell[]; // per-cell terrain class
  river?: { spline: Vec2[]; fords: Vec2[] };
  wall?: { cells: Vec2[]; gate: Vec2 };
  seed: number;
}

export type GambitId =
  | 'cavalryCharge'
  | 'fireAttack'
  | 'floodAttack'
  | 'ambush'
  | 'duelChallenge'
  | 'fordCrossing';

export interface Gambit {
  id: GambitId;
  unitIds: string[]; // the player's units this gambit would act with
  labelKey: string; // i18n MessageKey, e.g. 'battle.gambit.fireAttack'
}

// The typed timeline the renderer plays back and the HUD narrates. Positions
// use battlefield-local cell coordinates.
export type BattleEvent =
  | { kind: 'move'; unitId: string; from: Vec2; to: Vec2 }
  | { kind: 'volley'; unitId: string; targetUnitId: string; casualties: number }
  | { kind: 'clash'; unitId: string; targetUnitId: string; casualties: number; defCasualties: number }
  | { kind: 'charge'; unitId: string; targetUnitId: string }
  | { kind: 'rally'; unitId: string; targetUnitId: string; morale: number }
  | { kind: 'duel'; a: GeneralId; b: GeneralId; winner: GeneralId }
  | { kind: 'fire'; at: Vec2; spread: number }
  | { kind: 'flood'; from: Vec2; cells: Vec2[] }
  | { kind: 'ambushSprung'; at: Vec2; unitId: string }
  | { kind: 'moraleBreak'; unitId: string }
  | { kind: 'rout'; unitId: string }
  | { kind: 'feint'; unitId: string }
  | { kind: 'reserveCommitted'; factionId: FactionId; unitIds: string[] }
  | { kind: 'dayAdvanced'; day: number }
  | { kind: 'log'; entry: LogEntry }
  | { kind: 'end'; attackerWon: boolean; reason: 'destroyed' | 'timeout' };

// Re-export a couple of global ids used above so consumers can import from one
// place.
export type { CityId, FactionId, GeneralId, TroopType };
