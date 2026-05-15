// Core type definitions for the Three Kingdoms engine.
//
// All identifiers, type names, and comments are English. User-facing names
// (cities, generals, factions) carry both zh and en via LocalizedString so
// the engine is locale-independent and the UI picks the active locale.

export type LocalizedString = { zh: string; en: string };

export type FactionId = string;
export type CityId = string;
export type GeneralId = string;
export type ItemId = string;

export type TroopType =
  | 'infantry'
  | 'archer'
  | 'cavalry'
  | 'heavyCav'
  | 'navy'
  | 'xuan';

export type Terrain = 'plain' | 'mountain' | 'forest' | 'river' | 'city';

// Four canonical stats. Keyed in romanized pinyin so the meaning is unambiguous
// across English-only code review and bilingual UI rendering.
//   wu    = 武力 / Martial      (melee damage, frontline attack)
//   zhi   = 智力 / Intellect   (stratagem hit-rate, scheme damage)
//   tong  = 统率 / Command     (troop cap, defense, march speed)
//   zheng = 政治 / Politics    (development, diplomacy, recruitment)
export interface Stats {
  wu: number;
  zhi: number;
  tong: number;
  zheng: number;
}

export type GeneralStatus =
  | 'active'
  | 'captured'
  | 'wounded'
  | 'dead'
  | 'hidden';

export interface General {
  id: GeneralId;
  name: LocalizedString;
  stats: Stats;
  loyalty: number; // 0-100
  age: number;
  factionId: FactionId | null; // null = unaligned (wild)
  locationCityId: CityId | null; // wild: where they can be found via search
  troopType: TroopType;
  troops: number;
  weapon?: ItemId;
  horse?: ItemId;
  book?: ItemId;
  status: GeneralStatus;
}

export interface City {
  id: CityId;
  name: LocalizedString;
  pos: { x: number; y: number }; // grid 0..MAP_WIDTH-1, 0..MAP_HEIGHT-1
  terrain: Terrain[]; // primary terrain first, then secondary
  factionId: FactionId | null;
  agriculture: number; // 0-100, food yield
  commerce: number; // 0-100, gold yield
  defense: number; // 0-100, garrison fortification
  loyalty: number; // 0-100, below 20 risks rebellion
  money: number; // city treasury
  food: number; // city granary
  generals: GeneralId[]; // stationed generals
  garrison: number; // city guard troops
  flags: Record<string, unknown>; // event-specific flags
}

export type Personality = 'active' | 'balanced' | 'turtle';

// ----- AI strategy (goal-oriented faction planning) -----
//
// Each non-player faction carries a persistent strategy that survives
// across months so it can run coherent multi-month campaigns. It lives in
// GameState (not the agent) so it is deterministic and round-trips through
// save/load.
export type AiPosture = 'expand' | 'consolidate' | 'defend';

export interface FactionStrategy {
  posture: AiPosture;
  targetFactionId: FactionId | null; // faction we are campaigning against
  targetCityId: CityId | null; // specific enemy city we mass toward
  stagingCityId: CityId | null; // our city where we concentrate troops
  updatedTurn: number; // turn the strategy was last reassessed
}

export interface Faction {
  id: FactionId;
  name: LocalizedString;
  lordId: GeneralId;
  color: string; // ANSI color key, see ui/theme.ts
  difficulty: 1 | 2 | 3 | 4 | 5;
  personality: Personality;
  alive: boolean;
  money?: number; // optional faction-level treasury for scenarios that pool resources
  food?: number;
}

export type ItemKind = 'weapon' | 'horse' | 'book' | 'token';

export interface Item {
  id: ItemId;
  kind: ItemKind;
  name: LocalizedString;
  // Stat bonuses granted to the carrier. Applied additively in combat.
  bonus: Partial<Stats>;
  // For weapons: damage modifier (1.0 = neutral). For horses: movement.
  modifier?: number;
  // Tokens unlock troop types: 'heavyCav' | 'xuan' | 'navy'.
  unlocks?: TroopType[];
  // Where the item starts on the map. null = held by initial owner.
  location?: { cityId: CityId; foundBy?: GeneralId };
}

