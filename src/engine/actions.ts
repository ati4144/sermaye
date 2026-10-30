import { balance } from './balance';
import { countryDef } from './data/countries';
import { ASSETS_CATALOG, assetDef } from './data/assets';
import { createExpenses, isLifestyleTier, presetItems } from './data/expenses';
import { eventDef } from './events/catalog';
import { applyEffects, logAssetEntry } from './events/apply';
import { applyFateOption } from './fate/tick';
import { performInheritance } from './life';
import { createIncome, migrateState } from './create';
import { basketMult } from './residency';
import { depositRateFor } from './deposits';
import { createWorld } from './world';
import {
  assetFeeFor,
  assetPrice,
  effectiveQuickDiscount,
  escrowProceedsFor,
  feeRateFor,
  liquidateToRaise,
  netWorth,
  round4,
  roundCash,
} from './market';
import { advanceUntilEvent, tick } from './sim';
import type { AssetMarketState, EngineAction, GameState, LifestyleTier, PendingSale } from './types';

/**
 * The single seam between UI and engine. Pure in the (state, action) sense:
 * returns a NEW state, leaving the input untouched (the clone is safe because
 * GameState is JSON-serializable by contract). Invalid actions throw with a
 * stable reason code that the UI maps through i18n; they never mutate state
 * and never append to the action log.
 */
export function applyAction(state: GameState, action: EngineAction): GameState {
  // normalize on entry so live play and replay() agree bit-for-bit even for
  // v1 states fed in raw (identity for current-schema states)
  const s: GameState = migrateState(JSON.parse(JSON.stringify(state)));

  switch (action.type) {
    case 'BUY':
      buy(s, action.countryId, action.amount);
      break;
    case 'SELL':
      sell(s, action.countryId, action.units);
      break;
    case 'NEXT_MONTH':
      nextMonth(s);
      break;
    case 'FAST_FORWARD':
      fastForward(s, action.months);
      break;
    case 'ACK_EVENT':
      ackEvent(s, action.uid);
      break;
    case 'RESOLVE_EVENT':
      resolveEvent(s, action.uid, action.optionIndex);
      break;
    case 'INIT_ASSETS':
      initAssets(s);
      break;
    case 'BUY_ASSET':
      buyAsset(s, action.assetId, action.amount);
      break;
    case 'SELL_ASSET':
      sellAsset(s, action.assetId, action.units);
      break;
    case 'INIT_WORLD':
      initWorld(s);
      break;
    case 'INIT_EXPENSES':
      initExpenses(s);
      break;
    case 'SET_LIFESTYLE':
      setLifestyle(s, action.tier);
      break;
    case 'ADD_EXPENSE':
      addExpense(s, action.label, action.amount);
      break;
    case 'UPDATE_EXPENSE':
      updateExpense(s, action.id, action.amount);
      break;
    case 'REMOVE_EXPENSE':
      removeExpense(s, action.id);
      break;
    case 'LIST_ASSET':
      listAsset(s, action.assetId, action.units);
      break;
    case 'CANCEL_LISTING':
      cancelListing(s, action.uid);
      break;
    case 'SET_ROLE':
      setRole(s, action.role, action.assetId);
      break;
    case 'ACTIVATE_ASSET':
      activateAsset(s, action.assetId);
      break;
    case 'INIT_INCOME':
      initIncome(s, action.salaryM);
      break;
    case 'SET_SALARY':
      setSalary(s, action.salaryM);
      break;
    case 'INIT_RESIDENCY':
      initResidency(s, action.countryId);
      break;
    case 'OPEN_DEPOSIT':
      openDeposit(s, action.amount, action.termMonths);
      break;
    case 'BREAK_DEPOSIT':
      breakDeposit(s, action.uid);
      break;
  }

  s.actionLog.push({ seq: nextSeq(s), tick: s.tick, action });
  return s;
}

/** Replay an action list over an initial state (multiplayer/tests). */
export function replay(initial: GameState, actions: EngineAction[]): GameState {
  return actions.reduce((st, a) => applyAction(st, a), migrateState(initial));
}

