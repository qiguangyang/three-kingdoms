// Three.js scene manager for the 3D battlefield. Pure layout math lives in
// geometry.ts (unit-tested); this file is the rendering glue (verified
// visually). Only ever instantiated in a real WebGL context — BattleView
// routes to the SVG fallback when WebGL is unavailable.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BattleSession } from '../../state/battleSession.js';
import type { BattleEvent, BattleField, GeneralId, Vec2 } from '../../engine/battle/types.js';
import type { BattleUnit, TroopType } from '../../engine/types.js';
import { factionColor } from '../theme.js';
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
  generalId: string;
  basePos: THREE.Vector3;
  target: THREE.Vector3;
  placed: boolean;
  shakeUntil: number;
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

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1e2a48);
    this.scene.fog = new THREE.Fog(0x93a0b4, 30, 118);
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

    this.resize();
    this.loop();
  }

  private addSky(): void {
    const geo = new THREE.SphereGeometry(260, 24, 12);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(0x2a3b60) },
        horizon: { value: new THREE.Color(0x93a0b4) },
      },
      vertexShader:
        'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'varying vec3 vP; uniform vec3 top; uniform vec3 horizon; void main(){ float h = clamp((normalize(vP).y+0.04)/0.5, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.8)), 1.0); }',
    });
    this.skyMat = mat;
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  resize(): void {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 500;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setField(field: BattleField): void {
    this.field = field;
    this.applyEnv(field.seed);
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

  syncUnits(session: BattleSession): void {
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
        v.placed = true;
      }
      v.soldiers.count = soldierCount(u.troops);
      const routing = u.state === 'routing';
      v.material.transparent = routing;
      v.material.opacity = routing ? 0.4 : 1;
    }
    for (const [id, v] of this.units) {
      if (alive.has(id)) continue;
      this.scene.remove(v.group);
      v.soldiers.dispose();
      v.material.dispose();
      if (v.banner) disposeObject(v.banner);
      this.units.delete(id);
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
    if (u.generalId) {
      banner = this.buildBanner(u.factionId);
      group.add(banner);
    }
    return {
      group, soldiers, material, banner, generalId: u.generalId,
      basePos: new THREE.Vector3(), target: new THREE.Vector3(), placed: false, shakeUntil: 0,
    };
  }

  private buildBanner(factionId: string): THREE.Mesh {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 1.4, 5),
      new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 0.9 }),
    );
    pole.position.set(0, 0.7, -0.6);
    pole.castShadow = true;
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.34),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(factionColor(factionId)), side: THREE.DoubleSide, roughness: 0.7 }),
    );
    flag.position.set(0.27, 1.15, -0.6);
    flag.castShadow = true;
    pole.add(flag);
    return pole;
  }

  // Deterministically pick a time-of-day look for this battle and push it into
  // the sky/fog/sun/ambient (a lightweight version of a scene environment).
  private applyEnv(seed: number): void {
    const keys = Object.keys(ENV_PRESETS) as (keyof typeof ENV_PRESETS)[];
    const env = ENV_PRESETS[keys[Math.abs(seed) % keys.length]!]!;
    (this.skyMat.uniforms.top!.value as THREE.Color).setHex(env.skyTop);
    (this.skyMat.uniforms.horizon!.value as THREE.Color).setHex(env.skyHz);
    (this.scene.background as THREE.Color).setHex(env.skyTop);
    (this.scene.fog as THREE.Fog).color.setHex(env.fog);
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
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff7a1c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    core.position.y = 0.7;
    group.add(core);
    const E = 40;
    const em = makeParticles(E, 0xffb050, 0.3, true);
    for (let i = 0; i < E; i++) {
      em.pos[i * 3] = (fxRand() - 0.5); em.pos[i * 3 + 1] = fxRand() * 0.6; em.pos[i * 3 + 2] = (fxRand() - 0.5);
      em.vel[i * 3] = (fxRand() - 0.5) * 0.8; em.vel[i * 3 + 1] = 1.6 + fxRand() * 2.2; em.vel[i * 3 + 2] = (fxRand() - 0.5) * 0.8;
    }
    group.add(em.points);
    const S = 28;
    const sm = makeParticles(S, 0x565058, 0.5, false);
    for (let i = 0; i < S; i++) {
      sm.pos[i * 3] = (fxRand() - 0.5) * 0.8; sm.pos[i * 3 + 1] = 0.8 + fxRand(); sm.pos[i * 3 + 2] = (fxRand() - 0.5) * 0.8;
      sm.vel[i * 3] = (fxRand() - 0.5) * 0.5; sm.vel[i * 3 + 1] = 0.8 + fxRand() * 0.8; sm.vel[i * 3 + 2] = (fxRand() - 0.5) * 0.5;
    }
    group.add(sm.points);
    const light = this.fireLights.find((l) => l.intensity < 0.1);
    if (light) {
      light.position.set(group.position.x, group.position.y + 1, group.position.z);
      light.intensity = 7; // claim it now so a second fire this frame grabs another
    }
    this.spawnEffect(group, 2400, (age, dt, t) => {
      const flick = 0.7 + 0.3 * Math.sin(t / 40);
      const de = dt / 1000;
      (core.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - age) * flick;
      core.scale.setScalar((1 + age) * flick);
      if (light) light.intensity = 7 * (1 - age) * flick; // fades to 0 → auto-freed
      advanceParticles(em, de, 0);
      (em.points.material as THREE.PointsMaterial).opacity = 1 - age;
      advanceParticles(sm, de, 0);
      const smMat = sm.points.material as THREE.PointsMaterial;
      smMat.size = 0.5 + age * 1.4;
      smMat.opacity = 0.5 * (1 - age);
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
      v.basePos.lerp(v.target, 0.12);
      v.group.position.copy(v.basePos);
      if (t < v.shakeUntil) {
        const k = (v.shakeUntil - t) / 260;
        v.group.position.x += Math.sin(t * 0.09) * 0.32 * k;
        v.group.position.z += Math.cos(t * 0.11) * 0.2 * k;
      }
      if (v.banner) v.banner.rotation.z = Math.sin(t / 600 + v.basePos.x) * 0.08;
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
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && !isSharedSoldierGeo(mesh.geometry)) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else if (mat) (mat as THREE.Material).dispose();
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    this.renderer.dispose();
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
    if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
    else if (mat) (mat as THREE.Material).dispose();
    // InstancedMesh holds a separate instanceMatrix GPU buffer not covered by
    // geometry.dispose() — free it too (e.g. spawned arrow volleys).
    if ((c as THREE.InstancedMesh).isInstancedMesh) (c as THREE.InstancedMesh).dispose();
  });
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
