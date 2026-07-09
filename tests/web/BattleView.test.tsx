import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';
import { createBattle } from '../../src/engine/battle/setup.js';
import { startSession } from '../../src/state/battleSession.js';
import { BattleView } from '../../src/web/battle/BattleView.js';
import { hasWebGL } from '../../src/web/battle/webglSupport.js';
import type { Personality } from '../../src/engine/types.js';

function fixtureSession() {
  const s = buildInitialState({ scenario: SCENARIO_DONGZHUO, playerFactionId: 'caocao', refData: REF_DATA, seed: 100 });
  const target = Object.values(s.cities).find((c) => c.factionId && c.factionId !== 'caocao')!;
  const battle = createBattle(s, {
    cityId: target.id, attackerFactionId: 'caocao', defenderFactionId: target.factionId!,
    attackingGeneralIds: ['caocao'], attackingTroops: 8000,
  });
  const personalities: Record<string, Personality> = {};
  for (const f of Object.values(s.factions)) personalities[f.id] = f.personality;
  return startSession(battle, 'caocao', personalities);
}

describe('BattleView', () => {
  it('reports no WebGL under jsdom', () => {
    expect(hasWebGL()).toBe(false);
  });

  it('renders the SVG fallback when WebGL is unavailable', () => {
    const { getByRole } = render(<BattleView session={fixtureSession()} />);
    expect(getByRole('img', { name: 'battlefield' })).toBeTruthy();
  });
});
