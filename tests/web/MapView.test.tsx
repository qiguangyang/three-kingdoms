import { describe, expect, it } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { MapView } from '../../src/web/components/MapView.js';
import { buildInitialState } from '../../src/engine/scenario.js';
import { SCENARIO_DONGZHUO } from '../../src/data/scenarios/s1-dongzhuo.js';
import { REF_DATA } from '../../src/data/index.js';

describe('MapView (SVG)', () => {
  it('renders an SVG with one city marker per city', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 1,
    });
    const { container } = render(
      <MapView game={state} selectedCityId={null} onSelectCity={() => {}} />,
    );
    const svg = container.querySelector('svg.map-svg');
    expect(svg).not.toBeNull();
    const markers = container.querySelectorAll('.map-city');
    expect(markers.length).toBe(Object.keys(state.cities).length);
  });

  it('highlights the selected city', () => {
    const state = buildInitialState({
      scenario: SCENARIO_DONGZHUO,
      playerFactionId: 'dongzhuo',
      refData: REF_DATA,
      seed: 1,
    });
    const { container } = render(
      <MapView game={state} selectedCityId="luoyang" onSelectCity={() => {}} />,
    );
    const selected = container.querySelector('.map-city.is-selected');
    expect(selected).not.toBeNull();
  });
});
