# Battle Screen — Plan 2: Three.js 3D Renderer (Phase 2)

> Follow-up to Plan 1 (`2026-07-07-battle-screen.md`). Plan 1 shipped the headless emergent engine + a playable SVG screen (`BattleField2D`). This plan replaces the flat SVG with a **real Three.js 3D battlefield**, behind the exact same `{ session }` prop, with a WebGL-capability fallback to the SVG view.

**Goal:** Render the battle in 3D — a terrain heightmap mesh (hills/river/forest/wall/gate from `BattleField`), faction-colored unit blocks standing on the terrain scaled by troop count, a perspective camera with orbit controls and lighting — that swaps in for `BattleField2D` when WebGL is available, and falls back to `BattleField2D` when it isn't (jsdom tests, WebGL-disabled browsers).

**Architecture:** `BattleView` (new switcher) renders `BattleCanvas` (Three.js) when `hasWebGL()` else `BattleField2D`. `BattleScreen` renders `<BattleView session={session}/>` instead of `<BattleField2D>`. All battlefield→world math is **pure and unit-tested** in `geometry.ts` / `camera.ts`; the Three.js scene wiring (`BattleScene`) is thin glue verified visually. No engine/session/store changes — this is a pure rendering swap.

**Scope:** Phase 2 = a functional, recognizably-3D battlefield replacing the SVG. Phase 3 (deferred, iterative — needs visual tuning) = particle FX (arrow volleys, fire, dust, flood), cinematic camera shots, procedural realistic materials/lighting, wind + 赤壁 naval flavor, instancing/perf.

## Global Constraints
- **Add deps:** `three` + `@types/three`. Imported ONLY under `src/web/battle/` (engine/state never import Three.js).
- **WebGL fallback is mandatory:** the Three.js path must never run under jsdom. `BattleView` gates on `hasWebGL()` (false under jsdom) → renders `BattleField2D`. The existing `tests/web/BattleScreen.test.tsx` must stay green (it renders `BattleScreen` under jsdom and must get the SVG fallback).
- **Pure math is TDD'd; Three.js glue is visually verified.** Factor all battlefield→world geometry/positioning/color/camera math into pure functions with unit tests. Keep `BattleScene`/`BattleCanvas` thin.
- English-only identifiers/comments. Explicit `.js` import extensions. Determinism: geometry is a pure function of `BattleField` (seeded upstream); no `Math.random` in layout.
- Full suite + `tsc` + `build` stay green after every task.

## File Structure
- **New:** `src/web/battle/webglSupport.ts` (`hasWebGL()`), `src/web/battle/BattleView.tsx` (switcher), `src/web/battle/geometry.ts` (pure terrain/unit math), `src/web/battle/camera.ts` (pure camera framing math), `src/web/battle/BattleScene.ts` (Three.js scene manager), `src/web/battle/BattleCanvas.tsx` (React ↔ BattleScene).
- **Modified:** `package.json` (deps), `src/web/battle/BattleScreen.tsx` (BattleField2D → BattleView).
- **Kept:** `src/web/battle/BattleField2D.tsx` (now the fallback, unchanged).
- **New tests:** `tests/web/battle-geometry.test.ts`, `tests/web/battle-camera.test.ts`, `tests/web/BattleView.test.tsx`.

---

### Task 2.1: Dependency + WebGL-guarded view switcher

**Files:** add `three`+`@types/three`; create `webglSupport.ts`, `BattleView.tsx`; modify `BattleScreen.tsx`; test `tests/web/BattleView.test.tsx`.

- `hasWebGL(): boolean` — creates a throwaway `<canvas>`, tries `getContext('webgl2')||getContext('webgl')`, returns `false` on null/throw (jsdom → false).
- `BattleView: React.FC<{ session: BattleSession }>` — `hasWebGL() ? <BattleCanvas session={session}/> : <BattleField2D session={session}/>`.
- `BattleScreen.tsx`: replace the `<BattleField2D session={session}/>` at line 57 with `<BattleView session={session}/>` (+ import).
- Test: under jsdom, `hasWebGL()` is `false`; `render(<BattleView session={fixture}/>)` shows the SVG (`getByRole('img')` / the `<svg>`); and `tests/web/BattleScreen.test.tsx` still passes.
- `BattleCanvas` is created in 2.3; for 2.1 stub it as a component that renders `<BattleField2D session={session}/>` (so the switcher compiles and the fallback path is identical). 2.3 fills in the real Three.js body.

Gate: `npm test` green (fallback path), `tsc` clean.

---

### Task 2.2: Pure geometry, layout, and color math (TDD)

**Files:** `geometry.ts`, `camera.ts`; tests `battle-geometry.test.ts`, `battle-camera.test.ts`.

