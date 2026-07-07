// Detect whether the current environment can create a WebGL context. Returns
// false under jsdom (no WebGL) and in WebGL-disabled browsers, which routes the
// battle view to the SVG fallback so tests and non-WebGL clients still work.
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