// A logged event in the game. The engine emits message keys + variables so
// the UI can render them in either locale. Variable values may be
// LocalizedString objects (proper nouns); the i18n layer resolves them
// against the active locale at render time.
export interface LogEntry {
  turn: number;
  year: number;
  month: number;
  key: string; // i18n MessageKey
  vars?: Record<string, string | number | LocalizedString>;
  factionId?: FactionId;
}

export interface EventRecord {
  id: string; // event id, e.g. 'guandong_coalition'
  turn: number;
  year: number;
  month: number;
}

// Battle (tactical layer) state. Active only while a city is being besieged.
export interface BattleUnit {
  id: string; // unit id within the battle
  generalId: GeneralId;
  factionId: FactionId;
  troops: number;
  troopType: TroopType;
  pos: { x: number; y: number }; // battlefield-local grid (smaller than world)
  morale: number; // 0-100
  hasActed: boolean;
}

export interface Battle {
  cityId: CityId; // city being attacked
  attackerFactionId: FactionId;
  defenderFactionId: FactionId;
  daysElapsed: number; // 30-day timeout triggers attacker auto-retreat
  units: BattleUnit[];
  field: { width: number; height: number };
  log: LogEntry[];
}

// Commands emitted by AI agents (or the player) at the strategic layer.
export type StrategicCommand =
  | { kind: 'develop'; cityId: CityId; generalId: GeneralId }
  | { kind: 'commerce'; cityId: CityId; generalId: GeneralId }
  | { kind: 'govern'; cityId: CityId; generalId: GeneralId }
  | { kind: 'patrol'; cityId: CityId; generalId: GeneralId }
  | { kind: 'search'; cityId: CityId; generalId: GeneralId }
  | { kind: 'recruit'; cityId: CityId; count: number }
  | { kind: 'plunder'; cityId: CityId } // Dong Zhuo's evil option
  | { kind: 'hireWild'; cityId: CityId; generalId: GeneralId; targetGeneralId: GeneralId }
  | {
      kind: 'attack';
      fromCityId: CityId;
      toCityId: CityId;
      generalIds: GeneralId[];
      troops: number;
    }
  | { kind: 'move'; fromCityId: CityId; toCityId: CityId; generalIds: GeneralId[]; troops: number }
  | {
      kind: 'defect';
      fromCityId: CityId; // player-owned city paying the bribe (must be adjacent to target)
      targetGeneralId: GeneralId;
      gold: number; // amount offered; must be >= defectionCost(target)
    }
  | { kind: 'endTurn' };

// Commands emitted at the tactical (battlefield) layer.
export type TacticalCommand =
  | { kind: 'march'; unitId: string; target: { x: number; y: number } }
  | { kind: 'meleeAttack'; unitId: string; targetUnitId: string }
  | { kind: 'rangedAttack'; unitId: string; targetUnitId: string }
  | { kind: 'stratagem'; unitId: string; targetUnitId: string }
  | { kind: 'hold'; unitId: string }
  | { kind: 'retreat'; unitId: string };

export interface AgentContext {
  state: GameState;
  factionId: FactionId;
  // Supplied by the turn loop, which calls agent.reassess() before
  // agent.decideStrategic(). Absent only in direct unit-test calls.
  strategy?: FactionStrategy;
}

export interface FactionAgent {
  // Recompute the faction's standing strategy. Called by the turn loop
  // before decideStrategic each month; the result is persisted into
  // GameState.aiStrategies and passed back via AgentContext.strategy.
  reassess(ctx: AgentContext, current: FactionStrategy | null): FactionStrategy;
  decideStrategic(ctx: AgentContext): StrategicCommand[];
  decideTactical(battle: Battle, ctx: AgentContext): TacticalCommand[];
}

// Event triggers attached to scenarios. The handler returns a (possibly
// modified) GameState plus log entries for the UI to surface.
export interface ScenarioEvent {
  id: string;
  // Cheap predicate; called every month. Should be deterministic given state.
  check: (state: GameState) => boolean;
  // Applied once `check` passes. The event id is added to `state.events` to
  // prevent re-firing.
  apply: (state: GameState) => GameState;
  oneShot?: boolean; // default true
}

export interface VictoryCondition {
  // 'unify' = own all cities
  // 'dominate' = own >= N cities AND hold required capitals
  // 'historic' = follow scripted historical events
  kind: 'unify' | 'dominate' | 'historic';
  cityCount?: number;
  requiredCityIds?: CityId[];
}

