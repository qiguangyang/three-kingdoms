export { CITIES, CITY_IDS } from './cities.js';
export { GENERALS, GENERAL_IDS, FACTION_GENERAL_IDS } from './generals/index.js';
export { ITEMS } from './items/index.js';
export { TERRAIN_GRID, terrainAt } from './map/terrain.js';
export {
  SCENARIOS,
  SCENARIO_LIST,
  SCENARIO_DONGZHUO,
  SCENARIO_JUNXIONG,
  SCENARIO_CHIBI,
  SCENARIO_DINGLI,
} from './scenarios/index.js';
export { S1_EVENTS } from './events/s1-triggers.js';

import { CITIES } from './cities.js';
import { GENERALS } from './generals/index.js';
import { ITEMS } from './items/index.js';
import type { ReferenceData } from '../engine/scenario.js';

// Bundle the static reference data for the scenario loader.
export const REF_DATA: ReferenceData = {
  cities: CITIES,
  generals: GENERALS,
  items: ITEMS,
};
