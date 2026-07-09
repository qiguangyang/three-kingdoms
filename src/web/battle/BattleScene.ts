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
import type { BattleSession } from '../../state/battleSession.js';
import type { BattleEvent, BattleField, GeneralId, Vec2 } from '../../engine/battle/types.js';
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
const FLAG_W = 0.5;

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
function buildSoldier(kind: string): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.05, 0.1, 0.34, 6);
  body.translate(0, 0.17, 0);
  const head = new THREE.SphereGeometry(0.075, 8, 6);
  head.translate(0, 0.42, 0);
  if (kind === 'archer') {
    const bow = new THREE.TorusGeometry(0.12, 0.014, 5, 10, Math.PI * 1.25);
    bow.rotateY(Math.PI / 2);
    bow.translate(0.12, 0.34, 0);
    return mergeGeometries([body, head, bow], false);
  }
  if (kind === 'cavalry') {
    const horse = new THREE.BoxGeometry(0.5, 0.2, 0.16);
    horse.translate(0, 0.3, 0);
    const neck = new THREE.BoxGeometry(0.12, 0.24, 0.12);
    neck.translate(0.25, 0.46, 0);
    const rider = new THREE.CylinderGeometry(0.05, 0.08, 0.26, 6);
    rider.translate(-0.05, 0.56, 0);
    const rhead = new THREE.SphereGeometry(0.07, 8, 6);
    rhead.translate(-0.05, 0.76, 0);
    return mergeGeometries([horse, neck, rider, rhead], false);
  }
  if (kind === 'navy') {
    const hull = new THREE.BoxGeometry(0.52, 0.1, 0.2);
    hull.translate(0, 0.08, 0);
    const prow = new THREE.BoxGeometry(0.14, 0.16, 0.14);
    prow.translate(0.29, 0.14, 0);
    const mast = new THREE.CylinderGeometry(0.012, 0.012, 0.52, 4);
    mast.translate(0, 0.34, 0);
    return mergeGeometries([hull, prow, mast], false);
  }
  // infantry (default): spearman
  const spear = new THREE.CylinderGeometry(0.012, 0.012, 0.6, 4);
  spear.translate(0.1, 0.34, 0);
  return mergeGeometries([body, head, spear], false);
}

interface UnitVisual {
  group: THREE.Group;
  soldiers: THREE.InstancedMesh;
  material: THREE.MeshStandardMaterial;
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
  private readonly focusC = new THREE.Vector3(0, 1.5, 0);
  private focusSpan = 40;
  private introT = 0;
  private pullbackUntil = 0;
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

    if (field.wall) {
      const gate = field.wall.gate;
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x7a6a50, roughness: 0.95 });
      const gateMat = new THREE.MeshStandardMaterial({ color: 0x4a3722, roughness: 0.9 });
      for (const c of field.wall.cells) {
        const isGate = c.x === gate.x && c.y === gate.y;
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(CELL_SIZE * 1.02, isGate ? 1.4 : 3.0, CELL_SIZE * 1.4),
          isGate ? gateMat : wallMat,
        );
        const { x, z } = cellWorldXZ(c.x, c.y, field);
        box.position.set(x, terrainHeight(c.x, c.y, field) + (isGate ? 0.7 : 1.5), z);
        box.castShadow = true;
        box.receiveShadow = true;
        this.scene.add(box);
      }
    }
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
      v.material.transparent = routing;
      v.material.opacity = routing ? 0.4 : 1;

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
      v.material.dispose();
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
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(factionColor(u.factionId)), roughness: 0.65 });
    const soldiers = new THREE.InstancedMesh(soldierGeometryFor(u.troopType), material, MAX_SOLDIERS);
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
      group, soldiers, material, banner, flag, flagBase, generalId: u.generalId,
      factionId: u.factionId, offsets: offs, heading: 0, moving: 0,
      basePos: new THREE.Vector3(), target: new THREE.Vector3(), placed: false, shakeUntil: 0,
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
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 1.4, 5),
      new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 0.9 }),
    );
    pole.position.set(0, 0.7, -0.6);
    pole.castShadow = true;
    const geo = new THREE.PlaneGeometry(FLAG_W, 0.34, 12, 3);
    geo.translate(FLAG_W / 2, 0, 0); // anchor the pole edge at local x = 0
    const flag = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: flagTexture(factionColor(factionId), FACTION_GLYPH[factionId] ?? '·'), side: THREE.DoubleSide, roughness: 0.75 }),
    );
    flag.position.set(0.02, 1.12, -0.6);
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
        case 'fire':
          this.spawnFire(e.at);
          break;
        case 'flood':
          this.spawnFlood(e.from, e.cells);
          this.pullbackUntil = nowMs() + 3500; // pull the shot back to take in the whole flood
          break;
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
          }
          break;
        }
        case 'charge': {
          const a = this.units.get(e.unitId);
          if (a) this.spawnDust(a.group.position);
          break;
        }
        case 'moraleBreak':
        case 'rout': {
          this.pullbackUntil = nowMs() + 3500;
          const a = this.units.get(e.unitId);
          if (a) this.spawnDust(a.group.position);
          break;
        }
        case 'duel':
          this.spawnDuel(e.a, e.b);
          break;
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

  private updateCamera(t: number, dt: number): void {
    this.introT = Math.min(1, this.introT + dt / 3500);
    const e = easeInOut(this.introT);
    const rout = t < this.pullbackUntil;
    const az = lerp(-1.15, 0.16 * Math.sin(t * 0.00008), e);
    const radius = lerp(this.focusSpan * 1.95, this.focusSpan * (rout ? 1.75 : 1.18), e);
    const elev = lerp(0.26, rout ? 0.72 : 0.5, e);
    const ce = Math.cos(elev);
    TMP.set(
      this.focusC.x + radius * ce * Math.sin(az),
      this.focusC.y + radius * Math.sin(elev),
      this.focusC.z + radius * ce * Math.cos(az),
    );
    this.camera.position.lerp(TMP, rout ? 0.035 : 0.05);
    this.controls.target.lerp(this.focusC, 0.06);
    this.camera.lookAt(this.controls.target);
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
      animateSoldiers(v, t);
      if (t < v.shakeUntil) {
        const k = (v.shakeUntil - t) / 260;
        v.group.position.x += Math.sin(t * 0.09) * 0.32 * k;
        v.group.position.z += Math.cos(t * 0.11) * 0.2 * k;
      }
      if (v.flag && v.flagBase) wave(v.flag, v.flagBase, t, v.basePos.x);
    }

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
function flagTexture(color: string, glyph: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 88;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 128, 88);
  ctx.strokeStyle = 'rgba(0,0,0,.32)';
  ctx.lineWidth = 7;
  ctx.strokeRect(4, 4, 120, 80);
  ctx.fillStyle = 'rgba(247,239,222,.94)';
  ctx.font = '900 58px "Noto Serif TC", "Noto Serif SC", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, 64, 48);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
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
function animateSoldiers(v: UnitVisual, t: number): void {
  const n = v.soldiers.count;
  const off = v.offsets;
  const march = v.moving;
  for (let i = 0; i < n; i++) {
    const o = off[i]!;
    const phase = i * 1.7;
    const bob = Math.abs(Math.sin(t * 0.006 + phase)) * (0.03 + march * 0.11);
    const sway = Math.sin(t * 0.004 + phase * 1.3) * 0.02;
    _sp.set(o.x + sway * 0.4, bob, o.z);
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
    const w = Math.sin(bx * 16 - t * 0.006 + phase) * 0.06 * k;
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
