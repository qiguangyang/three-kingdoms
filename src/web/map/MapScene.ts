// Three.js scene manager for the 3D campaign map ("沙盘 · 天下" overworld).
//
// Pure projection/sizing math lives in mapGeometry.ts (unit-tested); this file
// is the rendering glue (verified visually), mirroring the battle renderer's
// architecture. Much of the low-level look — the dusk sky-gradient dome, the
// FogExp2 haze, the EffectComposer bloom + film-grade post chain, the animated
// water shader, the seeded fbm value-noise relief, and the dispose()/resize()
// discipline — is adapted from src/web/battle/BattleScene.ts so the two scenes
// share one visual language. Only ever instantiated in a real WebGL context;
// WorldMapView routes to the SVG MapView fallback when WebGL is unavailable.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CHINA_LAND, RIVERS } from '../../data/map/geography.js';
import type { City, GameState } from '../../engine/types.js';
import { FACTION_GLYPH, factionColor } from '../theme.js';
import { gridToWorld, worldToGrid, markerScale, WORLD_W, WORLD_D } from './mapGeometry.js';

// ---- render-layer tuning (world units; the map spans WORLD_W x WORLD_D,
// ~575 x 540 world units, centered on the origin via gridToWorld — the render
// proportions stretch the logical 500x200 grid to real-China proportions) ----
const MAP_SEED = 1337; // fixed noise seed — relief is stable across frames
const SHORE_WIDTH = 22; // world units the coast ramps up from sea level
const LOWLAND_H = 3; // baseline elevation of inland lowland
const UPLAND_H = 26; // extra elevation the fbm relief adds toward the interior
const SEA_FLOOR = -3; // elevation of sea-floor vertices (below the water plane)
const WATER_Y = 1.4; // sea level; land emerges above this, coast fringe sits below
const RELIEF_FREQ = 0.035; // fbm frequency over logical grid coords
const LAND_SEGMENTS_X = 280; // landmass plane subdivisions (~2 world units/cell)
const LAND_SEGMENTS_Z = 240;
const RIVER_WIDTH = 2.0; // world-unit radius of a river ribbon
const RIVER_COLOR = 0x3f6f96; // blue-grey river water
const YELLOW_RIVER_COLOR = 0xb79149; // the Yellow River runs ochre with loess silt

// Dusk look, borrowed from BattleScene's `dusk` environment preset so the two
// scenes read as the same time of day.
const SKY_TOP = 0x2a3b60;
const SKY_HORIZON = 0x93a0b4;
const FOG_COLOR = 0x93a0b4;
const FOG_DENSITY = 0.0009; // low: the far landmass stays visible, edges haze out

// ---- city-marker tuning (world units) ----
// markerScale() returns ~1..2.2 (economic importance); multiply into world units
// so a walled town reads at the map's scale (500x200) from the orbit distances.
const MARKER_UNIT = 3.0; // world units per markerScale point
const CAPITAL_MARKER_MULT = 1.35; // a faction capital's town is a bit larger
const STONE_COLOR = 0x8a7d68; // town wall stone, then tinted toward the faction
const STONE_TINT = 0.32; // how far the stone leans to the faction colour (0..1)
const ROOF_COLOR = 0x3a2c26; // dark tiled keep roof
const MARKER_GOLD = 0xffcf7a; // selection ring + hover emphasis (matches the coast)
const LABEL_GAP = 2.2; // world units the CSS2D label floats above the marker top
const HOVER_THROTTLE_MS = 30; // min gap between hover raycasts on pointer move
const CLICK_DRAG_PX = 5; // pointer travel under which a press counts as a click, not an orbit-drag

// Final film-grade pass (runs after tone mapping, on display-space colour).
// Copied from BattleScene.ts — same painterly S-curve + split-tone + vignette so
// the overworld matches the battle's colour treatment.
const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader:
    'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader:
    'uniform sampler2D tDiffuse; varying vec2 vUv;' +
    'void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb;' +
    ' c = (c - 0.5) * 1.09 + 0.5;' + // gentle S-ish contrast around mid
    ' float l = dot(c, vec3(0.299, 0.587, 0.114));' +
    ' c = mix(vec3(l), c, 1.2);' + // +saturation
    ' float lum = clamp(l, 0.0, 1.0);' +
    ' vec3 splitt = mix(vec3(-0.015, 0.008, 0.05), vec3(0.06, 0.03, -0.02), smoothstep(0.15, 0.85, lum));' +
    ' c += splitt;' + // teal shadows, warm highlights
    ' vec2 q = vUv - 0.5;' +
    ' c *= 1.0 - dot(q, q) * 0.42;' + // soft vignette
    ' gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0); }',
};

// ---- public data shapes (see the plan's Interfaces section) ----