function nextSeq(s: GameState): number {
  const last = s.actionLog[s.actionLog.length - 1];
  return last ? last.seq + 1 : 1;
}

function requirePlaying(s: GameState): void {
  if (s.status === 'DECEASED') throw new Error('PLAYER_DECEASED');
  if (s.status !== 'PLAYING') throw new Error('GAME_OVER');
}

function buy(s: GameState, countryId: string, amount: number): void {
  requirePlaying(s);
  countryDef(countryId); // throws UNKNOWN_COUNTRY on bad id
  if (!(amount > 0)) throw new Error('INVALID_AMOUNT');
  if (amount > s.cash + 1e-9) throw new Error('INSUFFICIENT_CASH');

  const fee = feeRateFor(s, countryId);
  const index = s.countries[countryId].index;
  const unitsBought = (amount * (1 - fee)) / index;

  const h = s.holdings[countryId];
  if (h) {
    const totalUnits = h.units + unitsBought;
    h.avgCost = (h.units * h.avgCost + unitsBought * index) / totalUnits;
    h.units = round4(totalUnits);
  } else {
    s.holdings[countryId] = { units: round4(unitsBought), avgCost: index };
  }
  s.cash = roundCash(s.cash - amount);
}

function sell(s: GameState, countryId: string, units: number): void {
  requirePlaying(s);
  const h = s.holdings[countryId];
  if (!h) throw new Error('NO_HOLDING');
  if (!(units > 0) || units > h.units + 1e-9) throw new Error('INVALID_UNITS');

  const fee = feeRateFor(s, countryId);
  const index = s.countries[countryId].index;
  const proceeds = units * index * (1 - fee);

  h.units = round4(h.units - units);
  if (h.units <= 0.0001) delete s.holdings[countryId];
  s.cash = roundCash(s.cash + proceeds);
}

/**
 * Activate the asset layer on a legacy (v2) run. Zero draws — the rng state
 * is untouched (tested), so the only divergence from the pre-activation
 * future is the asset layer itself. Throws when already active.
 */
function initAssets(s: GameState): void {
  requirePlaying(s);
  if (s.assets) throw new Error('ASSETS_ACTIVE');
  const markets: Record<string, AssetMarketState> = {};
  const activeIds: string[] = [];
  for (const def of ASSETS_CATALOG) {
    activeIds.push(def.id);
    markets[def.id] = { id: def.id, index: 100, mods: [], indexHistory: [100], lastEventTick: {} };
  }
  s.assets = { activeIds, markets };
  logAssetEntry(s, 'assets_init', undefined, undefined, undefined);
}

/**
 * Activate the world layer (regimes + agenda) on a legacy run — the current
 * era, no scenario. Zero draws: the rng state is untouched (tested), so the
 * only divergence from the pre-activation future is the world layer itself.
 * The regime starts from `tick` (not 0), so "Kriz, 8. ay" counts forward.
 */
function initWorld(s: GameState): void {
  requirePlaying(s);
  if (s.world) throw new Error('WORLD_ACTIVE');
  s.world = createWorld(null, s.tick);
  s.eventLog.push({
    tick: s.tick,
    uid: `${s.tick}:world_init`,
    eventId: 'world_init',
    netWorth: roundCash(netWorth(s)),
    generation: s.player.generation,
  });
}

/**
 * Activate the expense layer on a legacy run at the standard tier. Zero
 * draws — the rng state is untouched (tested), and the standard preset sums
 * exactly to LIVING.BASE, so the very next tick charges the same living
 * cost the flat formula did. Throws when already active.
 */
function initExpenses(s: GameState): void {
  requirePlaying(s);
  if (s.expenses) throw new Error('EXPENSES_ACTIVE');
  s.expenses = createExpenses();
  s.eventLog.push({
    tick: s.tick,
    uid: `${s.tick}:expenses_init`,
    eventId: 'expenses_init',
    netWorth: roundCash(netWorth(s)),
    generation: s.player.generation,
  });
}

