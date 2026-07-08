// Three.js scene manager for the 3D battlefield. Pure layout math lives in
// geometry.ts / camera.ts (unit-tested); this file is the rendering glue
// (verified visually). Only ever instantiated in a real WebGL context —
// BattleView routes to the SVG fallback when WebGL is unavailable.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BattleSession } from '../../state/battleSession.js';
import type { BattleEvent, BattleField, Vec2 } from '../../engine/battle/types.js';
import type { BattleUnit } from '../../engine/types.js';
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

// One low-poly soldier (feet at origin), reused across all instanced armies.
let SOLDIER_GEO: THREE.BufferGeometry | null = null;
function soldierGeometry(): THREE.BufferGeometry {
  if (SOLDIER_GEO) return SOLDIER_GEO;
  const body = new THREE.CylinderGeometry(0.05, 0.1, 0.34, 6);
  body.translate(0, 0.17, 0);
  const head = new THREE.SphereGeometry(0.075, 8, 6);
  head.translate(0, 0.42, 0);
  const spear = new THREE.CylinderGeometry(0.012, 0.012, 0.6, 4);
  spear.translate(0.1, 0.34, 0);
  SOLDIER_GEO = mergeGeometries([body, head, spear], false);
  return SOLDIER_GEO;
}

interface UnitVisual {
  group: THREE.Group;
  soldiers: THREE.InstancedMesh;
  material: THREE.MeshStandardMaterial;
  banner?: THREE.Mesh;
}
interface Fire {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  born: number;
}

export class BattleScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly units = new Map<string, UnitVisual>();
  private readonly fires: Fire[] = [];
  private field: BattleField | null = null;
  private raf = 0;
  private disposed = false;
  // Cinematic camera director state.
  private readonly focusC = new THREE.Vector3(0, 1.5, 0);
  private focusSpan = 40;
  private introT = 0;
  private pullbackUntil = 0;
  private autoPausedUntil = 0; // while > now, the user is orbiting; auto yields
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
    // When the user grabs the camera, pause the cinematic director; resume a
    // few seconds after they let go.
    this.controls.addEventListener('start', () => { this.autoPausedUntil = Number.POSITIVE_INFINITY; });
    this.controls.addEventListener('end', () => { this.autoPausedUntil = nowMs() + 6000; });

    // Dusk lighting: warm low sun casting long shadows + soft sky fill.
    this.scene.add(new THREE.HemisphereLight(0xaec4e8, 0x4a3d28, 0.55));
    const sun = new THREE.DirectionalLight(0xffd9a0, 2.1);
    sun.position.set(-26, 30, 34);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 140;
    const s = 34;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0x30364a, 0.4));

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
    const geo = buildTerrainBufferGeometry(field);
    const ground = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98, metalness: 0 }),
    );
    ground.receiveShadow = true;
    this.scene.add(ground);

    if (field.river) {
      const size = fieldWorldSize(field);
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(size.w, size.h),
        new THREE.MeshStandardMaterial({ color: 0x2f5a72, transparent: true, opacity: 0.72, roughness: 0.15, metalness: 0.3 }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = WATER_Y;
      water.receiveShadow = true;
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
      v.group.userData.target = new THREE.Vector3(p.x, p.y, p.z);
      if (!v.group.userData.placed) {
        v.group.position.set(p.x, p.y, p.z);
        v.group.userData.placed = true;
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
      v.banner?.geometry.dispose();
      this.units.delete(id);
    }
  }

  private buildUnit(u: BattleUnit): UnitVisual {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(factionColor(u.factionId)), roughness: 0.65 });
    const soldiers = new THREE.InstancedMesh(soldierGeometry(), material, MAX_SOLDIERS);
    soldiers.castShadow = true;
    const offs = formationOffsets(MAX_SOLDIERS);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const pos = new THREE.Vector3();
    for (let i = 0; i < MAX_SOLDIERS; i++) {
      const yaw = (i * 2.399963) % (Math.PI * 2);
      q.setFromAxisAngle(UP, yaw);
      const hj = 0.9 + (0.25 * ((i * 7) % 5)) / 4;
      scl.set(1, hj, 1);
      pos.set(offs[i]!.x, 0, offs[i]!.z);
      m.compose(pos, q, scl);
      soldiers.setMatrixAt(i, m);
    }
    soldiers.instanceMatrix.needsUpdate = true;
    soldiers.count = soldierCount(u.troops);
    group.add(soldiers);
    group.scale.setScalar(1.3); // read the ranks from the cinematic camera

    let banner: THREE.Mesh | undefined;
    if (u.generalId) {
      banner = this.buildBanner(u.factionId);
      group.add(banner);
    }
    return { group, soldiers, material, banner };
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
    (pole as THREE.Mesh).userData.flag = flag;
    return pole;
  }

  // Track the battle's focus (centroid + span); the director in the loop eases
  // the camera toward it, so the shot follows the armies as they advance.
  frameBattle(session: BattleSession): void {
    const c = battleCentroidXZ(session.battle.units, session.battle.field);
    const size = fieldWorldSize(session.battle.field);
    this.focusC.set(c.x, 1.5, c.z);
    this.focusSpan = Math.max(size.w, size.h);
  }

  playEvents(events: BattleEvent[]): void {
    for (const e of events) {
      if (e.kind === 'fire') this.spawnFire(e.at);
      if (e.kind === 'rout' || e.kind === 'moraleBreak') this.pullbackUntil = nowMs() + 3500;
    }
  }

  // Cinematic director: an opening sweep that eases into a low framed shot,
  // gentle idle drift, and a pull-back on routs. Skipped while the user orbits.
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

  private spawnFire(at: Vec2): void {
    if (!this.field) return;
    const { x, z } = cellWorldXZ(at.x, at.y, this.field);
    const y = terrainHeight(at.x, at.y, this.field) + 0.8;
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xff7a1c, transparent: true, opacity: 0.85 }),
    );
    glow.position.set(x, y, z);
    this.scene.add(glow);
    const light = new THREE.PointLight(0xff6a1c, 6, 14, 2);
    light.position.set(x, y + 0.5, z);
    this.scene.add(light);
    this.fires.push({ mesh: glow, light, born: nowMs() });
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const t = nowMs();
    const dt = this.lastT ? Math.min(60, t - this.lastT) : 16;
    this.lastT = t;
    for (const v of this.units.values()) {
      const target = v.group.userData.target as THREE.Vector3 | undefined;
      if (target) v.group.position.lerp(target, 0.12);
      if (v.banner) v.banner.rotation.z = Math.sin(t / 600 + v.group.position.x) * 0.08;
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const fire = this.fires[i]!;
      const age = (t - fire.born) / 1900;
      if (age >= 1) {
        this.scene.remove(fire.mesh, fire.light);
        fire.mesh.geometry.dispose();
        (fire.mesh.material as THREE.Material).dispose();
        this.fires.splice(i, 1);
      } else {
        const flick = 0.75 + 0.25 * Math.sin(t / 45 + i);
        (fire.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - age) * flick;
        fire.mesh.scale.setScalar((1 + age * 1.4) * flick);
        fire.light.intensity = 6 * (1 - age) * flick;
      }
    }
    if (t < this.autoPausedUntil) {
      this.controls.update(); // user is orbiting
    } else {
      this.updateCamera(t, dt); // cinematic director
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry && mesh.geometry !== SOLDIER_GEO) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else if (mat) (mat as THREE.Material).dispose();
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
