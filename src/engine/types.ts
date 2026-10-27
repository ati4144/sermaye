import type { RngState } from './rng';

/**
 * Data contract for the whole game. Everything here must stay
 * JSON-serializable (no Date, Map, Set, functions, class instances) because:
 *  - saves are JSON in AsyncStorage,
 *  - determinism tests hash JSON.stringify(state),
 *  - the future shared-world server broadcasts state diffs as JSON.
 *
 * Static definitions (CountryDef, EventDef) are *not* part of GameState; they
 * ship with the app and are versioned with it.
 */

// ---------- Static data (never saved) ----------

export type RiskGrade = 'A' | 'B' | 'C';

export interface CountryDef {
  /** short id, e.g. 'tr' — i18n key countries.<id>.name */
  id: string;
  grade: RiskGrade;
  /** expected annual growth, e.g. 0.07 */
  baseDrift: number;
  /** annual volatility (sigma), e.g. 0.18 */
  baseVol: number;
}

export type EventScope = 'GLOBAL' | 'COUNTRY' | 'ASSET';

export type EventTrigger = 'MARKET' | 'LIFE' | 'FATE';

export interface EventEffect {
  /** countryId, assetId, 'SELF' (triggering market), or 'GLOBAL' */
  target: string;
  /** immediate index multiplier on trigger/resolve, e.g. 0.78 */
  indexShock?: number;
  /** per-month drift addition applied for `duration` months */
  driftDelta?: number;
  /** per-month volatility addition applied for `duration` months */
  volDelta?: number;
  /** per-month yield addition (asset markets only) applied for `duration` months */
  yieldDelta?: number;
  /** per-month quick-sale discount addition (asset markets only) for `duration` months */
  liqDelta?: number;
  /** months the deltas last; 0/omitted = shock only */
  duration?: number;
}

export interface EventOption {
  effects: EventEffect[];
  /** cost as a fraction of current net worth */
  costPctNetWorth?: number;
  /** flat cash cost */
  cashCost?: number;
  /** signed cash grant/loss (fate beats; |v| <= balance.FATE.CASH_DELTA_CAP) */
  cashDelta?: number;
  /** immediate health change for the player */
  healthDelta?: number;
  /** set married state (marriage event) */
  setMarried?: boolean;
  /** fate-side effects, applied only when the run has a fate (CHOSEN/RANDOM) */
  fate?: FateOption;
  /** v6 kader hook — gift the player units of an asset (fractional or DEED); inert when the asset layer is null */
  grantAsset?: { assetId: string; units: number };
  /** v6 kader hook — take DEED units away (units omitted = the whole position); no-op when unowned */
  takeAsset?: { assetId: string; units?: number };
  /** v6 life hook — one-way player-scoped flag (e.g. 'eve_cikti') */
  setLifeFlag?: string;
}

/** Fate mutations carried by an EventOption — resolved on RESOLVE_EVENT. */
export interface FateOption {
  setFlag?: string;
  /** PENDING beats with these keys → LOST */
  cancelBeats?: string[];
  counters?: Record<string, number>;
  /** reveal the destiny now (revealedTick = current tick) */
  reveal?: boolean;
  /** each field shifted by its value (content uses ±0.1), clamped to MOD_CLAMP */
  modShift?: Partial<FateMods>;
}

export interface EventDef {
  /** i18n key events.<id>.title / .text / .options.<n> */
  id: string;
  scope: EventScope;
  trigger?: EventTrigger; // default MARKET (random events); LIFE events are enqueued by life.ts
  /** COUNTRY events: countryId or RiskGrade; ASSET events: assetId; GLOBAL/LIFE: undefined */
  appliesTo?: string;
  /** per-tick trigger probability */
  p: number;
  /** months before this event can fire again */
  cooldown: number;
  minTick?: number;
  /** pure state predicate; must not draw */
  condition?: (s: GameState) => boolean;
  /** applied at trigger time for non-choice events */
  effects: EventEffect[];
  /** choice events: effects/costs apply on RESOLVE_EVENT */
  options?: EventOption[];
}

// ---------- Runtime state (all saved) ----------

