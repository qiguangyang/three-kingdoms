import { describe, expect, it } from 'vitest';
import type {
  BattleField,
  BattleEvent,
  Gambit,
} from '../../src/engine/battle/types.js';
import { BATTLE_TUNING } from '../../src/engine/battle/constants.js';
import type { Battle, BattleUnit, TacticalCommand } from '../../src/engine/types.js';

describe('battle domain types', () => {
  it('constructs a BattleField with row-major arrays sized width*height', () => {
    const field: BattleField = {
      width: 2,
      height: 2,
      heights: [0, 0, 0, 0],
      cells: ['plain', 'hill', 'plain', 'forest'],
      seed: 1,
    };
    expect(field.cells.length).toBe(field.width * field.height);
    expect(field.heights.length).toBe(field.width * field.height);
  });

  it('extends BattleUnit with state + formationRole and Battle with field/seed/rngCursor', () => {
    const unit: BattleUnit = {
      id: 'u1',
      generalId: 'guanyu',
      factionId: 'liubei',
      troops: 5000,
      troopType: 'infantry',
      pos: { x: 1, y: 2 },
      morale: 100,
      hasActed: false,
      state: 'fielded',
      formationRole: 'center',
    };
    const battle: Battle = {
      cityId: 'luoyang',
      attackerFactionId: 'liubei',
      defenderFactionId: 'dongzhuo',
      daysElapsed: 0,
      units: [unit],
      field: { width: 1, height: 1, heights: [0], cells: ['plain'], seed: 7 },
      seed: 7,
      rngCursor: 7,
      log: [],
    };
    expect(battle.units[0]!.state).toBe('fielded');
    expect(battle.rngCursor).toBe(7);
  });

  it('extends TacticalCommand with charge/challengeDuel/commitReserves/gambit', () => {
    const cmds: TacticalCommand[] = [
      { kind: 'charge', unitId: 'u1', targetUnitId: 'e1' },
      { kind: 'challengeDuel', unitId: 'u1', targetUnitId: 'e1' },
      { kind: 'commitReserves', factionId: 'liubei' },
      { kind: 'gambit', gambitId: 'fireAttack', unitIds: ['u1'] },
    ];
    expect(cmds).toHaveLength(4);
  });

  it('exposes BattleEvent variants and Gambit shape', () => {
    const ev: BattleEvent = { kind: 'clash', unitId: 'u1', targetUnitId: 'e1', casualties: 100, defCasualties: 90 };
    const g: Gambit = { id: 'cavalryCharge', unitIds: ['u1'], labelKey: 'battle.gambit.cavalryCharge' };
    expect(ev.kind).toBe('clash');
    expect(g.id).toBe('cavalryCharge');
    expect(BATTLE_TUNING.moveRange.infantry).toBeGreaterThan(0);
  });
});