/**
 * SET_LIFESTYLE — swap the PRESET items for the new tier's fresh set (ids
 * minted from the save's seq counter); CUSTOM items always survive. Zero
 * draws: amounts are catalog constants.
 */
function setLifestyle(s: GameState, tier: LifestyleTier): void {
  requirePlaying(s);
  if (!isLifestyleTier(tier)) throw new Error('INVALID_TIER');
  if (!s.expenses) throw new Error('EXPENSES_INACTIVE');
  const e = s.expenses;
  const customs = e.items.filter((it) => it.kind === 'CUSTOM');
  const { items, seq } = presetItems(tier, e.seq);
  e.lifestyle = tier;
  e.items = [...items, ...customs];
  e.seq = seq;
}

/** ADD_EXPENSE — custom item, label trimmed, amount rounded and capped. */
function addExpense(s: GameState, label: string, amount: number): void {
  requirePlaying(s);
  if (!s.expenses) throw new Error('EXPENSES_INACTIVE');
  const text = typeof label === 'string' ? label.trim() : '';
  if (text.length < 1 || text.length > balance.EXPENSES.LABEL_MAX) throw new Error('INVALID_LABEL');
  const value = validateAmount(amount);
  const e = s.expenses;
  e.seq += 1;
  e.items.push({ id: `e${e.seq}`, kind: 'CUSTOM', label: text, amount: value });
}

/** UPDATE_EXPENSE — change any item's monthly amount (PRESET or CUSTOM). */
function updateExpense(s: GameState, id: string, amount: number): void {
  requirePlaying(s);
  if (!s.expenses) throw new Error('EXPENSES_INACTIVE');
  const value = validateAmount(amount);
  const item = s.expenses.items.find((it) => it.id === id);
  if (!item) throw new Error('EXPENSE_NOT_FOUND');
  item.amount = value;
}

/** REMOVE_EXPENSE — delete any item (PRESET or CUSTOM) outright. */
function removeExpense(s: GameState, id: string): void {
  requirePlaying(s);
  if (!s.expenses) throw new Error('EXPENSES_INACTIVE');
  const idx = s.expenses.items.findIndex((it) => it.id === id);
  if (idx < 0) throw new Error('EXPENSE_NOT_FOUND');
  s.expenses.items.splice(idx, 1);
}

/**
 * v6: activeIds is a frozen snapshot the player grows via ACTIVATE_ASSET —
 * trading a known-but-inactive class would read a nonexistent market, so the
 * handlers reject with a stable code the UI can map.
 */
function requireActive(s: GameState, assetId: string): void {
  if (!s.assets!.activeIds.includes(assetId)) throw new Error('ASSET_INACTIVE');
}

/** Positive, finite, rounded to cents, clamped to AMOUNT_MAX; throws INVALID_AMOUNT. */
function validateAmount(amount: number): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || !(amount > 0)) {
    throw new Error('INVALID_AMOUNT');
  }
  const value = Math.min(roundCash(amount), balance.EXPENSES.AMOUNT_MAX);
  if (!(value > 0)) throw new Error('INVALID_AMOUNT'); // sub-cent input rounds to 0
  return value;
}

