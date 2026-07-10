# 3D Cinematic Campaign Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the parchment SVG overworld with a true 3D Three.js campaign map that matches the battle scene's cinematic look, renders historically-grounded Han-era China, and shows the kingdoms as two layers — static historical provinces (州) and live faction territories that shift as the campaign plays.

**Architecture:** Mirror the battle scene: `WorldMapView` picks `WorldMap3D` (Three.js) when `hasWebGL()`, else keeps the existing SVG `MapView` as the 2D fallback (jsdom tests stay green). `MapScene.ts` is the thin Three.js glue; pure math lives in a TDD'd `mapGeometry.ts`. Reuse the battle renderer's building blocks (fbm terrain, water shader, instanced forests, EffectComposer bloom+grade, CSS2D labels, dusk sky/fog). A gameplay-invariant `GRID_SCALE` rescale (default 5 → 500×200) is applied at the data boundary and proven identical by a guard test.

**Tech Stack:** Vite 5 · React 19 · Zustand 5 · Tailwind 3 · TypeScript (NodeNext ESM) · three@0.185 (three/addons: OrbitControls, mergeGeometries, CSS2DRenderer/CSS2DObject, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass) · Vitest 2 (jsdom).

## Global Constraints

- **English-only** identifiers and comments. Non-English text appears ONLY in i18n catalog values, faction glyphs (`FACTION_GLYPH`), and geography/province `LocalizedString` names.
- **Bilingual zh/en** for every new user-facing label from day one (province names, layer toggles, legends). Register keys in `src/i18n/types.ts` + both catalogs; add to the relevant i18n key test.
- **Engine determinism:** no `Math.random`/`Date`/`new Date()` in `src/engine/`. The render layer (`src/web/`) may use *seeded local* randomness (fbm value-noise, scatter) — never global `Math.random` in a way that breaks frame stability.
- **Explicit `.js` import specifiers** on all relative imports (NodeNext ESM).
- **`three` imported only under `src/web/`** (battle + map).
- **Gameplay must not change.** The `GRID_SCALE` rescale is a gameplay-invariant transform proven by a guard test (adjacency graph + AI classifications + march cost/duration orderings byte-identical). `GRID_SCALE=1` must reproduce today's grid exactly.
- **SVG fallback preserved.** `MapView.tsx` remains the no-WebGL / jsdom fallback; the 179-test suite must stay green throughout.
- Commit messages END with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Verify feature code with `npx tsc --noEmit` (feature files clean), `npm test` (all green), `npx vite build`. Any temporary DEV hook (e.g. a map seed, a `window.__mapScene` handle) is reverted before each commit and re-added after.

---

## File Structure

**Phase 0 — grid rescale (data/engine, no visual change):**
- Modify `src/engine/constants.ts` — add `GRID_SCALE`, derive `MAP_WIDTH`/`MAP_HEIGHT`.
- Modify `src/engine/map.ts` — `ADJACENCY_THRESHOLD`, `marchCost` divisor via `GRID_SCALE`.
- Modify `src/engine/ai/strategy.ts` — `DIRECT_BORDER_DISTANCE` via `GRID_SCALE`.
- Modify `src/engine/pendingOp.ts` — `marchDuration` coefficient via `GRID_SCALE`.
- Modify `src/web/screens/MainScreen.tsx` — dedupe the inline march-day calc to call `marchDuration`.
- Modify `src/data/cities.ts` — scale `pos` by `GRID_SCALE` in `buildCity`.
- Create `src/data/map/scale.ts` — pure `scalePath(d, k)` / `scalePoints(pts, k)` helpers.
- Modify `src/data/map/geography.ts` — export data scaled by `GRID_SCALE` via `scale.ts`.
- Modify `src/data/map/terrain.ts` — decouple to base resolution; `terrainAt` samples via `GRID_SCALE`.
- Modify `src/web/components/MapView.tsx` — `CELL = 32 / GRID_SCALE` (preserve on-screen px), default view center scales.
- Create `tests/engine/grid-invariance.test.ts` — guard test (adjacency + AI + costs identical).
- Modify `tests/data/map-scale.test.ts` (new) — `scalePath`/`scalePoints`.
- Modify `tests/engine/_ai-fixtures.ts`, `tests/engine/ai-strategy.test.ts`, `tests/engine/ai-strategic.test.ts` — scale fixture coords via `GRID_SCALE`.

