// Procedural, primitive-mesh character rigs for the real-time duel. No skeletal
// assets: each fighter is a THREE.Group of boxes/cylinders whose limb + weapon
// joints are rotated by applyPose(). Object construction needs no WebGL context,
// so this is unit-testable headless. Palette/proportions echo BattleScene's
// low-poly soldier idiom (steel weapons, cloth body, tan skin). applyPose is a
// pure function of (action, phase, t) — no Date.now()/Math.random().
import * as THREE from 'three';

export interface CharacterRig {
  group: THREE.Group;
  // action: player/boss action id; phase: attack sub-phase or null; t: 0..1 progress.
  applyPose(action: string, phase: string | null, t: number): void;
}

const SKIN = 0xead9b0;
const LEG = 0x2b2b33;
const STEEL = 0xcdd3da;

function box(color: number, w: number, h: number, d: number, metalness = 0): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, metalness, roughness: metalness > 0 ? 0.4 : 0.8 }),
  );
}

// A limb that pivots at its TOP (shoulder/hip): the box hangs down from an empty
// group, so rotating the group swings the limb around the joint, not its centre.
function jointLimb(name: string, color: number, w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  const m = box(color, w, h, d);
  m.position.y = -h / 2;
  g.add(m);
  return g;
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

// Normalise the player + boss action vocabularies to a swing archetype.
function attackKind(action: string): 'light' | 'heavy' | 'sweep' | 'thrust' | null {
  if (action === 'lightAttack' || action === 'combo') return 'light';
  if (action === 'heavyAttack' || action === 'smash') return 'heavy';
  if (action === 'sweep') return 'sweep';
  if (action === 'lunge') return 'thrust';
  return null;
}

// Overhead swing arc: raise on windup, chop through on active, settle on recovery.
function swingArm(phase: string | null, t: number, power: number): number {
  if (phase === 'windup') return -1.3 * power * t;
  if (phase === 'active') return (-1.3 + 2.7 * t) * power;
  if (phase === 'recovery') return 1.4 * power * (1 - t);
  return 0.55 * power; // held ready when no phase is supplied
}

interface RigOptions {
  robe: number;
  accent: number; // trim/armour panel colour
  torsoW: number;
  shoulder: number; // arm x offset from centre
  scale: number;
  leftWeapon?: THREE.Object3D;
  rightWeapon?: THREE.Object3D;
}

function buildRig(o: RigOptions): CharacterRig {
  const group = new THREE.Group();

  const torso = box(o.robe, o.torsoW, 0.9, 0.35);
  torso.name = 'torso';
  const chest = box(o.accent, o.torsoW * 0.7, 0.4, 0.37); // armour/trim panel
  chest.position.y = 0.18;
  torso.add(chest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7 }));
  head.name = 'head';
  head.position.y = 0.75;

  const rightArm = jointLimb('rightArm', o.robe, 0.18, 0.7, 0.18);
  rightArm.position.set(o.shoulder, 0.42, 0);
  if (o.rightWeapon) rightArm.add(o.rightWeapon);
  const leftArm = jointLimb('leftArm', o.robe, 0.18, 0.7, 0.18);
  leftArm.position.set(-o.shoulder, 0.42, 0);
  if (o.leftWeapon) leftArm.add(o.leftWeapon);

  const legL = jointLimb('legL', LEG, 0.2, 0.8, 0.2);
  legL.position.set(-0.18, -0.45, 0);
  const legR = jointLimb('legR', LEG, 0.2, 0.8, 0.2);
  legR.position.set(0.18, -0.45, 0);

  group.add(torso, head, rightArm, leftArm, legL, legR);
  group.scale.setScalar(o.scale);

  return {
    group,
    applyPose(action, phase, t) {
      const p = clamp01(t);
      // Reset every joint we animate to a neutral rest pose (keeps poses a pure
      // function of the arguments — no accumulation between frames).
      rightArm.rotation.set(0, 0, 0);
      leftArm.rotation.set(0, 0, 0);
      legL.rotation.x = 0;
      legR.rotation.x = 0;
      torso.rotation.set(0, 0, 0);
      group.rotation.z = 0;

      const kind = attackKind(action);
      if (action === 'move' || action === 'reposition' || action === 'charge') {
        const s = Math.sin(p * Math.PI * 2);
        legL.rotation.x = s * 0.6;
        legR.rotation.x = -s * 0.6;
        rightArm.rotation.x = -s * 0.3;
        leftArm.rotation.x = s * 0.3;
        if (action === 'charge') torso.rotation.x = 0.28; // lean into the rush
      } else if (kind) {
        const power = kind === 'heavy' ? 1.0 : kind === 'light' ? 0.7 : 0.85;
        if (kind === 'sweep') {
          // Horizontal polearm arc: swing the arm across the body on active.
          rightArm.rotation.z = phase === 'active' ? -1.5 + 3.0 * p : phase === 'windup' ? -1.5 * p : 1.5 * (1 - p);
          rightArm.rotation.x = 0.4;
          torso.rotation.y = (phase === 'active' ? 0.5 : 0) * (p - 0.5);
        } else if (kind === 'thrust') {
          const reach = phase === 'active' ? p : phase === 'recovery' ? 1 - p : 0;
          rightArm.rotation.x = 0.3 + reach * 0.6;
          torso.rotation.x = reach * 0.35; // lunge forward
        } else {
          rightArm.rotation.x = swingArm(phase, p, power);
          leftArm.rotation.x = swingArm(phase, p, power) * 0.5; // off-hand follows
          if (kind === 'heavy' && phase === 'active') torso.rotation.x = 0.3 * p;
        }
      } else if (action === 'dodge') {
        group.rotation.z = Math.sin(p * Math.PI) * 0.6; // quick side roll
        legL.rotation.x = -0.5;
        legR.rotation.x = -0.5; // tuck
      } else if (action === 'stagger') {
        torso.rotation.x = -0.35 * (1 - p);
        rightArm.rotation.x = -0.3 * (1 - p);
        leftArm.rotation.x = -0.3 * (1 - p);
      }
      // idle / guard / unknown -> neutral rest pose (already applied above).
    },
  };
}

