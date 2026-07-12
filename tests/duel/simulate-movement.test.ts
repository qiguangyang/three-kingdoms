import { describe, expect, it } from 'vitest';
import { createDuelState, stepDuel } from '../../src/duel/simulate.js';
import { DUEL_CONFIG } from '../../src/duel/config.js';
import type { DuelInput } from '../../src/duel/types.js';

const NO_INPUT: DuelInput = { move: { x: 0, z: 0 }, light: false, heavy: false, dodge: false, guard: false };
const dt = DUEL_CONFIG.fixedDtMs;

describe('createDuelState', () => {
  it('starts both fighters at full HP with the boss idle', () => {
    const s = createDuelState(1);
    expect(s.player.hp).toBe(DUEL_CONFIG.player.maxHp);
    expect(s.boss.hp).toBe(DUEL_CONFIG.boss.maxHp);
    expect(s.boss.action).toBe('idle');
    expect(s.outcome).toBeNull();
  });
});

describe('stepDuel movement', () => {
  it('moves the player toward the input direction', () => {
    const s0 = createDuelState(1);
    const startX = s0.player.pos.x;
    const { state } = stepDuel(s0, { ...NO_INPUT, move: { x: 1, z: 0 } }, dt);
    expect(state.player.pos.x).toBeGreaterThan(startX);
  });
  it('does not mutate the input state (purity)', () => {
    const s0 = createDuelState(1);
    const before = s0.player.pos.x;
    stepDuel(s0, { ...NO_INPUT, move: { x: 1, z: 0 } }, dt);
    expect(s0.player.pos.x).toBe(before);
  });
  it('clamps the player inside the arena radius', () => {
    let s = createDuelState(1);
    for (let i = 0; i < 600; i++) s = stepDuel(s, { ...NO_INPUT, move: { x: -1, z: 0 } }, dt).state;
    expect(Math.hypot(s.player.pos.x, s.player.pos.z)).toBeLessThanOrEqual(DUEL_CONFIG.arena.radius + 1e-6);
  });
  it('regenerates stamina after the regen delay when idle', () => {
    let s = createDuelState(1);
    s = { ...s, player: { ...s.player, stamina: 10, staminaIdle: DUEL_CONFIG.player.staminaRegenDelayMs } };
    const { state } = stepDuel(s, NO_INPUT, dt);
    expect(state.player.stamina).toBeGreaterThan(10);
  });
  it('faces the player toward the boss (soft lock-on)', () => {
    const s0 = createDuelState(1);
    const { state } = stepDuel(s0, NO_INPUT, dt);
    // Boss is at +x from the player, so facing should be near 0 rad.
    expect(Math.abs(state.player.facing)).toBeLessThan(0.2);
  });
});
