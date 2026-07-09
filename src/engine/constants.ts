// World and viewport dimensions plus combat/economy tuning knobs.
//
// All values live here so the engine and UI both reference one source.

// Logical grid resolution multiplier. The map is authored at a base
// 100x40 resolution but operated at BASE * GRID_SCALE so downstream 3D
// rendering has room for smooth relief. GRID_SCALE is a gameplay-invariant
// transform: coordinates and every distance threshold/cost scale together,
// so adjacency, march cost, and AI classifications are unchanged (proven by
// tests/engine/grid-invariance.test.ts). GRID_SCALE=1 reproduces the old grid.
export const GRID_SCALE = 5;
export const BASE_MAP_WIDTH = 100;
export const BASE_MAP_HEIGHT = 40;

export const MAP_WIDTH = BASE_MAP_WIDTH * GRID_SCALE;
export const MAP_HEIGHT = BASE_MAP_HEIGHT * GRID_SCALE;

// Default terminal viewport. 80x24 is the universal lower bound; we use
// 60x18 for the map portion and reserve the rest for status bar, sidebar
// and event log.
export const VIEW_WIDTH = 60;
export const VIEW_HEIGHT = 18;

// Battlefield (tactical layer) dimensions. Smaller grid than the world map.
export const BATTLE_WIDTH = 20;
export const BATTLE_HEIGHT = 12;
export const BATTLE_DAY_LIMIT = 30; // attacker auto-retreats on day 30

// Terrain symbols rendered on the world map.
export const TERRAIN_SYMBOL: Record<string, string> = {
  plain: '.',
  mountain: '^',
  forest: '*',
  river: '~',
  city: 'O',
};

// Terrain colors (terminal ANSI keys understood by Ink's <Text color={...}>).
export const TERRAIN_COLOR: Record<string, string> = {
  plain: 'green',
  mountain: 'gray',
  forest: 'greenBright',
  river: 'blue',
  city: 'yellow',
};

// Movement cost per terrain tile (used for march time + tactical phase).
export const TERRAIN_MOVE_COST: Record<string, number> = {
  plain: 1,
  forest: 2,
  mountain: 3,
  river: 4,
  city: 0, // entering a friendly city is free
};

// Combat modifier matrix: troopType x terrain damage multiplier.
// Sourced from SCENARIOS.md §0 ("Troop types" + "Terrains").
export const COMBAT_MODIFIER: Record<string, Record<string, number>> = {
  infantry: { plain: 1.0, mountain: 1.0, forest: 1.1, river: 0.5, city: 1.0 },
  archer:   { plain: 1.0, mountain: 1.15, forest: 1.0, river: 0.5, city: 1.0 },
  cavalry:  { plain: 1.2, mountain: 0.7, forest: 0.6, river: 0.3, city: 0.9 },
  heavyCav: { plain: 1.35, mountain: 0.6, forest: 0.5, river: 0.2, city: 0.9 },
  navy:     { plain: 0.4, mountain: 0.3, forest: 0.4, river: 1.5, city: 0.7 },
  xuan:     { plain: 1.1, mountain: 1.1, forest: 1.1, river: 1.0, city: 1.0 },
};

export const CITY_DEFENSE_BONUS = 1.25; // defender gets +25% when in a city

// Monthly economy: yield per agriculture/commerce point.
export const FOOD_PER_AGRICULTURE = 100;
export const MONEY_PER_COMMERCE = 80;
// Each soldier eats this much food per month. Tuned so that a well-developed
// city can sustain a garrison roughly equal to its agriculture score x 100.
export const FOOD_PER_TROOP_MONTH = 0.4;

// Loyalty thresholds for rebellion.
export const LOYALTY_REBELLION = 20;
export const LOYALTY_RECOVERY = 30; // post-rebellion loyalty floor

// Duel mechanics (single-combat between named generals).
export const DUEL_TRIGGER_WU_MIN = 85;
export const DUEL_TRIGGER_PROB = 0.8;

// Wild general search: monthly base success probability per attempt, scaled
// by the searching general's zheng stat.
export const SEARCH_BASE_PROB = 0.05; // 5% baseline
export const SEARCH_ZHENG_WEIGHT = 0.004; // +0.4% per zheng point

// Recruit cap per month per city.
export const RECRUIT_CAP_PER_MONTH = 2000;
export const RECRUIT_GOLD_COST_PER_TROOP = 1;
export const RECRUIT_FOOD_COST_PER_TROOP = 2;
