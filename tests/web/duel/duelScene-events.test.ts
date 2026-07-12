import { describe, expect, it, vi } from 'vitest';
import { applyDuelEventFx } from '../../../src/web/duel/DuelScene.js';
import type { DuelEvent } from '../../../src/duel/types.js';

describe('applyDuelEventFx', () => {
  it('maps hit events to shake + sfx + spark', () => {
    const sink = { shake: vi.fn(), sfx: vi.fn(), spark: vi.fn() };
    const events: DuelEvent[] = [
      { kind: 'playerHit', at: { x: 0, z: 0 }, amount: 7 },
      { kind: 'bossHitPlayer', at: { x: 1, z: 0 }, amount: 20 },
      { kind: 'phaseChange', at: { x: 0, z: 0 } },
    ];
    applyDuelEventFx(events, sink);
    expect(sink.shake).toHaveBeenCalled();
    expect(sink.sfx).toHaveBeenCalled();
    expect(sink.spark).toHaveBeenCalled();
  });

  it('sparks at the exact event position for a hit', () => {
    const sink = { shake: vi.fn(), sfx: vi.fn(), spark: vi.fn() };
    applyDuelEventFx([{ kind: 'playerHit', at: { x: 3, z: -2 }, amount: 5 }], sink);
    expect(sink.spark).toHaveBeenCalledWith({ x: 3, z: -2 });
    expect(sink.sfx).toHaveBeenCalledWith('clash');
  });

  it('dodge whooshes (sfx only — no shake, no spark)', () => {
    const sink = { shake: vi.fn(), sfx: vi.fn(), spark: vi.fn() };
    applyDuelEventFx([{ kind: 'dodge', at: { x: 0, z: 0 } }], sink);
    expect(sink.sfx).toHaveBeenCalledWith('dodge');
    expect(sink.shake).not.toHaveBeenCalled();
    expect(sink.spark).not.toHaveBeenCalled();
  });

  it('guard deflect clangs and sparks', () => {
    const sink = { shake: vi.fn(), sfx: vi.fn(), spark: vi.fn() };
    applyDuelEventFx([{ kind: 'guardDeflect', at: { x: 2, z: 2 }, amount: 1 }], sink);
    expect(sink.sfx).toHaveBeenCalledWith('guard');
    expect(sink.spark).toHaveBeenCalledWith({ x: 2, z: 2 });
  });

  it('phase change roars with a big shake', () => {
    const sink = { shake: vi.fn(), sfx: vi.fn(), spark: vi.fn() };
    applyDuelEventFx([{ kind: 'phaseChange', at: { x: 0, z: 0 } }], sink);
    expect(sink.sfx).toHaveBeenCalledWith('phase');
    expect(sink.shake).toHaveBeenCalled();
  });

  it('win / lose play their stings', () => {
    const win = { shake: vi.fn(), sfx: vi.fn(), spark: vi.fn() };
    applyDuelEventFx([{ kind: 'win', at: { x: 0, z: 0 } }], win);
    expect(win.sfx).toHaveBeenCalledWith('win');

    const lose = { shake: vi.fn(), sfx: vi.fn(), spark: vi.fn() };
    applyDuelEventFx([{ kind: 'lose', at: { x: 0, z: 0 } }], lose);
    expect(lose.sfx).toHaveBeenCalledWith('lose');
  });

  it('is a no-op for an empty event list', () => {
    const sink = { shake: vi.fn(), sfx: vi.fn(), spark: vi.fn() };
    applyDuelEventFx([], sink);
    expect(sink.shake).not.toHaveBeenCalled();
    expect(sink.sfx).not.toHaveBeenCalled();
    expect(sink.spark).not.toHaveBeenCalled();
  });
});
