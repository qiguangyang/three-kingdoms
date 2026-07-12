import React from 'react';
import { DuelScene } from './DuelScene.js';
import type { KeyState } from './input.js';
import { hasWebGL } from '../gfx/hasWebGL.js';
import { resolveDuel } from '../../state/store.js';
import type { DuelState } from '../../duel/types.js';

// React <-> DuelScene bridge for the real-time boss duel. Mounts a <canvas>,
// builds the Three.js scene once (only when WebGL is available), and:
//   - feeds a live KeyState from window keydown/keyup (held + edge-triggered
//     pressed sets, lowercased; the SCENE clears `pressed` each fixed sim step),
//   - hands the scene `onOutcome` -> resolveDuel (routes back into the campaign),
//   - forwards `onFrame` up so the parent can drive the HUD's live DuelState.
// The sim is stepped entirely inside DuelScene at a fixed timestep; React never
// steps it. Any WebGL construction failure is swallowed (belt-and-suspenders
// beyond DuelScreen's hasWebGL() gate) so the surrounding HUD still renders.
export const DuelCanvas: React.FC<{ onFrame: (state: DuelState) => void }> = ({ onFrame }) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  // Keep the latest onFrame without re-running the mount effect (which would
  // tear down and rebuild the scene). The scene always calls the current one.
  const onFrameRef = React.useRef(onFrame);
  onFrameRef.current = onFrame;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasWebGL()) return undefined;

    // Live input the scene samples each fixed step. React owns these DOM
    // listeners; the scene only reads the sets and clears `pressed`.
    const keys: KeyState = { held: new Set<string>(), pressed: new Set<string>() };
    const onKeyDown = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      // Edge-trigger: only mark `pressed` on a genuine down-transition so OS
      // key-repeat doesn't re-fire attacks/dodge every repeat event.
      if (!keys.held.has(k)) keys.pressed.add(k);
      keys.held.add(k);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      keys.held.delete(e.key.toLowerCase());
    };

    let scene: DuelScene | null = null;
    try {
      scene = new DuelScene(canvas, {
        onOutcome: resolveDuel,
        onFrame: (state) => onFrameRef.current(state),
      });
      scene.setKeyState(keys);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      scene.start();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[duel] WebGL scene failed to start', err);
      scene?.stop();
      return undefined;
    }

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      scene?.stop();
    };
    // Mount once per screen: the scene owns the whole fight until an outcome.
  }, []);

  return <canvas ref={canvasRef} className="block h-full w-full" />;
};
