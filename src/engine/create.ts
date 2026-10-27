import { balance } from './balance';
import { COUNTRIES, COUNTRY_IDS } from './data/countries';
import { ASSETS_CATALOG, ASSET_IDS } from './data/assets';
import { createExpenses, isLifestyleTier } from './data/expenses';
import { createRng, nextU32 } from './rng';
import { netWorth, roundCash, round4 } from './market';
import { rollFate } from './fate/roll';
import { applyOpeningBeats, createWorld, packAgenda, REGIME_IDS } from './world';
import { WORLD_PACK } from './worldpack';
import type {
  AssetsState,
  ExpenseItem,
  ExpensesState,
  GameState,
  IncomeState,
  PendingSale,
  ResidencyState,
  WorldState,
} from './types';

export const SCHEMA_VERSION = 8;

export interface NewGameOptions {
  seed: number;
  name: string;
  /**
   * Questionnaire answers in FATE_QUESTIONS order (-1 = skipped). Omitted or
   * all -1 → RANDOM mode ("Kadere Bırak"); any real answer → CHOSEN mode.
   */
  answers?: number[];
  /**
   * Historical scenario id from WORLD_PACK.scenarios (e.g. 'gfc_2008'), or
   * null/omitted for the open-ended current-era world. Zero draws — the
   * regime/agenda initial state is pure data.
   */
  scenarioId?: string | null;
  /**
   * v7 opening-question answer: the player's monthly salary in USD. Omitted or
   * invalid → INCOME.SALARY_DEFAULT. Zero draws — pure initial data.
   */
  salaryM?: number;
  /**
   * v8 opening-question answer: the family's home country (COUNTRY_IDS
   * member). Omitted or unknown → 'us'. Zero draws — pure initial data.
   */
  homeCountryId?: string | null;
}

/** v7 income-layer initializer — zero draws, pure initial data. */
export function createIncome(salaryM: number | undefined): IncomeState {
  const valid =
    typeof salaryM === 'number' && Number.isFinite(salaryM) && salaryM > 0 && salaryM <= balance.INCOME.SALARY_MAX;
  return {
    salaryM: valid ? roundCash(salaryM) : balance.INCOME.SALARY_DEFAULT,
    employed: true,
    lastReviewTick: 0,
  };
}

/** v8 residency-layer initializer — zero draws, pure initial data. */
export function createResidency(homeCountryId: string | null | undefined): ResidencyState {
  const valid = typeof homeCountryId === 'string' && COUNTRY_IDS.indexOf(homeCountryId) >= 0;
  return { countryId: valid ? homeCountryId : 'us', cpi: 100, sinceTick: 0 };
}

export function createNewGame(opts: NewGameOptions): GameState {
  const countries: GameState['countries'] = {};
  for (const def of COUNTRIES) {
    countries[def.id] = {
      id: def.id,
      index: 100,
      mods: [],
      indexHistory: [100],
      lastEventTick: {},
    };
  }

  // New games get the full asset catalog active from day one — zero draws,
  // pure initial state (legacy v2 saves stay null until INIT_ASSETS).
  const assets: AssetsState = {
    activeIds: ASSETS_CATALOG.map((d) => d.id),
    markets: {},
  };
  for (const def of ASSETS_CATALOG) {
    assets.markets[def.id] = {
      id: def.id,
      index: 100,
      mods: [],
      indexHistory: [100],
      lastEventTick: {},
    };
  }

  const s: GameState = {
    schemaVersion: SCHEMA_VERSION,
    seed: opts.seed >>> 0,
    rng: createRng(opts.seed),
    tick: 0,
    status: 'PLAYING',
    countries,
    globalMods: [],
    holdings: {},
    cash: balance.START_CASH,
    player: {
      generation: 1,
      name: opts.name,
      birthTick: -balance.START_AGE_MONTHS,
      health: 100,
      alive: true,
      married: false,
      children: [],
    },
    pendingEvents: [],
    eventLog: [],
    netWorthHistory: [],
    peakNetWorth: balance.START_CASH,
    lowWealthStreak: 0,
    actionLog: [],
    fate: null,
    assets,
    properties: {},
    // v4 world layer — active from the start on new games (zero draws here:
    // pure initial data; the per-tick regime float only starts in tick())
    world: createWorld(opts.scenarioId ?? null, 0),
    // v5 expense layer — active from the start on new games. The standard
    // preset sums exactly to LIVING.BASE, so the cash path matches the flat
    // pre-v5 formula bit-for-bit (legacy saves stay null until INIT_EXPENSES).
    expenses: createExpenses(),
    // v6 Yuva & escrow layer — renters from day one (relief 0 → the living
    // formula keeps the exact v5 expression) and an empty escrow ledger.
    // Legacy saves migrate to home: null (inert until SET_ROLE).
    pendingSales: [],
    home: { role: 'rental', assetId: null, sinceTick: 0 },
    // v7 income layer — employed from day one at the opening-question salary
    // (default SALARY_DEFAULT). Legacy saves migrate to income: null (inert
    // until INIT_INCOME); the credit is zero-draw, phase 4a-pre.
    income: createIncome(opts.salaryM),
    // v8 residency layer — the home country from day one, CPI starting at
    // 100. Legacy saves migrate to residency: null (inert until
    // INIT_RESIDENCY); the whole inflation path is zero-draw.
    residency: createResidency(opts.homeCountryId),
  };

  // Fate: exactly ONE unconditional draw from the main stream seeds the
  // private fate stream — the only main-stream draw fate ever takes. Every
  // other fate draw (destiny, jitter, variants, reveal, inheritance) comes
  // from s.fate.rng, so the world/life stream is creation-isolated.
  const fateSeed = nextU32(s.rng);
  s.fate = rollFate(s, fateSeed, opts.answers);

  // v4: the scenario's atTick-0 opening beat (if any) fires here — zero
  // draws, headline stamped tick 0 so month one starts with exactly one
  // beat. The netWorth backfill mirrors sim.ts phase 5 (entries log 0 while
  // a tick is still running; creation fills them right away).
  applyOpeningBeats(s);
  const worth0 = roundCash(netWorth(s));
  for (let i = 0; i < s.eventLog.length; i++) {
    if (s.eventLog[i].netWorth === 0) s.eventLog[i].netWorth = worth0;
  }
  s.netWorthHistory.push(worth0);
  return s;
}

