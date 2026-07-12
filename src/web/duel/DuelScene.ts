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
import type { AttackPhase, DuelEvent, DuelInput, DuelOutcome, DuelState, Vec2 } from '../../duel/types.js';
import { buildBossRig, buildHeroRig, type CharacterRig } from './characterRig.js';
import { inputFromKeys, type KeyState } from './input.js';
import { makeShake } from '../three/cameraShake.js';
import {
  playCharge,
  playClash,
  playDayTick,
  playDefeatTheme,
  playGong,
  playRout,
  playVictoryTheme,
} from '../audio/battle.js';

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

// The juice surface the event dispatcher drives. The scene supplies a real sink
// (camera shake / Web-Audio SFX / particle burst); tests supply a spy sink.
export interface DuelFxSink {
  shake(intensity: number): void;
  sfx(kind: string): void;
  spark(at: Vec2): void;
}

// PURE event -> FX dispatcher. Maps each DuelEvent emitted by stepDuel to sink
// calls; it performs NO side effects of its own (every effect goes through the
// injected sink), so it is unit-testable with a spy sink and reused with the
// scene's real sink. FX are read-only consumers of sim events — nothing here
// feeds back into the simulation, so determinism is unaffected.
export function applyDuelEventFx(events: DuelEvent[], sink: DuelFxSink): void {
  for (const e of events) {
    switch (e.kind) {
      case 'playerHit': // the boss took damage
        sink.shake(0.25);
        sink.sfx('clash');
        sink.spark(e.at);
        break;
      case 'bossHitPlayer': // the player took damage — hit harder
        sink.shake(0.45);
        sink.sfx('clash');
        sink.spark(e.at);
        break;
      case 'dodge': // an airy whoosh as the hero rolls clear
        sink.sfx('dodge');
        break;
      case 'guardDeflect': // a metallic clang + a shower of sparks off the guard
        sink.sfx('guard');
        sink.spark(e.at);
        break;
      case 'phaseChange': // the boss powers up: a roar and a big shake
        sink.sfx('phase');
        sink.shake(0.6);
        break;
      case 'bossTell': // subtle telegraph cue before a big swing
        sink.sfx('tell');
        break;
      case 'win':
        sink.sfx('win');
        break;
      case 'lose':
        sink.sfx('lose');
        break;
      case 'playerSwing': // swing whoosh / empty-stamina thunk are tuned live
      case 'staminaEmpty':
        break;
    }
  }
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
  // Fired EXACTLY ONCE when the duel is decided, purely to NOTIFY the screen the
  // fight is over (so it can raise the Victory/Defeat overlay). It must NOT be
  // assumed to tear the scene down: the RAF keeps rendering the settled final
  // pose + killing-blow FX afterwards, and the scene is stopped later via stop()
  // when the screen unmounts (the player pressed Continue → resolveDuel routed
  // back into the campaign). See the loop's outcome tail.
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
  private readonly effects: DuelEffect[] = [];
  private readonly onOutcome: (outcome: DuelOutcome) => void;
  private readonly onFrame?: (state: DuelState) => void;

  // Real FX sink handed to applyDuelEventFx: camera shake, procedural SFX, and a
  // spark burst at the event position. Arrow methods so `this` binds to the
  // scene; they only touch the renderer/audio, never the simulation.
  private readonly fxSink: DuelFxSink = {
    shake: (intensity) => this.shake.add(intensity),
    sfx: (kind) => this.playSfx(kind),
    spark: (at) => this.spawnSparks(at),
  };

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

  // Map an abstract SFX kind (from applyDuelEventFx) to a procedural battle cue.
  // Every helper below already no-ops when audio is muted / unavailable, so this
  // never introduces a new failure mode.
  private playSfx(kind: string): void {
    switch (kind) {
      case 'clash': playClash(); break; // steel-on-steel on a landed blow
      case 'dodge': playRout(); break; // short falling whoosh as the hero rolls
      case 'guard': playGong(); break; // metallic clang off a raised guard
      case 'phase': playCharge(); break; // rising rush as the boss powers up
      case 'tell': playDayTick(); break; // subtle telegraph tick
      case 'win': playVictoryTheme(); break;
      case 'lose': playDefeatTheme(); break;
      default: break;
    }
  }

  // A short burst of bright sparks at a world-plane hit point (chest height),
  // following the BattleScene particle idiom (additive Points + gravity + fade).
  private spawnSparks(at: Vec2): void {
    const N = 14;
    const P = makeParticles(N, 0xffe3a0, 0.16);
    for (let i = 0; i < N; i++) {
      P.pos[i * 3] = at.x;
      P.pos[i * 3 + 1] = 1.1; // impact roughly at torso height
      P.pos[i * 3 + 2] = at.z;
      const ang = fxRand() * Math.PI * 2;
      const sp = 1.6 + fxRand() * 3.4;
      P.vel[i * 3] = Math.cos(ang) * sp;
      P.vel[i * 3 + 1] = 1.4 + fxRand() * 3;
      P.vel[i * 3 + 2] = Math.sin(ang) * sp;
    }
    this.spawnEffect(P.points, 420, (age, dt) => {
      advanceParticles(P, dt / 1000, 12);
      (P.points.material as THREE.PointsMaterial).opacity = 1 - age;
    });
  }

  private spawnEffect(obj: THREE.Object3D, life: number, update: DuelEffect['update']): void {
    obj.frustumCulled = false;
    this.scene.add(obj);
    this.effects.push({ obj, born: nowMs(), life, update });
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
      // Juice: shake / SFX / sparks off this substep's events. Read-only side
      // effects — nothing here feeds back into the sim, so it stays deterministic.
      applyDuelEventFx(events, this.fxSink);
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

    // Age + integrate live spark bursts; retire (and dispose) the expired ones.
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i]!;
      const age = (now - fx.born) / fx.life;
      if (age >= 1) {
        this.scene.remove(fx.obj);
        disposeEffect(fx.obj);
        this.effects.splice(i, 1);
      } else {
        fx.update(age, dt);
      }
    }

    this.renderer.render(this.scene, this.camera);

    // The duel is decided. Notify the screen EXACTLY ONCE (the `fired` guard) so
    // it can raise the Victory/Defeat overlay — but do NOT stop() or route here.
    // The sim already froze (stepDuel early-returns once `outcome` is set), so we
    // keep the RAF running purely to RENDER: the killing-blow spark burst and
    // camera shake bleed out over the settled final pose, giving the set-piece
    // its payoff instead of flashing past in a single frame. `this.state` is a
    // stable reference from here on (stepDuel returns it unchanged), so the HUD's
    // per-frame tap idles cheaply. The scene is torn down later, in stop(), when
    // the screen unmounts after the player presses Continue.
    if (this.state.outcome && !this.fired) {
      this.fired = true;
      this.onOutcome(this.state.outcome);
    }
  };
}

