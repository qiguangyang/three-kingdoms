import { describe, expect, it } from 'vitest';
import { t, setLocale } from '../../src/i18n/locale.js';

const KEYS = [
  'battle.heading', 'battle.morale', 'battle.advanceDay', 'battle.play', 'battle.pause',
  'battle.quickResolve', 'battle.speed', 'battle.yourOrders', 'battle.gambits',
  'battle.commitReserves', 'battle.charge', 'battle.hold', 'battle.advance', 'battle.finish',
  'battle.victoryTitle', 'battle.defeatTitle', 'battle.gambit.cavalryCharge',
  'battle.gambit.fireAttack', 'battle.gambit.floodAttack', 'battle.gambit.duelChallenge', 'battle.gambit.fordCrossing',
  'battle.gambit.ambush',
  'battle.caption.fire', 'battle.caption.flood', 'battle.caption.duel', 'battle.caption.rout',
  'battle.caption.charge', 'battle.caption.clash', 'battle.caption.volley',
  'battle.intro.tag', 'battle.intro.title', 'battle.intro.era', 'battle.intro.commanders',
  'battle.intro.garrison', 'battle.intro.narr', 'battle.intro.begin',
  'battle.act.deploy', 'battle.act.engage', 'battle.act.decide',
  'battle.narr.deploy', 'battle.narr.volley', 'battle.narr.clash', 'battle.narr.charge',
  'battle.narr.fire', 'battle.narr.flood', 'battle.narr.duel', 'battle.narr.rout',
  'battle.reveal.tag', 'battle.reveal.cavalryCharge', 'battle.reveal.fireAttack',
  'battle.reveal.floodAttack', 'battle.reveal.duelChallenge', 'battle.reveal.fordCrossing',
  'battle.reveal.ambush', 'battle.mute', 'battle.unmute',
] as const;

describe('battle screen i18n keys', () => {
  it('resolve to non-empty, distinct strings in both locales', () => {
    for (const loc of ['zh', 'en'] as const) {
      setLocale(loc);
      for (const k of KEYS) {
        const v = t(k as never);
        expect(v, `${loc} ${k}`).toBeTruthy();
        expect(v, `${loc} ${k} not resolved`).not.toBe(k);
      }
    }
    setLocale('zh');
  });
});
