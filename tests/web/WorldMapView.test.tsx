import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { WorldMapView } from '../../src/web/map/WorldMapView.js';
import { hasWebGL } from '../../src/web/gfx/hasWebGL.js';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';

function fixtureGame() {
  return buildInitialState({
    scenario: SCENARIO_DONGZHUO,
    playerFactionId: 'dongzhuo',
    refData: REF_DATA,
    seed: 1,
  });
}

describe('WorldMapView', () => {
  it('reports no WebGL under jsdom', () => {
    // The premise of the fallback: jsdom cannot create a WebGL context, so
    // WorldMapView must never construct WorldMap3D / MapScene / three here.
    expect(hasWebGL()).toBe(false);
  });

  it('renders the SVG MapView fallback when WebGL is unavailable', () => {
    const { getByTestId } = render(
      <WorldMapView game={fixtureGame()} selectedCityId={null} onSelectCity={() => {}} />,
    );
    // The SVG map root is present — proving the 3D path (and any WebGL/canvas
    // instantiation) was skipped in favor of the fallback.
    expect(getByTestId('svg-map')).toBeTruthy();
  });
});
