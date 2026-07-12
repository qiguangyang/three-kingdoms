import { describe, expect, it } from 'vitest';
import { createDuelState, stepDuel } from '../../src/duel/simulate.js';
import { DUEL_CONFIG } from '../../src/duel/config.js';
import type { DuelInput, DuelState } from '../../src/duel/types.js';

const NONE: DuelInput = { move: { x: 0, z: 0 }, light: false, heavy: false, dodge: false, guard: false };
const dt = DUEL_CONFIG.fixedDtMs;

// A boss frozen in its active hitbox, point-blank on the player.
function bossActiveOnPlayer(): DuelState {
  const s = createDuelState(1);
  return {
    ...s,
    player: { ...s.player, pos: { x: 0, z: 0 } },
    boss: { ...s.boss, pos: { x: 1, z: 0 }, facing: Math.PI, action: 'sweep', attackPhase: 'active', actionTimer: 0, hitThisSwing: false },
  };
}

describe('boss damage & defense', () => {
  it('damages an unguarded, non-dodging player', () => {
    const s = bossActiveOnPlayer();
    const { state } = stepDuel(s, NONE, dt);
    expect(state.player.hp).toBeLessThan(DUEL_CONFIG.player.maxHp);
    expect(state.player.action).toBe('stagger');
  });
  it('deals no damage while the player has i-frames', () => {
    const s0 = bossActiveOnPlayer();
    const s = { ...s0, player: { ...s0.player, iframes: 200, action: 'dodge' as const } };
    const { state } = stepDuel(s, NONE, dt);
    expect(state.player.hp).toBe(DUEL_CONFIG.player.maxHp);
  });
  it('reduces damage and spends stamina when guarding', () => {
    const s = bossActiveOnPlayer();
    const { state } = stepDuel(s, { ...NONE, guard: true }, dt);
    const dmg = DUEL_CONFIG.player.maxHp - state.player.hp;
    expect(dmg).toBeGreaterThan(0);
    expect(dmg).toBeLessThan(DUEL_CONFIG.boss.attacks.sweep.dmg);
    expect(state.player.stamina).toBeLessThan(DUEL_CONFIG.player.maxStamina);
  });
});

describe('dodge', () => {
  it('grants i-frames and costs stamina', () => {
    const s = createDuelState(1);
    const { state, events } = stepDuel(s, { ...NONE, dodge: true, move: { x: -1, z: 0 } }, dt);
    expect(state.player.iframes).toBeGreaterThan(0);
    expect(state.player.stamina).toBe(DUEL_CONFIG.player.maxStamina - DUEL_CONFIG.player.dodge.stamina);
    expect(events.some((e) => e.kind === 'dodge')).toBe(true);
  });
});

describe('outcome', () => {
  it('is win when the boss reaches 0 HP', () => {
    const s0 = createDuelState(1);
    const s = { ...s0, boss: { ...s0.boss, hp: 1, pos: { x: 1.2, z: 0 } }, player: { ...s0.player, pos: { x: 0, z: 0 }, facing: 0 } };
    let cur = s;
    for (let i = 0; i < 20; i++) cur = stepDuel(cur, i === 0 ? { ...NONE, heavy: true } : NONE, dt).state;
    expect(cur.outcome).toBe('win');
  });
  it('is lose when the player reaches 0 HP', () => {
    const s0 = bossActiveOnPlayer();
    const s = { ...s0, player: { ...s0.player, hp: 1 } };
    const { state } = stepDuel(s, NONE, dt);
    expect(state.outcome).toBe('lose');
  });
});