// Text the renderer floats over the map (resolved in React, where the name data
// + locale live; the scene only positions and shows the strings). Consumed by
// syncCities in Task 1.3.
export interface MapLabelData {
  cityId: string;
  name: string;
  sub: string;
  factionId: string | null;
}

// A live city marker in the scene: the walled-town group, the material whose
// emissive we brighten on hover/select, the (hidden) gold selection ring, and
// the floating CSS2D label. `sig` captures the faction + capital state the
// group was built for, so syncCities can detect when a marker must be rebuilt.
interface CityVisual {
  group: THREE.Group;
  keepMat: THREE.MeshStandardMaterial; // central keep — brightened on hover/select
  ring: THREE.Mesh; // gold selection ring, hidden until selected
  label: CSS2DObject | null;
  labelY: number; // local height the label floats at, above the marker
  factionId: string | null;
  sig: string; // `${factionId}|${isCapital}` — rebuild trigger
  selected: boolean;
  hovered: boolean;
}

// Placeholder shapes for later tasks (Phase 3). The authoritative definitions
// land in mapGeometry.ts / the store; kept minimal here so the Task 1.2 stubs
// typecheck and Task 3.x can refine them.
export interface InfluenceCell {
  fx: number;
  fy: number;
  factionId: string | null;
}
export interface InFlightMarch {
  fromCityId: string;
  toCityId: string;
  intent: 'attack' | 'reinforce';
  progress: number; // 0..1 along the march
}