/** BUY_ASSET — `amount` is an upper limit; the price comes from state (no draws). */
function buyAsset(s: GameState, assetId: string, amount: number): void {
  requirePlaying(s);
  const def = assetDef(assetId); // throws UNKNOWN_ASSET on bad id
  if (!s.assets) throw new Error('ASSETS_INACTIVE');
  requireActive(s, assetId);
  if (!(amount > 0)) throw new Error('INVALID_AMOUNT');

  const fee = assetFeeFor(s, assetId);
  const price = assetPrice(s, assetId);

  if (def.kind === 'FRACTIONAL') {
    if (amount > s.cash + 1e-9) throw new Error('INSUFFICIENT_CASH');
    const units = (amount * (1 - fee)) / price;
    const h = s.holdings[assetId];
    if (h) {
      const totalUnits = h.units + units;
      h.avgCost = (h.units * h.avgCost + units * price) / totalUnits;
      h.units = round4(totalUnits);
    } else {
      s.holdings[assetId] = { units: round4(units), avgCost: price };
    }
    s.cash = roundCash(s.cash - amount);
    logAssetEntry(s, 'asset_bought', assetId, round4(units), roundCash(amount));
    return;
  }

  // DEED: whole units; the engine floors and charges only the real cost.
  const units = Math.floor((amount * (1 - fee)) / price);
  if (units < 1) throw new Error('TOO_SMALL');
  const cost = Math.min(amount, roundCash((units * price) / (1 - fee)));
  if (cost > s.cash + 1e-9) throw new Error('INSUFFICIENT_CASH');

  const pos = s.properties[assetId];
  if (pos) {
    const totalUnits = pos.units + units;
    pos.avgCost = round4((pos.units * pos.avgCost + units * price) / totalUnits);
    pos.units = totalUnits;
  } else {
    s.properties[assetId] = {
      classId: assetId,
      units,
      avgCost: round4(price),
      firstBuyTick: s.tick,
      rentCollected: 0,
    };
  }
  s.cash = roundCash(s.cash - cost);
  logAssetEntry(s, 'asset_bought', assetId, units, cost);
}

/** SELL_ASSET — fractional like sell(); DEED whole units at the quick-sale discount. */
function sellAsset(s: GameState, assetId: string, units: number): void {
  requirePlaying(s);
  const def = assetDef(assetId);
  if (!s.assets) throw new Error('ASSETS_INACTIVE');
  requireActive(s, assetId);

  const fee = assetFeeFor(s, assetId);
  const price = assetPrice(s, assetId);

  if (def.kind === 'FRACTIONAL') {
    const h = s.holdings[assetId];
    if (!h) throw new Error('NO_HOLDING');
    if (!(units > 0) || units > h.units + 1e-9) throw new Error('INVALID_UNITS');
    const proceeds = roundCash(units * price * (1 - fee));
    h.units = round4(h.units - units);
    if (h.units <= 0.0001) delete s.holdings[assetId];
    s.cash = roundCash(s.cash + proceeds);
    logAssetEntry(s, 'asset_sold', assetId, round4(units), proceeds);
    return;
  }

  const pos = s.properties[assetId];
  if (!pos) throw new Error('NO_HOLDING');
  if (!(units > 0) || !Number.isInteger(units) || units > pos.units) throw new Error('INVALID_UNITS');
  const disc = effectiveQuickDiscount(s, assetId);
  const proceeds = roundCash(units * price * (1 - fee) * (1 - disc));
  pos.units -= units;
  if (pos.units <= 0) delete s.properties[assetId];
  s.cash = roundCash(s.cash + proceeds);
  logAssetEntry(s, 'asset_sold', assetId, units, proceeds);
}

/**
 * LIST_ASSET (v6) — the patient sale. Whole DEED units leave `properties`
 * for the escrow ledger; proceeds lock at listing (price × (1 − fee), NO
 * quick-sale discount) and pay out at dueTick via phase 4c. Zero draws.
 * Pending units earn no rent and are invisible to the liquidation ladder —
 * escrow is a contract, not a fire-sale buffer.
 */
function listAsset(s: GameState, assetId: string, units: number): void {
  requirePlaying(s);
  const def = assetDef(assetId);
  if (!s.assets) throw new Error('ASSETS_INACTIVE');
  requireActive(s, assetId);
  if (def.kind !== 'DEED') throw new Error('NOT_DEED');
  const pos = s.properties[assetId];
  if (!pos) throw new Error('NO_HOLDING');
  if (!(units > 0) || !Number.isInteger(units) || units > pos.units) throw new Error('INVALID_UNITS');

  const proceeds = escrowProceedsFor(s, assetId, units);
  const sale: PendingSale = {
    uid: `${s.tick}:${assetId}:${s.pendingSales.length}`,
    assetId,
    units,
    proceeds,
    dueTick: s.tick + balance.ASSETS.ESCROW_MONTHS,
    avgCost: pos.avgCost,
    firstBuyTick: pos.firstBuyTick,
    rentCollected: pos.rentCollected,
  };
  pos.units -= units;
  if (pos.units <= 0) delete s.properties[assetId];
  s.pendingSales.push(sale);
  logAssetEntry(s, 'asset_listed', assetId, units, proceeds);
}

