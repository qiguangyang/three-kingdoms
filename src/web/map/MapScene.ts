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
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { MAP_HEIGHT, MAP_WIDTH } from '../../engine/constants.js';
import { COASTLINE_PATH } from '../../data/map/geography.js';
import type { GameState } from '../../engine/types.js';
import { gridToWorld } from './mapGeometry.js';

// ---- render-layer tuning (world units; the map spans MAP_WIDTH x MAP_HEIGHT,
// i.e. 500 x 200 world units, centered on the origin via gridToWorld) ----
const MAP_SEED = 1337; // fixed noise seed — relief is stable across frames
const SHORE_WIDTH = 16; // world units the coast ramps up from sea level
const LOWLAND_H = 3; // baseline elevation of inland lowland
const UPLAND_H = 26; // extra elevation the fbm relief adds toward the interior
const SEA_FLOOR = -3; // elevation of sea-floor vertices (below the water plane)
const WATER_Y = 1.4; // sea level; land emerges above this, coast fringe sits below
const RELIEF_FREQ = 0.035; // fbm frequency over logical grid coords
const LAND_SEGMENTS_X = 250; // landmass plane subdivisions (2 world units/cell)
const LAND_SEGMENTS_Z = 100;

// Dusk look, borrowed from BattleScene's `dusk` environment preset so the two
// scenes read as the same time of day.
const SKY_TOP = 0x2a3b60;
const SKY_HORIZON = 0x93a0b4;
const FOG_COLOR = 0x93a0b4;
const FOG_DENSITY = 0.0012; // low: the far landmass stays visible, edges haze out

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
  // Picking callback registered by the React layer; wired up in Task 1.3.
  private pickCb: ((cityId: string | null) => void) | null = null;
  private raf = 0;
  private disposed = false;

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
    this.camera = new THREE.PerspectiveCamera(46, 1, 1, 4000);
    this.camera.position.set(0, 300, 230);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0);
    // Clamp so the map stays legible and you can't dip under the ground:
    // minPolar keeps a near-top-down cap; maxPolar stops just above the horizon.
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = 1.45;
    this.controls.minDistance = 150;
    this.controls.maxDistance = 620;

    // Dusk lighting, mirroring the battle's `dusk` preset (warm low sun, cool
    // sky fill, faint ambient).
    this.hemi = new THREE.HemisphereLight(0xaec4e8, 0x4a3d28, 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd9a0, 2.1);
    this.sun.position.set(-180, 260, 220);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 900;
    const s = 280; // ortho shadow frustum covering the full landmass
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
    // Derive the land/sea mask from COASTLINE_PATH. The authored path is an OPEN
    // curve hugging the eastern coast (running from the NE corner down to the SE
    // corner); land lies to its west. We sample it into a polyline, then close it
    // around the map's western / northern / southern boundary to get a filled
    // land polygon we can point-in-polygon test. (Accurate re-authoring of the
    // coastline is a later task — the existing scaled coastline is fine here.)
    const coastLogical = samplePath(COASTLINE_PATH);
    const coastWorld = coastLogical.map((p) => toWorldXZ(p[0], p[1]));
    const first = coastLogical[0]!;
    const landPolyLogical: Array<[number, number]> = [
      ...coastLogical,
      [0, MAP_HEIGHT], // SW corner
      [0, 0], // NW corner
      [first[0], 0], // back up under the coastline's start x, closing the loop
    ];
    const landPolyWorld = landPolyLogical.map((p) => toWorldXZ(p[0], p[1]));

    const geo = new THREE.PlaneGeometry(MAP_WIDTH, MAP_HEIGHT, LAND_SEGMENTS_X, LAND_SEGMENTS_Z);
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
        // Seeded fbm micro-relief keyed on logical grid coords (stable, no
        // per-frame Math.random).
        const gx = wx + MAP_WIDTH / 2;
        const gy = wz + MAP_HEIGHT / 2;
        const relief = fbm(gx * RELIEF_FREQ, gy * RELIEF_FREQ, MAP_SEED);
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

    // Glowing gold coastline where land meets sea, floated just above the water
    // so it reads as a shoreline; kept bright so the bloom pass makes it glow.
    const linePts = coastWorld.map(([x, z]) => new THREE.Vector3(x, WATER_Y + 0.2, z));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
    const coast = new THREE.Line(
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
    const wgeo = new THREE.PlaneGeometry(MAP_WIDTH * 2, MAP_HEIGHT * 3.5, 200, 140);
    wgeo.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { uT: { value: 0 }, uCol: { value: new THREE.Color(0x1d3d55) } },
      vertexShader:
        'uniform float uT; varying float vR; varying vec3 vW;' +
        'void main(){ vec3 p = position;' +
        ' float r = sin(p.x*0.03 + uT*0.8)*0.5 + sin(p.z*0.045 - uT*0.6)*0.4 + sin((p.x+p.z)*0.02 + uT*0.4)*0.3;' +
        ' p.y += r; vR = r; vec4 wp = modelMatrix*vec4(p,1.0); vW = wp.xyz;' +
        ' gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader:
        'uniform float uT; uniform vec3 uCol; varying float vR; varying vec3 vW;' +
        'void main(){ float sh = 0.5 + 0.5*sin(vR*6.0 + uT*3.0);' +
        ' float spk = smoothstep(0.85, 1.0, sin(vW.x*0.08 + uT*2.0)*sin(vW.z*0.1 - uT*1.7));' +
        ' vec3 col = uCol + vec3(0.08,0.13,0.18)*sh + vec3(0.4)*spk;' +
        ' gl_FragColor = vec4(col, 0.9); }',
    });
    const water = new THREE.Mesh(wgeo, this.waterMat);
    water.position.y = WATER_Y;
    this.scene.add(water);
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

  // ---- stubs filled in by later tasks (signatures fixed by the plan) ----

  // Place / update / remove 3D city markers + labels. Implemented in Task 1.3.
  syncCities(_game: GameState, _labels: MapLabelData[]): void {
    // implemented in Task 1.3
  }

  // Highlight the selected city marker. Implemented in Task 1.3.
  setSelected(_cityId: string | null): void {
    // implemented in Task 1.3
  }

  // Build the translucent faction-territory overlay. Implemented in Task 3.2.
  setTerritories(_field: InfluenceCell[]): void {
    // implemented in Task 3.2
  }

  // Draw animated arcs for armies in transit. Implemented in Task 3.3.
  setMarches(_ops: InFlightMarch[]): void {
    // implemented in Task 3.3
  }

  // Register the pointer-pick callback. Wired to a Raycaster in Task 1.3.
  onPickCity(cb: (cityId: string | null) => void): void {
    this.pickCb = cb;
  }
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
