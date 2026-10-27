import { balance } from './balance';
import { COUNTRY_IDS, countryDef } from './data/countries';
import { activeAssetIds } from './data/assets';
import { EVENT_CATALOG, marketEvents } from './events/catalog';
import { fireMarketEvent, enqueueLifeNotice } from './events/apply';
import { liveLife } from './life';
import { triggerFateBeats } from './fate/tick';
import { evolveMarkets, evolveAssetMarkets, collectAssetIncome, collectDueSales, homeReliefFor, liquidateToRaise, netWorth, roundCash, salaryFor } from './market';
import { basketMult, cpiMult, evolveResidency, livingClampFor } from './residency';
import { nextFloat } from './rng';
import { evolveWorld, applyScenarioBeats, eventProb } from './world';
import type { RngState } from './rng';
import type { GameState } from './types';

/**
 * ─────────────────────────── DETERMINISM CONTRACT ───────────────────────────
 * This module (and everything under src/engine) must satisfy:
 *
 *  1. GameState is JSON-serializable — no Date/Map/Set/functions/classes.
 *     Enforced by the serialization tests.
 *  2. All randomness flows through rng.ts; the live RNG state is carried in
 *     GameState. The seed is immutable provenance, never re-derived.
 *  3. Draw order per tick is fixed. Every eligible candidate draws exactly one
 *     value at its slot; branches consume draws AFTER drawing and never skip
 *     a draw conditionally (draw-then-decide).
 *  4. Only cross-engine-safe math: + - * /, floor/abs/min/max, imul, integer
 *     ops; sqrt only as precomputed literals. Never random/exp/log/pow/sin/cos
 *     (enforced by ESLint). Normal draws use the Irving–Hall approximation.
 *  5. The engine never reads wall clock, locale, device, or storage.
 *  6. Every player decision is an EngineAction appended to actionLog with a
 *     monotonic seq. Replaying (initialState, actionLog) reproduces any later
 *     state bit-for-bit — the basis for the future shared-world server.
 *  7. Fate draws occur ONLY at creation (from the private fate stream, itself
 *     seeded by one fixed main-stream draw in create.ts) plus one fixed slot
 *     in the inheritance path. Phase 2.5 (triggerFateBeats) is draw-free, and
 *     phases 1–2 read and write shared/world state only — the split the
 *     future shared-world server needs.
 *  8. DRAW BUDGET (v3): per tick = 10×12 country draws + 12 × |active asset
 *     ids| asset draws (ONLY when s.assets !== null — legacy v2 runs keep the
 *     exact v2 budget and replay bit-for-bit) + phase-2 event-candidate draws
 *     (GLOBAL → country → ASSET; ASSET candidates exist only when the asset
 *     layer is active, one float per eligible candidate, quota
 *     balance.ASSETS.MAX_ASSET_PER_TICK) + life draws. Phase 4a asset income,
 *     rent, upkeep, quick-sale discounts and the liquidation ladder are
 *     formula-only: zero draws. NO action handler ever draws — prices come
 *     from state (assetPrice), spreads are catalog constants.
 *  9. WORLD LAYER (v4): phase 0.9 draws exactly one float per tick — ONLY
 *     when s.world !== null (INIT_WORLD / new games). Phase 0.95 scenario
 *     beats and the regime/agenda modulation of drift, volatility and event
 *     thresholds are formula-only. The atTick-0 opening beat fires at
 *     CREATION (create.ts), zero draws; atTick N ≥ 1 fires inside tick().
 *     world === null ⇒ the exact v3 budget and thresholds: legacy replays
 *     stay bit-for-bit. The regime float is drawn unconditionally
 *     (draw-then-decide).
 * 10. EXPENSE LAYER (v5): phase 4b replaces the flat LIVING.BASE component
 *     with the itemized sum when s.expenses !== null (INIT_EXPENSES / new
 *     games) — formula-only, zero draws; the per-month cash-flow record is
 *     write-only state (never feeds back into the simulation). The standard
 *     tier's items sum exactly to BASE, so a fresh v5 game charges the same
 *     living cost as the flat v4 formula. expenses === null ⇒ the exact v4
 *     formula: legacy replays stay bit-for-bit. The floor follows the
 *     itemized sum BY DESIGN (user decision 2026-10-14): the player owns the
 *     survival baseline — removing every item drops the living cost to the
 *     wealth levy alone; bankruptcy stays worth-streak based either way.
 * 11. YUVA & ESCROW LAYER (v6): adds ZERO draws anywhere. Phase 4c
 *     (collectDueSales) is a formula-only pass over the escrow ledger; the
 *     home-ownership relief reduces the clamped living cost BEFORE the fate
 *     multiplier (a curse cannot be dodged by buying a home); LIST_ASSET /
 *     CANCEL_LISTING / SET_ROLE handlers and the grantAsset/takeAsset/
 *     setLifeFlag option effects read prices from state; eve_cikma and the
 *     forced-sale notice are pure conditions. relief === 0 (home null or
 *     renting — every pre-v6 path) keeps the exact v5 expression:
 *     pendingSales: [] and home: null replays stay bit-for-bit.
 * 12. INCOME LAYER (v7): adds ZERO draws anywhere. The phase-4a-pre salary
 *     credit is formula-only; the health-gated employment transitions (phase
 *     3.5, job_loss/job_return) are pure conditions with hysteresis — no rng
 *     call exists on any income path. INIT_INCOME / SET_SALARY are actions
 *     carrying player-entered amounts. income === null (every pre-v7 path)
 *     credits nothing and enqueues nothing: legacy replays stay bit-for-bit.
 * 13. RESIDENCY LAYER (v8): adds ZERO draws anywhere. Phase 0.97 compounds
 *     the home-CPI index formula-only (catalog rate / scenario-arc override /
 *     mild regime tilt on catalog rates); the asset-drift inflation add-on
 *     (assetDriftVol, guarded append), the CPI-indexed living basket (floor
 *     and cap scale, the wealth levy does NOT — asset prices already inflate
 *     worth), and the bankruptcy-threshold scaling are formula-only.
 *     INIT_RESIDENCY carries a player-picked id. residency === null (every
 *     pre-v8 path) keeps the exact v7 budget and bits: legacy replays stay
 *     bit-for-bit.
 *
 * With these rules, the same code runs identically on Hermes (Android), JSC
 * (iOS), and V8 (web/Node).
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Phase 2 — market event triggering, draw-then-decide.
 *
 * Iteration order is fixed: GLOBAL defs in catalog order, then each country
 * (sorted by id) with its COUNTRY defs in catalog order. Every *eligible*
 * candidate (cooldown expired, minTick passed, condition true) draws exactly
 * one float regardless of whether the per-tick quota is already full — the
 * draw is discarded then, but the stream never shifts.
 */