export class MapScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly composer: EffectComposer;
  private skyMat!: THREE.ShaderMaterial;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private ambient!: THREE.AmbientLight;
  private waterMat: THREE.ShaderMaterial | null = null;
  // Picking callback registered by the React layer.
  private pickCb: ((cityId: string | null) => void) | null = null;
  private raf = 0;
  private disposed = false;

  // ---- city layer (Task 1.3) ----
  private readonly cities = new Map<string, CityVisual>();
  private land: THREE.Mesh | null = null; // terrain mesh, raycast to seat markers on the surface
  private readonly terrainRay = new THREE.Raycaster(); // samples land height under a city
  private readonly pickRay = new THREE.Raycaster(); // resolves the marker under the cursor
  private readonly pointerNdc = new THREE.Vector2();
  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  private lastHoverAt = 0; // throttles hover raycasts on pointermove
  private downX = 0; // pointer-down position, to tell a click from an orbit-drag
  private downY = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // A CSS2D layer over the canvas for crisp HTML labels (city / province
    // names) projected onto 3D positions — the same overlay technique the
    // battle scene uses. No labels yet (Task 1.3), but the overlay is wired now.
    this.labelRenderer = new CSS2DRenderer();
    const lr = this.labelRenderer.domElement;
    lr.style.position = 'absolute';
    lr.style.inset = '0';
    lr.style.pointerEvents = 'none';
    lr.style.overflow = 'hidden';
    canvas.parentElement?.appendChild(lr);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY_TOP);
    // Exponential fog hazes the distant coast and horizon into the sky, giving
    // the overworld atmospheric depth (density tuned far lower than the battle's
    // because the map is an order of magnitude larger in world units).
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
    this.addSky();

    // Free-orbit camera framed on the whole landmass. near/far span the large
    // world extent plus the sky dome.
    this.camera = new THREE.PerspectiveCamera(44, 1, 1, 5000);
    this.camera.position.set(0, 470, 380);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enableZoom = true; // wheel zooms in/out toward the map
    this.controls.zoomSpeed = 1.1;
    this.controls.target.set(0, 0, 0);
    // Clamp so the map stays legible and you can't dip under the ground:
    // minPolar keeps a near-top-down cap; maxPolar stops just above the horizon.
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = 1.45;
    this.controls.minDistance = 160;
    this.controls.maxDistance = 1000;

    // Dusk lighting, mirroring the battle's `dusk` preset (warm low sun, cool
    // sky fill, faint ambient).
    this.hemi = new THREE.HemisphereLight(0xaec4e8, 0x4a3d28, 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd9a0, 2.1);
    this.sun.position.set(-180, 260, 220);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 1100;
    const s = 340; // ortho shadow frustum covering the full landmass
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.ambient = new THREE.AmbientLight(0x30364a, 0.4);
    this.scene.add(this.ambient);

    this.buildLandmass();
    this.buildSea();
    this.buildRivers();

    // Post-processing: a gentle bloom so the gold coastline, water sparkle, and
    // bright sky glow filmically. RenderPass renders linear HDR; OutputPass
    // applies ACES tone mapping + sRGB once; the grade pass adds the painterly
    // finish. Threshold is kept high so the land itself does not bloom.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.75, 0.8));
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(GRADE_SHADER));

    this.resize();
    this.loop();

    // Pointer picking: hover-highlight and click-to-select over the city markers.
    // OrbitControls listens on the same canvas; we distinguish a click from an
    // orbit-drag by the pointer travel between down and up (CLICK_DRAG_PX).
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
  }

  // High-segment dome + fragment dithering for the dusk sky. Copied from
  // BattleScene.addSky — the coarse-sphere banding fix (fine subdivision +
  // sub-LSB noise) applies identically here.
  private addSky(): void {
    const geo = new THREE.SphereGeometry(1600, 64, 32);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(SKY_TOP) },
        horizon: { value: new THREE.Color(SKY_HORIZON) },
      },
      vertexShader:
        'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'varying vec3 vP; uniform vec3 top; uniform vec3 horizon;' +
        'void main(){ float h = clamp((normalize(vP).y + 0.04) / 0.5, 0.0, 1.0);' +
        ' vec3 c = mix(horizon, top, pow(h, 0.8));' +
        ' float d = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;' +
        ' c += d * (1.6 / 255.0);' +
        ' gl_FragColor = vec4(c, 1.0); }',
    });
    this.skyMat = mat;
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  // The "real China landmass" base: a subdivided plane whose height is an fbm
  // micro-relief PLUS a land/sea mask derived from the coastline. Points inside
  // the coastline polygon are raised land (with a soft shore falloff), points
  // outside sit on the sea floor below the water plane. Vertices are coloured by
  // a height ramp (coast sand -> lowland green -> upland brown). A glowing gold
  // line traces the coast where land meets sea.
  private buildLandmass(): void {
    // Land/sea mask from the CLOSED China outline (CHINA_LAND, logical coords):
    // points inside the polygon are land, everything outside floods to sea. The
    // whole outline is treated as coast in the render (the landmass is an island
    // continent, the sea plane surrounds it), so the shore falloff + gold coast
    // line trace the entire border.
    const landPolyWorld = CHINA_LAND.map((p) => toWorldXZ(p[0], p[1]));
    const coastWorld = landPolyWorld; // closed loop; the border is the coast

    const geo = new THREE.PlaneGeometry(WORLD_W, WORLD_D, LAND_SEGMENTS_X, LAND_SEGMENTS_Z);
    geo.rotateX(-Math.PI / 2); // lay the plane on the XZ ground plane
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i);
      const wz = pos.getZ(i);
      const inside = pointInPolygon(wx, wz, landPolyWorld);
      let h: number;
      if (inside) {
        // Soft shore falloff: height ramps up from 0 at the coast to full inland.
        const dist = distanceToPolyline(wx, wz, coastWorld);
        const shore = smoothstep(0, SHORE_WIDTH, dist);
        // Seeded fbm micro-relief keyed on LOGICAL grid coords (stable, no
        // per-frame Math.random) so the relief pattern isn't stretched by the
        // render proportions.
        const g = worldToGrid(wx, wz);
        const relief = fbm(g.x * RELIEF_FREQ, g.y * RELIEF_FREQ, MAP_SEED);
        h = shore * (LOWLAND_H + relief * UPLAND_H);
      } else {
        h = SEA_FLOOR;
      }
      pos.setY(i, h);
      const c = inside ? landRamp(h) : SEABED_COLOR;
      colors.push(c[0], c[1], c[2]);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const land = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }),
    );
    land.receiveShadow = true;
    land.castShadow = true;
    this.scene.add(land);
    this.land = land; // kept so syncCities can raycast city markers onto the surface

    // Glowing gold coastline where land meets sea, floated just above the water
    // so it reads as a shoreline; kept bright so the bloom pass makes it glow.
    const linePts = coastWorld.map(([x, z]) => new THREE.Vector3(x, WATER_Y + 0.2, z));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
    const coast = new THREE.LineLoop(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0.9 }),
    );
    this.scene.add(coast);
  }

  // Animated sea filling outside the coastline. Reuses the battle water shader's
  // structure (a summed-sine vertex wave + a sparkle/shade fragment), with the
  // spatial frequencies scaled down and amplitude scaled up for the far larger,
  // calmer overworld sea. The plane extends well past the map so the water runs
  // to the fogged horizon; land pokes up through it, so no explicit sea mask is
  // needed.
  private buildSea(): void {
    const wgeo = new THREE.PlaneGeometry(WORLD_W * 2.4, WORLD_D * 2.2, 220, 180);
    wgeo.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { uT: { value: 0 }, uCol: { value: new THREE.Color(0x1a3850) } },
      vertexShader:
        'uniform float uT; varying float vR; varying vec3 vW;' +
        'void main(){ vec3 p = position;' +
        ' float r = sin(p.x*0.018 + uT*0.6)*0.6 + sin(p.z*0.026 - uT*0.5)*0.5 + sin((p.x*0.7+p.z)*0.012 + uT*0.3)*0.35;' +
        ' p.y += r; vR = r; vec4 wp = modelMatrix*vec4(p,1.0); vW = wp.xyz;' +
        ' gl_Position = projectionMatrix * viewMatrix * wp; }',
      // Gentle broad shading with soft, sparse, drifting glints — no hard grid of
      // white dots. The glint term uses irregular (non-commensurate) frequencies
      // and a high threshold so highlights are occasional, not a regular pattern.
      fragmentShader:
        'uniform float uT; uniform vec3 uCol; varying float vR; varying vec3 vW;' +
        'void main(){ float sh = 0.5 + 0.5*sin(vR*3.0 + uT*1.4);' +
        ' float g = sin(vW.x*0.021 + uT*0.7) * sin(vW.z*0.017 - uT*0.5) * sin((vW.x-vW.z)*0.013 + uT*0.4);' +
        ' float spk = smoothstep(0.93, 1.0, g);' +
        ' vec3 col = uCol + vec3(0.05,0.09,0.13)*sh + vec3(0.18,0.22,0.26)*spk;' +
        ' gl_FragColor = vec4(col, 0.92); }',
    });
    const water = new THREE.Mesh(wgeo, this.waterMat);
    water.position.y = WATER_Y;
    this.scene.add(water);
  }

  // Draw the named rivers as blue water ribbons draped on the terrain surface.
  // Each authored river path is sampled into points, seated on the relief via a
  // downward raycast, and swept into a thin tube along a smooth curve. The Yellow
  // River runs ochre (loess silt); the rest are blue-grey. Must run after
  // buildLandmass (needs this.land to seat the ribbons).
  private buildRivers(): void {
    for (const r of RIVERS) {
      const sampled = samplePath(r.path);
      if (sampled.length < 2) continue;
      const pts = sampled.map(([lx, lz]) => {
        const [wx, wz] = toWorldXZ(lx, lz);
        return new THREE.Vector3(wx, this.terrainHeightAt(wx, wz) + 0.4, wz);
      });
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, pts.length * 3, RIVER_WIDTH, 6, false);
      const isYellow = r.id === 'huanghe';
      const mat = new THREE.MeshStandardMaterial({
        color: isYellow ? YELLOW_RIVER_COLOR : RIVER_COLOR,
        roughness: 0.34,
        metalness: 0.12,
        emissive: isYellow ? 0x2a1e08 : 0x0a1a26,
      });
      const river = new THREE.Mesh(geo, mat);
      river.renderOrder = 1;
      this.scene.add(river);
    }
  }

  resize(): void {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 500;
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const t = nowMs();
    if (this.waterMat) this.waterMat.uniforms.uT!.value = t / 1000;
    this.controls.update();
    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    // Remove every city marker's CSS2D label element. Their GPU geometry /
    // material / texture are freed by the scene.traverse() sweep below (each
    // marker mesh is a scene descendant), but the label DOM nodes are not — and
    // the whole label overlay is torn down at the end regardless.
    for (const v of this.cities.values()) {
      if (v.label) {
        v.label.removeFromParent();
        v.label.element.remove();
      }
    }
    this.cities.clear();
    this.controls.dispose();
    // Free every geometry / material / texture in the scene, matching the
    // battle scene's disposal rigor to avoid GPU leaks between mounts.
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(disposeMaterial);
      else if (mat) disposeMaterial(mat as THREE.Material);
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    this.renderer.dispose();
    // EffectComposer.dispose() only frees its own ping-pong targets + copyPass;
    // dispose each pass so UnrealBloomPass's render targets and the pass shader
    // materials (OutputPass, grade ShaderPass) are released too.
    for (const pass of this.composer.passes) {
      (pass as { dispose?: () => void }).dispose?.();
    }
    this.composer.dispose();
    this.labelRenderer.domElement.remove();
  }

  // ---- city layer (Task 1.3) ----

  // Diff the city markers against the previous sync (add / update / remove keyed
  // by city id, mirroring BattleScene.syncUnits). A marker whose faction or
  // capital status changed is rebuilt; every marker's floating label is refreshed
  // from the matching MapLabelData.
  syncCities(game: GameState, labels: MapLabelData[]): void {
    const labelById = new Map(labels.map((l) => [l.cityId, l]));
    const capitals = capitalCityIds(game);
    const alive = new Set<string>();

    for (const city of Object.values(game.cities)) {
      alive.add(city.id);
      const isCapital = capitals.has(city.id);
      const sig = `${city.factionId ?? '_'}|${isCapital ? 'C' : '_'}`;
      let v = this.cities.get(city.id);
      // Faction handover / capital move: rebuild so colours + banner are correct.
      if (v && v.sig !== sig) {
        this.disposeMarker(v);
        this.cities.delete(city.id);
        v = undefined;
      }
      if (!v) {
        v = this.buildMarker(city, isCapital, sig);
        this.scene.add(v.group);
        this.cities.set(city.id, v);
        if (city.id === this.selectedId) this.applySelected(v, true);
      }
      const ld = labelById.get(city.id);
      if (ld) this.updateLabel(v, ld);
    }

    for (const [id, v] of this.cities) {
      if (alive.has(id)) continue;
      this.disposeMarker(v);
      this.cities.delete(id);
    }
  }

  // Highlight the selected city marker (gold ring + brighter emissive + a small
  // scale-up), clearing the previous selection.
  setSelected(cityId: string | null): void {
    if (this.selectedId === cityId) return;
    const prev = this.selectedId ? this.cities.get(this.selectedId) : undefined;
    if (prev) this.applySelected(prev, false);
    this.selectedId = cityId;
    const next = cityId ? this.cities.get(cityId) : undefined;
    if (next) this.applySelected(next, true);
  }

  // Register the pointer-pick callback fired on click (city id, or null on a
  // click that hits no marker).
  onPickCity(cb: (cityId: string | null) => void): void {
    this.pickCb = cb;
  }

  // Build one walled-town marker: a low stone wall (tinted toward the faction),
  // four corner towers, a faction-coloured central keep with a dark roof, a
  // hidden gold selection ring, and — for a capital — a faction banner. The whole
  // group is seated on the terrain surface via a downward raycast.
  private buildMarker(city: City, isCapital: boolean, sig: string): CityVisual {
    const w = gridToWorld(city.pos);
    const baseY = this.terrainHeightAt(w.x, w.z);
    const s = markerScale(city) * MARKER_UNIT * (isCapital ? CAPITAL_MARKER_MULT : 1);

    const group = new THREE.Group();
    group.position.set(w.x, baseY, w.z);
    group.userData.cityId = city.id; // walked up from a raycast hit to resolve the city

    const factionCol = new THREE.Color(factionColor(city.factionId));
    const stoneCol = new THREE.Color(STONE_COLOR).lerp(factionCol, STONE_TINT);

    const wallH = s * 0.5;
    const keepH = s * 1.1;
    const towerH = s * 0.8;
    const roofH = s * 0.6;
    const half = s * 0.72; // corner-tower offset from centre

    const add = (mesh: THREE.Mesh): THREE.Mesh => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    };

    // Low square curtain wall.
    add(new THREE.Mesh(
      new THREE.BoxGeometry(s * 1.7, wallH, s * 1.7),
      new THREE.MeshStandardMaterial({ color: stoneCol, roughness: 0.92 }),
    )).position.y = wallH / 2;

    // Four corner towers.
    for (const [dx, dz] of [[-half, -half], [half, -half], [-half, half], [half, half]] as const) {
      const t = add(new THREE.Mesh(
        new THREE.BoxGeometry(s * 0.34, towerH, s * 0.34),
        new THREE.MeshStandardMaterial({ color: stoneCol, roughness: 0.92 }),
      ));
      t.position.set(dx, towerH / 2, dz);
    }

    // Faction-coloured central keep — the piece that carries hover/select emissive.
    const keepMat = new THREE.MeshStandardMaterial({
      color: factionCol,
      roughness: 0.7,
      emissive: new THREE.Color(MARKER_GOLD),
      emissiveIntensity: 0,
    });
    const keep = add(new THREE.Mesh(new THREE.BoxGeometry(s * 0.75, keepH, s * 0.75), keepMat));
    keep.position.y = wallH + keepH / 2;

    // Dark pyramidal roof crowning the keep.
    const roof = add(new THREE.Mesh(
      new THREE.ConeGeometry(s * 0.62, roofH, 4),
      new THREE.MeshStandardMaterial({ color: ROOF_COLOR, roughness: 0.85 }),
    ));
    roof.position.y = wallH + keepH + roofH / 2;
    roof.rotation.y = Math.PI / 4;

    // Gold selection ring, laid flat around the base — unlit so the bloom pass
    // makes it glow; hidden until the city is selected.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(s * 1.35, s * 0.11, 8, 24),
      new THREE.MeshBasicMaterial({ color: MARKER_GOLD }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    ring.visible = false;
    group.add(ring);

    // Capital banner: a modest faction flag on a pole at one corner.
    if (isCapital) this.addCapitalBanner(group, city.factionId, s, half);

    const labelY = wallH + keepH + roofH + LABEL_GAP;
    return {
      group, keepMat, ring, label: null, labelY,
      factionId: city.factionId, sig, selected: false, hovered: false,
    };
  }

  // A pole flying a small faction flag beside the keep, marking a capital.
  private addCapitalBanner(group: THREE.Group, factionId: string | null, s: number, half: number): void {
    const poleH = s * 2.6;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(s * 0.05, s * 0.07, poleH, 6),
      new THREE.MeshStandardMaterial({ color: 0x2b2016, roughness: 0.85 }),
    );
    pole.position.set(half, poleH / 2, -half);
    pole.castShadow = true;
    const finial = new THREE.Mesh(
      new THREE.ConeGeometry(s * 0.1, s * 0.28, 6),
      new THREE.MeshStandardMaterial({ color: 0xcaa64f, roughness: 0.35, metalness: 0.4 }),
    );
    finial.position.y = poleH / 2 + s * 0.14; // pole-local, crowning the top
    pole.add(finial);
    const flagW = s * 1.1;
    const flagH = s * 0.7;
    const flagGeo = new THREE.PlaneGeometry(flagW, flagH);
    flagGeo.translate(flagW / 2, 0, 0); // anchor the pole edge at local x = 0
    const flag = new THREE.Mesh(
      flagGeo,
      new THREE.MeshStandardMaterial({
        map: capitalFlagTexture(factionColor(factionId), FACTION_GLYPH[factionId ?? '__neutral__'] ?? '·'),
        side: THREE.DoubleSide,
        roughness: 0.82,
      }),
    );
    flag.position.set(0.01, poleH * 0.62 - poleH / 2, 0);
    flag.castShadow = true;
    pole.add(flag);
    group.add(pole);
  }

  // Create (once) and refresh a marker's floating CSS2D label from label data.
  private updateLabel(v: CityVisual, ld: MapLabelData): void {
    if (!v.label) {
      v.label = new CSS2DObject(makeMapLabelEl());
      v.label.position.set(0, v.labelY, 0);
      v.group.add(v.label);
    }
    v.label.element.innerHTML = cityLabelHtml(ld.name, ld.sub, factionColor(ld.factionId));
  }

  // Sample the terrain surface height under a world XZ by raycasting straight
  // down onto the land mesh (the exact rendered relief), so a marker sits on the
  // ground rather than at y=0. Clamped to sea level so a marker never sinks.
  private terrainHeightAt(wx: number, wz: number): number {
    if (!this.land) return LOWLAND_H;
    this.terrainRay.set(new THREE.Vector3(wx, 240, wz), DOWN);
    const hits = this.terrainRay.intersectObject(this.land, false);
    const y = hits.length > 0 ? hits[0]!.point.y : LOWLAND_H;
    return Math.max(y, WATER_Y);
  }

  // Apply / clear the selected look on a marker.
  private applySelected(v: CityVisual, on: boolean): void {
    v.selected = on;
    v.ring.visible = on;
    v.keepMat.emissiveIntensity = on ? 0.6 : v.hovered ? 0.35 : 0;
    v.group.scale.setScalar(on ? 1.14 : 1);
  }

  // Apply / clear the subtle hover look (a faint emissive lift) on a marker,
  // leaving a selected marker's stronger highlight untouched.
  private setHovered(cityId: string | null): void {
    if (this.hoveredId === cityId) return;
    const prev = this.hoveredId ? this.cities.get(this.hoveredId) : undefined;
    if (prev) {
      prev.hovered = false;
      if (!prev.selected) prev.keepMat.emissiveIntensity = 0;
    }
    this.hoveredId = cityId;
    const next = cityId ? this.cities.get(cityId) : undefined;
    if (next) {
      next.hovered = true;
      if (!next.selected) next.keepMat.emissiveIntensity = 0.35;
    }
    this.canvas.style.cursor = cityId ? 'pointer' : '';
  }

  // Resolve the city id of the marker under the current pointer NDC, or null.
  private pickCityAt(clientX: number, clientY: number): string | null {
    if (this.cities.size === 0) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.pickRay.setFromCamera(this.pointerNdc, this.camera);
    const roots: THREE.Object3D[] = [];
    for (const v of this.cities.values()) roots.push(v.group);
    const hit = this.pickRay.intersectObjects(roots, true)[0];
    return hit ? cityIdFromObject(hit.object) : null;
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    const t = nowMs();
    if (t - this.lastHoverAt < HOVER_THROTTLE_MS) return; // throttle the hover raycast
    this.lastHoverAt = t;
    this.setHovered(this.pickCityAt(e.clientX, e.clientY));
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.downX = e.clientX;
    this.downY = e.clientY;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    // Only treat a near-stationary press as a click; a drag is an orbit gesture.
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > CLICK_DRAG_PX) return;
    this.pickCb?.(this.pickCityAt(e.clientX, e.clientY));
  };

  // Remove a marker from the scene and free its per-marker GPU resources + label.
  private disposeMarker(v: CityVisual): void {
    this.scene.remove(v.group);
    disposeObject3D(v.group);
    if (v.label) {
      v.label.removeFromParent();
      v.label.element.remove();
    }
  }

  // Build the translucent faction-territory overlay. Implemented in Task 3.2.
  setTerritories(_field: InfluenceCell[]): void {
    // implemented in Task 3.2
  }

  // Draw animated arcs for armies in transit. Implemented in Task 3.3.
  setMarches(_ops: InFlightMarch[]): void {
    // implemented in Task 3.3
  }
}

