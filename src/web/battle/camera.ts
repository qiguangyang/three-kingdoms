// Pure camera-framing math (no Three.js import). Given the battle centroid and
// the field's world size, returns a camera position + look-at target that pulls
// the camera up and back, angled down, so terrain relief and both armies show.
export function framing(
  centroid: { x: number; z: number },
  size: { w: number; h: number },
): { position: [number, number, number]; target: [number, number, number] } {
  const span = Math.max(size.w, size.h);
  const dist = span * 0.85;
  // Low, pulled-back angle for an epic, more horizontal view of the ranks.
  return {
    position: [centroid.x, dist * 0.55, centroid.z + dist * 1.05],
    target: [centroid.x, 1.5, centroid.z],
  };
}