/**
 * CANCEL_LISTING (v6) — pull a listing back. The position is restored from
 * the snapshot (merged when the player re-bought meanwhile); no penalty —
 * the cost is the months spent rent-free and cash-free. Zero draws.
 */
function cancelListing(s: GameState, uid: string): void {
  requirePlaying(s);
  const idx = s.pendingSales.findIndex((ps) => ps.uid === uid);
  if (idx < 0) throw new Error('LISTING_NOT_FOUND');
  const [ps] = s.pendingSales.splice(idx, 1);
  const pos = s.properties[ps.assetId];
  if (pos) {
    const totalUnits = pos.units + ps.units;
    pos.avgCost = round4((pos.units * pos.avgCost + ps.units * ps.avgCost) / totalUnits);
    pos.units = totalUnits;
    pos.firstBuyTick = Math.min(pos.firstBuyTick, ps.firstBuyTick);
    pos.rentCollected = Math.max(pos.rentCollected, ps.rentCollected);
  } else {
    s.properties[ps.assetId] = {
      classId: ps.assetId,
      units: ps.units,
      avgCost: round4(ps.avgCost),
      firstBuyTick: ps.firstBuyTick,
      rentCollected: ps.rentCollected,
    };
  }
  logAssetEntry(s, 'asset_listing_cancelled', ps.assetId, ps.units, ps.proceeds);
}

/**
 * SET_ROLE (v6) — the Yuva switch. 'rental' also activates a null home layer
 * (player-consented, like the INIT_* activations, zero draws, no banner).
 * 'home' requires an owned REAL_ESTATE deed position to move into.
 */
function setRole(s: GameState, role: 'rental' | 'home', assetId: string | undefined): void {
  requirePlaying(s);
  if (role === 'rental') {
    s.home = { role: 'rental', assetId: null, sinceTick: s.tick };
  } else {
    if (!s.assets) throw new Error('ASSETS_INACTIVE');
    if (typeof assetId !== 'string') throw new Error('INVALID_HOME_ASSET');
    const def = assetDef(assetId);
    if (def.kind !== 'DEED' || def.category !== 'REAL_ESTATE') throw new Error('INVALID_HOME_ASSET');
    if (!s.properties[assetId]) throw new Error('NO_HOLDING');
    s.home = { role: 'home', assetId, sinceTick: s.tick };
  }
  s.eventLog.push({
    tick: s.tick,
    uid: `${s.tick}:home_set:${s.eventLog.length}`,
    eventId: 'home_set',
    netWorth: roundCash(netWorth(s)),
    generation: s.player.generation,
  });
}

/**
 * ACTIVATE_ASSET (v6) — turn on one catalog class the save predates (e.g. a
 * v5 save meeting the villa). The market comes up at the activation baseline
 * (index 100), exactly the INIT_ASSETS pattern shrunk to one id. Zero draws —
 * but from this tick the class joins phase 1b (+12 draws/month): the player
 * consciously buys into the stream change, like every INIT_* activation.
 */
function activateAsset(s: GameState, assetId: string): void {
  requirePlaying(s);
  if (!s.assets) throw new Error('ASSETS_INACTIVE');
  assetDef(assetId); // throws UNKNOWN_ASSET on bad id
  if (s.assets.activeIds.includes(assetId)) throw new Error('ASSET_ACTIVE');
  s.assets.activeIds.push(assetId); // iteration order is always catalog order (activeAssetIds)
  s.assets.markets[assetId] = { id: assetId, index: 100, mods: [], indexHistory: [100], lastEventTick: {} };
  logAssetEntry(s, 'asset_activated', assetId, undefined, undefined);
}