export interface ActiveModifier {
  /** `${eventId}:${tick}` — deterministic unique id */
  id: string;
  driftDelta: number; // per-month
  volDelta: number; // per-month
  /** asset markets only: monthly yield addition (default 0 on countries) */
  yieldDelta?: number;
  /** asset markets only: quick-sale discount addition (default 0 on countries) */
  liqDelta?: number;
  remaining: number; // months
}

export interface CountryState {
  id: string;
  index: number; // starts at 100
  mods: ActiveModifier[];
  indexHistory: number[]; // capped ring of recent samples (sparklines)
  lastEventTick: Record<string, number>; // eventId -> tick it last fired
}

export interface Holding {
  units: number;
  avgCost: number;
}

// ---------- Asset classes (v3 — "Varlık Kataloğu") ----------

export interface AssetDef {
  /** short id, e.g. 'gold' — i18n key assets.<id>.name; never a countryId */
  id: string;
  /** FRACTIONAL lives in `holdings` (like countries); DEED lives in `properties` (whole units) */
  kind: 'FRACTIONAL' | 'DEED';
  category: 'METAL' | 'REAL_ESTATE' | 'LAND' | 'VEHICLE';
  grade: RiskGrade; // badge/colour language only — never the country fee machine
  /** $/unit at tick 0; current price = startPrice × index/100 */
  startPrice: number;
  baseDrift: number; // annual
  baseVol: number; // annual
  /** monthly net income per unit (negative = upkeep); applied in phase 4a */
  yieldNetM: number;
  fee: number; // both directions, × fate fee mod
  /** quick-sale discount for DEED sells (0 for FRACTIONAL) */
  quickDiscount: number;
}

/**
 * Structurally identical to a CountryState — same evolution formula, same
 * modifier machinery, same history ring. Asset indexes start at 100 and the
 * unit price is startPrice × index/100.
 */
export type AssetMarketState = CountryState;

/** One aggregate position per DEED class (no serial counters to fork). */
export interface AssetPosition {
  classId: string;
  units: number; // whole units
  avgCost: number; // round4, Holding pattern
  firstBuyTick: number;
  /** cumulative net rent collected (UI card; upkeep-only classes stay 0) */
  rentCollected: number;
}

/** The v3 asset layer — null on legacy v2 saves until the player opts in. */
export interface AssetsState {
  /** frozen catalog snapshot (future classes open via ACTIVATE_ASSET, faz 3) */
  activeIds: string[];
  markets: Record<string, AssetMarketState>;
}

export interface Child {
  /** `c${birthTick}` */
  id: string;
  birthTick: number;
  alive: boolean;
}

export interface Player {
  generation: number; // 1 = founder
  /** family name — persists across generations */
  name: string;
  birthTick: number; // negative for the founder (born before game start)
  health: number; // 0..100
  alive: boolean;
  married: boolean;
  children: Child[];
  /**
   * v6 — tick the current marriage was entered (stamped only while the Yuva
   * layer is active; it exists solely for the eve_cikma timing). Dropped with
   * the fresh Player object at inheritance.
   */
  marriedTick?: number;
  /** v6 — one-way life flags ('eve_cikti'); reset at inheritance. */
  lifeFlags?: Record<string, true>;
}

export interface PendingEvent {
  /** `${tick}:${eventId}:${countryId ?? 'g'}` */
  uid: string;
  eventId: string;
  tick: number;
  countryId?: string; // for i18n interpolation
  hasChoice: boolean;
}

export interface LogEntry {
  tick: number;
  uid: string;
  eventId: string;
  countryId?: string;
  optionIndex?: number; // set for resolved choice events
  netWorth: number;
  generation: number;
  // v3 asset entries (bought / sold / forced sale / layer activation)
  assetId?: string;
  assetUnits?: number;
  assetAmount?: number;
  regimeId?: string; // v4: regime change entries
  newsId?: string; // v4: scenario headlines ("scenarioId:index")
}

// ---------- World layer (v4 — "Dünya Paketi": regimes + agenda) ----------

export type RegimeId = 'growth' | 'boom' | 'crisis' | 'stagnation';

export interface RegimeHistoryEntry {
  id: RegimeId;
  sinceTick: number;
}