/**
 * Lossless engine-side migration, chained step by step:
 *  v1 → v2: `fate: null` (inert run — no destiny, neutral mods via ?? guards)
 *  v2 → v3: `assets: null, properties: {}` (inert asset layer — no draws, no
 *           income, no events; replay bit-for-bit until the player activates
 *           the layer via INIT_ASSETS, which itself draws nothing)
 *  v3 → v4: `world: null` (inert world layer — no regime float, identity
 *           drift/vol, base event probabilities; replay bit-for-bit until
 *           the player activates via INIT_WORLD, which itself draws nothing)
 *  v4 → v5: `expenses: null` (inert expense layer — the flat LIVING.BASE
 *           formula keeps running; replay bit-for-bit until the player
 *           activates via INIT_EXPENSES, which itself draws nothing)
 *  v5 → v6: `pendingSales: [], home: null` (inert Yuva & escrow layer — no
 *           relief, no escrow collection, no eve_cikma; replay bit-for-bit
 *           until the player activates via SET_ROLE, which draws nothing)
 *  v6 → v7: `income: null` (inert income layer — no salary credit, no
 *           employment transitions; replay bit-for-bit until the player
 *           activates via INIT_INCOME, which draws nothing)
 *  v7 → v8: `residency: null` (inert residency layer — cpi multiplier 1, no
 *           asset-drift add-on, no basket indexing; replay bit-for-bit until
 *           the player activates via INIT_RESIDENCY, which draws nothing)
 * replay() applies this on entry so (initial, actionLog) pairs from any
 * schema version reproduce identically.
 */
export function migrateState(state: GameState): GameState {
  if (state.schemaVersion >= SCHEMA_VERSION) return state;
  let st = state;
  if (st.schemaVersion < 2) {
    st = { ...st, schemaVersion: 2, fate: null };
  }
  if (st.schemaVersion < 3) {
    st = { ...st, schemaVersion: 3, assets: null, properties: {} };
  }
  if (st.schemaVersion < 4) {
    st = { ...st, schemaVersion: 4, world: null };
  }
  if (st.schemaVersion < 5) {
    st = { ...st, schemaVersion: 5, expenses: null };
  }
  if (st.schemaVersion < 6) {
    st = { ...st, schemaVersion: 6, pendingSales: [], home: null };
  }
  if (st.schemaVersion < 7) {
    st = { ...st, schemaVersion: 7, income: null };
  }
  if (st.schemaVersion < 8) {
    st = { ...st, schemaVersion: 8, residency: null };
  }
  return st;
}

