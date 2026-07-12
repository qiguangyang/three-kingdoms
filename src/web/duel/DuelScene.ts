// Three.js scene manager for the real-time boss duel. The over-the-shoulder
// framing math (followCamTarget) is a pure, unit-tested export; the DuelScene
// class itself is the rendering glue (a WebGLRenderer needs a real GL context,
// so it is validated live in Task 15/17, not in headless unit tests). The scene
// reuses the lighting/fog/ground idioms from BattleScene and drives a fixed-
// timestep simulation loop so the fight stays deterministic regardless of the
// display frame rate.
import * as THREE from 'three';
import { DUEL_CONFIG } from '../../duel/config.js';
import { createDuelState, stepDuel } from '../../duel/simulate.js';
import type { AttackPhase, DuelInput, DuelOutcome, DuelState, Vec2 } from '../../duel/types.js';
import { buildBossRig, buildHeroRig, type CharacterRig } from './characterRig.js';
import { inputFromKeys, type KeyState } from './input.js';
import { makeShake } from '../three/cameraShake.js';

// Over-the-shoulder framing: look at a point 35% from player toward boss; the
// camera yaw follows the player→boss vector so the boss stays framed ahead.
export function followCamTarget(playerPos: Vec2, bossPos: Vec2): { look: Vec2; camOffsetYaw: number } {
  const look = {
    x: playerPos.x + (bossPos.x - playerPos.x) * 0.35,
    z: playerPos.z + (bossPos.z - playerPos.z) * 0.35,
  };
  const camOffsetYaw = Math.atan2(bossPos.z - playerPos.z, bossPos.x - playerPos.x);
  return { look, camOffsetYaw };
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

// Neutral input used before a KeyState is attached (or as a fallback).
const NEUTRAL_INPUT: DuelInput = { move: { x: 0, z: 0 }, light: false, heavy: false, dodge: false, guard: false };

// Attack-phase durations pulled from config, used to turn actionTimer into a
// 0..1 pose progress. Boss phase-2 attacks are slightly faster than these
// (phase2SpeedMul); the small overshoot is clamped in poseProgress and is
// visual-only (pose progress is tuned live, not unit-tested).
type PhaseKey = 'windupMs' | 'activeMs' | 'recoveryMs';
function phaseDurationMs(action: string, phase: AttackPhase): number {
  const key: PhaseKey = phase === 'windup' ? 'windupMs' : phase === 'active' ? 'activeMs' : 'recoveryMs';
  const p = DUEL_CONFIG.player;
  if (action === 'lightAttack') return p.light[key];
  if (action === 'heavyAttack') return p.heavy[key];
  const atk = (DUEL_CONFIG.boss.attacks as Record<string, Record<PhaseKey, number>>)[action];
  return atk ? atk[key] : 0;
}

// Milliseconds for one full walk cycle (drives the march-bob in applyPose for
// continuous locomotion/idle, which have no phase timer of their own).
const WALK_CYCLE_MS = 600;

// Map a fighter's action/phase/timer to the 0..1 progress applyPose wants.
function poseProgress(
  f: { action: string; attackPhase: AttackPhase | null; actionTimer: number },
  elapsedMs: number,
): number {
  if (f.attackPhase) {
    const dur = phaseDurationMs(f.action, f.attackPhase);
    return dur > 0 ? clamp01(f.actionTimer / dur) : 0;
  }
  if (f.action === 'dodge') return clamp01(f.actionTimer / DUEL_CONFIG.player.dodge.durationMs);
  if (f.action === 'stagger') return clamp01(f.actionTimer / DUEL_CONFIG.player.staggerMs);
  // Continuous locomotion / idle: a free-running cycle from total elapsed time.
  return (elapsedMs % WALK_CYCLE_MS) / WALK_CYCLE_MS;
}

export interface DuelSceneOptions {
  onOutcome: (outcome: DuelOutcome) => void;
  // Optional live-state tap: called once per rendered frame with the current
  // DuelState so a React HUD can mirror HP / stamina without stepping the sim
  // itself. Kept optional so the scene's headless/unit surfaces are unaffected.
  onFrame?: (state: DuelState) => void;
}

// Camera framing constants (world units). Tuned live in Task 17.
const CAM_DISTANCE = 6; // how far behind the player the camera sits
const CAM_HEIGHT = 3; // camera eye height
const LOOK_HEIGHT = 1.2; // height of the point the camera looks at

export class DuelScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly hero: CharacterRig;
  private readonly boss: CharacterRig;
  private readonly shake = makeShake();
  private readonly onOutcome: (outcome: DuelOutcome) => void;
  private readonly onFrame?: (state: DuelState) => void;

  private state: DuelState = createDuelState();
  private keyState: KeyState | null = null;

  private raf = 0;
  private disposed = false;
  private running = false;
  private fired = false; // has onOutcome already fired?
  private lastT = 0; // wall-clock timestamp of the previous frame
  private acc = 0; // accumulated (slow-mo-scaled) real time owed to the sim

  constructor(private readonly canvas: HTMLCanvasElement, opts: DuelSceneOptions) {
    this.onOutcome = opts.onOutcome;
    this.onFrame = opts.onFrame;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a2036);
    // Exponential fog hazes the arena edge into the sky so the ring feels open.
    this.scene.fog = new THREE.FogExp2(0x30384f, 0.03);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200);
    this.camera.position.set(0, CAM_HEIGHT, -CAM_DISTANCE);

    // Lighting: a warm key sun + cool hemisphere fill (BattleScene idiom).
    const hemi = new THREE.HemisphereLight(0xaec4e8, 0x30281c, 0.7);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe6c0, 2.2);
    sun.position.set(-8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    const s = 16;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0x2a3048, 0.5));

    this.addGround();

    // Both fighters. Their bodies cast shadows onto the arena floor.
    this.hero = buildHeroRig();
    this.boss = buildBossRig();
    for (const rig of [this.hero, this.boss]) {
      rig.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.castShadow = true;
      });
      this.scene.add(rig.group);
    }

    this.resize();
  }

  // Circular arena floor the duel is fought on.
  private addGround(): void {
    const geo = new THREE.CircleGeometry(DUEL_CONFIG.arena.radius + 2, 64);
    geo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: 0x4a4335, roughness: 0.98, metalness: 0 }),
    );
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  resize(): void {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 500;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Store the KeyState the loop reads each fixed step (React owns the DOM
  // listeners that mutate it; the scene only samples + clears `pressed`).
  setKeyState(k: KeyState): void {
    this.keyState = k;
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastT = 0;
    this.acc = 0;
    this.raf = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    });
    this.renderer.dispose();
  }

  private readonly loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);

    // Real wall-clock dt (clamped so a long stall can't fast-forward the sim),
    // scaled by slow-mo. The SIMULATION only ever advances in fixed steps.
    const dt = this.lastT ? Math.min(50, now - this.lastT) : 16;
    this.lastT = now;
    const scale = this.state.slowMo > 0 ? DUEL_CONFIG.juice.slowMoScale : 1;
    this.acc += dt * scale;

    const fixed = DUEL_CONFIG.fixedDtMs;
    while (this.acc >= fixed) {
      const input = this.keyState ? inputFromKeys(this.keyState) : NEUTRAL_INPUT;
      const { state, events } = stepDuel(this.state, input, fixed);
      this.state = state;
      // Edge-triggered keys (attack/dodge) fire once: clear after each fixed
      // step so a held key doesn't re-trigger on the next step this frame.
      this.keyState?.pressed.clear();
      for (const e of events) {
        if (e.kind === 'playerHit') this.shake.add(0.25);
        else if (e.kind === 'bossHitPlayer') this.shake.add(0.45);
      }
      this.acc -= fixed;
    }

    // Live-state tap for the HUD: emit the just-simulated state once per
    // rendered frame (the sim itself only advances in the fixed steps above).
    this.onFrame?.(this.state);

    // Sync both rigs from the simulation state (facing negated: sim yaw is
    // atan2(z, x) on the ground plane; the mesh rotates about world +y).
    const { player, boss } = this.state;
    this.hero.group.position.set(player.pos.x, 0, player.pos.z);
    this.hero.group.rotation.y = -player.facing;
    this.boss.group.position.set(boss.pos.x, 0, boss.pos.z);
    this.boss.group.rotation.y = -boss.facing;
    this.hero.applyPose(player.action, player.attackPhase, poseProgress(player, this.state.elapsed));
    this.boss.applyPose(boss.action, boss.attackPhase, poseProgress(boss, this.state.elapsed));

    // Over-the-shoulder follow camera: sit behind the player along the reverse
    // of the player→boss vector, add decaying hit-shake, and look at the biased
    // midpoint so the boss stays framed ahead.
    const { look, camOffsetYaw } = followCamTarget(player.pos, boss.pos);
    const shake = this.shake.sample(dt);
    this.camera.position.set(
      player.pos.x - Math.cos(camOffsetYaw) * CAM_DISTANCE + shake.x,
      CAM_HEIGHT + shake.y,
      player.pos.z - Math.sin(camOffsetYaw) * CAM_DISTANCE,
    );
    this.camera.lookAt(look.x, LOOK_HEIGHT, look.z);

    this.renderer.render(this.scene, this.camera);

    if (this.state.outcome && !this.fired) {
      this.fired = true;
      this.onOutcome(this.state.outcome);
      this.stop();
    }
  };
}
