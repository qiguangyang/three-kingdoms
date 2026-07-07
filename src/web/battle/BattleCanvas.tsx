import React from 'react';
import type { BattleSession } from '../../state/battleSession.js';
import { BattleField2D } from './BattleField2D.js';
import { BattleScene } from './BattleScene.js';

// React <-> BattleScene bridge. Builds the Three.js scene once per battle
// (keyed on the field identity, which is stable across days), then syncs units
// + camera + events on every session tick. Any WebGL failure falls back to the
// SVG view — belt-and-suspenders beyond BattleView's hasWebGL() gate.
export const BattleCanvas: React.FC<{ session: BattleSession }> = ({ session }) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const sceneRef = React.useRef<BattleScene | null>(null);
  const [failed, setFailed] = React.useState(false);

  // (Re)build the scene when a new battle starts (field object changes).
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const scene = new BattleScene(canvas);
      scene.setField(session.battle.field);
      scene.syncUnits(session);
      scene.frameBattle(session);
      sceneRef.current = scene;
      const onResize = (): void => scene.resize();
      window.addEventListener('resize', onResize);
      return () => {
        window.removeEventListener('resize', onResize);
        scene.dispose();
        sceneRef.current = null;
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[battle] WebGL scene failed; using SVG fallback', err);
      setFailed(true);
      return undefined;
    }
    // Intentionally keyed on the field, not the whole session: the scene
    // rebuilds only for a new battle, not on every day tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.battle.field]);

  // Sync units / camera / events on every session change.
  React.useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.syncUnits(session);
    scene.frameBattle(session);
    scene.playEvents(session.lastEvents);
  }, [session]);

  if (failed) return <BattleField2D session={session} />;
  return <canvas ref={canvasRef} className="block h-full w-full" />;
};
