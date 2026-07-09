// Three.js scene manager for the 3D battlefield. Pure layout math lives in
// geometry.ts (unit-tested); this file is the rendering glue (verified
// visually). Only ever instantiated in a real WebGL context — BattleView
// routes to the SVG fallback when WebGL is unavailable.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { BattleSession } from '../../state/battleSession.js';
import type { BattleCell, BattleEvent, BattleField, GeneralId, Vec2 } from '../../engine/battle/types.js';
import type { BattleUnit, TroopType } from '../../engine/types.js';
import { FACTION_GLYPH, factionColor } from '../theme.js';
import {
  CELL_SIZE,
  battleCentroidXZ,
  buildTerrainGeometry,
  cellWorldXZ,
  fieldWorldSize,
  formationOffsets,
  soldierCount,
  terrainHeight,
  unitWorldPosition,
} from './geometry.js';

const UP = new THREE.Vector3(0, 1, 0);
const MAX_SOLDIERS = 48;
const WATER_Y = 0.2;
const FLAG_W = 0.95;
// World distance under which two opposing blocks count as locked in melee.
const MELEE_DIST = 3.8;
// Azimuths the shot director rotates through on each cut, so consecutive shots
// look at the action from visibly different angles.
const CUT_AZIMUTHS = [-1.15, 0.4, -0.55, 1.2, -2.05, 0.9];

// Final film-grade pass (runs after tone mapping, on display-space colour).
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

// Time-of-day / weather looks, chosen deterministically per battle so different
// fields feel distinct. Values (sky/fog/sun/ambient) are tuned here, not copied.
const ENV_PRESETS = {
  dusk: { skyTop: 0x2a3b60, skyHz: 0x93a0b4, fog: 0x93a0b4, sun: 0xffd9a0, sunI: 2.1, hemiSky: 0xaec4e8, hemiI: 0.55, amb: 0.4 },
  day: { skyTop: 0x3d6ea8, skyHz: 0xbccadc, fog: 0xbccadc, sun: 0xfff4e0, sunI: 2.5, hemiSky: 0xc4d6f0, hemiI: 0.7, amb: 0.5 },
  dawn: { skyTop: 0x3a4a70, skyHz: 0xcaa678, fog: 0xc0a888, sun: 0xffdca8, sunI: 1.9, hemiSky: 0xd0c4c0, hemiI: 0.6, amb: 0.45 },
  overcast: { skyTop: 0x6a7280, skyHz: 0x9aa2ac, fog: 0x9aa2ac, sun: 0xdadfe4, sunI: 1.25, hemiSky: 0xb2bac4, hemiI: 0.9, amb: 0.6 },
} as const;

// Distinct low-poly silhouettes per troop type (infantry=spear, archer=bow,
// cavalry=mounted, navy=boat), each built once from primitives and shared
// across all armies of that type.
const SOLDIER_GEOS = new Map<string, THREE.BufferGeometry>();
function soldierKind(type: TroopType): string {
  if (type === 'heavyCav') return 'cavalry';
  if (type === 'xuan') return 'infantry';
  return type;
}
function soldierGeometryFor(type: TroopType): THREE.BufferGeometry {
  const key = soldierKind(type);
  const cached = SOLDIER_GEOS.get(key);
  if (cached) return cached;
  const g = buildSoldier(key);
  SOLDIER_GEOS.set(key, g);
  return g;
}
function isSharedSoldierGeo(g: THREE.BufferGeometry): boolean {
  for (const v of SOLDIER_GEOS.values()) if (v === g) return true;
  return false;
}
// Realistic soldier palette, baked as vertex colours on the body geometry (the
// faction tabard is a separate group, tinted per-unit).
const SKIN = 0xc79a6b;
const HELM = 0x94815a; // laced cap / tan
const ARMOR = 0x8c8f95; // steel lamellar
const SLEEVE = 0x6f6353;
const BELT = 0x47342a;
const TROUSER = 0x35312b;
const BOOT = 0x2a2119;
const WOOD = 0x6b4f30;
const STEEL = 0xb8bcc0;
const SHIELD = 0x5c4835;
const HORSE = 0x5b4636;
const HORSE_DK = 0x3e3128;

// Bake a flat vertex colour onto a geometry so several coloured parts can be
// merged into one instanced geometry (steel armour, tan helmet, skin, dark cloth).
function paint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position!.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  return geo;
}
// Merge body parts (group 0, realistic material) + faction accent (group 1) into
// one grouped geometry the two-material InstancedMesh draws.
function soldierGeo(body: THREE.BufferGeometry[], accent: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const b = mergeGeometries(body, false);
  const a = mergeGeometries(accent, false);
  return mergeGeometries([b, a], true);
}

// A low-poly Han-era soldier: dark trousers + boots, steel lamellar torso over a
// belt, sleeved arms, a skin head under a laced helmet, and a tall shouldered
// spear (archers a bow) — with a faction-coloured tabard over the armour.
function buildSoldier(kind: string): THREE.BufferGeometry {
  if (kind === 'cavalry') {
    const body = [
      paint(new THREE.BoxGeometry(0.46, 0.18, 0.18).translate(0, 0.37, 0), HORSE),
      ...([[-0.18, -0.06], [0.18, -0.06], [-0.18, 0.06], [0.18, 0.06]] as const).map(([lx, lz]) =>
        paint(new THREE.BoxGeometry(0.05, 0.3, 0.05).translate(lx, 0.15, lz), HORSE_DK)),
      paint(new THREE.BoxGeometry(0.1, 0.22, 0.1).rotateZ(-0.4).translate(0.26, 0.54, 0), HORSE),
      paint(new THREE.BoxGeometry(0.18, 0.1, 0.1).translate(0.35, 0.62, 0), HORSE),
      paint(new THREE.CylinderGeometry(0.09, 0.07, 0.2, 7).translate(-0.05, 0.58, 0), ARMOR),
      paint(new THREE.SphereGeometry(0.06, 8, 6).translate(-0.05, 0.72, 0), SKIN),
      paint(new THREE.SphereGeometry(0.075, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(-0.05, 0.73, 0), HELM),
      paint(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 4).translate(0.12, 0.72, 0), WOOD),
      paint(new THREE.ConeGeometry(0.02, 0.08, 4).translate(0.12, 1.04, 0), STEEL),
    ];
    const accent = [paint(new THREE.BoxGeometry(0.13, 0.14, 0.02).translate(-0.05, 0.58, 0.085), 0xffffff)];
    return soldierGeo(body, accent);
  }
  if (kind === 'navy') {
    const body = [
      paint(new THREE.BoxGeometry(0.52, 0.1, 0.2).translate(0, 0.08, 0), WOOD),
      paint(new THREE.BoxGeometry(0.14, 0.16, 0.14).translate(0.29, 0.14, 0), WOOD),
      paint(new THREE.CylinderGeometry(0.012, 0.012, 0.52, 4).translate(0, 0.34, 0), WOOD),
    ];
    const accent = [paint(new THREE.BoxGeometry(0.02, 0.28, 0.24).translate(0, 0.4, 0), 0xffffff)];
    return soldierGeo(body, accent);
  }
  // foot soldier (infantry / archer)
  const body = [
    paint(new THREE.BoxGeometry(0.06, 0.2, 0.07).translate(-0.05, 0.16, 0), TROUSER),
    paint(new THREE.BoxGeometry(0.06, 0.2, 0.07).translate(0.05, 0.16, 0), TROUSER),
    paint(new THREE.BoxGeometry(0.075, 0.06, 0.11).translate(-0.05, 0.03, 0.015), BOOT),
    paint(new THREE.BoxGeometry(0.075, 0.06, 0.11).translate(0.05, 0.03, 0.015), BOOT),
    paint(new THREE.CylinderGeometry(0.12, 0.09, 0.22, 7).translate(0, 0.37, 0), ARMOR),
    paint(new THREE.CylinderGeometry(0.125, 0.125, 0.03, 10).translate(0, 0.27, 0), BELT),
    paint(new THREE.BoxGeometry(0.04, 0.19, 0.05).translate(-0.14, 0.36, 0.01), SLEEVE),
    paint(new THREE.BoxGeometry(0.04, 0.19, 0.05).translate(0.14, 0.36, 0.01), SLEEVE),
    paint(new THREE.SphereGeometry(0.06, 8, 6).translate(0, 0.53, 0), SKIN),
    paint(new THREE.SphereGeometry(0.078, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 0.53, 0), HELM),
    paint(new THREE.CylinderGeometry(0.088, 0.088, 0.02, 10).translate(0, 0.505, 0), HELM),
    paint(new THREE.BoxGeometry(0.14, 0.06, 0.13).translate(0, 0.5, -0.025), HELM),
  ];
  if (kind === 'archer') {
    body.push(paint(new THREE.TorusGeometry(0.14, 0.012, 5, 10, Math.PI * 1.3).rotateY(Math.PI / 2).translate(0.16, 0.42, 0), WOOD));
  } else {
    body.push(paint(new THREE.CylinderGeometry(0.01, 0.01, 0.72, 4).translate(0.17, 0.5, 0), WOOD));
    body.push(paint(new THREE.ConeGeometry(0.02, 0.09, 4).translate(0.17, 0.9, 0), STEEL));
    body.push(paint(new THREE.BoxGeometry(0.03, 0.18, 0.16).translate(-0.16, 0.36, 0.02), SHIELD));
  }
  const accent = [
    paint(new THREE.BoxGeometry(0.16, 0.18, 0.02).translate(0, 0.36, 0.105), 0xffffff),
    paint(new THREE.BoxGeometry(0.16, 0.18, 0.02).translate(0, 0.36, -0.105), 0xffffff),
  ];
  return soldierGeo(body, accent);
}