export interface FactionSetup {
  id: FactionId;
  name: LocalizedString;
  lordId: GeneralId;
  color: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  personality: Personality;
  cityIds: CityId[];
  generalIds: GeneralId[];
  resources: { money: number; food: number; troops: number };
}

export interface Scenario {
  id: string;
  name: LocalizedString;
  description: LocalizedString;
  startYear: number;
  startMonth: number; // 1-12
  factions: FactionSetup[];
  victory: VictoryCondition;
  // Implemented = full data wired up. todo = stub for planning only.
  todo?: boolean;
}

export interface GameState {
  scenarioId: string;
  year: number;
  month: number; // 1-12
  day: number; // 1-30 (we model 30-day months for tractability)
  turn: number; // total months since scenario start
  playerFactionId: FactionId;
  factions: Record<FactionId, Faction>;
  cities: Record<CityId, City>;
  generals: Record<GeneralId, General>;
  items: Record<ItemId, Item>;
  ownedItems: Record<GeneralId, ItemId[]>;
  events: EventRecord[];
  log: LogEntry[];
  // Seeded RNG state; serialized into save files so replays are deterministic.
  rngState: number;
  pendingBattle?: Battle;
  // Recorded actions; replay re-applies them on the initial state with the
  // same rngState. Empty until the first action runs.
  actionLog: { turn: number; command: StrategicCommand; factionId: FactionId }[];
  // Persistent-game operations in flight. Each op ticks down 1 day per
  // tickDays() and applies its effect via the engine functions when its
  // daysRemaining hits zero. See pendingOp.ts for the constructors and
  // the per-kind completion handlers.
  pendingOps: PendingOp[];
  // Monotonic counter for unique op ids.
  nextOpId: number;
  // Per-faction AI strategy, keyed by FactionId. Player faction has no
  // entry. Empty at scenario start; populated by the turn loop's
  // reassess step. See engine/ai/strategy.ts.
  aiStrategies: Record<FactionId, FactionStrategy>;
}

// ----- Persistent-game operations -----
//
// Each player or AI command now schedules a PendingOp instead of being
// applied instantly. The op ticks down 1 day per tickDays() call; when
// daysRemaining hits 0 the engine applies the resulting state change
// (using the existing develop/commerce/.../resolveQuickBattle code).
//
// `march` is a special two-stage op: it represents an army moving from
// `fromCityId` to `toCityId` over its march duration. On completion,
// if `intent === 'attack'` the engine spawns a follow-up `siege` op at
// the target; if `intent === 'reinforce'` the troops + generals are
// folded into the destination city's garrison.

export type OpKind =
  | 'develop'
  | 'commerce'
  | 'govern'
  | 'patrol'
  | 'search'
  | 'recruit'
  | 'plunder'
  | 'defect'
  | 'march'
  | 'siege';

interface OpBase {
  id: number;
  kind: OpKind;
  factionId: FactionId;
  durationDays: number; // total duration
  daysRemaining: number; // counts down to 0
}

export type PendingOp =
  | (OpBase & { kind: 'develop'; cityId: CityId; generalId: GeneralId })
  | (OpBase & { kind: 'commerce'; cityId: CityId; generalId: GeneralId })
  | (OpBase & { kind: 'govern'; cityId: CityId; generalId: GeneralId })
  | (OpBase & { kind: 'patrol'; cityId: CityId; generalId: GeneralId })
  | (OpBase & { kind: 'search'; cityId: CityId; generalId: GeneralId })
  | (OpBase & { kind: 'recruit'; cityId: CityId; count: number })
  | (OpBase & { kind: 'plunder'; cityId: CityId })
  | (OpBase & {
      kind: 'defect';
      fromCityId: CityId;
      targetGeneralId: GeneralId;
      gold: number;
    })
  | (OpBase & {
      kind: 'march';
      fromCityId: CityId;
      toCityId: CityId;
      generalIds: GeneralId[];
      troops: number;
      // 'attack' marches into hostile/neutral territory and turns into a
      // siege on arrival. 'reinforce' folds into a friendly city.
      intent: 'attack' | 'reinforce';
    })
  | (OpBase & {
      kind: 'siege';
      targetCityId: CityId;
      generalIds: GeneralId[];
      troops: number;
    });