export function triggerMarketEvents(s: GameState, rng: RngState): void {
  let globalFired = 0;
  let countryFired = 0;
  const defs = marketEvents();

  for (const def of defs) {
    if (def.scope === 'GLOBAL') {
      if (!eligible(s, def, undefined)) continue;
      const draw = nextFloat(rng);
      if (draw < eventProb(s, def.p, def.id) && globalFired < balance.EVENTS.MAX_GLOBAL_PER_TICK) {
        fireMarketEvent(s, def, undefined);
        globalFired++;
      }
    }
  }

  for (const countryId of COUNTRY_IDS) {
    const cs = s.countries[countryId];
    for (const def of defs) {
      if (def.scope !== 'COUNTRY') continue;
      if (!appliesToCountry(def, countryId)) continue;
      if (!eligible(s, def, cs.lastEventTick[def.id])) continue;
      const draw = nextFloat(rng);
      if (draw < eventProb(s, def.p, def.id) && countryFired < balance.EVENTS.MAX_COUNTRY_PER_TICK) {
        fireMarketEvent(s, def, countryId);
        countryFired++;
      }
    }
  }

  // Phase 2b — ASSET-scope candidates, only in runs with the asset layer
  // active. Catalog order over active assets; every eligible candidate draws
  // exactly one float. Legacy v2 runs never reach this loop (zero new draws).
  if (s.assets) {
    let assetFired = 0;
    for (const assetId of activeAssetIds(s)) {
      const am = s.assets.markets[assetId];
      for (const def of defs) {
        if (def.scope !== 'ASSET' || def.appliesTo !== assetId) continue;
        if (!eligible(s, def, am.lastEventTick[def.id])) continue;
        const draw = nextFloat(rng);
        if (draw < eventProb(s, def.p, def.id) && assetFired < balance.ASSETS.MAX_ASSET_PER_TICK) {
          fireMarketEvent(s, def, assetId);
          assetFired++;
        }
      }
    }
  }
}