interface UnitVisual {
  group: THREE.Group;
  soldiers: THREE.InstancedMesh;
  mats: THREE.MeshStandardMaterial[]; // [realistic body (vertex colours), faction tabard]
  banner?: THREE.Mesh;
  flag?: THREE.Mesh;
  flagBase?: Float32Array;
  label?: CSS2DObject;
  generalId: string;
  factionId: string;
  offsets: { x: number; z: number }[]; // formation slots, for per-figure animation
  heading: number; // current facing (world y-rotation), eased toward movement/enemy
  moving: number; // 0..1 recent movement, drives march-bob intensity
  basePos: THREE.Vector3;
  target: THREE.Vector3;
  placed: boolean;
  shakeUntil: number;
  engagedUntil: number; // while > now, the block is in melee (drives combat animation)
}

// Text the renderer floats over the battle (resolved in React, where the name
// data + locale live; the scene only positions and shows the strings).
export interface BattleLabelData {
  units: Record<string, { title: string; sub: string; color: string }>;
  landmark?: { text: string; cell: { x: number; y: number } };
}
interface Effect {
  obj: THREE.Object3D;
  born: number;
  life: number;
  update: (age01: number, dt: number, t: number) => void;
}

export class BattleScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly units = new Map<string, UnitVisual>();
  private readonly effects: Effect[] = [];
  // A small fixed pool of fire lights kept permanently in the scene so the WebGL
  // light count never changes (adding/removing lights recompiles materials).
  private readonly fireLights: THREE.PointLight[] = [];
  private readonly labelRenderer: CSS2DRenderer;
  private readonly composer: EffectComposer;
  private landmarkLabel: CSS2DObject | null = null;
  private skyMat!: THREE.ShaderMaterial;
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private ambient!: THREE.AmbientLight;
  private waterMat: THREE.ShaderMaterial | null = null;
  private field: BattleField | null = null;
  private raf = 0;
  private disposed = false;
  // Cinematic camera director state.
  private readonly focusC = new THREE.Vector3(0, 1.5, 0); // centroid of the armies
  private readonly camFocus = new THREE.Vector3(0, 1.5, 0); // where the camera currently looks
  private readonly hotPoint = new THREE.Vector3(0, 1.5, 0); // where the action just happened
  private focusSpan = 40;
  private introT = 0;
  private hotUntil = 0; // while > now, frame the hot point instead of the centroid
  private shotKind: 'establish' | 'action' | 'hero' | 'rout' = 'establish';
  private shotBorn = 0; // when the current shot started (for the cut-in ease)
  private shotAz = -1.1; // azimuth of the current shot
  private cutUntil = 0; // don't cut again before this (avoid strobing cuts)
  private shotSeq = 0; // rotates the angle each cut for variety
  private shakeAmp = 0;
  private meleeSparkT = 0;
  private autoPausedUntil = 0;
  private lastT = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // A CSS2D layer over the canvas for crisp HTML labels (general/army names,
    // landmarks) projected onto 3D positions — the reference's documentary look.
    this.labelRenderer = new CSS2DRenderer();
    const lr = this.labelRenderer.domElement;
    lr.style.position = 'absolute';
    lr.style.inset = '0';
    lr.style.pointerEvents = 'none';
    lr.style.overflow = 'hidden';
    canvas.parentElement?.appendChild(lr);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1e2a48);
    // Exponential fog: keeps the playfield crisp but hazes the distant hills and
    // mountain ridges into the sky, giving the world atmospheric depth.
    this.scene.fog = new THREE.FogExp2(0x93a0b4, 0.0062);
    this.addSky();

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 500);
    this.camera.position.set(0, 30, 45);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 120;
    this.controls.addEventListener('start', () => { this.autoPausedUntil = Number.POSITIVE_INFINITY; });
    this.controls.addEventListener('end', () => { this.autoPausedUntil = nowMs() + 6000; });

    this.hemi = new THREE.HemisphereLight(0xaec4e8, 0x4a3d28, 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd9a0, 2.1);
    this.sun.position.set(-26, 30, 34);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 140;
    const s = 34;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.ambient = new THREE.AmbientLight(0x30364a, 0.4);
    this.scene.add(this.ambient);
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xff6a1c, 0, 16, 2);
      this.scene.add(l);
      this.fireLights.push(l);
    }

    // Post-processing: a gentle bloom so fire, water sparkle, and the bright sky
    // glow filmically. RenderPass renders linear HDR; OutputPass applies the
    // renderer's ACES tone mapping + sRGB once, at the end (no double-grade).
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.7, 0.82);
    this.composer.addPass(bloom);
    this.composer.addPass(new OutputPass());
    // Film grade (after tone mapping, in display space): lift saturation, add an
    // S-curve, a teal-shadow/warm-highlight split-tone, and a soft vignette — so
    // the frame reads painterly and cinematic instead of flat ACES grey-green.
    this.composer.addPass(new ShaderPass(GRADE_SHADER));

    this.resize();
    this.loop();
  }

  private addSky(): void {
    // High-segment dome + fragment dithering: a coarse sphere with a smooth
    // gradient shows facet seams and 8-bit banding as streaks in the sky, so
    // subdivide finely and add sub-LSB noise to break the bands up.
    const geo = new THREE.SphereGeometry(300, 64, 32);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(0x2a3b60) },
        horizon: { value: new THREE.Color(0x93a0b4) },
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

  resize(): void {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 500;
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setField(field: BattleField): void {
    this.field = field;
    this.applyEnv(field.seed);
    this.addEnvironment(field);
    const geo = buildTerrainBufferGeometry(field);
    const ground = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98, metalness: 0 }),
    );
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.addGroundDetail(field);

    if (field.river) {
      const size = fieldWorldSize(field);
      const wgeo = new THREE.PlaneGeometry(size.w, size.h, 48, 32);
      wgeo.rotateX(-Math.PI / 2);
      this.waterMat = new THREE.ShaderMaterial({
        transparent: true,
        uniforms: { uT: { value: 0 }, uCol: { value: new THREE.Color(0x244b60) } },
        vertexShader:
          'uniform float uT; varying float vR; varying vec3 vW;' +
          'void main(){ vec3 p = position;' +
          ' float r = sin(p.x*0.16 + uT*1.4)*0.13 + sin(p.z*0.21 - uT*1.05)*0.10 + sin((p.x+p.z)*0.09 + uT*0.7)*0.08;' +
          ' p.y += r; vR = r; vec4 wp = modelMatrix*vec4(p,1.0); vW = wp.xyz;' +
          ' gl_Position = projectionMatrix * viewMatrix * wp; }',
        fragmentShader:
          'uniform float uT; uniform vec3 uCol; varying float vR; varying vec3 vW;' +
          'void main(){ float sh = 0.5 + 0.5*sin(vR*22.0 + uT*3.0);' +
          ' float spk = smoothstep(0.85, 1.0, sin(vW.x*0.4 + uT*2.0)*sin(vW.z*0.5 - uT*1.7));' +
          ' vec3 col = uCol + vec3(0.10,0.16,0.20)*sh + vec3(0.45)*spk;' +
          ' gl_FragColor = vec4(col, 0.86); }',
      });
      const water = new THREE.Mesh(wgeo, this.waterMat);
      water.position.y = WATER_Y;
      this.scene.add(water);
    }

    if (field.wall) this.addFortification(field, field.wall);
    this.addCamps(field);
    this.addGroundDetail(field);
  }

  // Scatter grass tufts and pebbles across the playfield so the battleground reads
  // as living ground (grassland churned by an army) instead of a bare tinted mesh.
  private addGroundDetail(field: BattleField): void {
    const seed = Math.abs(field.seed) | 0;
    const fw = fieldWorldSize(field);
    const cellOf = (cx: number, cy: number): BattleCell =>
      field.cells[Math.max(0, Math.min(field.height - 1, cy)) * field.width + Math.max(0, Math.min(field.width - 1, cx))] ?? 'plain';

    // --- grass tufts (a few splayed blades, instanced) ---
    const blades: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const bl = new THREE.ConeGeometry(0.03, 0.26, 3);
      const a = (i / 4) * Math.PI * 2;
      bl.rotateZ((i - 1.5) * 0.16);
      bl.translate(Math.cos(a) * 0.045, 0.13, Math.sin(a) * 0.045);
      blades.push(bl);
    }
    const tuft = mergeGeometries(blades, false);
    const grass = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({ roughness: 1 }), 900);
    const M = new THREE.Matrix4();
    const P = new THREE.Vector3();
    const Q = new THREE.Quaternion();
    const S = new THREE.Vector3();
    const CT = new THREE.Color();
    let g = 0;
    for (let i = 0; i < 2200 && g < 900; i++) {
      const x = (envHash(i, 3, seed) - 0.5) * fw.w * 0.98;
      const z = (envHash(i, 7, seed) - 0.5) * fw.h * 0.98;
      const cx = Math.round(x / CELL_SIZE + (field.width - 1) / 2);
      const cy = Math.round(z / CELL_SIZE + (field.height - 1) / 2);
      const cell = cellOf(cx, cy);
      if (cell === 'river' || cell === 'ford' || cell === 'wall' || cell === 'gate') continue;
      if (envHash(i, 9, seed) > 0.7) continue; // patchy, not a lawn
      const sc = 0.6 + envHash(i, 12, seed) * 0.9;
      P.set(x, terrainHeight(cx, cy, field), z);
      Q.setFromAxisAngle(UP, envHash(i, 15, seed) * Math.PI);
      S.set(sc, sc * (0.8 + envHash(i, 17, seed) * 0.6), sc);
      M.compose(P, Q, S);
      grass.setMatrixAt(g, M);
      const v = 0.28 + envHash(i, 19, seed) * 0.22;
      CT.setRGB(v * 0.72, v, v * 0.42); // varied grass greens
      grass.setColorAt(g, CT);
      g++;
    }
    grass.count = g;
    grass.instanceMatrix.needsUpdate = true;
    if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    this.scene.add(grass);

    // --- pebbles (small instanced rocks) ---
    const rockGeo = new THREE.DodecahedronGeometry(0.12, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x6b655c, roughness: 1, flatShading: true }), 60);
    let r = 0;
    for (let i = 0; i < 400 && r < 60; i++) {
      const x = (envHash(i, 21, seed) - 0.5) * fw.w * 0.95;
      const z = (envHash(i, 23, seed) - 0.5) * fw.h * 0.95;
      const cx = Math.round(x / CELL_SIZE + (field.width - 1) / 2);
      const cy = Math.round(z / CELL_SIZE + (field.height - 1) / 2);
      const cell = cellOf(cx, cy);
      if (cell === 'river' || cell === 'wall' || cell === 'gate') continue;
      if (envHash(i, 25, seed) > 0.35) continue;
      const sc = 0.6 + envHash(i, 27, seed) * 1.2;
      P.set(x, terrainHeight(cx, cy, field) + 0.03, z);
      Q.setFromAxisAngle(UP, envHash(i, 29, seed) * Math.PI);
      S.set(sc, sc * 0.7, sc);
      M.compose(P, Q, S);
      rocks.setMatrixAt(r++, M);
    }
    rocks.count = r;
    rocks.instanceMatrix.needsUpdate = true;
    this.scene.add(rocks);
  }

  // A besieged city's fortifications along the defender edge: a crenellated
  // curtain wall, corner towers with roofs, a gatehouse, and a keep behind the
  // gate — replacing the row of bare boxes so the objective reads as a city.
  private addFortification(field: BattleField, wall: { cells: Vec2[]; gate: Vec2 }): void {
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6f665c, roughness: 0.95 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x7a6a50, roughness: 0.95 });
    const gateMat = new THREE.MeshStandardMaterial({ color: 0x2c1f14, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x50322f, roughness: 0.85 });
    const WH = 3.2;
    const gate = wall.gate;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const c of wall.cells) { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); }
    const add = (m: THREE.Mesh): void => { m.castShadow = true; m.receiveShadow = true; this.scene.add(m); };

    for (const c of wall.cells) {
      const { x, z } = cellWorldXZ(c.x, c.y, field);
      const y = terrainHeight(c.x, c.y, field);
      if (c.x === gate.x && c.y === gate.y) {
        for (const dx of [-0.72, 0.72]) {
          const tw = new THREE.Mesh(new THREE.BoxGeometry(0.8, WH + 1.9, CELL_SIZE * 1.35), stoneMat);
          tw.position.set(x + dx, y + (WH + 1.9) / 2, z);
          add(tw);
        }
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(CELL_SIZE * 1.05, 1.1, CELL_SIZE * 1.4), stoneMat);
        lintel.position.set(x, y + WH + 0.55, z);
        add(lintel);
        const door = new THREE.Mesh(new THREE.BoxGeometry(1.15, WH * 0.72, CELL_SIZE * 0.7), gateMat);
        door.position.set(x, y + WH * 0.36, z);
        add(door);
      } else if (c.x === minX || c.x === maxX) {
        const tw = new THREE.Mesh(new THREE.BoxGeometry(CELL_SIZE * 1.25, WH + 2.4, CELL_SIZE * 1.25), stoneMat);
        tw.position.set(x, y + (WH + 2.4) / 2, z);
        add(tw);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(CELL_SIZE * 1.02, 1.9, 4), roofMat);
        roof.position.set(x, y + WH + 2.4 + 0.95, z);
        roof.rotation.y = Math.PI / 4;
        add(roof);
      } else {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(CELL_SIZE * 1.02, WH, CELL_SIZE * 1.15), wallMat);
        seg.position.set(x, y + WH / 2, z);
        add(seg);
        for (const mx of [-0.62, 0, 0.62]) {
          const mer = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, CELL_SIZE * 1.15), wallMat);
          mer.position.set(x + mx * CELL_SIZE * 0.5, y + WH + 0.28, z);
          add(mer);
        }
      }
    }

    // Keep: a roofed tower just behind the gate (toward the defender edge).
    const by = Math.max(0, gate.y - 1);
    const { x: kx, z: kz } = cellWorldXZ(gate.x, by, field);
    const ky = terrainHeight(gate.x, by, field);
    const keep = new THREE.Mesh(new THREE.BoxGeometry(CELL_SIZE * 1.6, WH + 2.6, CELL_SIZE * 1.6), stoneMat);
    keep.position.set(kx, ky + (WH + 2.6) / 2, kz);
    add(keep);
    const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(CELL_SIZE * 1.35, 2.3, 4), roofMat);
    keepRoof.position.set(kx, ky + WH + 2.6 + 1.15, kz);
    keepRoof.rotation.y = Math.PI / 4;
    add(keepRoof);
  }

  // A war camp of canvas tents at the attacker's staging edge, so the field has
  // an encampment behind the assault rather than empty ground.
  private addCamps(field: BattleField): void {
    const seed = Math.abs(field.seed) | 0;
    const tentMat = new THREE.MeshStandardMaterial({ color: 0xcdc2a6, roughness: 1 });
    const tentGeo = new THREE.ConeGeometry(0.85, 1.5, 6);
    const camp = new THREE.Group();
    const cx = Math.floor(field.width / 2);
    const cy = field.height - 1; // attacker's back edge
    const { x: wx, z: wz } = cellWorldXZ(cx, cy, field);
    const tents = new THREE.InstancedMesh(tentGeo, tentMat, 9);
    const M = new THREE.Matrix4();
    const P = new THREE.Vector3();
    const Q = new THREE.Quaternion();
    const S = new THREE.Vector3(1, 1, 1);
    let k = 0;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const tx = wx + Math.cos(a) * 3.2 + (envHash(i, 2, seed) - 0.5) * 1.4;
      const tz = wz + Math.sin(a) * 2.4 + (envHash(i, 5, seed) - 0.5) * 1.4 + 2.5; // nudge off the field edge
      P.set(tx, terrainHeight((tx / CELL_SIZE) + (field.width - 1) / 2, (tz / CELL_SIZE) + (field.height - 1) / 2, field) + 0.75, tz);
      const sc = 0.85 + envHash(i, 8, seed) * 0.4;
      S.set(sc, sc, sc);
      M.compose(P, Q, S);
      tents.setMatrixAt(k++, M);
    }
    tents.count = k;
    tents.instanceMatrix.needsUpdate = true;
    tents.castShadow = true;
    tents.receiveShadow = true;
    camp.add(tents);
    this.scene.add(camp);
  }

  // Wraps the bare playfield in a landscape: a rolling-hills basin the battle sits
  // in, a ridge of distant mountains on the horizon, scattered forests and rocks.
  // Everything is deterministic (seeded) and instanced, and is disposed by the
  // scene traversal in dispose(). This is what turns the diorama into a place.
  private addEnvironment(field: BattleField): void {
    const seed = Math.abs(field.seed) | 0;
    const fw = fieldWorldSize(field);
    const clearing = Math.max(fw.w, fw.h) / 2 + 4; // the flat arena the armies fight on

    // --- surrounding rolling-hills ground (a basin around the playfield) ---
    const GEXT = 360;
    const gGeo = new THREE.PlaneGeometry(GEXT, GEXT, 128, 128);
    gGeo.rotateX(-Math.PI / 2);
    const gp = gGeo.attributes.position as THREE.BufferAttribute;
    const gcol: number[] = [];
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i);
      const z = gp.getZ(i);
      const y = surroundHeight(x, z, clearing, seed);
      gp.setY(i, y);
      const c = groundRamp(y);
      gcol.push(c[0], c[1], c[2]);
    }
    gGeo.setAttribute('color', new THREE.Float32BufferAttribute(gcol, 3));
    gGeo.computeVertexNormals();
    const groundMesh = new THREE.Mesh(gGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    groundMesh.receiveShadow = true;
    this.scene.add(groundMesh);

    const M = new THREE.Matrix4();
    const Q = new THREE.Quaternion();
    const S = new THREE.Vector3();
    const P = new THREE.Vector3();
    const CT = new THREE.Color();

    // --- distant mountain ridge (a ring of instanced peaks rising above the tree
    // line and fading into the fog to anchor the horizon) ---
    const peakGeo = new THREE.ConeGeometry(1, 1, 5);
    const peaks = new THREE.InstancedMesh(peakGeo, new THREE.MeshStandardMaterial({ color: 0x4a5468, roughness: 1, flatShading: true }), 80);
    let pk = 0;
    for (let i = 0; i < 80; i++) {
      const ang = (i / 80) * Math.PI * 2 + (envHash(i, 5, seed) - 0.5) * 0.07;
      const rad = 132 + (envHash(i, 9, seed) - 0.5) * 46;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      const hgt = 48 + envHash(i, 17, seed) * 68;
      const wid = 34 + envHash(i, 23, seed) * 30;
      const baseY = surroundHeight(x, z, clearing, seed) - 6;
      P.set(x, baseY + hgt / 2, z);
      S.set(wid, hgt, wid);
      M.compose(P, Q, S);
      peaks.setMatrixAt(pk++, M);
      // haze the farther peaks toward the fog colour so the ridge recedes
      const t = Math.min(1, (rad - 110) / 70);
      CT.setRGB(0.29 + 0.14 * t, 0.33 + 0.13 * t, 0.41 + 0.12 * t);
      peaks.setColorAt(pk - 1, CT);
    }
    peaks.count = pk;
    peaks.instanceMatrix.needsUpdate = true;
    this.scene.add(peaks);

    // --- forests: instanced fir cones on the hills + on the field's forest cells ---
    const treeGeo = new THREE.ConeGeometry(1.7, 5.4, 5);
    treeGeo.translate(0, 2.7, 0);
    const trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), 640);
    let tk = 0;
    // woodland around the clearing, clumped into groves (fbm density) and thinning
    // toward the mountains, so it reads as a real forest rather than a blanket
    for (let i = 0; i < 5200 && tk < 560; i++) {
      const ang = envHash(i, 2, seed) * Math.PI * 2;
      const rad = clearing + 2 + envHash(i, 4, seed) * (118 - clearing);
      const x = Math.cos(ang) * rad + (envHash(i, 6, seed) - 0.5) * 12;
      const z = Math.sin(ang) * rad + (envHash(i, 8, seed) - 0.5) * 12;
      const r = Math.hypot(x, z);
      if (r < clearing || r > 122) continue;
      // grove density: fbm carves clearings and copses instead of an even fill
      if (envFbm(x * 0.05, z * 0.05, seed + 31) < 0.46) continue;
      const y = surroundHeight(x, z, clearing, seed);
      const sc = 0.7 + envHash(i, 12, seed) * 1.5;
      P.set(x, y, z);
      S.set(sc, sc, sc);
      M.compose(P, Q, S);
      trees.setMatrixAt(tk, M);
      const g = 0.2 + envHash(i, 15, seed) * 0.18; // varied greens
      CT.setRGB(g * 0.7, g + 0.06, g * 0.55);
      trees.setColorAt(tk, CT);
      tk++;
    }
    // real trees standing on the playfield's forest cells
    for (let cy = 0; cy < field.height && tk < 640; cy++) {
      for (let cx = 0; cx < field.width && tk < 640; cx++) {
        if (field.cells[cy * field.width + cx] !== 'forest') continue;
        const w = cellWorldXZ(cx, cy, field);
        const yy = terrainHeight(cx, cy, field);
        for (let n = 0; n < 3 && tk < 640; n++) {
          const jx = (envHash(cx * 7 + cy, n * 3 + 1, seed) - 0.5) * CELL_SIZE;
          const jz = (envHash(cx * 7 + cy, n * 3 + 2, seed) - 0.5) * CELL_SIZE;
          const sc = 0.5 + envHash(cx * 7 + cy, n, seed) * 0.5;
          P.set(w.x + jx, yy, w.z + jz);
          S.set(sc, sc, sc);
          M.compose(P, Q, S);
          trees.setMatrixAt(tk, M);
          const g = 0.2 + envHash(cx * 7 + cy, n + 4, seed) * 0.18;
          CT.setRGB(g * 0.7, g + 0.06, g * 0.55);
          trees.setColorAt(tk, CT);
          tk++;
        }
      }
    }
    trees.count = tk;
    trees.instanceMatrix.needsUpdate = true;
    if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
    trees.castShadow = true;
    this.scene.add(trees);

    // --- scattered boulders on the near hills ---
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x6b665e, roughness: 1, flatShading: true }), 70);
    let rk = 0;
    for (let i = 0; i < 600 && rk < 70; i++) {
      const ang = envHash(i, 14, seed) * Math.PI * 2;
      const rad = clearing + envHash(i, 16, seed) * 70;
      const x = Math.cos(ang) * rad;
      const z = Math.sin(ang) * rad;
      if (envHash(i, 18, seed) > 0.4) continue;
      const y = surroundHeight(x, z, clearing, seed);
      const sc = 0.5 + envHash(i, 20, seed) * 1.4;
      Q.setFromAxisAngle(UP, envHash(i, 22, seed) * Math.PI);
      P.set(x, y + sc * 0.3, z);
      S.set(sc, sc * 0.75, sc);
      M.compose(P, Q, S);
      Q.identity();
      rocks.setMatrixAt(rk++, M);
    }
    rocks.count = rk;
    rocks.instanceMatrix.needsUpdate = true;
    this.scene.add(rocks);
  }

  syncUnits(session: BattleSession, labels?: BattleLabelData): void {
    const field = session.battle.field;
    const alive = new Set<string>();
    for (const u of session.battle.units) {
      if (u.state !== 'fielded' && u.state !== 'routing') continue;
      alive.add(u.id);
      let v = this.units.get(u.id);
      if (!v) {
        v = this.buildUnit(u);
        this.scene.add(v.group);
        this.units.set(u.id, v);
      }
      const p = unitWorldPosition(u.pos, field);
      v.target.set(p.x, p.y, p.z);
      if (!v.placed) {
        v.basePos.copy(v.target);
        v.group.position.copy(v.target);
        v.heading = Math.atan2(this.focusC.x - v.target.x, this.focusC.z - v.target.z);
        v.group.rotation.y = v.heading;
        v.placed = true;
      }
      v.soldiers.count = soldierCount(u.troops);
      const routing = u.state === 'routing';
      for (const m of v.mats) { m.transparent = routing; m.opacity = routing ? 0.4 : 1; }

      const info = labels?.units[u.id];
      if (info) {
        if (!v.label) {
          v.label = new CSS2DObject(makeLabelEl('unit'));
          v.label.position.set(0, 3.1, 0);
          v.group.add(v.label);
        }
        v.label.element.innerHTML = unitLabelHtml(info);
        v.label.visible = !routing;
      }
    }
    for (const [id, v] of this.units) {
      if (alive.has(id)) continue;
      this.scene.remove(v.group);
      v.soldiers.dispose();
      for (const m of v.mats) m.dispose();
      if (v.banner) disposeObject(v.banner);
      if (v.label) { v.label.removeFromParent(); v.label.element.remove(); }
      this.units.delete(id);
    }

    // Landmark: the besieged city, floated over its gate (built once).
    if (labels?.landmark && !this.landmarkLabel && this.field) {
      const cell = labels.landmark.cell;
      const { x, z } = cellWorldXZ(cell.x, cell.y, this.field);
      const y = terrainHeight(cell.x, cell.y, this.field);
      const el = makeLabelEl('landmark');
      el.innerHTML = `<span style="opacity:.7">◈</span> ${escapeText(labels.landmark.text)}`;
      this.landmarkLabel = new CSS2DObject(el);
      this.landmarkLabel.position.set(x, y + 5.5, z);
      this.scene.add(this.landmarkLabel);
    }
  }

  private buildUnit(u: BattleUnit): UnitVisual {
    const group = new THREE.Group();
    // Two materials: the realistic body (vertex-coloured — steel/tan/skin/dark) and
    // the faction-coloured tabard that tells the armies apart. The soldier geometry
    // is grouped so material 0 paints the body and material 1 the tabard.
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 });
    const factionMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(factionColor(u.factionId)), roughness: 0.6 });
    const mats = [bodyMat, factionMat];
    const soldiers = new THREE.InstancedMesh(soldierGeometryFor(u.troopType), mats, MAX_SOLDIERS);
    soldiers.castShadow = true;
    const offs = formationOffsets(MAX_SOLDIERS);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const pos = new THREE.Vector3();
    for (let i = 0; i < MAX_SOLDIERS; i++) {
      q.setFromAxisAngle(UP, (i * 2.399963) % (Math.PI * 2));
      scl.set(1, 0.9 + (0.25 * ((i * 7) % 5)) / 4, 1);
      pos.set(offs[i]!.x, 0, offs[i]!.z);
      m.compose(pos, q, scl);
      soldiers.setMatrixAt(i, m);
    }
    soldiers.instanceMatrix.needsUpdate = true;
    soldiers.count = soldierCount(u.troops);
    group.add(soldiers);
    group.scale.setScalar(1.3);

    let banner: THREE.Mesh | undefined;
    let flag: THREE.Mesh | undefined;
    let flagBase: Float32Array | undefined;
    if (u.generalId) {
      const b = this.buildBanner(u.factionId);
      group.add(b.pole);
      banner = b.pole;
      flag = b.flag;
      flagBase = b.base;
    }
    return {
      group, soldiers, mats, banner, flag, flagBase, generalId: u.generalId,
      factionId: u.factionId, offsets: offs, heading: 0, moving: 0,
      basePos: new THREE.Vector3(), target: new THREE.Vector3(), placed: false, shakeUntil: 0, engagedUntil: 0,
    };
  }

  // Nearest opposing unit (for a stationary block to square up against).
  private nearestEnemy(v: UnitVisual): UnitVisual | null {
    let best: UnitVisual | null = null;
    let bd = Infinity;
    for (const o of this.units.values()) {
      if (o === v || o.factionId === v.factionId) continue;
      const d = o.basePos.distanceToSquared(v.basePos);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // A pole flying a faction cloth flag: the flag is a subdivided plane textured
  // with the faction colour + surname glyph (曹/劉/孫…), anchored at the pole and
  // waved per-frame in the loop. Returns the base vertex positions for the wave.
  private buildBanner(factionId: string): { pole: THREE.Mesh; flag: THREE.Mesh; base: Float32Array } {
    // A tall tapered staff standing from the ground, crowned by a gilt spearhead,
    // flying the faction banner near its top.
    const poleH = 3.6;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.06, poleH, 6),
      new THREE.MeshStandardMaterial({ color: 0x2b2016, roughness: 0.85 }),
    );
    pole.position.set(0, poleH / 2, -0.55); // base at the ground, standing tall above the ranks
    pole.castShadow = true;
    const finial = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.28, 6),
      new THREE.MeshStandardMaterial({ color: 0xcaa64f, roughness: 0.35, metalness: 0.4 }),
    );
    finial.position.set(0, poleH / 2 + 0.14, 0); // pole-local, crowning the top
    pole.add(finial);
    const FLAG_H = 0.66;
    const geo = new THREE.PlaneGeometry(FLAG_W, FLAG_H, 18, 9);
    geo.translate(FLAG_W / 2, 0, 0); // anchor the pole edge at local x = 0
    const flag = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: flagTexture(factionColor(factionId), FACTION_GLYPH[factionId] ?? '·'), side: THREE.DoubleSide, roughness: 0.82 }),
    );
    // Pole-local. Fly the flag at 60% of the pole height so it sits clear of the
    // unit's floating name label (which hovers near the pole top) instead of
    // overlapping it, while still riding above the soldiers' heads.
    flag.position.set(0.01, poleH * 0.6 - poleH / 2, 0);
    flag.castShadow = true;
    pole.add(flag);
    return { pole, flag, base: (geo.attributes.position!.array as Float32Array).slice() };
  }

  // Deterministically pick a time-of-day look for this battle and push it into
  // the sky/fog/sun/ambient (a lightweight version of a scene environment).
  private applyEnv(seed: number): void {
    const keys = Object.keys(ENV_PRESETS) as (keyof typeof ENV_PRESETS)[];
    const env = ENV_PRESETS[keys[Math.abs(seed) % keys.length]!]!;
    (this.skyMat.uniforms.top!.value as THREE.Color).setHex(env.skyTop);
    (this.skyMat.uniforms.horizon!.value as THREE.Color).setHex(env.skyHz);
    (this.scene.background as THREE.Color).setHex(env.skyTop);
    (this.scene.fog as THREE.FogExp2).color.setHex(env.fog);
    this.sun.color.setHex(env.sun);
    this.sun.intensity = env.sunI;
    this.hemi.color.setHex(env.hemiSky);
    this.hemi.intensity = env.hemiI;
    this.ambient.intensity = env.amb;
  }

  // Track the battle's focus; the director in the loop eases the camera toward
  // it so the shot follows the armies as they advance.
  frameBattle(session: BattleSession): void {
    const c = battleCentroidXZ(session.battle.units, session.battle.field);
    const size = fieldWorldSize(session.battle.field);
    this.focusC.set(c.x, 1.5, c.z);
    this.focusSpan = Math.max(size.w, size.h);
  }

  // Turn a resolved day's events into combat FX.
  playEvents(events: BattleEvent[]): void {
    for (const e of events) {
      switch (e.kind) {
        case 'fire': {
          this.spawnFire(e.at);
          if (this.field) {
            const w = cellWorldXZ(e.at.x, e.at.y, this.field);
            this.cutTo(new THREE.Vector3(w.x, terrainHeight(e.at.x, e.at.y, this.field), w.z), 'hero');
            this.cameraShake(0.3);
          }
          break;
        }
        case 'flood': {
          this.spawnFlood(e.from, e.cells);
          if (this.field) {
            const w = cellWorldXZ(e.from.x, e.from.y, this.field);
            this.cutTo(new THREE.Vector3(w.x, terrainHeight(e.from.x, e.from.y, this.field), w.z), 'action');
          }
          break;
        }
        case 'volley': {
          const a = this.units.get(e.unitId);
          const b = this.units.get(e.targetUnitId);
          if (a && b) this.spawnVolley(a.group.position, b.group.position);
          break;
        }
        case 'clash': {
          const a = this.units.get(e.unitId);
          const b = this.units.get(e.targetUnitId);
          if (a && b) {
            const mid = a.group.position.clone().lerp(b.group.position, 0.5);
            mid.y += 0.7;
            this.spawnSparks(mid, 0xffd070, 22);
            a.shakeUntil = nowMs() + 260;
            b.shakeUntil = nowMs() + 260;
            this.cutTo(mid, 'hero'); // low, close on the melee
            this.cameraShake(0.35);
          }
          break;
        }
        case 'charge': {
          const a = this.units.get(e.unitId);
          if (a) { this.spawnDust(a.group.position); this.cutTo(a.group.position, 'action'); }
          break;
        }
        case 'moraleBreak':
        case 'rout': {
          const a = this.units.get(e.unitId);
          if (a) { this.spawnDust(a.group.position); this.cutTo(a.group.position, 'rout'); this.cameraShake(0.2); }
          break;
        }
        case 'duel': {
          this.spawnDuel(e.a, e.b);
          const va = this.findByGeneral(e.a);
          if (va) { this.cutTo(va.group.position, 'hero'); this.cameraShake(0.25); }
          break;
        }
        default:
          break;
      }
    }
  }

  private findByGeneral(gid: GeneralId): UnitVisual | undefined {
    for (const v of this.units.values()) if (v.generalId === gid) return v;
    return undefined;
  }

  private spawnDuel(a: GeneralId, b: GeneralId): void {
    const va = this.findByGeneral(a);
    const vb = this.findByGeneral(b);
    const pos = va && vb ? va.group.position.clone().lerp(vb.group.position, 0.5) : this.focusC.clone();
    pos.y += 0.9;
    this.spawnSparks(pos, 0xffffff, 30);
  }

  private spawnEffect(obj: THREE.Object3D, life: number, update: Effect['update']): void {
    obj.frustumCulled = false;
    this.scene.add(obj);
    this.effects.push({ obj, born: nowMs(), life, update });
  }

  private spawnSparks(pos: THREE.Vector3, color: number, count: number): void {
    const P = makeParticles(count, color, 0.17, true);
    for (let i = 0; i < count; i++) {
      P.pos[i * 3] = pos.x; P.pos[i * 3 + 1] = pos.y; P.pos[i * 3 + 2] = pos.z;
      const ang = fxRand() * Math.PI * 2;
      const sp = 1.5 + fxRand() * 3;
      P.vel[i * 3] = Math.cos(ang) * sp;
      P.vel[i * 3 + 1] = 1.8 + fxRand() * 3;
      P.vel[i * 3 + 2] = Math.sin(ang) * sp;
    }
    this.spawnEffect(P.points, 520, (age, dt) => {
      advanceParticles(P, dt / 1000, 10);
      (P.points.material as THREE.PointsMaterial).opacity = 1 - age;
    });
  }

  private spawnDust(pos: THREE.Vector3): void {
    const N = 26;
    const P = makeParticles(N, 0x9a8a6a, 0.4, false);
    for (let i = 0; i < N; i++) {
      P.pos[i * 3] = pos.x + (fxRand() - 0.5); P.pos[i * 3 + 1] = pos.y + 0.1; P.pos[i * 3 + 2] = pos.z + (fxRand() - 0.5);
      const ang = fxRand() * Math.PI * 2;
      const sp = 0.4 + fxRand() * 1.1;
      P.vel[i * 3] = Math.cos(ang) * sp;
      P.vel[i * 3 + 1] = 0.6 + fxRand() * 1;
      P.vel[i * 3 + 2] = Math.sin(ang) * sp;
    }
    this.spawnEffect(P.points, 950, (age, dt) => {
      advanceParticles(P, dt / 1000, 1.2);
      const mat = P.points.material as THREE.PointsMaterial;
      mat.size = 0.4 + age * 0.5;
      mat.opacity = 0.6 * (1 - age);
    });
  }

  private spawnVolley(from: THREE.Vector3, to: THREE.Vector3): void {
    const N = 16;
    const inst = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.55, 4),
      new THREE.MeshBasicMaterial({ color: 0x2a2018 }),
      N,
    );
    inst.castShadow = false;
    const starts: THREE.Vector3[] = [];
    const ends: THREE.Vector3[] = [];
    const delays: number[] = [];
    for (let i = 0; i < N; i++) {
      starts.push(from.clone().add(new THREE.Vector3((fxRand() - 0.5) * 1.4, 0.6, (fxRand() - 0.5) * 1.4)));
      ends.push(to.clone().add(new THREE.Vector3((fxRand() - 0.5) * 1.8, 0, (fxRand() - 0.5) * 1.8)));
      delays.push(fxRand() * 0.28);
    }
    const flight = 0.62;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const zero = new THREE.Vector3(0, 0, 0);
    const p = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const dir = new THREE.Vector3();
    this.spawnEffect(inst, 780, (age) => {
      for (let i = 0; i < N; i++) {
        const lt = (age - delays[i]!) / flight;
        if (lt < 0 || lt > 1) {
          m.compose(zero, q, zero); // not yet launched / already landed
          inst.setMatrixAt(i, m);
          continue;
        }
        arcPoint(starts[i]!, ends[i]!, lt, p);
        arcPoint(starts[i]!, ends[i]!, Math.min(1, lt + 0.03), p2);
        dir.subVectors(p2, p);
        if (dir.lengthSq() > 1e-8) {
          dir.normalize();
          q.setFromUnitVectors(UP, dir); // keep the last orientation if degenerate
        }
        m.compose(p, q, one);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
    });
  }

  private spawnFire(at: Vec2): void {
    if (!this.field) return;
    const { x, z } = cellWorldXZ(at.x, at.y, this.field);
    const y = terrainHeight(at.x, at.y, this.field);
    const group = new THREE.Group();
    group.position.set(x, y, z);

    // Dark scorch decal on the ground that fades in fast and lingers under the smoke.
    const scorch = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 20),
      new THREE.MeshBasicMaterial({ color: 0x140f0a, transparent: true, opacity: 0, depthWrite: false }),
    );
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.y = 0.03;
    group.add(scorch);

    // Two-layer flame: a broad orange body wrapping a small white-hot inner core,
    // so the fire reads with a temperature gradient rather than one flat blob.
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff7a1c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    core.position.y = 0.7;
    group.add(core);
    const inner = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe8a6, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    inner.position.y = 0.6;
    group.add(inner);

    const E = 48;
    const em = makeParticles(E, 0xffb050, 0.3, true);
    for (let i = 0; i < E; i++) {
      em.pos[i * 3] = (fxRand() - 0.5); em.pos[i * 3 + 1] = fxRand() * 0.6; em.pos[i * 3 + 2] = (fxRand() - 0.5);
      em.vel[i * 3] = (fxRand() - 0.5) * 0.9; em.vel[i * 3 + 1] = 1.8 + fxRand() * 2.6; em.vel[i * 3 + 2] = (fxRand() - 0.5) * 0.9;
    }
    group.add(em.points);

    const S = 52;
    // Warm medium-grey so the plume reads against both a dark sky and pale ground.
    const sm = makeParticles(S, 0x847f78, 0.5, false);
    for (let i = 0; i < S; i++) {
      sm.pos[i * 3] = (fxRand() - 0.5) * 0.8; sm.pos[i * 3 + 1] = 0.8 + fxRand(); sm.pos[i * 3 + 2] = (fxRand() - 0.5) * 0.8;
      sm.vel[i * 3] = (fxRand() - 0.5) * 0.5; sm.vel[i * 3 + 1] = 0.9 + fxRand(); sm.vel[i * 3 + 2] = (fxRand() - 0.5) * 0.5;
    }
    group.add(sm.points);

    const light = this.fireLights.find((l) => l.intensity < 0.1);
    if (light) {
      light.position.set(group.position.x, group.position.y + 1, group.position.z);
      light.intensity = 7; // claim it now so a second fire this frame grabs another
    }

    // Prevailing wind the rising smoke leans into (world units/s of sideways accel).
    const WIND_X = 0.9;
    const WIND_Z = 0.35;
    // The whole effect outlives the flames: the plume keeps rising, spreading and
    // thinning for the full 4.2s while the flame body burns out over the first ~55%.
    this.spawnEffect(group, 4200, (age, dt, t) => {
      const de = dt / 1000;
      const flame = Math.min(1, age / 0.55); // flame body + pooled light live in the first 55%
      const flick = 0.7 + 0.3 * Math.sin(t / 40);
      const flick2 = 0.62 + 0.38 * Math.sin(t / 27 + 1.3);
      (core.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - flame) * flick;
      core.scale.setScalar((1 + flame) * flick);
      (inner.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - flame) * flick2;
      inner.scale.setScalar((0.9 + flame * 0.6) * flick2);
      if (light) light.intensity = 7 * (1 - flame) * flick; // hits 0 at 55% → auto-freed

      advanceParticles(em, de, 0.5); // gentle gravity so embers rise then arc back
      const emMat = em.points.material as THREE.PointsMaterial;
      emMat.opacity = 1 - flame;
      emMat.size = 0.3 * (1 - flame * 0.5);

      advanceParticles(sm, de, 0);
      for (let i = 0; i < sm.vel.length; i += 3) {
        sm.vel[i] = sm.vel[i]! + WIND_X * de; // lean the plume downwind as it rises
        sm.vel[i + 2] = sm.vel[i + 2]! + WIND_Z * de;
      }
      const smMat = sm.points.material as THREE.PointsMaterial;
      smMat.size = 0.55 + age * 2.2; // billow outward as it climbs
      smMat.opacity = 0.62 * (1 - age) * (1 - age * 0.35); // dense mid-rise, thins at the top

      (scorch.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.min(1, age * 6) * (1 - age * 0.4);
    });
  }

  // River-breach flood: a sheet of animated water that sweeps outward from the
  // breach cell across the flooded cells (a foam-crested wave front), holds, then
  // recedes. Built as one merged quad-per-cell mesh; each vertex carries its
  // distance from the breach so the shader reveals cells as the front reaches them.
  private spawnFlood(from: Vec2, cells: Vec2[]): void {
    if (!this.field || cells.length === 0) return;
    const field = this.field;
    const fromW = cellWorldXZ(from.x, from.y, field);
    // Pool the water clearly above the highest flooded cell. terrainHeight() is the
    // base cell elevation; the rendered mesh adds up to ~0.3 of fbm micro-relief on
    // top, so the sheet must clear that or it drowns in the terrain bumps.
    let maxTerrain = -Infinity;
    for (const c of cells) maxTerrain = Math.max(maxTerrain, terrainHeight(c.x, c.y, field));
    const level = maxTerrain + 0.6;
    const half = CELL_SIZE / 2;
    const positions: number[] = [];
    const dists: number[] = [];
    const indices: number[] = [];
    let vi = 0;
    let maxDist = 0.0001;
    for (const c of cells) {
      const w = cellWorldXZ(c.x, c.y, field);
      const corners = [[-half, -half], [half, -half], [half, half], [-half, half]];
      for (const [ox, oz] of corners) {
        const x = w.x + ox!;
        const z = w.z + oz!;
        positions.push(x, level, z);
        const d = Math.hypot(x - fromW.x, z - fromW.z);
        dists.push(d);
        if (d > maxDist) maxDist = d;
      }
      indices.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
      vi += 4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aDist', new THREE.Float32BufferAttribute(dists, 1));
    geo.setIndex(indices);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uT: { value: 0 }, uFront: { value: 0 }, uFade: { value: 1 }, uCol: { value: new THREE.Color(0x2a5568) } },
      vertexShader:
        'uniform float uT; attribute float aDist; varying float vD; varying vec3 vW; varying float vR;' +
        'void main(){ vec3 p = position;' +
        ' float r = sin(p.x*0.5 + uT*2.2)*0.06 + sin(p.z*0.6 - uT*1.7)*0.05;' +
        ' p.y += r; vR = r; vD = aDist; vec4 wp = modelMatrix*vec4(p,1.0); vW = wp.xyz;' +
        ' gl_Position = projectionMatrix * viewMatrix * wp; }',
      fragmentShader:
        'uniform float uT; uniform float uFront; uniform float uFade; uniform vec3 uCol;' +
        'varying float vD; varying vec3 vW; varying float vR;' +
        'void main(){ float rev = smoothstep(uFront, uFront - 1.5, vD);' + // 1 where the front has passed
        ' if (rev <= 0.001) discard;' +
        ' float foam = smoothstep(1.8, 0.0, abs(vD - uFront));' + // bright crest at the advancing edge
        ' float sh = 0.5 + 0.5*sin(vR*22.0 + uT*3.0);' +
        ' float spk = smoothstep(0.85, 1.0, sin(vW.x*0.4 + uT*2.0)*sin(vW.z*0.5 - uT*1.7));' +
        ' vec3 col = uCol + vec3(0.08,0.14,0.18)*sh + vec3(0.4)*spk + vec3(0.5)*foam;' +
        ' gl_FragColor = vec4(col, (0.82*rev + 0.55*foam) * uFade); }',
    });
    const mesh = new THREE.Mesh(geo, mat);
    const reach = maxDist + 2;
    this.spawnEffect(mesh, 5200, (age, _dt, t) => {
      mat.uniforms.uT!.value = t / 1000;
      mat.uniforms.uFront!.value = Math.min(1, age / 0.3) * reach; // sweep out over the first ~30%
      mat.uniforms.uFade!.value = age > 0.75 ? Math.max(0, 1 - (age - 0.75) / 0.25) : 1; // recede at the end
    });

    // A splash of spray leaping up at the breach as the bank gives way.
    const N = 46;
    const sp = makeParticles(N, 0xcfe6ef, 0.22, true);
    for (let i = 0; i < N; i++) {
      sp.pos[i * 3] = fromW.x + (fxRand() - 0.5) * 1.2;
      sp.pos[i * 3 + 1] = level + fxRand() * 0.4;
      sp.pos[i * 3 + 2] = fromW.z + (fxRand() - 0.5) * 1.2;
      const ang = fxRand() * Math.PI * 2;
      const spd = 1.5 + fxRand() * 3.5;
      sp.vel[i * 3] = Math.cos(ang) * spd;
      sp.vel[i * 3 + 1] = 2.5 + fxRand() * 3;
      sp.vel[i * 3 + 2] = Math.sin(ang) * spd;
    }
    this.spawnEffect(sp.points, 1100, (age, dt) => {
      advanceParticles(sp, dt / 1000, 9);
      (sp.points.material as THREE.PointsMaterial).opacity = 1 - age;
    });
  }

  // Reactive shot director: frame where the action is (a fresh clash/fire/rout),
  // cut to a new angle on each beat, push low + close on combat, pull back on a
  // rout, and shake on impact — instead of one unbroken take on the empty middle.
  private updateCamera(t: number, dt: number): void {
    this.introT = Math.min(1, this.introT + dt / 3500);
    const e = easeInOut(this.introT);
    // Frame the hot point while the action is fresh, otherwise the army centroid.
    const hot = t < this.hotUntil;
    this.camFocus.lerp(hot ? this.hotPoint : this.focusC, 0.045);
    if (!hot && this.shotKind === 'hero') this.shotKind = 'action'; // ease back out after the beat

    const span = this.focusSpan;
    let radius: number;
    let elev: number;
    let az: number;
    switch (this.shotKind) {
      case 'hero': radius = span * 0.62; elev = 0.17; az = this.shotAz; break; // low, close on the clash
      case 'action': radius = span * 1.0; elev = 0.4; az = this.shotAz + Math.sin(t * 0.00007) * 0.12; break;
      case 'rout': radius = span * 1.55; elev = 0.66; az = this.shotAz; break;
      default: radius = span * 1.7; elev = 0.5; az = -1.05 + t * 0.00003; break; // establish
    }
    radius = lerp(span * 2.0, radius, e); // intro: start high & wide, ease into the shot
    elev = lerp(0.28, elev, e);

    const ce = Math.cos(elev);
    TMP.set(
      this.camFocus.x + radius * ce * Math.sin(az),
      this.camFocus.y + radius * Math.sin(elev),
      this.camFocus.z + radius * ce * Math.cos(az),
    );
    const sinceCut = (t - this.shotBorn) / 1000;
    this.camera.position.lerp(TMP, sinceCut < 0.28 ? 0.3 : 0.05); // snap in on a cut, then settle
    if (this.shakeAmp > 0.02) {
      this.camera.position.x += (fxRand() - 0.5) * this.shakeAmp;
      this.camera.position.y += (fxRand() - 0.5) * this.shakeAmp * 0.6;
      this.shakeAmp *= 0.9;
    }
    this.controls.target.lerp(this.camFocus, 0.08);
    this.camera.lookAt(this.controls.target);
  }

  // Cut to frame a point where the action is, from a fresh dramatic angle.
  private cutTo(p: THREE.Vector3, kind: 'action' | 'hero' | 'rout'): void {
    const t = nowMs();
    this.hotPoint.set(p.x, p.y + 0.5, p.z);
    this.hotUntil = t + 3200;
    if (t < this.cutUntil) return; // don't cut again too soon
    this.shotKind = kind;
    this.shotBorn = t;
    this.shotSeq++;
    this.shotAz = CUT_AZIMUTHS[this.shotSeq % CUT_AZIMUTHS.length]!;
    this.cutUntil = t + 2600;
  }

  private cameraShake(a: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, a);
  }

  // Continuous melee: any two opposing blocks that have closed to melee range are
  // marked engaged (drives the soldiers' combat lunge + a jostle) and throw off a
  // steady stream of sparks at their contact line — so a battle in contact looks
  // like ongoing fighting between the discrete day-steps, not two static clusters.
  private updateMelee(t: number): void {
    const arr = [...this.units.values()];
    const spark = t > this.meleeSparkT;
    let bursts = 0;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i]!;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j]!;
        if (a.factionId === b.factionId) continue;
        if (a.basePos.distanceTo(b.basePos) > MELEE_DIST) continue;
        a.engagedUntil = t + 250;
        b.engagedUntil = t + 250;
        a.shakeUntil = Math.max(a.shakeUntil, t + 200);
        b.shakeUntil = Math.max(b.shakeUntil, t + 200);
        if (spark && bursts < 3) {
          const mid = a.basePos.clone().lerp(b.basePos, 0.5);
          mid.y += 0.7;
          this.spawnSparks(mid, 0xffd070, 6);
          bursts++;
        }
      }
    }
    if (spark) this.meleeSparkT = t + 150;
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const t = nowMs();
    const dt = this.lastT ? Math.min(60, t - this.lastT) : 16;
    this.lastT = t;
    if (this.waterMat) this.waterMat.uniforms.uT!.value = t / 1000;

    for (const v of this.units.values()) {
      const px = v.basePos.x;
      const pz = v.basePos.z;
      v.basePos.lerp(v.target, 0.12);
      v.group.position.copy(v.basePos);
      const dx = v.basePos.x - px;
      const dz = v.basePos.z - pz;
      const step = Math.hypot(dx, dz);
      // Ease the block to face where it is going; when stationary, face the enemy —
      // so armies march and square up instead of sliding sideways like furniture.
      let aim = v.heading;
      if (step > 0.008) {
        aim = Math.atan2(dx, dz);
        v.moving = Math.min(1, v.moving + 0.15);
      } else {
        v.moving = Math.max(0, v.moving - 0.05);
        const foe = this.nearestEnemy(v);
        if (foe) aim = Math.atan2(foe.basePos.x - v.basePos.x, foe.basePos.z - v.basePos.z);
      }
      v.heading += Math.atan2(Math.sin(aim - v.heading), Math.cos(aim - v.heading)) * 0.08;
      v.group.rotation.y = v.heading;
      animateSoldiers(v, t, t < v.engagedUntil);
      // Jostle only the soldier block in melee — offset the InstancedMesh, not the
      // whole group, so the banner and labels stay planted while the ranks reel.
      if (t < v.shakeUntil) {
        const k = (v.shakeUntil - t) / 260;
        v.soldiers.position.set(Math.sin(t * 0.09) * 0.32 * k, 0, Math.cos(t * 0.11) * 0.2 * k);
      } else if (v.soldiers.position.x !== 0 || v.soldiers.position.z !== 0) {
        v.soldiers.position.set(0, 0, 0);
      }
      if (v.flag && v.flagBase) wave(v.flag, v.flagBase, t, v.basePos.x);
    }
    this.updateMelee(t);

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i]!;
      const age = (t - fx.born) / fx.life;
      if (age >= 1) {
        this.scene.remove(fx.obj);
        disposeObject(fx.obj);
        this.effects.splice(i, 1);
      } else {
        fx.update(age, dt, t);
      }
    }

    if (t < this.autoPausedUntil) {
      this.controls.update();
    } else {
      this.updateCamera(t, dt);
    }
    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && !isSharedSoldierGeo(mesh.geometry)) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(disposeMaterial);
      else if (mat) disposeMaterial(mat as THREE.Material);
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    this.renderer.dispose();
    this.composer.dispose();
    this.labelRenderer.domElement.remove();
  }
}

