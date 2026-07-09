// Detect whether the current environment can create a WebGL context. Returns
// false under jsdom (no WebGL) and in WebGL-disabled browsers, which routes the
// battle view and the campaign map to their SVG fallbacks so tests and
// non-WebGL clients still work. Shared by BattleView (via webglSupport.ts) and
// WorldMapView so both scenes gate on the same detector.
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    return gl !== null && gl !== undefined;
  } catch {
    return false;
  }
}