Pure functions (no Three.js import — return plain numbers/arrays):
- `cellColor(cell: BattleCell): [number, number, number]` — RGB 0..1 per terrain class (green plains, brown hills, dark forest, blue river/ford, grey wall/gate).
- `WORLD` scale consts: `CELL_SIZE`, `HEIGHT_SCALE` (terrain elevation → world Y).
- `cellWorldXZ(x, y, field): { x: number; z: number }` — center a `width×height` grid on the origin.
- `terrainHeight(x, y, field): number` — `field.heights[y*width+x] * HEIGHT_SCALE`.
- `unitWorldPosition(pos, field): { x: number; y: number; z: number }` — cellWorldXZ + terrainHeight (+ small block lift).
- `blockScale(troops: number): number` — monotonic block size (e.g. `clamp(sqrt(troops)/K, min, max)`).
- `buildTerrainGeometry(field): { positions: number[]; colors: number[]; indices: number[] }` — a `width×height` vertex grid, per-vertex Y from `heights`, per-vertex color from `cellColor`, two triangles per cell in `indices`.
- `battleCentroidXZ(units, field): { x: number; z: number }` — average world XZ of fielded units (for camera framing).

Tests: vertex count `= width*height`; `indices.length = (width-1)*(height-1)*6`; a raised cell's vertex Y `> HEIGHT_SCALE*0`; `unitWorldPosition` Y tracks `terrainHeight`; `blockScale` monotonic + clamped; `cellColor` distinct per class; centroid within field bounds.

`camera.ts`: `framing(centroid, fieldWorldSize): { position: [x,y,z]; target: [x,y,z] }` — pull the camera back/up to frame the whole field, angled ~45°. Test: camera above (`y>0`) and outside the field, target at the centroid.

Gate: `npm test` green (new pure tests), `tsc` clean.

---

### Task 2.3: BattleScene + BattleCanvas (Three.js glue)

**Files:** `BattleScene.ts`, `BattleCanvas.tsx` (replace the 2.1 stub).

- `BattleScene` class: `constructor(canvas)` builds a `WebGLRenderer({canvas, antialias})`, `Scene`, `PerspectiveCamera`, hemisphere + directional light, and an `OrbitControls`. `setField(field)` builds the terrain `Mesh` from `buildTerrainGeometry` (BufferGeometry with position/color attrs + `vertexColors`, `MeshStandardMaterial`), adds a water plane if `field.river`, and simple extruded boxes for `wall`/`gate`. `syncUnits(session)` diffs `session.battle.units` → creates/updates/removes a `Mesh` (BoxGeometry) per fielded/routing unit, positioned via `unitWorldPosition`, scaled via `blockScale`, colored via `factionColor` (parsed to THREE.Color), faded when routing. `frameBattle(session)` sets camera via `camera.ts framing(battleCentroidXZ(...))`. `render()` loop via `requestAnimationFrame`. `dispose()` disposes geometries/materials/renderer + cancels the loop.
- `BattleCanvas.tsx`: a `<canvas ref>` filling its parent; `useEffect` (mount) → `new BattleScene(canvas)`, `setField`, start loop; `useEffect([session])` → `syncUnits(session)` + `frameBattle`; unmount → `dispose()`. Guard the whole effect in `try/catch` → on any WebGL error, set a `failed` state and render `<BattleField2D session={session}/>` (belt-and-suspenders beyond `hasWebGL()`).
- No unit test for the WebGL render (jsdom can't). Structural: importing `BattleCanvas`/`BattleScene` must not throw at import time under jsdom (three imports are import-safe; WebGL only touched inside the guarded effect, which never runs because `BattleView` picks the fallback under jsdom). Keep `tests/web/BattleView.test.tsx` + `BattleScreen.test.tsx` green.

Gate: `npm test` green, `tsc` clean, `npm run build` succeeds (three in the bundle).

---

### Task 2.4: Event animation, camera polish, integration + visual verification

**Files:** `BattleScene.ts` (extend), `BattleCanvas.tsx` (interpolation).

- Interpolate unit mesh positions toward their target world position each frame (lerp) so a day's `move` reads as motion rather than a snap. On a `clash` event (in `session.lastEvents`), a brief scale/shake on the involved meshes; on `rout`, fade + drift toward the home edge; a simple emissive glow quad at each `fire` event's cell.
- Camera eases toward the framed position each frame.
- **Visual verification (controller, not a subagent):** run the app, start a battle, and screenshot the 3D battlefield in a real browser (WebGL). Confirm: terrain relief is visible, units stand on the surface colored by faction, camera frames the field, advancing a day animates movement, and quick-resolve + finish still work. Iterate on scale/lighting/colors until it reads clearly. This is where Phase-2 "looks right" is judged.

Gate: `npm test` + `tsc` + `build` green; a browser screenshot of the working 3D battle captured.

---

## Deferred to Phase 3 (iterative, visual)
Particle arrow-volleys/fire/dust/flood, cinematic camera shots (follow-charge, pull-back-on-rout), procedural realistic materials + shadows, wind + 赤壁 naval/fire set-piece flavor, instanced soldiers for density, quality/perf settings, and wiring the Plan-1 audio cues (`playCharge`/`playVolley`/…) to battle events.