/**
 * Activate the income layer on a legacy run (INIT_EXPENSES pattern). Zero
 * draws — the rng state is untouched (tested); the salary is player-entered
 * (the given amount or SALARY_DEFAULT), so unlike INIT_EXPENSES this DOES
 * change the cash path from the next tick on — that is the point. Throws
 * when already active.
 */
function initIncome(s: GameState, salaryM: number | undefined): void {
  requirePlaying(s);
  if (s.income) throw new Error('INCOME_ACTIVE');
  s.income = createIncome(salaryM, basketMult(s));
  s.eventLog.push({
    tick: s.tick,
    uid: `${s.tick}:income_init`,
    eventId: 'income_init',
    assetAmount: s.income.salaryM, // generic amount slot — the salary (v7)
    netWorth: roundCash(netWorth(s)),
    generation: s.player.generation,
  });
}

/**
 * SET_SALARY — the player-entered amount (opening question default aside,
 * the yearly raise review and manual edits both land here). Rounds to cents
 * and stamps the review cursor: the yearly UI prompt counts from the last
 * change (a mid-year manual edit shifts the next review by a few months at
 * most — harmless by design). Zero draws. Logged so the history screen shows
 * the raise.
 */
function setSalary(s: GameState, salaryM: number): void {
  requirePlaying(s);
  if (!s.income) throw new Error('INCOME_INACTIVE');
  if (typeof salaryM !== 'number' || !Number.isFinite(salaryM) || !(salaryM > 0)) {
    throw new Error('INVALID_SALARY');
  }
  const value = roundCash(Math.min(salaryM, balance.INCOME.SALARY_MAX));
  if (!(value > 0)) throw new Error('INVALID_SALARY'); // sub-cent input rounds to 0
  s.income = { ...s.income, salaryM: value, lastReviewTick: s.tick };
  s.eventLog.push({
    tick: s.tick,
    uid: `${s.tick}:salary_set:${s.eventLog.length}`,
    eventId: 'salary_set',
    assetAmount: value, // generic amount slot — the salary (v7)
    netWorth: roundCash(netWorth(s)),
    generation: s.player.generation,
  });
}

/**
 * INIT_RESIDENCY — the home-country pick (the opening question, or the v8
 * banner on legacy saves). Pure initial data: the CPI index starts at 100
 * THIS tick, so a mid-run activation re-bases inflation from today (the
 * country's past is not retro-charged). Zero draws. Logged so the history
 * screen anchors where the family settled.
 */
function initResidency(s: GameState, countryId: string): void {
  requirePlaying(s);
  if (s.residency) throw new Error('RESIDENCY_ACTIVE');
  countryDef(countryId); // throws on unknown ids — the BUY-path convention
  s.residency = { countryId, cpi: 100, sinceTick: s.tick };
  s.eventLog.push({
    tick: s.tick,
    uid: `${s.tick}:residency_init`,
    eventId: 'residency_init',
    countryId, // the LogEntry interpolation slot
    netWorth: roundCash(netWorth(s)),
    generation: s.player.generation,
  });
}

/**
 * OPEN_DEPOSIT (v9) — lock cash for a term at the rate this month's CPI path
 * prices (depositRateFor, locked INTO state). Zero draws. Guards in price
 * order: term, amount, ledger cap, cash. The interest itself is DERIVED
 * (accruedDepositInterest), never stored. Logged so the history screen
 * anchors the contract.
 */
function openDeposit(s: GameState, amount: number, termMonths: number): void {
  requirePlaying(s);
  if (!(balance.DEPOSITS.SPREAD_BY_TERM[termMonths] > 0)) throw new Error('INVALID_TERM');
  if (!(amount > 0)) throw new Error('INVALID_AMOUNT');
  if (amount < balance.DEPOSITS.MIN_AMOUNT) throw new Error('TOO_SMALL');
  if (s.deposits.length >= balance.DEPOSITS.MAX_OPEN) throw new Error('DEPOSIT_LIMIT');
  if (amount > s.cash + 1e-9) throw new Error('INSUFFICIENT_CASH');
  const principal = roundCash(amount);
  s.cash = roundCash(s.cash - principal);
  s.deposits.push({
    uid: `${s.tick}:${s.deposits.length}`,
    principal,
    annualRate: depositRateFor(s, termMonths),
    openedTick: s.tick,
    termMonths,
  });
  s.eventLog.push({
    tick: s.tick,
    uid: `${s.tick}:deposit_opened:${s.eventLog.length}`,
    eventId: 'deposit_opened',
    assetAmount: principal, // generic amount slot — the locked principal (v9)
    assetUnits: termMonths, // generic count slot — the term in months (v9)
    netWorth: roundCash(netWorth(s)),
    generation: s.player.generation,
  });
}

