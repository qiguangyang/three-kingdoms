import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildHeroRig, buildBossRig } from '../../../src/web/duel/characterRig.js';

const ACTIONS = ['idle', 'move', 'lightAttack', 'heavyAttack', 'dodge', 'stagger'];
const PHASES = [null, 'windup', 'active', 'recovery'];

describe('character rigs', () => {
  it('build THREE groups with child meshes (no GL context needed)', () => {
    const hero = buildHeroRig();
    const boss = buildBossRig();
    expect(hero.group).toBeInstanceOf(THREE.Group);
    expect(boss.group).toBeInstanceOf(THREE.Group);
    expect(hero.group.children.length).toBeGreaterThan(3);
    expect(boss.group.children.length).toBeGreaterThan(3);
  });

  it('boss looms larger than the hero', () => {
    const hero = buildHeroRig();
    const boss = buildBossRig();
    expect(boss.group.scale.x).toBeGreaterThan(hero.group.scale.x);
  });

  it('applyPose runs for every action/phase without throwing and is deterministic', () => {
    const hero = buildHeroRig();
    const boss = buildBossRig();
    for (const rig of [hero, boss]) {
      for (const action of ACTIONS) {
        for (const phase of PHASES) {
          expect(() => rig.applyPose(action, phase, 0.5)).not.toThrow();
        }
      }
    }
    // Determinism: same inputs -> same joint rotation.
    hero.applyPose('lightAttack', 'active', 0.5);
    const arm = hero.group.children.find((c) => c.name === 'rightArm')!;
    const rot1 = arm.rotation.x;
    hero.applyPose('idle', null, 0);
    hero.applyPose('lightAttack', 'active', 0.5);
    expect(arm.rotation.x).toBe(rot1);
  });

  it('applyPose tolerates unknown boss actions (sweep/smash/lunge/combo/charge)', () => {
    const boss = buildBossRig();
    for (const action of ['sweep', 'smash', 'lunge', 'combo', 'charge', 'reposition', 'guard']) {
      expect(() => boss.applyPose(action, 'active', 0.3)).not.toThrow();
    }
  });
});