// A straight-bladed jian: guard + blade extending down/forward from the hand.
function jianSword(): THREE.Group {
  const s = new THREE.Group();
  const guard = box(0x8a6b3a, 0.16, 0.04, 0.06, 0.3);
  guard.position.y = -0.72;
  const blade = box(STEEL, 0.05, 0.85, 0.05, 0.65);
  blade.position.y = -1.15;
  s.add(guard, blade);
  return s;
}

// Liu Bei: agile dual-wielder in a jade-green robe with twin jian.
export function buildHeroRig(): CharacterRig {
  return buildRig({
    robe: 0x2f6f4e,
    accent: 0x4f9c73,
    torsoW: 0.56,
    shoulder: 0.4,
    scale: 1.0,
    rightWeapon: jianSword(),
    leftWeapon: jianSword(),
  });
}

// Lü Bu: a looming, broad boss in dark-crimson armour wielding the Sky-Piercer
// halberd (ji) — a long shaft with a spear tip and a crescent side-blade.
export function buildBossRig(): CharacterRig {
  const halberd = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 2.0, 8),
    new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.8 }),
  );
  shaft.position.y = -0.7; // extends above and below the grip
  const spear = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.42, 8), new THREE.MeshStandardMaterial({ color: 0xd0d0d8, metalness: 0.7, roughness: 0.35 }));
  spear.position.y = 0.5;
  const crescent = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 6, 10, Math.PI), new THREE.MeshStandardMaterial({ color: 0xd0d0d8, metalness: 0.7, roughness: 0.35 }));
  crescent.rotation.z = Math.PI / 2;
  crescent.position.set(0.16, 0.28, 0);
  halberd.add(shaft, spear, crescent);
  return buildRig({
    robe: 0x7a1f1f,
    accent: 0x3a1414,
    torsoW: 0.74,
    shoulder: 0.5,
    scale: 1.3, // Lü Bu towers over Liu Bei
    rightWeapon: halberd,
  });
}