function buildTerrainBufferGeometry(field: BattleField): THREE.BufferGeometry {
  const geo = buildTerrainGeometry(field);
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(geo.positions, 3));
  bg.setAttribute('color', new THREE.Float32BufferAttribute(geo.colors, 3));
  bg.setIndex(geo.indices);
  bg.computeVertexNormals();
  return bg;
}

interface Particles {
  points: THREE.Points;
  pos: Float32Array;
  vel: Float32Array;
}
function makeParticles(count: number, color: number, size: number, additive: boolean): Particles {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const material = new THREE.PointsMaterial({
    color, size, transparent: true, opacity: 1, depthWrite: false, sizeAttenuation: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  return { points: new THREE.Points(g, material), pos, vel };
}

// Advance a particle system one step: integrate velocity (with gravity) into
// position and flag the buffer for upload.
function advanceParticles(p: Particles, de: number, gravity: number): void {
  const n = p.pos.length;
  for (let i = 0; i < n; i += 3) {
    p.vel[i + 1] = p.vel[i + 1]! - gravity * de;
    p.pos[i] = p.pos[i]! + p.vel[i]! * de;
    p.pos[i + 1] = p.pos[i + 1]! + p.vel[i + 1]! * de;
    p.pos[i + 2] = p.pos[i + 2]! + p.vel[i + 2]! * de;
  }
  p.points.geometry.attributes.position!.needsUpdate = true;
}

function arcPoint(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): void {
  out.lerpVectors(a, b, t);
  out.y += a.distanceTo(b) * 0.16 * Math.sin(Math.PI * t);
}

function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (mesh.geometry && !isSharedSoldierGeo(mesh.geometry)) mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach(disposeMaterial);
    else if (mat) disposeMaterial(mat as THREE.Material);
    // InstancedMesh holds a separate instanceMatrix GPU buffer not covered by
    // geometry.dispose() — free it too (e.g. spawned arrow volleys).
    if ((c as THREE.InstancedMesh).isInstancedMesh) (c as THREE.InstancedMesh).dispose();
  });
}
// Dispose a material and any texture it owns (e.g. a flag's CanvasTexture, which
// material.dispose() does NOT free on its own).
function disposeMaterial(m: THREE.Material): void {
  const map = (m as THREE.MeshStandardMaterial).map;
  if (map) map.dispose();
  m.dispose();
}