**Phase 1 — 3D foundation:**
- Create `src/web/map/mapGeometry.ts` — pure grid↔world projection + city-marker sizing (TDD).
- Create `src/web/map/MapScene.ts` — Three.js scene glue (land/sea, camera, sky/fog, cities, post, CSS2D).
- Create `src/web/map/WorldMap3D.tsx` — React component: store sync, raycast picking, label data.
- Create `src/web/map/hasWebGL.ts` OR reuse the battle's detector (locate and import).
- Create `src/web/map/WorldMapView.tsx` — switch (`WorldMap3D` vs SVG `MapView`).
- Modify `src/web/screens/MainScreen.tsx` — render `WorldMapView` instead of `MapView`.
- Create `tests/web/mapGeometry.test.ts`, `tests/web/WorldMapView.test.tsx`.

**Phase 2 — geography + provinces:**
- Modify/replace `src/data/map/geography.ts` — accurate coastline/rivers/mountains/lakes at 500×200.
- Create `src/data/map/provinces.ts` — 13 province boundary polygons + labels (`LocalizedString`).
- Modify `src/web/map/mapGeometry.ts` — `provinceAt(pos)` point-in-polygon (TDD).
- Modify `src/web/map/MapScene.ts` — 3D relief, river ribbons, province borders + labels.
- Create `tests/data/provinces.test.ts`, extend `tests/web/mapGeometry.test.ts`.

**Phase 3 — territories + armies:**
- Modify `src/web/map/mapGeometry.ts` — `influenceField(cities, factions, res)` (TDD).
- Modify `src/web/map/MapScene.ts` — territory overlay mesh + borders; march arcs.
- Modify `src/web/map/WorldMap3D.tsx` — feed ownership + in-flight ops; recompute-on-change.
- Extend `tests/web/mapGeometry.test.ts` — influence field.

**Phase 4 — polish:**
- Modify `src/web/map/MapScene.ts` — intro sweep, capital emphasis, hover/selection FX, grade.
- Modify i18n catalogs + `src/i18n/types.ts` — any legend/toggle strings.

---

## Interfaces (shared across tasks)

```ts
// src/engine/constants.ts  (Phase 0)
export const GRID_SCALE = 5;                 // logical grid resolution multiplier
export const BASE_MAP_WIDTH = 100;
export const BASE_MAP_HEIGHT = 40;
export const MAP_WIDTH = BASE_MAP_WIDTH * GRID_SCALE;   // 500
export const MAP_HEIGHT = BASE_MAP_HEIGHT * GRID_SCALE; // 200

// src/data/map/scale.ts  (Phase 0)
export function scalePath(d: string, k: number): string;        // scale every number in an SVG path
export function scalePoints(pts: [number, number][], k: number): [number, number][];

// src/web/map/mapGeometry.ts  (Phase 1-3)
export interface Vec3 { x: number; y: number; z: number; }
export function gridToWorld(pos: { x: number; y: number }): Vec3;   // logical → 3D world (Y=0 plane; height added by scene)
export function markerScale(city: City): number;                    // capital/size emphasis from stats
export function provinceAt(pos: { x: number; y: number }): string | null;  // Phase 2
export interface InfluenceCell { fx: number; fy: number; factionId: string | null; }
export function influenceField(
  cities: City[], ownerOf: (c: City) => string | null, res: number,
): InfluenceCell[];                                                 // Phase 3, deterministic

// src/web/map/MapScene.ts  (Phase 1+)
export interface MapLabelData { cityId: string; name: string; sub: string; factionId: string | null; }
export class MapScene {
  constructor(canvas: HTMLCanvasElement);
  syncCities(game: GameState, labels: MapLabelData[]): void;
  setSelected(cityId: string | null): void;
  setTerritories(field: InfluenceCell[]): void;   // Phase 3
  setMarches(ops: InFlightMarch[]): void;          // Phase 3
  onPickCity(cb: (cityId: string | null) => void): void;
  resize(): void;
  dispose(): void;
}
```

---

## Phase 0 — Gameplay-invariant grid rescale

**Goal:** operate the logical grid at 500×200 via `GRID_SCALE` with ZERO gameplay change, proven by a guard test. Do this first and in isolation so the visual work builds on a stable base.

