import React from 'react';
import type { MapViewProps } from '../components/MapView.js';
import { MapView } from '../components/MapView.js';
import { WorldMap3D } from './WorldMap3D.js';
import { hasWebGL } from '../gfx/hasWebGL.js';

// Picks the Three.js 3D campaign map when WebGL is available, else keeps the
// existing SVG MapView as the 2D fallback (jsdom tests, WebGL-disabled
// browsers). Decided once per mount so the choice can't flip mid-session.
// Props are identical to MapView so MainScreen stays agnostic to which renders.
//
// The choice is gated at render (conditional JSX): when WebGL is unavailable,
// WorldMap3D — and therefore MapScene / three — is never constructed, so the
// jsdom test path never touches WebGL.
export const WorldMapView: React.FC<MapViewProps> = (props) => {
  const [webgl] = React.useState(() => hasWebGL());
  return webgl ? <WorldMap3D {...props} /> : <MapView {...props} />;
};