export interface WorldState {
  /** current world regime — modulates drift/vol/event probabilities */
  regime: RegimeId;
  regimeSinceTick: number;
  /** capped regime history for the UI */
  history: RegimeHistoryEntry[];
  /** agenda topic weights (topicId -> 0..1) — tilts event probabilities */
  agenda: Record<string, number>;
  /** active scenario id, or null for the open-ended current era */
  scenarioId: string | null;
  /** index of the next scenario beat to apply (scenario runs only) */
  beatCursor: number;
}

// ---------- Expenses ("Gider Kalemleri", v5) ----------

export type LifestyleTier = 'frugal' | 'standard' | 'comfort' | 'luxury';

export interface ExpenseItem {
  /** `e${seq}` — monotonic, replay-stable (the seq counter lives in state) */
  id: string;
  /** PRESET items come from the lifestyle tier and are replaced wholesale by SET_LIFESTYLE; CUSTOM items are player-added and always survive */
  kind: 'PRESET' | 'CUSTOM';
  /** PRESET i18n key suffix ('rent' → expenses.items.rent); CUSTOM omits it */
  key?: string;
  /** CUSTOM free text (1-40 chars); PRESET omits it */
  label?: string;
  /** monthly $, roundCash, > 0 */
  amount: number;
}

/** One month's recurring cash-flow breakdown (recorded at phase 4b, capped). */
export interface CashflowMonth {
  tick: number;
  /** asset income: rent/harvest in (>= 0) */
  rent: number;
  /** asset income: upkeep out (>= 0, stored positive) */
  upkeep: number;
  /**
   * lifestyle + custom expense items charged (post fate-mod). v8: the basket
   * is home-CPI indexed (itemsSum × cpi) — no `cpi` key is stored on the row;
   * the UI chip derives from the live residency state.
   */
  items: number;
  /**
   * net-worth levy (NETWORTH_RATE × worth, post fate-mod). v8: deliberately
   * NOT CPI-indexed — the levy base (net worth) self-indexes through the
   * inflated asset prices, so a second multiplier would double-count.
   */
  wealthLevy: number;
  /** salary + rent − upkeep − items − wealthLevy (the tick-attributable net) */
  net: number;
  /**
   * v6 Yuva relief deducted from the living cost this month (present only on
   * months with relief > 0 — pre-v6 rows and relief-less months omit it).
   */
  relief?: number;
  /**
   * v7 salary credited this month (present only on months with salary > 0 —
   * pre-v7 rows and unemployed months omit it, staying byte-identical).
   */
  salary?: number;
}

export interface ExpensesState {
  lifestyle: LifestyleTier;
  items: ExpenseItem[];
  /** monotonic id counter — ids are never reused within a save */
  seq: number;
  /** last N monthly cash-flow breakdowns (FLOW_CAP) */
  flow: CashflowMonth[];
}

// ---------- Yuva & escrow ("Yuva katmanı", v6 — Yatırım Faz 2) ----------

/** One deed sale in escrow (LIST_ASSET). Proceeds lock at listing time. */
export interface PendingSale {
  /** `${tick}:${assetId}:${pendingSales.length}` — unique among live entries */
  uid: string;
  /** DEED class only (fractional assets sell instantly) */
  assetId: string;
  /** whole units in escrow — removed from `properties`, so they earn no rent */
  units: number;
  /** roundCash(units × price × (1 − fee)) AT LISTING — no quick-sale discount */
  proceeds: number;
  /** listedTick + balance.ASSETS.ESCROW_MONTHS — phase 4c collects on/before */
  dueTick: number;
  /** position snapshot restored verbatim by CANCEL_LISTING */
  avgCost: number;
  firstBuyTick: number;
  rentCollected: number;
}

export type HomeRole = 'rental' | 'home';

/**
 * The v6 "Yuva" (hearth) layer — whether the player lives in a home they own.
 * null on pre-v6 saves (relief 0 → living formula bit-identical).
 */
export interface HomeState {
  role: HomeRole;
  /** owned REAL_ESTATE deed class lived in; null while renting */
  assetId: string | null;
  sinceTick: number;
}

/**
 * The v7 income layer — the player's monthly salary. Null on pre-v7 saves
 * (inert: no credit, no employment transitions, replay bit-for-bit) until the
 * player activates via INIT_INCOME. The amount is player-entered (new-game
 * question, yearly raise review, manual edits via SET_SALARY) — the engine
 * only stores and credits it.
 */