### Task 0.1: Capture the invariance baseline (guard test FIRST)

**Files:**
- Create: `tests/engine/grid-invariance.test.ts`

**Interfaces:**
- Consumes: `CITIES`, `buildAdjacencyMap`, `marchCost`, `marchDuration`, `threatenedCityIds` (or the AI strategy entry that uses `DIRECT_BORDER_DISTANCE`), the s1-dongzhuo scenario.
- Produces: a permanent regression guard that any future coord/threshold change preserves gameplay topology.

- [ ] **Step 1: Write the guard test as a self-consistent invariant (not a captured snapshot).** Because adjacency is a boolean relation and both coordinates and thresholds scale together, the invariant is *structural*: assert the adjacency graph and cost orderings computed from the CURRENT exported `CITIES`/constants match a set of concrete expectations that are true today. Capture the concrete expected values by running the current code once (see Step 2), then bake them as literals.

```ts
import { describe, expect, it } from 'vitest';
import { CITIES, CITY_IDS } from '../../src/data/cities.js';
import { buildAdjacencyMap, marchCost } from '../../src/engine/map.js';

describe('grid rescale is gameplay-invariant', () => {
  it('adjacency graph is unchanged (same neighbor sets by city id)', () => {
    const adj = buildAdjacencyMap(Object.values(CITIES));
    // Baked from the pre-rescale run (GRID_SCALE=1). Regenerate via the printer in
    // this file's comment if the intended topology ever changes.
    const expected = EXPECTED_ADJACENCY; // Record<cityId, cityId[] sorted>
    for (const id of CITY_IDS) {
      expect([...adj.get(id) ?? []].map((c) => c.id).sort(), id).toEqual(expected[id]);
    }
  });

  it('marchCost ordering between a fixed set of city pairs is unchanged', () => {
    const pairs: [string, string][] = EXPECTED_COST_PAIRS.map((p) => [p.a, p.b]);
    const costs = pairs.map(([a, b]) => marchCost(CITIES[a]!, CITIES[b]!));
    // Assert costs equal the baked pre-rescale values within 1e-9.
    costs.forEach((c, i) => expect(c).toBeCloseTo(EXPECTED_COST_PAIRS[i]!.cost, 9));
  });
});
```

- [ ] **Step 2: Generate `EXPECTED_ADJACENCY` / `EXPECTED_COST_PAIRS` from the current build.** Before touching any constant, run a throwaway script (or a temporary `console.log` in the test) that prints `buildAdjacencyMap(Object.values(CITIES))` as a `{id: sortedNeighborIds}` object and `marchCost` for ~12 representative pairs. Paste the output into the test as the `EXPECTED_*` literals. Commit this test on its own so it is the frozen pre-rescale truth.

- [ ] **Step 3: Run — expect PASS on the current (unscaled) code.** `npx vitest run tests/engine/grid-invariance.test.ts` → PASS. This is the frozen baseline.

- [ ] **Step 4: Commit.** `git add tests/engine/grid-invariance.test.ts && git commit` — message: "Add grid-invariance guard test (pre-rescale baseline)".

### Task 0.2: `scalePath` / `scalePoints` helpers (TDD)

**Files:**
- Create: `src/data/map/scale.ts`
- Test: `tests/data/map-scale.test.ts`

**Interfaces:**
- Produces: `scalePath(d: string, k: number): string`, `scalePoints(pts, k)` — consumed by `geography.ts` (Task 0.5).

- [ ] **Step 1: Failing test.**