/**
 * BREAK_DEPOSIT (v9) — early exit: the principal returns, ALL accrued
 * interest forfeits (the one-rule penalty — the term mattered). Zero draws.
 */
function breakDeposit(s: GameState, uid: string): void {
  requirePlaying(s);
  const idx = s.deposits.findIndex((d) => d.uid === uid);
  if (idx < 0) throw new Error('DEPOSIT_NOT_FOUND');
  const [d] = s.deposits.splice(idx, 1);
  s.cash = roundCash(s.cash + d.principal);
  s.eventLog.push({
    tick: s.tick,
    uid: `${s.tick}:deposit_broken:${s.eventLog.length}`,
    eventId: 'deposit_broken',
    assetAmount: d.principal, // generic amount slot — the returned principal (v9)
    assetUnits: d.termMonths, // generic count slot — the term in months (v9)
    netWorth: roundCash(netWorth(s)),
    generation: s.player.generation,
  });
}

function nextMonth(s: GameState): void {  requirePlaying(s);
  if (s.pendingEvents.length > 0) throw new Error('PENDING_EVENT');
  tick(s);
}

/** Skip up to `months` months, stopping early at the next pending event. */
function fastForward(s: GameState, months: number | undefined): void {
  requirePlaying(s);
  if (s.pendingEvents.length > 0) throw new Error('PENDING_EVENT');
  advanceUntilEvent(s, months ?? 12);
}

function queueHead(s: GameState, uid: string) {
  const head = s.pendingEvents[0];
  if (!head) throw new Error('NO_PENDING_EVENT');
  if (head.uid !== uid) throw new Error('NOT_QUEUE_HEAD');
  return head;
}

function ackEvent(s: GameState, uid: string): void {
  const head = queueHead(s, uid);
  if (head.hasChoice) throw new Error('EVENT_NEEDS_CHOICE');

  // death is special: the ACK confirms the inheritance and hands over
  if (head.eventId === 'death' && s.status === 'DECEASED') {
    performInheritance(s);
    logResolved(s, head.uid, head.eventId, head.countryId, undefined);
    s.pendingEvents.shift();
    return;
  }

  if (s.status !== 'PLAYING' && s.status !== 'DECEASED') throw new Error('GAME_OVER');
  s.pendingEvents.shift();
}

function resolveEvent(s: GameState, uid: string, optionIndex: number): void {
  const head = queueHead(s, uid);
  if (!head.hasChoice) throw new Error('EVENT_HAS_NO_CHOICE');
  const def = eventDef(head.eventId);
  const option = def.options?.[optionIndex];
  if (!option) throw new Error('INVALID_OPTION');

  // effects first (choice events apply their effects only on resolve)
  applyEffects(s, option.effects, head.countryId, def.id);

  // costs
  let cost = 0;
  if (option.costPctNetWorth !== undefined) cost += Math.max(0, netWorth(s)) * option.costPctNetWorth;
  if (option.cashCost !== undefined) cost += option.cashCost;
  if (cost > 0) {
    if (s.cash < cost) liquidateToRaise(s, cost - s.cash);
    s.cash = roundCash(s.cash - cost);
  }

  // signed cash grant/loss (fate beats) — never without this player decision
  if (option.cashDelta !== undefined) {
    s.cash = roundCash(s.cash + option.cashDelta);
    if (s.cash < 0) liquidateToRaise(s, -s.cash);
  }

  // player effects
  if (option.healthDelta !== undefined) {
    s.player.health = Math.min(100, Math.max(0, s.player.health + option.healthDelta));
  }
  if (option.setMarried !== undefined) {
    s.player.married = option.setMarried;
    // v6: stamp the wedding month for the eve_cikma clock. Legacy runs
    // (home === null) keep the v5 Player shape — no new key, bit-identical.
    if (s.home !== null) s.player.marriedTick = s.tick;
  }
  if (option.setLifeFlag !== undefined) {
    s.player.lifeFlags = { ...s.player.lifeFlags, [option.setLifeFlag]: true };
  }

  // v6 kader vocabulary — asset grants/seizures read prices from state
  if (option.grantAsset !== undefined) grantAssetUnits(s, option.grantAsset.assetId, option.grantAsset.units);
  if (option.takeAsset !== undefined) takeAssetUnits(s, option.takeAsset.assetId, option.takeAsset.units);

  // fate effects (flags, counters, reveal, mod shifts, beat cancels)
  if (option.fate) {
    applyFateOption(s, option.fate);
  }

  logResolved(s, head.uid, head.eventId, head.countryId, optionIndex);
  s.pendingEvents.shift();
}

