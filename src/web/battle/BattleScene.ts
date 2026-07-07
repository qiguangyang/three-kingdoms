// Three.js scene manager for the 3D battlefield. Pure layout math lives in
// geometry.ts / camera.ts (unit-tested); this file is the thin rendering glue
// (verified visually). Only ever instantiated in a real WebGL context —
// BattleView routes to the SVG fallback when WebGL is unavailable.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BattleSession } from '../../state/battleSession.js';
import type { BattleEvent, BattleField, Vec2 } from '../../engine/battle/types.js';
import { factionColor } from '../theme.js';
import {
  CELL_SIZE,
  battleCentroidXZ,
  blockScale,
  buildTerrainGeometry,
  cellWorldXZ,
  fieldWorldSize,
  terrainHeight,
  unitWorldPosition,
} from './geometry.js';
import { framing } from './camera.js';

interface Fire {
  mesh: THREE.Mesh;
  born: number;
}

export class BattleScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly units = new Map<string, THREE.Mesh>();
  private readonly fires: Fire[] = [];
  private field: BattleField | null = null;
  private raf = 0;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x241f14);
    this.scene.fog = new THREE.Fog(0x241f14, 60, 160);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    this.camera.position.set(0, 40, 40);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49; // don't drop below the ground

    this.scene.add(new THREE.HemisphereLight(0xfff0d0, 0x40381f, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.15);
    sun.position.set(30, 50, 20);
    this.scene.add(sun);

    this.resize();
    this.loop();
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
    const geo = buildTerrainGeometry(field);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(geo.positions, 3));
    bg.setAttribute('color', new THREE.Float32BufferAttribute(geo.colors, 3));
    bg.setIndex(geo.indices);
    bg.computeVertexNormals();
    const ground = new THREE.Mesh(
      bg,
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.96 }),
    );
    this.scene.add(ground);

    if (field.river) {
      const size = fieldWorldSize(field);
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(size.w, size.h),
        new THREE.MeshStandardMaterial({ color: 0x3a6b82, transparent: true, opacity: 0.55, roughness: 0.25 }),
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = HEIGHT_LIFT_WATER;
      this.scene.add(water);
    }

    if (field.wall) {
      const gate = field.wall.gate;
      for (const c of field.wall.cells) {
        const isGate = c.x === gate.x && c.y === gate.y;
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(CELL_SIZE, isGate ? 1.0 : 2.4, CELL_SIZE),
          new THREE.MeshStandardMaterial({ color: isGate ? 0x5c4a2c : 0x6b5c44, roughness: 0.9 }),
        );
        const { x, z } = cellWorldXZ(c.x, c.y, field);
        box.position.set(x, terrainHeight(c.x, c.y, field) + (isGate ? 0.5 : 1.2), z);
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
      let mesh = this.units.get(u.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshStandardMaterial({ color: new THREE.Color(factionColor(u.factionId)), roughness: 0.7 }),
        );
        this.scene.add(mesh);
        this.units.set(u.id, mesh);
      }
      const p = unitWorldPosition(u.pos, field);
      const s = blockScale(u.troops);
      mesh.scale.set(s, s * 1.4, s); // slightly tall blocks read as ranks
      const targetY = p.y + (s * 1.4) / 2;
      mesh.userData.target = new THREE.Vector3(p.x, targetY, p.z);
      if (!mesh.userData.placed) {
        mesh.position.set(p.x, targetY, p.z);
        mesh.userData.placed = true;
      }
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const routing = u.state === 'routing';
      mat.transparent = routing;
      mat.opacity = routing ? 0.45 : 1;
    }
    for (const [id, mesh] of this.units) {
      if (alive.has(id)) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.units.delete(id);
    }
  }

  frameBattle(session: BattleSession): void {
    const c = battleCentroidXZ(session.battle.units, session.battle.field);
    const f = framing(c, fieldWorldSize(session.battle.field));
    // Only re-seat the camera on first frame; afterwards let the user orbit.
    if (!this.cameraSeated) {
      this.camera.position.set(f.position[0], f.position[1], f.position[2]);
      this.cameraSeated = true;
    }
    this.controls.target.set(f.target[0], f.target[1], f.target[2]);
    this.controls.update();
  }
  private cameraSeated = false;

  playEvents(events: BattleEvent[]): void {
    for (const e of events) {
      if (e.kind === 'fire') this.spawnFire(e.at);
    }
  }

  private spawnFire(at: Vec2): void {
    if (!this.field) return;
    const { x, z } = cellWorldXZ(at.x, at.y, this.field);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xe0641c, transparent: true, opacity: 0.7 }),
    );
    glow.position.set(x, terrainHeight(at.x, at.y, this.field) + 1.2, z);
    this.scene.add(glow);
    this.fires.push({ mesh: glow, born: nowMs() });
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    for (const mesh of this.units.values()) {
      const t = mesh.userData.target as THREE.Vector3 | undefined;
      if (t) mesh.position.lerp(t, 0.14);
    }
    // Fade + retire fire glows over ~1.6s.
    const t = nowMs();
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const fire = this.fires[i]!;
      const age = (t - fire.born) / 1600;
      if (age >= 1) {
        this.scene.remove(fire.mesh);
        fire.mesh.geometry.dispose();
        (fire.mesh.material as THREE.Material).dispose();
        this.fires.splice(i, 1);
      } else {
        (fire.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - age);
        fire.mesh.scale.setScalar(1 + age * 1.5);
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else if (m) (m as THREE.Material).dispose();
    });
    this.renderer.dispose();
  }
}

const HEIGHT_LIFT_WATER = 0.2;
function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}