```ts
import { describe, expect, it } from 'vitest';
import { scalePath, scalePoints } from '../../src/data/map/scale.js';

describe('geography scaling', () => {
  it('scales every number in an SVG path, preserving commands', () => {
    expect(scalePath('M 10 20 C 30 40 50 60 70 80 L 5 5 Z', 5))
      .toBe('M 50 100 C 150 200 250 300 350 400 L 25 25 Z');
  });
  it('leaves non-coordinate letters intact and handles decimals/negatives', () => {
    expect(scalePath('M -1.5 2 L 3.25 -4', 2)).toBe('M -3 4 L 6.5 -8');
  });
  it('scales point arrays', () => {
    expect(scalePoints([[1, 2], [3, 4]], 5)).toEqual([[5, 10], [15, 20]]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** (`function not defined`).

- [ ] **Step 3: Implement `scale.ts`.** `scalePath` replaces every numeric token (regex `-?\d*\.?\d+`) with `n*k`, leaving command letters and whitespace untouched; format numbers without trailing-zero noise (`String(Math.round(n*k*1e6)/1e6)`). `scalePoints` maps each pair.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit.**

### Task 0.3: `GRID_SCALE` in constants + engine distance/cost sites

**Files:**
- Modify: `src/engine/constants.ts:5-6`, `src/engine/map.ts:27,47`, `src/engine/ai/strategy.ts:17`, `src/engine/pendingOp.ts:66`
- Modify: `src/web/screens/MainScreen.tsx:629-630` (dedupe to `marchDuration`)

**Interfaces:**
- Consumes: `GRID_SCALE`.
- Produces: the rescaled thresholds; gameplay unchanged per Task 0.1.

- [ ] **Step 1:** In `constants.ts`, add `GRID_SCALE`, `BASE_MAP_WIDTH=100`, `BASE_MAP_HEIGHT=40`, and derive `MAP_WIDTH = BASE_MAP_WIDTH * GRID_SCALE`, `MAP_HEIGHT = BASE_MAP_HEIGHT * GRID_SCALE`.
- [ ] **Step 2:** In `map.ts`: `const ADJACENCY_THRESHOLD = 18 * GRID_SCALE;` (import it); `marchCost` divisor `manhattanDistance(a.pos, b.pos) / (8 * GRID_SCALE)`.
- [ ] **Step 3:** In `ai/strategy.ts`: `const DIRECT_BORDER_DISTANCE = 12 * GRID_SCALE;` (import `GRID_SCALE`); update the `13-16` prose comment to reference `GRID_SCALE`.
- [ ] **Step 4:** In `pendingOp.ts` `marchDuration`: `Math.max(4, Math.ceil((dx + dy) * (0.5 / GRID_SCALE)))`; update the "0.5 day per cell" comment.
- [ ] **Step 5:** In `MainScreen.tsx:629-630`, **remove the inline duplicate** and call `marchDuration(from, target)` (import it) so there is one source of truth.
- [ ] **Step 6:** Do NOT yet scale `cities.ts` (Task 0.4). Run the guard test — it should still PASS because at this point `CITIES.pos` is unscaled AND `ADJACENCY_THRESHOLD` is ×5, which WOULD change adjacency. **Therefore Tasks 0.3 and 0.4 must land together in one commit** — implement 0.4 before running tests, then verify. (Reorder: do 0.4 Steps 1-2, then run.)

### Task 0.4: Scale city positions at the data boundary

**Files:**
- Modify: `src/data/cities.ts:88`

- [ ] **Step 1:** In `buildCity`, scale: `pos: { x: def.x * GRID_SCALE, y: def.y * GRID_SCALE }` (import `GRID_SCALE`). Leave `CITY_DEFS` literals at 100×40 (readable authoring).
- [ ] **Step 2: Run the guard test (Task 0.1) — expect PASS.** Coords ×5 and thresholds ×5 → identical adjacency + `marchCost` (divisor ×5 cancels). If it fails, a coefficient was missed — reconcile against the audit before proceeding.
- [ ] **Step 3:** Run the full engine suite: `npx vitest run tests/engine` — the AI fixture tests will FAIL here (their literal coords are unscaled). Fix in Task 0.6.

### Task 0.5: Scale geography + decouple terrain grid

**Files:**
- Modify: `src/data/map/geography.ts` (export scaled data via `scale.ts`)
- Modify: `src/data/map/terrain.ts` (base-resolution generation; `terrainAt` samples via `GRID_SCALE`)
- Modify: `src/web/components/MapView.tsx:71,116-117` (`CELL = 32 / GRID_SCALE`; view center coords ×`GRID_SCALE`)

- [ ] **Step 1:** In `geography.ts`, wrap every exported coordinate payload through `scalePath(..., GRID_SCALE)` / `scalePoints(..., GRID_SCALE)`: `SEA_PATH`, `COASTLINE_PATH`, `GREAT_WALL_PATH`, each `RIVERS[].path`, `MOUNTAINS[].ridge`/`.baseline`/`.labelAt`, `LAKES[].polygon`/`.labelAt`, `FORESTS[].polygon`, `PROVINCE_LABELS[].x/y`, `SEA_LABELS[].x/y`. Keep the authored literals at 100×40; apply the scale once at module export. (Phase 2 will replace this data with directly-authored 500×200 geography.)
- [ ] **Step 2:** In `terrain.ts`, generate `TERRAIN_GRID` at `BASE_MAP_WIDTH`×`BASE_MAP_HEIGHT` (100×40) using the existing `classify` unchanged; make `terrainAt(x, y)` sample `classify(Math.floor(x / GRID_SCALE), Math.floor(y / GRID_SCALE))` with the existing out-of-bounds guard against `MAP_WIDTH`/`MAP_HEIGHT`. This avoids the 100k-cell grid AND the sin-frequency problem. **Confirm no gameplay path reads `terrainAt`** (grep; per audit it's cosmetic/legacy) — if any does, note it for review.
- [ ] **Step 3:** In `MapView.tsx`, `CELL = 32 / GRID_SCALE` (preserves on-screen size since coords are ×`GRID_SCALE`); default view center `x: 30*GRID_SCALE*CELL - 500`, `y: 17*GRID_SCALE*CELL - 280`.
- [ ] **Step 4:** Run `npx vite build` and load the SVG map (force no-WebGL or the fallback) — it must look identical to before. Run `tests/web` — MapView tests green.

### Task 0.6: Scale AI test fixtures in lockstep

**Files:**
- Modify: `tests/engine/_ai-fixtures.ts:36`, `tests/engine/ai-strategy.test.ts`, `tests/engine/ai-strategic.test.ts`

- [ ] **Step 1:** Import `GRID_SCALE`; multiply every fixture `pos: {x, y}` literal by `GRID_SCALE` (including the parked corner `{x:99,y:39}` → `{x:99*GRID_SCALE, y:39*GRID_SCALE}`). Update the inline comments that cite raw distances (e.g. "16 <= 18", "30 apart > 18") to reference the scaled numbers or `GRID_SCALE`.
- [ ] **Step 2:** Run `npx vitest run tests/engine` — all green.
- [ ] **Step 3:** Run the FULL suite `npm test` — 179 green. `npx tsc --noEmit` clean. `npx vite build` passes.
- [ ] **Step 4: Commit Tasks 0.3-0.6 together** (they are one atomic invariant change): "Rescale logical grid to 500×200 via GRID_SCALE (gameplay-invariant)".

---

## Phase 1 — 3D map foundation

**Goal:** a real 3D landmass with orbit camera, dark-cinematic sky/post, clickable city markers + labels, wired into `MainScreen` behind a WebGL switch with the SVG map as fallback. No provinces/territories yet.

### Task 1.1: `mapGeometry.ts` projection + marker sizing (TDD)

**Files:**
- Create: `src/web/map/mapGeometry.ts`
- Test: `tests/web/mapGeometry.test.ts`

- [ ] **Step 1: Failing tests** for `gridToWorld` (center the map at world origin: `X = pos.x - MAP_WIDTH/2`, `Z = pos.y - MAP_HEIGHT/2`, `y = 0`) and `markerScale` (monotonic in a city stat, clamped to `[1, 2.2]`). Include an exact-value case, e.g. a city at `pos {MAP_WIDTH/2, MAP_HEIGHT/2}` maps to `{x:0,y:0,z:0}`.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: Implement** the pure functions (no `three` import; plain math so it runs in jsdom).
- [ ] **Step 4: Run — PASS.** **Step 5: Commit.**

### Task 1.2: `MapScene.ts` — land, sea, camera, sky, post

**Files:**
- Create: `src/web/map/MapScene.ts`

**Interfaces:** Produces the `MapScene` class (see Interfaces section). This task delivers construction + terrain + camera + render loop; cities in Task 1.3.

- [ ] **Step 1:** Scaffold `MapScene` mirroring `BattleScene.ts`: renderer (antialias, shadow map, ACES), scene, perspective camera + `OrbitControls` (free orbit, framed on the landmass, min/max polar + distance clamps so it stays legible), `hemi`+`sun`(shadow)+`ambient`, dusk sky-gradient dome + `FogExp2`, `EffectComposer` (RenderPass → UnrealBloomPass → OutputPass → optional ShaderPass grade), and a separate `CSS2DRenderer` overlay. Reuse the battle's shader/sky/grade code (import or copy with attribution).
- [ ] **Step 2:** Build the **landmass**: a subdivided plane over `[MAP_WIDTH]×[MAP_HEIGHT]` (world units from `gridToWorld`), heightmapped by (a) an fbm value-noise micro-relief (seeded, reused from the battle terrain harvest) and (b) a land/sea mask from `geography.ts` `COASTLINE_PATH` (point-in-polygon → land raised, sea at y≈0). Vertex-colour by height ramp (coast sand → plain green → upland brown). Add the animated **sea** water plane (battle water shader) filling outside the coastline, and a soft **glowing gold coastline** line.
- [ ] **Step 3:** Render loop: `requestAnimationFrame`, update controls + water time + composer; `resize()` handles DPR + composer + CSS2D; `dispose()` frees geometries/materials/textures/composer/CSS2D and cancels the RAF (follow the battle's disposal discipline).
- [ ] **Step 4: In-browser check** via a temporary DEV hook (a `?map3d=1` seed that loads a scenario and a `window.__mapScene` handle) — a dark cinematic landmass with sea, orbitable. Revert the hook before commit. **Commit.**

### Task 1.3: City markers + labels + picking

**Files:**
- Modify: `src/web/map/MapScene.ts`

- [ ] **Step 1:** `syncCities(game, labels)`: for each city, place a **3D marker** at `gridToWorld(pos)` + terrain height — a small walled-town glyph (box cluster / low tower), faction-coloured via `factionColor(city.factionId)`, sized by `markerScale`; capitals (lord's city) larger + a small banner. Reuse `FACTION_GLYPH` on a `CSS2D` label (name + `sub`, e.g. garrison) per marker. Diff against previous sync (add/update/remove) like `BattleScene.syncUnits`.
- [ ] **Step 2:** `setSelected(cityId)` highlights the selected marker (emissive ring / raised); hover highlight via raycast.
- [ ] **Step 3:** Picking: a `Raycaster` on pointer events over marker meshes → `onPickCity(cb)` fires the city id (or null on empty). Debounce hover; click selects.
- [ ] **Step 4: In-browser check** — markers at every city, faction-coloured, labels crisp, click logs the id. **Commit.**

### Task 1.4: `WorldMap3D.tsx` + `WorldMapView` switch + MainScreen wiring

**Files:**
- Create: `src/web/map/WorldMap3D.tsx`, `src/web/map/WorldMapView.tsx`, `src/web/map/hasWebGL.ts` (or reuse battle's)
- Modify: `src/web/screens/MainScreen.tsx` (render `WorldMapView`)
- Test: `tests/web/WorldMapView.test.tsx`

- [ ] **Step 1:** Locate the battle's WebGL detector (`hasWebGL()` used by `BattleView`); reuse it. If it is battle-local, extract to a shared `src/web/gfx/hasWebGL.ts` and re-import from both.
- [ ] **Step 2:** `WorldMap3D.tsx`: owns a `<canvas>`, constructs `MapScene` in an effect, subscribes to the store (`useSession`) for `game`, builds `MapLabelData[]` (via `GENERALS`/`CITIES`/`pickName`, mirroring `BattleCanvas.buildLabelData`), calls `scene.syncCities` on change, wires `onPickCity` → the existing "select city" store action, `setSelected` from selected-city state, `resize` on container resize, `dispose` on unmount.
- [ ] **Step 3:** `WorldMapView.tsx`: `hasWebGL() ? <WorldMap3D/> : <MapView/>` (the existing SVG map). Props identical so `MainScreen` is agnostic.
- [ ] **Step 4:** `MainScreen.tsx`: replace `<MapView .../>` with `<WorldMapView .../>` (same props/handlers).
- [ ] **Step 5:** Test `WorldMapView.test.tsx` (jsdom): with WebGL unavailable it renders the SVG `MapView` (assert an SVG map testid). This proves the fallback keeps the suite green.
- [ ] **Step 6:** `npm test` green, `npx tsc --noEmit` clean, `npx vite build` passes. In-browser: the campaign opens to the 3D map; clicking a city selects it and the sidebar updates. **Commit.**

---

## Phase 2 — Historical geography + provinces

**Goal:** re-author the land to read as real Han-era China, and draw the 13 provinces as a dim gold administrative underlay with serif labels.

### Task 2.1: Re-author accurate geography at 500×200

**Files:**
- Modify/replace: `src/data/map/geography.ts`

- [ ] **Step 1:** Re-author (authored directly at 500×200, dropping the Phase-0 `scale.ts` wrapping for this data): `COASTLINE_PATH` (Bohai gulf, Liaodong, Shandong peninsula, Yangtze delta / Hangzhou bay, southern coast to 交州), `RIVERS` (Yellow with the Ordos loop + Han-era course north of Shandong; Yangtze; Huai; Han; Wei; Xiang; Gan; Min), `MOUNTAINS` (Qinling, Taihang, Yin Shan, Wuling, etc.), `LAKES` (Dongting/Poyang/Tai). Keep river/mountain names' `LocalizedString`. Verify all 42 city `pos` still sit on plausible land (they are fixed; adjust geography around them, never the cities).
- [ ] **Step 2:** The SVG fallback (`MapView`) re-renders from the new data — confirm it still looks coherent (no NaN paths). The 3D `MapScene` land/sea mask now uses the accurate coastline.
- [ ] **Step 3:** `npm test` green (geography has no gameplay tests; city adjacency unaffected). In-browser: the 3D landmass reads as China. **Commit.**

### Task 2.2: Province data + `provinceAt` (TDD)

**Files:**
- Create: `src/data/map/provinces.ts`
- Modify: `src/web/map/mapGeometry.ts` (`provinceAt`)
- Test: `tests/data/provinces.test.ts`, extend `tests/web/mapGeometry.test.ts`

- [ ] **Step 1:** `provinces.ts`: `PROVINCES: { id, name: LocalizedString, boundary: [number,number][] (closed polygon, 500×200 space), labelAt: {x,y} }[]` for the 13 Han provinces (司隶, 豫州, 冀州, 兖州, 徐州, 青州, 荆州, 扬州, 益州, 凉州, 并州, 幽州, 交州; 辽东 optional as a 14th). Author boundaries to tile the landmass without large gaps.
- [ ] **Step 2: Failing test** `tests/data/provinces.test.ts`: every province `name` is bilingual + non-empty; boundaries are closed polygons with ≥3 points; a sample of real cities falls inside the historically-correct province (e.g. Luoyang ∈ 司隶, Chengdu ∈ 益州, Xiangyang ∈ 荆州) via `provinceAt`.
- [ ] **Step 3:** Implement `provinceAt(pos)` in `mapGeometry.ts` (ray-cast point-in-polygon over `PROVINCES`). Extend `mapGeometry.test.ts` with a point-in-polygon unit case.
- [ ] **Step 4: Run — PASS.** **Commit.**

### Task 2.3: Draw provinces in the 3D scene

**Files:**
- Modify: `src/web/map/MapScene.ts`

- [ ] **Step 1:** Add a `provinces` layer: each boundary as a dim **gold border line** draped on the terrain (sample terrain height along the polyline so it hugs the relief), plus a `CSS2D` serif province label at `labelAt`, dimmed and behind the city labels. A subtle darken/parchment tint per province optional.
- [ ] **Step 2:** i18n: add a legend/toggle key set if a "Provinces" toggle is exposed (register in `types.ts` + both catalogs + key test). Otherwise province names come from `provinces.ts` `LocalizedString` via `pickName`.
- [ ] **Step 3: In-browser check** — the 13 provinces read as a faint administrative underlay; labels legible, not competing with cities. **Commit.**

---

## Phase 3 — Faction territories + armies

**Goal:** the live "kingdoms" layer — faction-coloured realms computed from owned cities, updating as the campaign shifts, plus 3D march arcs for armies in transit.

### Task 3.1: `influenceField` (TDD)

**Files:**
- Modify: `src/web/map/mapGeometry.ts`
- Test: extend `tests/web/mapGeometry.test.ts`

- [ ] **Step 1: Failing tests:** `influenceField(cities, ownerOf, res)` returns one `InfluenceCell` per sample of a `res`-resolution grid over the land; each land cell's `factionId` is the owner of the nearest owned city (weighted by a city-importance term, deterministic — no `Math.random`); sea/unclaimed cells are `null`. Concrete case: two cities of different factions on a line → the midpoint boundary splits ownership deterministically.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3:** Implement: for each sample point, argmin over owned cities of `dist(point, city) / weight(city)`; assign that city's `factionId`; mask out sea via the coastline test. Keep it O(cells × cities) — fine at moderate `res`.
- [ ] **Step 4: Run — PASS.** **Commit.**

### Task 3.2: Territory overlay + borders in the scene

**Files:**
- Modify: `src/web/map/MapScene.ts`, `src/web/map/WorldMap3D.tsx`

- [ ] **Step 1:** `setTerritories(field)`: build a translucent overlay mesh draped just above the terrain, vertex-coloured by each cell's `factionColor(factionId)` (neutral = muted); draw **glowing border ribbons** where adjacent cells differ in owner (rival frontier emphasis). Rebuild only when the ownership hash changes (memoize on a signature of `cityId→factionId`).
- [ ] **Step 2:** In `WorldMap3D.tsx`, compute `influenceField` from `game.cities` + ownership whenever ownership changes and call `scene.setTerritories`. Choose `res` for smoothness vs perf (e.g. 200×80 samples over the 500×200 space); document the choice with a `log`-style comment.
- [ ] **Step 3: In-browser check** across a mid-game save — realms are clearly coloured and shift when a city changes hands. **Commit.**

### Task 3.3: March arcs for armies in transit

**Files:**
- Modify: `src/web/map/MapScene.ts`, `src/web/map/WorldMap3D.tsx`

- [ ] **Step 1:** Identify in-flight marches from the store (the same pending-ops source the SVG `MarchLine` uses — locate it: `pendingOp` marches with `from`/`to`/`intent`). `setMarches(ops)`: draw an animated arc (attacker vs reinforce colour) from `gridToWorld(from)` to `gridToWorld(to)` with a moving pip; dispose/rebuild on change.
- [ ] **Step 2: In-browser check** — a scheduled attack shows a travelling arc. **Commit.**

---

## Phase 4 — Cinematic polish

**Goal:** close the gap to the battle scene's production feel.

### Task 4.1: Camera intro + selection/hover FX + grade

**Files:**
- Modify: `src/web/map/MapScene.ts`

- [ ] **Step 1:** A one-time **intro sweep** easing from a high establishing shot into a framed orbit (reuse the battle director's easing), then hand control to `OrbitControls`; gentle idle drift when untouched.
- [ ] **Step 2:** Selection/hover FX: selected city gets a gold pulse ring + slight bloom; hovered city lifts its label. Capital cities get a taller banner (`buildBanner` style, reused/adapted).
- [ ] **Step 3:** Tune the colour grade (teal-orange split-tone + vignette, as in the battle) and bloom thresholds for the map's palette. Confirm labels stay crisp (CSS2D renders separately).
- [ ] **Step 4: In-browser check** + a final pass on performance (instancing for trees/markers, memoized territory). **Commit.**

### Task 4.2: Whole-branch review + finish

- [ ] **Step 1:** Run the full gate: `npx tsc --noEmit` clean, `npm test` all green, `npx vite build` passes. Confirm all temporary DEV hooks are reverted.
- [ ] **Step 2:** Dispatch the final whole-branch code review (superpowers:requesting-code-review) over `main..campaign-map-3d`; fold in Critical/Important fixes.
- [ ] **Step 3:** Use superpowers:finishing-a-development-branch to merge/PR.

---

## Self-Review notes

- **Spec coverage:** 3D look (Phase 1), historical geography (2.1), provinces (2.2-2.3), live territories (3.1-3.2), free-orbit camera (1.2), fixed city positions + invariant grid rescale (Phase 0), SVG fallback + tests (1.4). All approved decisions map to a task.
- **Invariance risk is front-loaded and guard-tested** (Task 0.1 before any change; 0.3+0.4 land atomically; the audit's inverse-scale coefficients — `marchCost /8`, two `*0.5` march coeffs, terrain sin-freqs — are each named in a step).
- **Type consistency:** `MapScene`/`mapGeometry`/`WorldMap3D` signatures are fixed in the Interfaces section and reused verbatim by later tasks.
- **No gameplay change**: cities never move; only geography is re-authored around them.
- **Known risk to surface during execution:** if any gameplay path reads `terrainAt` (Task 0.5 Step 2), the cosmetic-decoupling assumption breaks — escalate before proceeding.
