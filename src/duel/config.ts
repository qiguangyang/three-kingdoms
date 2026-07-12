// The balance surface for the duel. All timings in milliseconds, distances in
// world units (same scale as the battle geometry), speeds in units/second.
// Tuned so a patient dodge-and-punish player wins in ~60-120s and a passive
// player loses (see the balance harness in Task 7).

export const DUEL_CONFIG = {
  player: {
    maxHp: 100,
    maxStamina: 100,
    staminaRegenPerSec: 24,
    staminaRegenDelayMs: 450, // no regen until this long after spending
    moveSpeed: 4.4,
    light: { dmg: 7, stamina: 12, windupMs: 90, activeMs: 90, recoveryMs: 170, range: 1.9, arc: 1.2 },
    heavy: { dmg: 19, stamina: 30, windupMs: 300, activeMs: 120, recoveryMs: 360, range: 2.2, arc: 1.4 },
    dodge: { stamina: 20, iframeMs: 300, durationMs: 400, distance: 3.2 },
    guard: { chipMul: 0.25, staminaPerHit: 18 },
    comboWindowMs: 420,
    comboHits: 3,
    staggerMs: 320,
  },
  boss: {
    maxHp: 220,
    phase2Threshold: 0.5, // fraction of maxHp
    phase2SpeedMul: 1.35,
    moveSpeed: 3.4,
    contactRange: 2.4, // how close it wants to be before attacking
    staggerMs: 260,
    idleMinMs: 260,
    idleMaxMs: 820,
    attacks: {
      sweep: { dmg: 20, windupMs: 620, activeMs: 160, recoveryMs: 640, range: 3.0, arc: 2.4 },
      smash: { dmg: 28, windupMs: 720, activeMs: 140, recoveryMs: 720, range: 2.6, arc: 1.0 },
      lunge: { dmg: 22, windupMs: 520, activeMs: 180, recoveryMs: 560, range: 4.6, arc: 0.8 },
      combo: { dmg: 16, windupMs: 440, activeMs: 140, recoveryMs: 300, range: 3.0, arc: 2.0 },
      charge: { dmg: 26, windupMs: 560, activeMs: 220, recoveryMs: 640, range: 6.5, arc: 1.0 },
    },
  },
  arena: { radius: 12 },
  fixedDtMs: 1000 / 60,
  juice: { hitStopMs: 90, slowMoMs: 700, slowMoScale: 0.35 },
  seed: 1,
} as const;