export interface IncomeState {
  /** monthly salary in USD (roundCash; player-entered, 0 < x <= SALARY_MAX) */
  salaryM: number;
  /** false while unemployed — salaryFor returns 0; health-gated transitions */
  employed: boolean;
  /** tick of the last salary review — the UI asks again every 12 months */
  lastReviewTick: number;
}

/**
 * The v8 residency layer — the family's home country and its cumulative CPI
 * index. Drives the home-CPI inflation path: asset drift gains the monthly
 * rate (nominal price appreciation), the living basket indexes by `cpi`, and
 * the bankruptcy threshold scales with it. Null on pre-v8 saves (inert:
 * cpi multiplier 1, no drift add-on, replay bit-for-bit) until the player
 * activates via INIT_RESIDENCY.
 */
export interface ResidencyState {
  /** COUNTRY_IDS member — the family's country (survives inheritance) */
  countryId: string;
  /** cumulative CPI index, starts at 100, round4, compounds monthly */
  cpi: number;
  /** activation stamp — 0 on new games, s.tick on INIT_RESIDENCY */
  sinceTick: number;
}

// ---------- Fate ("Kader") ----------

/**
 * Fate multipliers — every field defaults to 1 and is clamped to
 * balance.FATE.MOD_CLAMP at creation (and after each modShift). Hazard fields
 * multiply the *comparison side* of the life draws only (never the draw
 * itself); economics fields multiply the named player-side cost.
 */
export interface FateMods {
  illness: number;
  death: number;
  marriage: number;
  birth: number;
  spouse: number;
  child: number;
  livingCost: number;
  estateTax: number;
  fee: number;
}

/** One resolved beat of the destiny timeline — a pure data snapshot. */
export interface FateBeatState {
  /** unique beat key, indexes into the static beat catalogs */
  key: string;
  /** concrete event id (variant resolved at creation) */
  eventId: string;
  /** [from, to] inclusive, months since game start */
  window: [number, number];
  /** month this beat is scheduled to fire (jittered at creation, deferred at runtime) */
  plannedTick: number;
  /** beat keys that must be FIRED before this one can fire */
  requires: string[];
  personal: boolean; // personal = lost at inheritance; dynastic beats roll to the heir
  status: 'PENDING' | 'FIRED' | 'LOST';
}

export interface FateState {
  mode: 'RANDOM' | 'CHOSEN';
  /** private fate stream — the ONLY fate rng; seeded by one main-stream draw at creation */
  rng: RngState;
  /** destiny id, or 'none' */
  destinyId: string;
  /** answers in fixed FATE_QUESTIONS order; -1 = skipped/not asked */
  answers: number[];
  /** answer + branch flags */
  flags: Record<string, true>;
  /** merged answer × destiny multipliers, clamped */
  mods: FateMods;
  /** full resolved beat timeline (destiny beats then armed answer beats) */
  beats: FateBeatState[];
  /** immutable creation schedule; -1 = never (destiny 'none') */
  revealAtTick: number;
  /** -1 until the reveal fires (scheduled or via an option with fate.reveal) */
  revealedTick: number;
  counters: Record<string, number>;
  /** beats that fired before the reveal — the pre-reveal "omens" */
  omenCount: number;
}

// ---------- Actions ----------