function logResolved(
  s: GameState,
  uid: string,
  eventId: string,
  countryId: string | undefined,
  optionIndex: number | undefined,
): void {
  s.eventLog.push({
    tick: s.tick,
    uid,
    eventId,
    countryId,
    optionIndex,
    netWorth: roundCash(netWorth(s)),
    generation: s.player.generation,
  });
}

/**
 * v6 kader vocabulary — grantAsset effect (miras evi, düğün altını...).
 * Fractional classes merge into `holdings` at the current price, DEED classes
 * into `properties`, exactly like a buy minus the cash. Zero draws; inert
 * (logged nothing, no-op) on runs with the asset layer still inactive so
 * legacy replays stay bit-for-bit.
 */
function grantAssetUnits(s: GameState, assetId: string, units: number): void {
  if (!s.assets) return;
  const def = assetDef(assetId);
  // defensive: a grant against a not-yet-activated class has no market to
  // price from — skip rather than crash (kader content targets active classes)
  if (!s.assets.activeIds.includes(assetId) || !s.assets.markets[assetId]) return;
  const price = assetPrice(s, assetId);
  if (def.kind === 'FRACTIONAL') {
    const h = s.holdings[assetId];
    if (h) {
      const totalUnits = h.units + units;
      h.avgCost = (h.units * h.avgCost + units * price) / totalUnits;
      h.units = round4(totalUnits);
    } else {
      s.holdings[assetId] = { units: round4(units), avgCost: price };
    }
  } else {
    const pos = s.properties[assetId];
    if (pos) {
      const totalUnits = pos.units + units;
      pos.avgCost = round4((pos.units * pos.avgCost + units * price) / totalUnits);
      pos.units = totalUnits;
    } else {
      s.properties[assetId] = {
        classId: assetId,
        units,
        avgCost: round4(price),
        firstBuyTick: s.tick,
        rentCollected: 0,
      };
    }
  }
  logAssetEntry(s, 'asset_granted', assetId, def.kind === 'FRACTIONAL' ? round4(units) : units, undefined);
}

/**
 * v6 kader vocabulary — takeAsset effect (tarla rehni...). DEED-only mirror of
 * grantAsset: seizes min(units ?? all, owned) whole units with no cash in
 * return; a no-op when nothing is owned (the kader beat's condition usually
 * gates this, the engine stays forgiving on replays).
 */
function takeAssetUnits(s: GameState, assetId: string, units: number | undefined): void {
  if (!s.assets) return;
  const def = assetDef(assetId);
  if (def.kind !== 'DEED') return;
  const pos = s.properties[assetId];
  if (!pos || pos.units <= 0) return;
  const take = Math.min(units === undefined ? pos.units : Math.max(0, Math.floor(units)), pos.units);
  if (take <= 0) return;
  pos.units -= take;
  if (pos.units <= 0) delete s.properties[assetId];
  logAssetEntry(s, 'asset_taken', assetId, take, undefined);
}