// ---------------------------------------------------------------- city-marker
// helpers (pure; scene state stays on the class)

// Straight-down ray direction shared by every terrain-height sample.
const DOWN = new THREE.Vector3(0, -1, 0);

// The set of capital city ids: each alive faction's lord (faction.lordId) resides
// in exactly one city (General.locationCityId), which the scenario seeds as the
// faction's first city — its capital. That marker gets the larger town + banner.
function capitalCityIds(game: GameState): Set<string> {
  const set = new Set<string>();
  for (const f of Object.values(game.factions)) {
    if (!f.alive) continue;
    const lord = game.generals[f.lordId];
    if (lord?.locationCityId) set.add(lord.locationCityId);
  }
  return set;
}

// Walk up from a raycast hit to the marker group that carries the city id.
function cityIdFromObject(o: THREE.Object3D | null): string | null {
  let cur: THREE.Object3D | null = o;
  while (cur) {
    const id = cur.userData?.cityId as string | undefined;
    if (id) return id;
    cur = cur.parent;
  }
  return null;
}

// Free every geometry / material / texture under an object subtree exactly once
// (deduped so shared resources are not disposed twice), plus any InstancedMesh
// GPU buffer. Used when a marker is removed in a diff. Mirrors the battle scene's
// disposeObject discipline.
function disposeObject3D(root: THREE.Object3D): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  root.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (mesh.geometry) geos.add(mesh.geometry);
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => mats.add(m));
    else if (mat) mats.add(mat as THREE.Material);
    if ((c as THREE.InstancedMesh).isInstancedMesh) (c as THREE.InstancedMesh).dispose();
  });
  for (const g of geos) g.dispose();
  for (const m of mats) disposeMaterial(m);
}

