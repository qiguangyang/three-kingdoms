import { describe, expect, it } from 'vitest';
import { playCharge, playVolley, playFire, playDuel, playRout } from '../../src/web/audio/battle.js';

describe('battle audio cues', () => {
  it('are callable and no-op safely under jsdom (no AudioContext)', () => {
    // jsdom has no Web Audio; these must not throw.
    expect(() => { playCharge(); playVolley(); playFire(); playDuel(); playRout(); }).not.toThrow();
  });
});
