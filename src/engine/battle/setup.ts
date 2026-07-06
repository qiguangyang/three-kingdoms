// Build a Battle from a besieged city + the attacking expedition. Troop pools
// are split into unit blocks (one per committed general, plus a garrison
// block and a reserve block). Attackers deploy along the bottom edge;
// defenders array around the wall/gate. Deterministic given state.rngState.
import { BATTLE_HEIGHT, BATTLE_WIDTH } from '../constants.js';
import type {
  Battle,
  BattleUnit,
  CityId,
  FactionId,
  GameState,
  General,
  GeneralId,
  TroopType,
} from '../types.js';
import type { FormationRole } from './types.js';
import { generateField } from './terrain.js';

export interface BattleSetupInput {
  cityId: CityId;
  attackerFactionId: FactionId;
  defenderFactionId: FactionId;
  attackingGeneralIds: GeneralId[];
  attackingTroops: number;
}

const ROLE_BY_TROOP: Record<TroopType, FormationRole> = {
  cavalry: 'van',
  heavyCav: 'van',
  archer: 'rear',
  navy: 'flank',
  xuan: 'center',
  infantry: 'center',
};

// Split `total` across `n` blocks as evenly as possible, remainder to the first.
function split(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const out = new Array<number>(n).fill(base);
  out[0] = (out[0] ?? 0) + (total - base * n);
  return out;
}

export function createBattle(state: GameState, input: BattleSetupInput): Battle {
  const city = state.cities[input.cityId]!;
  const field = generateField(city, state.rngState >>> 0);

  const attackerGenerals = input.attackingGeneralIds
    .map((id) => state.generals[id])
    .filter((g): g is General => Boolean(g));
  const defenderGenerals = city.generals
    .map((id) => state.generals[id])
    .filter((g): g is General => Boolean(g));

  const units: BattleUnit[] = [];
  let uid = 0;
  const mkId = (): string => `bu${uid++}`;

  // --- Attackers: one block per general along the bottom edge (y = H-2).
  const atkShares = split(input.attackingTroops, Math.max(1, attackerGenerals.length));
  const atkY = BATTLE_HEIGHT - 2;
  const spread = Math.max(1, Math.floor(BATTLE_WIDTH / (attackerGenerals.length + 1)));
  if (attackerGenerals.length === 0) {
    units.push({
      id: mkId(), generalId: '', factionId: input.attackerFactionId,
      troops: input.attackingTroops, troopType: 'infantry',
      pos: { x: Math.floor(BATTLE_WIDTH / 2), y: atkY }, morale: 100,
      hasActed: false, state: 'fielded', formationRole: 'center',
    });
  } else {
    attackerGenerals.forEach((g, i) => {
      units.push({
        id: mkId(), generalId: g.id, factionId: input.attackerFactionId,
        troops: atkShares[i] ?? 0, troopType: g.troopType,
        pos: { x: Math.min(BATTLE_WIDTH - 1, spread * (i + 1)), y: atkY },
        morale: 100, hasActed: false, state: 'fielded',
        formationRole: ROLE_BY_TROOP[g.troopType],
      });
    });
  }

  // --- Defenders: general blocks near the wall row (y = 2), garrison block on
  //     the gate, plus a reserve block held back inside the city (state:reserve).
  const defY = 2;
  const defSpread = Math.max(1, Math.floor(BATTLE_WIDTH / (defenderGenerals.length + 2)));
  defenderGenerals.forEach((g, i) => {
    units.push({
      id: mkId(), generalId: g.id, factionId: input.defenderFactionId,
      troops: g.troops, troopType: g.troopType,
      pos: { x: Math.min(BATTLE_WIDTH - 1, defSpread * (i + 1)), y: defY },
      morale: 100, hasActed: false, state: 'fielded',
      formationRole: ROLE_BY_TROOP[g.troopType],
    });
  });
  // Garrison: half fielded on the gate, half reserve.
  const gate = field.wall?.gate ?? { x: Math.floor(BATTLE_WIDTH / 2), y: 1 };
  const fieldedGarrison = Math.ceil(city.garrison / 2);
  const reserveGarrison = city.garrison - fieldedGarrison;
  if (fieldedGarrison > 0) {
    units.push({
      id: mkId(), generalId: '', factionId: input.defenderFactionId,
      troops: fieldedGarrison, troopType: 'infantry',
      pos: { x: gate.x, y: gate.y + 1 }, morale: 100, hasActed: false,
      state: 'fielded', formationRole: 'center',
    });
  }
  if (reserveGarrison > 0) {
    units.push({
      id: mkId(), generalId: '', factionId: input.defenderFactionId,
      troops: reserveGarrison, troopType: 'infantry',
      pos: { x: gate.x, y: 0 }, morale: 100, hasActed: false,
      state: 'reserve', formationRole: 'rear',
    });
  }

  return {
    cityId: input.cityId,
    attackerFactionId: input.attackerFactionId,
    defenderFactionId: input.defenderFactionId,
    daysElapsed: 0,
    units,
    field,
    seed: field.seed,
    rngCursor: field.seed,
    log: [],
  };
}
