# 3D Cinematic Campaign Map (「沙盘 · 天下」) — Design

**Status:** approved (design conversation 2026-07-10)

## Goal

Replace the parchment SVG overworld with a **true 3D campaign map** that matches
the battle scene's cinematic look (dark ink, gold accents, glass panels, serif),
renders **historically-grounded Han-era China**, and shows the **kingdoms** as two
layers: the static historical provinces (州) and the **live faction territories**
that shift as the campaign plays out.

## Approved decisions

From the brainstorming conversation:

1. **Visual style:** true 3D overworld (Three.js), reskinned to the battle scene's
   dark-cinematic palette.
2. **"Real kingdoms":** *both* — historical provinces (州) as a static underlay
   **and** live faction-territory shading on top.
3. **Camera:** free orbit (OrbitControls), like the battle scene.
4. **Geography:** re-authored for higher historical accuracy (coastline, river
   courses, mountains, provinces) — Han China, ~95E–125E / 42N–20N.
5. **City positions:** **kept fixed** — gameplay (adjacency, march costs, AI) must
   not change. Cities keep their relative positions.
6. **Grid:** **expand the logical grid to higher resolution** — but as a
   *gameplay-invariant* rescale (see below), so (5) still holds.

## Architecture

Mirror the battle scene's proven split so jsdom tests stay green and no-WebGL
users still get a map:

- `WorldMapView` picks **`WorldMap3D`** (new Three.js) when `hasWebGL()`, else the
  **existing SVG `MapView`** kept as the 2D fallback.
- `MapScene.ts` is the Three.js glue (structured like `BattleScene.ts`); pure
  math (grid↔world projection, faction influence field, province point-in-polygon)
  lives in a TDD'd `mapGeometry.ts` (like the battle's `geometry.ts`).
- Reuse the battle building blocks: fbm terrain, animated water shader, instanced
  forests, `EffectComposer` bloom + colour grade, `CSS2DRenderer` labels, dusk
  sky + `FogExp2`. Extract shared helpers where a clean seam exists; otherwise
  adapt.

### Gameplay-invariant grid rescale

Introduce `GRID_SCALE` (default **5**) applied at the data boundary so authored
values stay readable at 100×40 while the whole system operates at 500×200:

- `MAP_WIDTH = 100 * GRID_SCALE`, `MAP_HEIGHT = 40 * GRID_SCALE`.
- City `pos` scaled ×`GRID_SCALE` at build time (defs unchanged).
- Distance thresholds ×`GRID_SCALE` (`ADJACENCY_THRESHOLD`, `DIRECT_BORDER_DISTANCE`).
- Cost/duration coefficients scaled **inversely** (`marchCost` divisor, march-day
  coefficient) so costs are unchanged.
- `terrain.ts` decoupled to its own base resolution; `terrainAt` samples via
  `GRID_SCALE` (cosmetic layer, no gameplay path reads it).
- Geography scaled ×`GRID_SCALE` through an accessor (Phase 0); re-authored
  directly at 500×200 in Phase 2.

**Invariance is proven by a guard test:** the adjacency graph over the real
`CITIES`, the AI threat classifications, and march cost/duration orderings are
asserted byte-identical to a baseline captured before the rescale. `GRID_SCALE=1`
reproduces today's grid exactly; the finer grid only makes geography, province
boundaries, and the territory influence field smoother.

## The two "kingdom" layers

- **Historical provinces (州):** the 13 Han provinces authored as boundary
  polylines + serif labels, draped on the terrain as a dim gold administrative
  underlay. Bilingual names from day one.
- **Live faction territories:** a runtime **influence field** — each land sample
  is claimed by the nearest owned city (weighted), partitioning the land into
  faction realms rendered as translucent faction-coloured regions with glowing
  borders between rivals. Recomputed when ownership changes. No new authored
  data — derived from `CITIES` + `factionId`.

## Interaction

- Free orbit camera framed on the landmass; dusk sky + fog; cinematic intro sweep.
- Cities are clickable 3D markers (capitals larger) with `CSS2D` name labels;
  click selects the city (drives the existing sidebar); hover highlight.
- Armies in transit shown as 3D march arcs (Phase 3).

## Delivery phases

0. **Gameplay-invariant grid rescale** (`GRID_SCALE`) — isolated, guard-tested.
1. **3D map foundation** — land/sea, orbit camera, sky/fog/post, clickable city
   markers + labels, wired into `MainScreen` with SVG fallback.
2. **Historical geography + provinces** — re-authored accurate coastline / rivers /
   mountains + the 13-province underlay.
3. **Faction territories** — influence-field kingdoms layer + glowing borders +
   3D march lines.
4. **Cinematic polish** — intro sweep, capital emphasis, selection/hover FX,
   colour grade tuning.

## Global constraints

- English-only identifiers and comments; non-English only inside i18n catalog
  values, faction glyphs, and geography/province `LocalizedString` names.
- Bilingual zh/en for every new label from day one.
- Engine stays deterministic (no `Math.random`/`Date` in `src/engine/`); the
  render layer may use seeded local randomness (fbm, scatter).
- Explicit `.js` import specifiers (NodeNext ESM).
- `three` imported only under `src/web/` (battle + map).
- Gameplay must not change (guard-tested); the SVG fallback keeps the jsdom suite
  green.

See [[project-battle-screen]] for the renderer building blocks this reuses and
[[feedback-code-style]] for the identifier/i18n rules.
