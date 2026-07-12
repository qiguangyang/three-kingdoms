import { describe, expect, it } from 'vitest';
import { createDuelState, stepDuel } from '../../src/duel/simulate.js';
import { DUEL_CONFIG } from '../../src/duel/config.js';
import type { DuelInput, DuelState } from '../../src/duel/types.js';

const NONE: DuelInput = { move: { x: 0, z: 0 }, light: false, heavy: false, dodge: false, guard: false };
const dt = DUEL_CONFIG.fixedDtMs;

// Place the player point-blank in front of the boss so swings connect.
function pointBlank(): DuelState {
  const s = createDuelState(1);
  return { ...s, player: { ...s.player, pos: { x: 1.5, z: 0 }, facing: 0 } };
}
function advance(s: DuelState, input: DuelInput, frames: number): DuelState {
  let cur = s;
  for (let i = 0; i < frames; i++) cur = stepDuel(cur, i === 0 ? input : NONE, dt).state;
  return cur;
}

describe('player light attack', () => {
  it('damages the boss when it connects during the active window', () => {
    const s = pointBlank();
    const after = advance(s, { ...NONE, light: true }, 20);
    expect(after.boss.hp).toBeLessThan(DUEL_CONFIG.boss.maxHp);
  });
  it('deals damage at most once per swing', () => {
    const s = pointBlank();
    const after = advance(s, { ...NONE, light: true }, 30);
    const dmg = DUEL_CONFIG.boss.maxHp - after.boss.hp;
    expect(dmg).toBeLessThanOrEqual(DUEL_CONFIG.player.light.dmg + 1e-6);
  });
  it('spends stamina on the swing', () => {
    const s = pointBlank();
    const { state } = stepDuel(s, { ...NONE, light: true }, dt);
    expect(state.player.stamina).toBe(DUEL_CONFIG.player.maxStamina - DUEL_CONFIG.player.light.stamina);
  });
  it('does not start an attack without enough stamina', () => {
    const s0 = pointBlank();
    const s = { ...s0, player: { ...s0.player, stamina: 1 } };
    const { state, events } = stepDuel(s, { ...NONE, light: true }, dt);
    expect(state.player.action).not.toBe('lightAttack');
    expect(events.some((e) => e.kind === 'staminaEmpty')).toBe(true);
  });
});

describe('player heavy attack', () => {
  it('hits harder than a light attack', () => {
    const s = pointBlank();
    const after = advance(s, { ...NONE, heavy: true }, 40);
    const dmg = DUEL_CONFIG.boss.maxHp - after.boss.hp;
    expect(dmg).toBeGreaterThan(DUEL_CONFIG.player.light.dmg);
  });
});