function appliesToCountry(def: { appliesTo?: string }, countryId: string): boolean {
  const at = def.appliesTo;
  if (at === undefined) return true; // any country
  if (at === countryId) return true;
  return at === countryDef(countryId).grade;
}

function eligible(s: GameState, def: { cooldown: number; minTick?: number; condition?: (st: GameState) => boolean }, lastTick: number | undefined): boolean {
  if (def.minTick !== undefined && s.tick < def.minTick) return false;
  if (lastTick !== undefined && s.tick - lastTick < def.cooldown) return false;
  if (def.condition && !def.condition(s)) return false;
  return true;
}

/**
 * One month. Phase order is fixed:
 *  1. evolve markets          1b. evolve asset markets (v3, gated)
 *  2. trigger market events   2b. ASSET-scope candidates (v3, gated)
 *  2.5 fate beats (draw-free) 3. player life
 *  3.5 employment transitions (v7, gated, zero draws)
 *  4. cash flow — 4a-pre salary credit (v7, gated), 4a asset income (gated),
 *     4b living costs, forced liquidation via the asset ladder
 *  5. valuation & bookkeeping   (net worth history, bankruptcy check)
 *
 * Mutates the passed state (callers apply it to a cloned draft).
 */
export function tick(s: GameState): void {
  const rng = s.rng;
  const logLenBefore = s.eventLog.length;

  s.tick += 1;

  // Phase 0.9 — world regime evolution (v4, gated: one float draw only when
  // the world layer is active; legacy runs keep the exact v3 draw budget)
  if (s.world) {
    evolveWorld(s);
    // Phase 0.95 — scripted scenario beats (zero draws)
    applyScenarioBeats(s);
  }

  // Phase 0.97 — home-CPI compounding (v8, zero draws; no-op when the
  // residency layer is null). AFTER the world/beats so this month's regime
  // and arc state already apply, BEFORE the markets so phase 1b's drift
  // add-on reads the same month's rate.
  evolveResidency(s);

  // Phase 1
  evolveMarkets(s, rng);

  // Phase 1b — asset markets (world state, ownership-independent; no-op on legacy runs)
  evolveAssetMarkets(s, rng);

  // Phase 2 (incl. 2b ASSET candidates)
  triggerMarketEvents(s, rng);

  // Phase 2.5 — fate timeline (zero draws; reads only fate + player state)
  if (s.fate && s.player.alive && s.status === 'PLAYING') {
    triggerFateBeats(s);
  }

  // Phase 3 (skipped once deceased — the death flow finishes via ACK)
  if (s.player.alive) {
    liveLife(s, rng);
  }

  // Phase 3.5 — employment transitions (v7, zero draws: pure conditions with
  // hysteresis). Chronic health collapse below JOB_LOSS_HEALTH costs the job;
  // recovery to JOB_RETURN_HEALTH brings it back — the band in between never
  // flaps. The notices are enqueued AND logged (Geçmiş shows the career arc).
  // Null layer (every pre-v7 run) enqueues nothing.
  if (s.income && s.player.alive && s.status === 'PLAYING') {
    if (s.income.employed && s.player.health < balance.INCOME.JOB_LOSS_HEALTH) {
      s.income.employed = false;
      enqueueLifeNotice(s, 'job_loss');
    } else if (!s.income.employed && s.player.health >= balance.INCOME.JOB_RETURN_HEALTH) {
      s.income.employed = true;
      enqueueLifeNotice(s, 'job_return');
    }
  }

  // Phase 4a-pre — salary credit (v7, zero draws). Runs before the living
  // cost so a paycheck can cover the month, exactly like rent below. The
  // credit lands BEFORE worthBefore is computed — the wealth levy consciously
  // sees this month's salary (the cost of living scales with money in hand).
  const salary = salaryFor(s);
  if (salary > 0) {
    s.cash = roundCash(s.cash + salary);
  }

  // Phase 4a — asset income/expenses (rent in, upkeep out; zero draws).
  // Runs BEFORE living costs so rent can cover the month (the fate
  // livingCost multiplier below multiplies only the living cost itself).
  let income = { rent: 0, upkeep: 0 };
  if (s.assets) {
    income = collectAssetIncome(s);
  }

  // Phase 4b — living costs (fate trait multiplies the cost itself). v5:
  // with the expense layer active the flat BASE component becomes the
  // itemized sum (floor moves with it); expenses === null keeps the exact
  // v4 expression — legacy replays stay bit-for-bit. v6: the Yuva relief
  // reduces the clamped cost BEFORE the fate multiplier ("lanet ev alarak
  // atlanamaz" — the relief path only exists when the player owns the home
  // they live in); relief === 0 keeps the exact v5 expression. v8: the living
  // BASKET and the clamp bounds index by the cumulative home CPI
  // (livingClampFor); the wealth levy does not — its base (worthBefore)
  // already self-indexes through the inflated asset prices.
  const worthBefore = netWorth(s);
  const fateMult = s.fate?.mods.livingCost ?? 1;
  const itemsSum = s.expenses
    ? s.expenses.items.reduce((acc, it) => acc + it.amount, 0)
    : balance.LIVING.BASE;
  const clamped = livingClampFor(s, itemsSum, worthBefore);
  const relief = homeReliefFor(s, worthBefore);
  const living = relief > 0 ? Math.max(0, clamped - relief) * fateMult : clamped * fateMult;
  s.cash = roundCash(s.cash - living);

  // Phase 4c — escrow maturation (v6, zero draws). BEFORE the deficit check:
  // a matured sale credits cash this month instead of triggering a fire sale.
  collectDueSales(s);

  // Phase 4d — forced liquidation
  if (s.cash < 0) {
    liquidateToRaise(s, -s.cash);
  }
  if (s.expenses) {
    // write-only monthly breakdown (display source; capped ring). The relief
    // and salary keys are present only on months with a positive value
    // (pre-v6/pre-v7 rows and relief-less/unemployed months stay
    // byte-identical to the earlier shapes). v8: the items aggregate is the
    // INFLATED basket (itemsSum × cpi) — the row shape itself is unchanged.
    const itemsPart = Math.min(itemsSum * cpiMult(s), clamped);
    s.expenses.flow.push({
      tick: s.tick,
      rent: income.rent,
      upkeep: income.upkeep,
      items: roundCash(itemsPart * fateMult),
      wealthLevy: roundCash((clamped - itemsPart) * fateMult),
      net: roundCash(salary + income.rent - income.upkeep - living),
      ...(relief > 0 ? { relief } : {}),
      ...(salary > 0 ? { salary: roundCash(salary) } : {}),
    });
    while (s.expenses.flow.length > balance.EXPENSES.FLOW_CAP) s.expenses.flow.shift();
  }

  // Phase 5 — valuation & bookkeeping
  const worth = netWorth(s);
  s.netWorthHistory.push(roundCash(worth));
  s.peakNetWorth = Math.max(s.peakNetWorth, worth);

  // v8: the bankruptcy threshold scales with the cumulative home CPI — being
  // "poor" is CPI-relative (10k of nominal cash in a 40%-inflation country
  // stops being safe as the index compounds). v8.1: it also scales by the
  // country's price level (a $5k buffer is poor in the US, not in Türkiye
  // where it buys a US-$12.5k life). cpi 1 and basket 1 keep the exact
  // pre-v8 comparison bits.
  if (worth < balance.BANKRUPT.THRESHOLD * cpiMult(s) * basketMult(s)) {
    s.lowWealthStreak += 1;
    if (s.lowWealthStreak >= balance.BANKRUPT.STREAK_MONTHS && s.status === 'PLAYING') {
      s.status = 'GAME_OVER_BANKRUPT';
    }
  } else {
    s.lowWealthStreak = 0;
  }

  // fill netWorth on this tick's non-choice log entries (fired during phase 2)
  for (let i = logLenBefore; i < s.eventLog.length; i++) {
    if (s.eventLog[i].netWorth === 0) s.eventLog[i].netWorth = roundCash(worth);
  }
}

/** Skip months until an event is pending (or maxMonths hit). Replay-safe: each month is a full tick. */
export function advanceUntilEvent(s: GameState, maxMonths = 12): void {
  for (let i = 0; i < maxMonths; i++) {
    if (s.pendingEvents.length > 0) return;
    if (s.status !== 'PLAYING') return;
    tick(s);
  }
}

// re-exported so engine consumers can soak-test the catalog without importing internals
export { EVENT_CATALOG };