export type EngineAction =
  | { type: 'BUY'; countryId: string; amount: number }
  | { type: 'SELL'; countryId: string; units: number }
  | { type: 'NEXT_MONTH' }
  | { type: 'FAST_FORWARD'; months?: number }
  | { type: 'ACK_EVENT'; uid: string }
  | { type: 'RESOLVE_EVENT'; uid: string; optionIndex: number }
  // v3 asset layer — appended, never renamed (BUY.countryId is frozen history)
  | { type: 'INIT_ASSETS' }
  | { type: 'BUY_ASSET'; assetId: string; amount: number }
  | { type: 'SELL_ASSET'; assetId: string; units: number }
  // v4 world layer — activate regimes + agenda on a legacy run (zero draws)
  | { type: 'INIT_WORLD' }
  // v5 expense layer — itemized living costs, all zero-draw (prices/amounts
  // come from state; no action ever draws)
  | { type: 'INIT_EXPENSES' }
  | { type: 'SET_LIFESTYLE'; tier: LifestyleTier }
  | { type: 'ADD_EXPENSE'; label: string; amount: number }
  | { type: 'UPDATE_EXPENSE'; id: string; amount: number }
  | { type: 'REMOVE_EXPENSE'; id: string }
  // v6 Yuva & escrow layer (Yatırım Faz 2) — patient deed sale via escrow,
  // home ownership role; all zero-draw (prices/fees come from state)
  | { type: 'LIST_ASSET'; assetId: string; units: number }
  | { type: 'CANCEL_LISTING'; uid: string }
  | { type: 'SET_ROLE'; role: HomeRole; assetId?: string }
  | { type: 'ACTIVATE_ASSET'; assetId: string }
  // v7 income layer — player-entered salary; zero-draw (amounts come from
  // the player, credits from state)
  | { type: 'INIT_INCOME'; salaryM?: number }
  | { type: 'SET_SALARY'; salaryM: number }
  // v8 residency layer — the home-country pick; zero-draw (pure initial data)
  | { type: 'INIT_RESIDENCY'; countryId: string };

export interface ActionLogEntry {
  seq: number;
  tick: number;
  action: EngineAction;
}

export type GameStatus =
  | 'PLAYING'
  | 'DECEASED' // death happened; inheritance pending (ACK the death event)
  | 'GAME_OVER_BANKRUPT'
  | 'GAME_OVER_EXTINCT';

export interface GameState {
  schemaVersion: number;
  seed: number; // provenance only — the live stream is `rng`
  rng: RngState;
  tick: number; // months since start
  status: GameStatus;
  countries: Record<string, CountryState>;
  globalMods: ActiveModifier[];
  holdings: Record<string, Holding>;
  cash: number;
  player: Player;
  pendingEvents: PendingEvent[]; // FIFO; head is shown by the UI
  eventLog: LogEntry[];
  netWorthHistory: number[];
  peakNetWorth: number;
  lowWealthStreak: number; // consecutive months below bankruptcy threshold
  actionLog: ActionLogEntry[];
  /** fate thread — null on legacy v1 saves (all reads guarded) */
  fate: FateState | null;
  /**
   * v3 asset layer — null on legacy v2 saves (inert: no draws, no income,
   * replay bit-for-bit) until the player activates via INIT_ASSETS.
   */
  assets: AssetsState | null;
  /** DEED positions, keyed by classId; iterated in catalog order, never Object.keys */
  properties: Record<string, AssetPosition>;
  /**
   * v4 world layer — null on legacy saves (inert: zero draws, zero drift/vol
   * modulation, base event probabilities) until the player activates via
   * INIT_WORLD. New games start with it active.
   */
  world: WorldState | null;
  /**
   * v5 expense layer — itemized living costs + cash-flow history. Null on
   * legacy saves (inert: the flat LIVING.BASE formula runs instead, replay
   * bit-for-bit) until the player activates via INIT_EXPENSES. New games
   * start active at the standard tier, whose items sum exactly to
   * LIVING.BASE — the cash path is identical to the pre-v5 engine.
   */
  expenses: ExpensesState | null;
  /**
   * v6 escrow — deed sales waiting to mature ([] on migration; phase 4c
   * collects due entries, zero draws). Pending units left `properties`, so
   * they earn no rent and are invisible to the liquidation ladder.
   */
  pendingSales: PendingSale[];
  /**
   * v6 Yuva layer — home ownership role. Null on legacy saves (relief 0 →
   * the living formula stays bit-identical) until the player activates it
   * via SET_ROLE (player-consented, zero draws). New games start as renters.
   */
  home: HomeState | null;
  /**
   * v7 income layer — the monthly salary. Null on legacy saves (inert: no
   * credit, no employment transitions, replay bit-for-bit) until the player
   * activates via INIT_INCOME. New games start employed at the salary the
   * opening question captured (default SALARY_DEFAULT).
   */
  income: IncomeState | null;
  /**
   * v8 residency layer — the family's home country and its cumulative CPI.
   * Null on legacy saves (inert: cpiMult 1, no asset-drift add-on, no basket
   * indexing, replay bit-for-bit) until the player activates via
   * INIT_RESIDENCY. New games start active at the country the opening
   * question captured (default 'us').
   */
  residency: ResidencyState | null;
}