/**
 * Repair a persisted save whose asset layer predates the current catalog
 * shape (dev-stage saves can carry missing or since-renamed market ids — the
 * UI reads `assets.markets[id]` unguarded, so a gap is a crash). Runs at the
 * STORE boundary on every rehydration, never inside replay/applyAction,
 * whose contract keeps states well-formed.
 *
 * v6 re-scope: activeIds is a FROZEN snapshot of what the save activated —
 * catalog growth (villa) must NOT silently inject +12 draws/month into old
 * runs; the player opts in via ACTIVATE_ASSET. Unknown ids are pruned from
 * activeIds; markets exist only for active ids — missing ones come back at
 * the activation baseline (index 100, no draws), known-but-inactive or
 * unknown market rows are dropped. Returns the SAME reference when the layer
 * is already healthy, so hydration stays cheap.
 */
export function healAssets(state: GameState): GameState {
  if (!state.assets) return state;
  // dev-stage shapes can lack either key entirely — never throw mid-hydration
  const sourceMarkets =
    state.assets.markets && typeof state.assets.markets === 'object' ? state.assets.markets : {};
  const sourceActive = Array.isArray(state.assets.activeIds) ? state.assets.activeIds : [];
  const known = new Set(ASSET_IDS);
  const activeIds = sourceActive.filter((id) => known.has(id));
  const markets: AssetsState['markets'] = {};
  let changed = sourceMarkets !== state.assets.markets || sourceActive !== state.assets.activeIds;
  for (const id of activeIds) {
    const m = sourceMarkets[id];
    if (m && typeof m.index === 'number' && Array.isArray(m.indexHistory)) {
      markets[id] = m;
    } else {
      markets[id] = { id, index: 100, mods: [], indexHistory: [100], lastEventTick: {} };
      changed = true;
    }
  }
  // any source market row that did not survive (unknown id, or known but not
  // active) is dropped — markets mirror activeIds exactly
  if (Object.keys(sourceMarkets).some((id) => markets[id] === undefined)) changed = true;
  if (activeIds.length !== sourceActive.length) changed = true; // pruned unknowns
  const properties = state.properties ?? {};
  if (properties !== state.properties) changed = true;
  if (!changed) return state;
  return { ...state, assets: { activeIds, markets }, properties };
}

/**
 * Repair a persisted save whose world layer predates the final v4 shape —
 * dev-stage v4 envelopes can carry a typo'd/missing regime id, an agenda
 * missing topics from a newer pack, or a scenario id the current pack
 * renamed/dropped (the same hazard class healAssets exists for; design §11.8).
 * Unknown scenario ids degrade to scenario-less: the remaining beats park and
 * the run keeps its regime — the save never locks. Every other gap fills
 * from a fresh world at the save's tick. Returns the SAME reference when the
 * layer is already healthy, so hydration stays cheap. Runs at the STORE
 * boundary only — replay/applyAction contract states stay well-formed.
 */
export function healWorld(state: GameState): GameState {
  const w = state.world;
  if (!w) return state;

  const regimeOk = REGIME_IDS.indexOf(w.regime) >= 0;
  const regime = regimeOk ? w.regime : 'growth';
  const sinceOk =
    typeof w.regimeSinceTick === 'number' && Number.isFinite(w.regimeSinceTick) && w.regimeSinceTick <= state.tick;
  const regimeSinceTick = sinceOk ? w.regimeSinceTick : state.tick;

  const history: WorldState['history'] = [];
  if (Array.isArray(w.history)) {
    for (const h of w.history) {
      if (h && REGIME_IDS.indexOf(h.id) >= 0 && typeof h.sinceTick === 'number' && Number.isFinite(h.sinceTick)) {
        history.push({ id: h.id, sinceTick: h.sinceTick });
      }
    }
    while (history.length > 24) history.shift(); // keep the latest, like production
  }
  if (history.length === 0) history.push({ id: regime, sinceTick: regimeSinceTick });

  // merge over the pack defaults: fills topics a newer pack added, drops
  // topics it retired — agendaEventMult skips unknown ids anyway
  const agenda = packAgenda();
  if (w.agenda && typeof w.agenda === 'object') {
    for (const [topic, weight] of Object.entries(w.agenda)) {
      if (typeof weight === 'number' && Number.isFinite(weight) && weight >= 0 && weight <= 1) {
        agenda[topic] = weight;
      }
    }
  }

  const scenarioOk = typeof w.scenarioId === 'string' && WORLD_PACK.scenarios.some((d) => d.id === w.scenarioId);
  const scenarioId = scenarioOk ? (w.scenarioId as string) : null;
  const beatCount = scenarioOk
    ? WORLD_PACK.scenarios.find((d) => d.id === w.scenarioId)!.beats.length
    : 0;
  // A garbage cursor (float/negative — dev-stage envelopes) RETIRES the arc
  // rather than resetting to 0: replaying consumed beats would dump backdated
  // headlines and regime flips into one tick. Unknown scenarios retire above.
  const beatCursor =
    typeof w.beatCursor === 'number' && Number.isInteger(w.beatCursor) && w.beatCursor >= 0
      ? Math.min(w.beatCursor, beatCount)
      : beatCount;

  const healed: WorldState = { regime, regimeSinceTick, history, agenda, scenarioId, beatCursor };
  if (JSON.stringify(healed) === JSON.stringify(w)) return state;
  return { ...state, world: healed };
}