// ── Spark FX helpers (self-contained port of the BattleScene particle idiom) ──
// A transient visual effect owned by the scene: an Object3D that is aged from
// `born` to `born + life` and advanced each frame until it retires.
interface DuelEffect {
  obj: THREE.Object3D;
  born: number;
  life: number;
  update: (age01: number, dtMs: number) => void;
}

interface Particles {
  points: THREE.Points;
  pos: Float32Array;
  vel: Float32Array;
}

// An additive-blended point cloud whose position buffer is integrated by
// advanceParticles. Kept tiny (no textures) so a burst is cheap to spawn.
function makeParticles(count: number, color: number, size: number): Particles {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const material = new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
  });
  return { points: new THREE.Points(g, material), pos, vel };
}

// Integrate velocity (with gravity) into position and flag the buffer upload.
function advanceParticles(p: Particles, dtSec: number, gravity: number): void {
  const n = p.pos.length;
  for (let i = 0; i < n; i += 3) {
    p.vel[i + 1] = p.vel[i + 1]! - gravity * dtSec;
    p.pos[i] = p.pos[i]! + p.vel[i]! * dtSec;
    p.pos[i + 1] = p.pos[i + 1]! + p.vel[i + 1]! * dtSec;
    p.pos[i + 2] = p.pos[i + 2]! + p.vel[i + 2]! * dtSec;
  }
  p.points.geometry.attributes.position!.needsUpdate = true;
}

// Free a retired effect's GPU resources (geometry + material).
function disposeEffect(o: THREE.Object3D): void {
  const mesh = o as THREE.Mesh;
  if (mesh.geometry) mesh.geometry.dispose();
  const mat = mesh.material;
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
  else if (mat) (mat as THREE.Material).dispose();
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

// Cheap module-local PRNG for spark scatter. Entirely visual — it never touches
// the simulation's seeded rngState, so the fight stays deterministic.
let fxSeed = 0x2f6e2b1;
function fxRand(): number {
  fxSeed = (fxSeed + 0x6d2b79f5) | 0;
  let t = Math.imul(fxSeed ^ (fxSeed >>> 15), 1 | fxSeed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