// ---- Faction cloth flags ----
// Draw the faction colour + surname glyph onto a canvas for the flag texture.
// A war banner drawn on a canvas: a diagonal faction gradient (bright -> dark),
// a cream-and-black double border, a corner boss at each corner, and the lord's
// surname glyph in a heavy serif with a drop shadow — then redrawn once the serif
// font has loaded so the character is crisp, not a fallback. (Technique from the
// MIT battlefield-editor; original implementation.)
function flagTexture(color: string, glyph: string): THREE.CanvasTexture {
  const W = 256;
  const H = 168;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const dark = new THREE.Color(color).multiplyScalar(0.42).getStyle();
  const light = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.18).getStyle();
  const draw = (): void => {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, light);
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, dark);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // faint cloth sheen
    const sheen = ctx.createLinearGradient(0, 0, W, 0);
    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,.10)');
    sheen.addColorStop(1, 'rgba(0,0,0,.10)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, W, H);
    // cream + black double border
    ctx.strokeStyle = 'rgba(233,220,193,.92)';
    ctx.lineWidth = 11;
    ctx.strokeRect(9, 9, W - 18, H - 18);
    ctx.strokeStyle = 'rgba(0,0,0,.28)';
    ctx.lineWidth = 3;
    ctx.strokeRect(19, 19, W - 38, H - 38);
    // gilt corner bosses
    ctx.fillStyle = 'rgba(201,163,92,.9)';
    for (const [bx, by] of [[16, 16], [W - 16, 16], [16, H - 16], [W - 16, H - 16]] as const) {
      ctx.beginPath();
      ctx.arc(bx, by, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    // surname glyph with a soft drop shadow
    ctx.font = `900 ${Math.round(H * 0.62)}px "Noto Serif TC", "Noto Serif SC", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = '#f4ecd6';
    ctx.fillText(glyph, W / 2, H * 0.55);
    ctx.shadowColor = 'transparent';
    tex.needsUpdate = true;
  };
  draw();
  // redraw once the serif font loads so the glyph isn't a system fallback
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready.then(draw).catch(() => {});
  }
  return tex;
}
// Per-figure life: rewrite the soldier instance matrices each frame with a gentle
// idle sway that grows into a march bounce while the unit is moving — so a block
// reads as living troops rather than a frozen cluster of statues. Cheap: only the
// visible `count` instances, reusing shared temps.
const _sm = new THREE.Matrix4();
const _sq = new THREE.Quaternion();
const _sp = new THREE.Vector3();
const _ss = new THREE.Vector3();
function animateSoldiers(v: UnitVisual, t: number, engaged: boolean): void {
  const n = v.soldiers.count;
  const off = v.offsets;
  const march = v.moving;
  for (let i = 0; i < n; i++) {
    const o = off[i]!;
    const phase = i * 1.7;
    const bob = Math.abs(Math.sin(t * 0.006 + phase)) * (0.03 + march * 0.11);
    const sway = Math.sin(t * 0.004 + phase * 1.3) * 0.02;
    // When locked in melee, each figure lunges fast along the block's forward
    // axis (toward the enemy) — reads as men hacking at each other, not standing.
    let lungeZ = 0;
    let lungeY = 0;
    if (engaged) {
      const lunge = Math.sin(t * 0.019 + phase * 2.3);
      lungeZ = lunge * 0.14;
      lungeY = Math.abs(lunge) * 0.06;
    }
    _sp.set(o.x + sway * 0.4, bob + lungeY, o.z + lungeZ);
    // Mostly face the block's front (the group is turned toward the enemy) with a
    // little per-figure jitter — reads as disciplined ranks, not a milling crowd.
    _sq.setFromAxisAngle(UP, Math.sin(i * 12.9898) * 0.32 + sway);
    _ss.set(1, 0.9 + (0.25 * ((i * 7) % 5)) / 4, 1);
    _sm.compose(_sp, _sq, _ss);
    v.soldiers.setMatrixAt(i, _sm);
  }
  v.soldiers.instanceMatrix.needsUpdate = true;
}

// Wave a flag's cloth: displacement grows with distance from the pole (local x),
// so the flag ripples out from a fixed edge. Reads rest positions from `base`.
function wave(flag: THREE.Mesh, base: Float32Array, t: number, phase: number): void {
  const pos = flag.geometry.attributes.position!;
  const arr = pos.array as Float32Array;
  for (let i = 0; i < arr.length; i += 3) {
    const bx = base[i]!;
    const k = bx / FLAG_W; // 0 at pole, 1 at the free edge
    const w = Math.sin(bx * 11 - t * 0.006 + phase) * 0.1 * k;
    arr[i] = bx;
    arr[i + 1] = base[i + 1]! + w * 0.35;
    arr[i + 2] = base[i + 2]! + w;
  }
  pos.needsUpdate = true;
}

// ---- Floating CSS2D labels ----
function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}
function makeLabelEl(kind: 'unit' | 'landmark'): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText =
    kind === 'landmark'
      ? 'padding:3px 11px;border-radius:5px;white-space:nowrap;pointer-events:none;' +
        "font:700 13px/1.3 'Noto Serif TC',serif;letter-spacing:2px;color:#f1e4c6;" +
        'background:rgba(10,13,18,.6);border:1px solid rgba(201,163,92,.5);text-shadow:0 1px 4px #000'
      : 'padding:2px 7px;border-radius:5px;white-space:nowrap;pointer-events:none;' +
        "font:600 11px/1.25 'Noto Sans TC',system-ui,sans-serif;color:#e8dcc3;" +
        'background:rgba(10,13,18,.66);border:1px solid rgba(201,163,92,.28);text-shadow:0 1px 3px #000';
  return el;
}
function unitLabelHtml(info: { title: string; sub: string; color: string }): string {
  const dot = `<span style="color:${info.color}">●</span>`;
  const name = info.title ? `<b>${escapeText(info.title)}</b> ` : '';
  return `${dot} ${name}<span style="opacity:.68;font-weight:400">${escapeText(info.sub)}</span>`;
}

// ---- Environment scatter/shape noise (deterministic, seeded) ----
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
function envFbm(x: number, y: number, seed: number): number {
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
function sstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
// Rolling hills the battlefield sits in: near-flat over the clearing, swelling
// into hills then mountains toward the horizon.
function surroundHeight(x: number, z: number, clearing: number, seed: number): number {
  const r = Math.hypot(x, z);
  const rise = sstep(clearing, clearing + 130, r);
  const hills = (envFbm(x * 0.013, z * 0.013, seed) - 0.5) * 20 * rise;
  const swell = rise * rise * 26;
  return -0.4 + swell + hills;
}
// Height -> natural ground color for the surrounding terrain (dry grass -> green
// -> rock -> pale peak).
function groundRamp(h: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [-1, [0.44, 0.44, 0.3]],
    [3, [0.34, 0.42, 0.26]],
    [12, [0.32, 0.36, 0.24]],
    [26, [0.4, 0.38, 0.34]],
    [48, [0.5, 0.5, 0.52]],
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

// Local deterministic RNG for FX spread only (visual variety; not sim state).
let fxSeed = 0x9e3779b9;
function fxRand(): number {
  fxSeed = (fxSeed + 0x6d2b79f5) | 0;
  let t = Math.imul(fxSeed ^ (fxSeed >>> 15), 1 | fxSeed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const TMP = new THREE.Vector3();
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}