/**
 * Repair a persisted save whose expense layer predates the final v5 shape —
 * dev-stage envelopes can carry a typo'd tier id, malformed items, a seq
 * behind the highest live id, or an over-long flow ring (the same hazard
 * class healAssets/healWorld exist for). Malformed items are dropped,
 * amounts are re-clamped, seq is pushed past the highest surviving id (ids
 * are never reused within a save), flow keeps its latest FLOW_CAP entries.
 * Returns the SAME reference when the layer is already healthy, so
 * hydration stays cheap. Runs at the STORE boundary only — the
 * replay/applyAction contract keeps states well-formed.
 */
export function healExpenses(state: GameState): GameState {
  const e = state.expenses;
  if (!e) return state;

  const lifestyle = isLifestyleTier(e.lifestyle) ? e.lifestyle : 'standard';

  const sourceItems = Array.isArray(e.items) ? e.items : [];
  const items: ExpenseItem[] = [];
  for (const it of sourceItems) {
    if (!it) continue;
    const idOk = typeof it.id === 'string' && /^e\d+$/.test(it.id);
    const labelOk =
      it.kind === 'PRESET'
        ? typeof it.key === 'string' && it.key.length > 0
        : it.kind === 'CUSTOM' &&
          typeof it.label === 'string' &&
          it.label.trim().length >= 1 &&
          it.label.length <= balance.EXPENSES.LABEL_MAX;
    const amount =
      typeof it.amount === 'number' && Number.isFinite(it.amount) && it.amount > 0
        ? Math.min(roundCash(it.amount), balance.EXPENSES.AMOUNT_MAX)
        : NaN;
    if (!idOk || !labelOk || !Number.isFinite(amount)) continue;
    // keep the original ref while the entry is perfectly healthy (same-
    // reference fast path for the common case)
    if (it.amount === amount) {
      items.push(it);
    } else if (it.kind === 'PRESET') {
      items.push({ id: it.id, kind: 'PRESET', key: it.key, amount });
    } else {
      items.push({ id: it.id, kind: 'CUSTOM', label: it.label, amount });
    }
  }

  let seq = typeof e.seq === 'number' && Number.isInteger(e.seq) && e.seq >= 0 ? e.seq : 0;
  for (const it of items) {
    const n = parseInt(it.id.slice(1), 10);
    if (Number.isFinite(n) && n > seq) seq = n;
  }

  const sourceFlow = Array.isArray(e.flow) ? e.flow : [];
  const flow = sourceFlow.filter(
    (f) =>
      f &&
      Number.isInteger(f.tick) &&
      f.tick >= 0 &&
      f.tick <= state.tick &&
      [f.rent, f.upkeep, f.items, f.wealthLevy, f.net].every(
        (v) => typeof v === 'number' && Number.isFinite(v)
      )
  );
  while (flow.length > balance.EXPENSES.FLOW_CAP) flow.shift(); // keep the latest

  const healed: ExpensesState = { lifestyle, items, seq, flow };
  if (JSON.stringify(healed) === JSON.stringify(e)) return state;
  return { ...state, expenses: healed };
}

/**
 * Repair a persisted save whose v6 Yuva & escrow layer predates the final
 * shape — dev-stage envelopes can carry a typo'd role, a home assetId the
 * catalog no longer knows (or that is not REAL_ESTATE), a sinceTick in the
 * future, or malformed pending-sale rows (the same hazard class the other
 * healers exist for). A bad home degrades to renting; malformed escrow rows
 * are dropped (the deeds themselves already left `properties`, so a dropped
 * row would strand units — conscious: heal only runs on corrupt dev-stage
 * envelopes, never on production states the engine itself wrote). Returns
 * the SAME reference when the layer is already healthy, so hydration stays
 * cheap. Runs at the STORE boundary only — replay/applyAction contract
 * states stay well-formed.
 */