// The floating city label element: the battle scene's "unit" label style, so the
// two scenes' CSS2D labels read as one system. pointer-events:none keeps it clear
// of the canvas picking.
function makeMapLabelEl(): HTMLDivElement {
  const el = document.createElement('div');
  // Light, atlas-style label: cream text on a strong shadow (no heavy pill), so
  // dense clusters of cities stay legible without stacking chunky dark boxes.
  el.style.cssText =
    'white-space:nowrap;pointer-events:none;letter-spacing:.02em;' +
    "font:600 10px/1.2 'Noto Sans TC',system-ui,sans-serif;color:#f0e7d2;" +
    'text-shadow:0 1px 2px #000,0 0 5px rgba(0,0,0,.9),0 0 2px #000';
  return el;
}

// name (bold) + sub (small, dimmed), prefixed by a faction-colour dot.
function cityLabelHtml(name: string, sub: string, color: string): string {
  const dot = `<span style="color:${color};text-shadow:0 0 3px #000">●</span>`;
  const nm = name ? `<b>${escapeText(name)}</b>` : '';
  const s = sub ? ` <span style="opacity:.72;font-weight:400;font-size:9px">${escapeText(sub)}</span>` : '';
  return `${dot} ${nm}${s}`;
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

// A compact faction banner drawn on a canvas: a faction-colour gradient, a cream
// border, and the lord's surname glyph — redrawn once the serif font loads so the
// character is crisp. A lightweight take on the battle scene's flagTexture.
function capitalFlagTexture(color: string, glyph: string): THREE.CanvasTexture {
  const W = 128;
  const H = 88;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const dark = new THREE.Color(color).multiplyScalar(0.5).getStyle();
  const draw = (): void => {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, color);
    grad.addColorStop(1, dark);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(233,220,193,.85)';
    ctx.lineWidth = 6;
    ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.font = `900 ${Math.round(H * 0.6)}px "Noto Serif TC", "Noto Serif SC", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#f4ecd6';
    ctx.fillText(glyph, W / 2, H * 0.54);
    ctx.shadowColor = 'transparent';
    tex.needsUpdate = true;
  };
  draw();
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready.then(draw).catch(() => {});
  }
  return tex;
}

// ---------------------------------------------------------------- geometry
// helpers (pure; deliberately free of scene state)

// Project a logical map coordinate to a world [x, z] pair using the same
// centered convention as gridToWorld (so terrain, coastline, and future city
// markers all share one frame).
function toWorldXZ(lx: number, ly: number): [number, number] {
  const w = gridToWorld({ x: lx, y: ly });
  return [w.x, w.z];
}

// Flatten an SVG `d` path (M/L/C/Q/Z, absolute) into a polyline of points. Our
// authored geography paths use only these commands; cubic/quadratic segments are
// sampled into short line runs. Adapted for the map from the SVG data format.
function samplePath(d: string, segmentsPerCurve = 16): Array<[number, number]> {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const pts: Array<[number, number]> = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let cmd = '';
  const num = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (/[a-zA-Z]/.test(tok)) {
      cmd = tok;
      i++;
      if (cmd === 'Z' || cmd === 'z') pts.push([startX, startY]);
      continue;
    }
    switch (cmd) {
      case 'M': {
        cx = num();
        cy = num();
        startX = cx;
        startY = cy;
        pts.push([cx, cy]);
        cmd = 'L'; // implicit line-to for subsequent coordinate pairs
        break;
      }
      case 'L': {
        cx = num();
        cy = num();
        pts.push([cx, cy]);
        break;
      }
      case 'C': {
        const x1 = num();
        const y1 = num();
        const x2 = num();
        const y2 = num();
        const x = num();
        const y = num();
        for (let s = 1; s <= segmentsPerCurve; s++) {
          const t = s / segmentsPerCurve;
          pts.push(cubicPoint(cx, cy, x1, y1, x2, y2, x, y, t));
        }
        cx = x;
        cy = y;
        break;
      }
      case 'Q': {
        const x1 = num();
        const y1 = num();
        const x = num();
        const y = num();
        for (let s = 1; s <= segmentsPerCurve; s++) {
          const t = s / segmentsPerCurve;
          pts.push(quadPoint(cx, cy, x1, y1, x, y, t));
        }
        cx = x;
        cy = y;
        break;
      }
      default:
        i++; // skip anything unexpected rather than loop forever
        break;
    }
  }
  return pts;
}

function cubicPoint(
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, t: number,
): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3];
}

function quadPoint(
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, t: number,
): [number, number] {
  const u = 1 - t;
  const a = u * u;
  const b = 2 * u * t;
  const c = t * t;
  return [a * x0 + b * x1 + c * x2, a * y0 + b * y1 + c * y2];
}

// Ray-cast point-in-polygon (same algorithm as MapView's helper, adapted to the
// [x, z] world tuples used here).
function pointInPolygon(x: number, y: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const xi = a[0];
    const yi = a[1];
    const xj = b[0];
    const yj = b[1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Shortest distance from (x, y) to an OPEN polyline (used for the shore falloff
// and, implicitly, to keep the coast crisp).
function distanceToPolyline(x: number, y: number, poly: Array<[number, number]>): number {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const d = distanceToSegment(x, y, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }
  return best;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// ---------------------------------------------------------------- colour +
// noise (seeded value-noise fbm, copied from BattleScene's env noise)

const SEABED_COLOR: [number, number, number] = [0.1, 0.18, 0.24];

// Height -> land colour: coast sand -> lowland green -> upland brown -> pale rock.
function landRamp(h: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [0.78, 0.71, 0.52]], // waterline sand
    [2.5, [0.72, 0.66, 0.47]], // shore sand
    [7, [0.34, 0.44, 0.26]], // lowland green
    [16, [0.3, 0.4, 0.24]], // rolling green
    [24, [0.42, 0.35, 0.26]], // upland brown
    [30, [0.52, 0.5, 0.47]], // pale rock
  ];
  if (h <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    if (h <= stops[i]![0]) {
      const a = stops[i - 1]!;
      const b = stops[i]!;
      const t = (h - a[0]) / (b[0] - a[0]);
      return [
        a[1][0] + (b[1][0] - a[1][0]) * t,
        a[1][1] + (b[1][1] - a[1][1]) * t,
        a[1][2] + (b[1][2] - a[1][2]) * t,
      ];
    }
  }
  return stops[stops.length - 1]![1];
}

function envHash(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function envNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = envHash(xi, yi, seed);
  const b = envHash(xi + 1, yi, seed);
  const c = envHash(xi, yi + 1, seed);
  const d = envHash(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x: number, y: number, seed: number): number {
  let s = 0;
  let amp = 1;
  let f = 1;
  let tot = 0;
  for (let i = 0; i < 4; i++) {
    s += envNoise(x * f, y * f, seed) * amp;
    tot += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / tot;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Dispose a material and any texture it owns (material.dispose() does not free
// textures on its own). Copied from BattleScene.
function disposeMaterial(m: THREE.Material): void {
  const map = (m as THREE.MeshStandardMaterial).map;
  if (map) map.dispose();
  m.dispose();
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}
