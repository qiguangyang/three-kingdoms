import React from 'react';
import type { GameState } from '../../engine/types.js';
import type { MapViewProps } from '../components/MapView.js';
import { MapView } from '../components/MapView.js';
import { MapScene } from './MapScene.js';
import type { MapLabelData } from './MapScene.js';
import { pickName } from '../../i18n/locale.js';
import { GENERALS } from '../../data/generals/index.js';
import { CITIES } from '../../data/cities.js';
import { useSession } from '../hooks/useSession.js';
import { selectLocale } from '../../state/selectors.js';

// Resolve the floating-label strings here in React, where the name data and the
// active locale live; the scene just positions and renders them. Mirrors
// BattleCanvas.buildLabelData: the city name comes from the static CITIES
// roster, and the sub-line is the resident general's name (via GENERALS) —
// falling back to the garrison headcount when no general is stationed.
function buildLabelData(game: GameState): MapLabelData[] {
  return Object.values(game.cities).map((city) => {
    const name = pickName(CITIES[city.id]?.name ?? city.name);
    const generalId = city.generals[0];
    const general = generalId ? GENERALS[generalId] : undefined;
    const sub = general ? pickName(general.name) : city.garrison.toLocaleString();
    return { cityId: city.id, name, sub, factionId: city.factionId };
  });
}

// React <-> MapScene bridge for the 3D campaign map. Owns the <canvas> + a
// relative container (the scene appends its CSS2D label overlay to the canvas's
// parent), constructs the Three.js scene once, then syncs city markers on game
// / locale change and the selection ring on selected-city change. Any WebGL
// failure falls back to the SVG MapView — belt-and-suspenders beyond
// WorldMapView's hasWebGL() gate. Only ever mounted in a real WebGL context.
export const WorldMap3D: React.FC<MapViewProps> = (props) => {
  const { game, selectedCityId, onSelectCity } = props;
  // Re-render (and re-sync labels) when the locale changes.
  const locale = useSession(selectLocale);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const sceneRef = React.useRef<MapScene | null>(null);
  const [failed, setFailed] = React.useState(false);

  // Keep the pick handler current without rebuilding the scene: the click
  // callback registered on construction always calls the latest handler.
  const onSelectRef = React.useRef(onSelectCity);
  onSelectRef.current = onSelectCity;

  // Build the scene once, on mount. Construction + disposal are paired in this
  // one effect so a React StrictMode double-mount is leak-safe. Initial city
  // sync + selection are handled by the effects below, which also run on mount.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return undefined;
    try {
      const scene = new MapScene(canvas);
      scene.onPickCity((id) => onSelectRef.current(id));
      sceneRef.current = scene;
      const ro = new ResizeObserver(() => scene.resize());
      ro.observe(container);
      return () => {
        ro.disconnect();
        scene.dispose();
        sceneRef.current = null;
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[map] WebGL scene failed; using SVG fallback', err);
      setFailed(true);
      return undefined;
    }
    // Refs and MapScene are stable; the scene lives for the component's
    // lifetime, so this builds exactly once (paired construct/dispose).
  }, []);

  // Sync the city markers + labels whenever the game state or locale changes
  // (locale participates so labels re-resolve on a language toggle).
  React.useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.syncCities(game, buildLabelData(game));
  }, [game, locale]);

  // Sync the selection ring whenever the selected city changes.
  React.useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setSelected(selectedCityId);
  }, [selectedCityId]);

  if (failed) return <MapView {...props} />;
  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
};