export function healHome(state: GameState): GameState {
  const REAL_ESTATE_IDS = new Set(ASSETS_CATALOG.filter((d) => d.category === 'REAL_ESTATE').map((d) => d.id));
  const DEED_IDS = new Set(ASSETS_CATALOG.filter((d) => d.kind === 'DEED').map((d) => d.id));
  const MAX_PENDING = 32; // defensive cap — the engine never stacks more

  let changed = false;

  const sourcePending = Array.isArray(state.pendingSales) ? state.pendingSales : [];
  const pendingSales: PendingSale[] = [];
  for (const ps of sourcePending) {
    const ok =
      ps &&
      typeof ps.uid === 'string' &&
      typeof ps.assetId === 'string' &&
      DEED_IDS.has(ps.assetId) &&
      Number.isInteger(ps.units) &&
      ps.units > 0 &&
      [ps.proceeds, ps.avgCost, ps.rentCollected].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
      Number.isInteger(ps.dueTick) &&
      ps.dueTick >= 0;
    if (ok) pendingSales.push(ps);
    else changed = true;
  }
  if (pendingSales.length > MAX_PENDING) {
    pendingSales.length = MAX_PENDING;
    changed = true;
  }
  if (sourcePending !== state.pendingSales) changed = true;

  let home = state.home;
  if (home) {
    const roleOk = home.role === 'rental' || home.role === 'home';
    const assetOk =
      home.role === 'rental'
        ? home.assetId === null || home.assetId === undefined
        : typeof home.assetId === 'string' && REAL_ESTATE_IDS.has(home.assetId);
    const sinceOk =
      typeof home.sinceTick === 'number' && Number.isInteger(home.sinceTick) && home.sinceTick <= state.tick;
    if (!roleOk || !assetOk || !sinceOk) {
      home = { role: 'rental', assetId: null, sinceTick: sinceOk ? home.sinceTick : state.tick };
      changed = true;
    }
  }

  if (!changed) return state;
  return { ...state, pendingSales, home };
}

/**
 * Repair a persisted save whose v7 income layer predates the final shape —
 * dev-stage envelopes can carry a malformed salary (NaN, 0, over the cap), a
 * non-boolean employed flag, or a lastReviewTick in the future (the same
 * hazard class the other healers exist for). A bad salary degrades to
 * SALARY_DEFAULT (never throws mid-hydration); a bad review cursor clamps to
 * the save's tick, so the yearly UI prompt fires within a year at worst.
 * Returns the SAME reference when the layer is already healthy, so hydration
 * stays cheap. Runs at the STORE boundary only.
 */
export function healIncome(state: GameState): GameState {
  const inc = state.income;
  if (!inc) return state;

  const salaryOk =
    typeof inc.salaryM === 'number' && Number.isFinite(inc.salaryM) && inc.salaryM > 0 && inc.salaryM <= balance.INCOME.SALARY_MAX;
  const salaryM = salaryOk ? roundCash(inc.salaryM) : balance.INCOME.SALARY_DEFAULT;
  const employed = typeof inc.employed === 'boolean' ? inc.employed : true;
  const lastReviewTick =
    typeof inc.lastReviewTick === 'number' && Number.isInteger(inc.lastReviewTick) && inc.lastReviewTick >= 0
      ? Math.min(inc.lastReviewTick, state.tick)
      : 0;

  if (salaryM === inc.salaryM && employed === inc.employed && lastReviewTick === inc.lastReviewTick) return state;
  return { ...state, income: { salaryM, employed, lastReviewTick } };
}

/**
 * Repair a persisted save whose v8 residency layer predates the final shape —
 * dev-stage envelopes can carry an unknown country id (renamed/dropped from
 * the catalog) or a malformed CPI index (the same hazard class the other
 * healers exist for). An unknown country RETIRES the layer to null (inert;
 * the banner re-asks — reactivating re-bases the CPI at 100); a bad index
 * resets to 100; a future sinceTick clamps to the save's tick. Returns the
 * SAME reference when the layer is already healthy, so hydration stays
 * cheap. Runs at the STORE boundary only.
 */
export function healResidency(state: GameState): GameState {
  const r = state.residency;
  if (!r) return state;

  if (typeof r.countryId !== 'string' || COUNTRY_IDS.indexOf(r.countryId) < 0) {
    return { ...state, residency: null };
  }
  const cpiOk = typeof r.cpi === 'number' && Number.isFinite(r.cpi) && r.cpi > 0;
  const cpi = cpiOk ? round4(r.cpi) : 100;
  const sinceTick =
    typeof r.sinceTick === 'number' && Number.isInteger(r.sinceTick) && r.sinceTick >= 0
      ? Math.min(r.sinceTick, state.tick)
      : state.tick;
  if (cpi === r.cpi && sinceTick === r.sinceTick) return state;
  return { ...state, residency: { countryId: r.countryId, cpi, sinceTick } };
}
