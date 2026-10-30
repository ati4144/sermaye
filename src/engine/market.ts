import { balance } from './balance';
import { countryDef, COUNTRY_IDS } from './data/countries';
import { assetDef, activeAssetIds, DEED_LIQUIDATION_ORDER } from './data/assets';
import { normal12 } from './rng';
import type { RngState } from './rng';
import { enqueueLifeEvent, logAssetEntry, tickModifiers } from './events/apply';
import { REGIMES, assetRegimeParams } from './world';
import { inflationM } from './residency';
import { accruedDepositInterest } from './deposits';
import type { GameState } from './types';

/**
 * Effective monthly drift/vol for a country market — exactly what the next
 * tick applies: base drift/vol, regime multipliers (world-aware), then active
 * country + global mods. Shared by evolveMarkets AND the forecast cones so
 * the analyst line can never drift from the engine formula.
 */
export function countryDriftVol(s: GameState, countryId: string): { driftM: number; volM: number } {
  const def = countryDef(countryId);
  let driftM = def.baseDrift / 12;
  let volM = def.baseVol / balance.MARKET.ANNUAL_TO_MONTHLY_VOL;
  const regime = s.world ? REGIMES[s.world.regime] : null;
  if (regime) {
    driftM *= regime.driftMult;
    volM *= regime.volMult;
  }
  for (const m of s.countries[countryId].mods) {
    driftM += m.driftDelta;
    volM += m.volDelta;
  }
  for (const m of s.globalMods) {
    driftM += m.driftDelta;
    volM += m.volDelta;
  }
  return { driftM, volM };
}

/**
 * Effective monthly drift/vol for an asset market — same accumulation minus
 * globalMods (GLOBAL events stay country-only), with the pack's per-class
 * regime override REPLACING the base regime multipliers.
 */
export function assetDriftVol(s: GameState, assetId: string): { driftM: number; volM: number } {
  const def = assetDef(assetId);
  let driftM = def.baseDrift / 12;
  let volM = def.baseVol / balance.MARKET.ANNUAL_TO_MONTHLY_VOL;
  const mults = assetRegimeParams(s, assetId);
  if (mults) {
    driftM *= mults.driftMult;
    volM *= mults.volMult;
  }
  for (const m of s.assets!.markets[assetId].mods) {
    driftM += m.driftDelta;
    volM += m.volDelta;
  }
  // v8 residency: the home-CPI rate rides along as a nominal price drift —
  // a GUARDED append (inert paths perform no arithmetic at all, so legacy
  // bits are unchanged), never regime-multiplied (inflation is not a
  // boom/crisis phenomenon here; tr boom must not double-charge)
  if (s.residency) {
    driftM += inflationM(s);
  }
  return { driftM, volM };
}

/**
 * Phase 1 — evolve every country index by one month, in sorted-id order.
 * Monthly return = drift + vol * z, clamped. Modifiers tick down afterwards.
 * The v4 world regime (s.world) scales drift/vol multiplicatively — identity
 * multipliers (growth) and world === null leave the exact v3 formula.
 */
export function evolveMarkets(s: GameState, rng: RngState): void {
  for (const id of COUNTRY_IDS) {
    const cs = s.countries[id];
    const { driftM, volM } = countryDriftVol(s, id);

    const z = normal12(rng); // exactly 12 draws, per country, every tick
    const r = clamp(driftM + Math.max(0, volM) * z, -balance.MARKET.MAX_RETURN, balance.MARKET.MAX_RETURN);
    cs.index = Math.max(balance.MARKET.MIN_INDEX, cs.index * (1 + r));

    cs.mods = tickModifiers(cs.mods);
    cs.indexHistory.push(round4(cs.index));
    if (cs.indexHistory.length > balance.MARKET.HISTORY_CAP) {
      cs.indexHistory.shift();
    }
  }
  s.globalMods = tickModifiers(s.globalMods);
}

/**
 * Phase 1b — evolve every active asset market, in catalog order. Identical
 * formula to countries (12 draws each, same clamp) minus globalMods: GLOBAL
 * events stay country-only by design; cross-market effects are explicit
 * per-asset effect rows. No-op (zero draws) when the asset layer is null —
 * legacy v2 runs replay bit-for-bit.
 */
export function evolveAssetMarkets(s: GameState, rng: RngState): void {
  if (!s.assets) return;
  for (const id of activeAssetIds(s)) {
    const am = s.assets.markets[id];
    const { driftM, volM } = assetDriftVol(s, id);

    const z = normal12(rng); // exactly 12 draws, per active asset, every tick
    const r = clamp(driftM + Math.max(0, volM) * z, -balance.MARKET.MAX_RETURN, balance.MARKET.MAX_RETURN);
    am.index = Math.max(balance.MARKET.MIN_INDEX, am.index * (1 + r));

    am.mods = tickModifiers(am.mods);
    am.indexHistory.push(round4(am.index));
    if (am.indexHistory.length > balance.MARKET.HISTORY_CAP) {
      am.indexHistory.shift();
    }
  }
}

/** Unit price of an asset class: startPrice × index/100. */
export function assetPrice(s: GameState, id: string): number {
  const def = assetDef(id);
  return (def.startPrice * s.assets!.markets[id].index) / 100;
}

/** Asset fee including the current fate trait (fee mod reaches deeds too). */
export function assetFeeFor(s: GameState, id: string): number {
  return assetDef(id).fee * (s.fate?.mods.fee ?? 1);
}

/** Effective quick-sale discount: base + active liqDelta mods (crisis freeze). */
export function effectiveQuickDiscount(s: GameState, id: string): number {
  if (!s.assets) return assetDef(id).quickDiscount;
  let disc = assetDef(id).quickDiscount;
  for (const m of s.assets.markets[id].mods) {
    disc += m.liqDelta ?? 0;
  }
  return disc;
}

/** Current net worth: cash + Σ country holdings + Σ fractional assets + Σ deeds + escrow proceeds. */
export function netWorth(s: GameState): number {
  let total = s.cash;
  for (const id of COUNTRY_IDS) {
    const h = s.holdings[id];
    if (h) total += h.units * s.countries[id].index;
  }
  if (s.assets) {
    for (const id of activeAssetIds(s)) {
      const def = assetDef(id);
      if (def.kind === 'FRACTIONAL') {
        const h = s.holdings[id];
        if (h) total += h.units * assetPrice(s, id);
      } else {
        const pos = s.properties[id];
        if (pos) total += pos.units * assetPrice(s, id);
      }
    }
  }
  // v6: locked escrow proceeds are a receivable — listed units already left
  // `properties`, so this is the only place they still count (empty array on
  // pre-v6 replays keeps the sum bit-identical).
  for (const ps of s.pendingSales) total += ps.proceeds;
  // v9: open deposits are receivables — principal plus accrued-but-unpaid
  // interest, derived here and never stored (empty array on pre-v9 replays
  // keeps the sum bit-identical).
  for (const d of s.deposits) total += d.principal + accruedDepositInterest(d, s.tick);
  return total;
}

/** Fee rate for a country by risk grade. */
export function feeRate(countryId: string): number {
  return balance.FEES[countryDef(countryId).grade];
}

/** Fee rate including the current fate trait (e.g. diaspora ağı). */
export function feeRateFor(s: GameState, countryId: string): number {
  return feeRate(countryId) * (s.fate?.mods.fee ?? 1);
}

/** Round to cents. */
export function roundCash(x: number): number {
  return Math.round(x * 100) / 100;
}

export function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

/**
 * Phase 4a — asset income/expenses, zero draws. Fractional yield classes pay
 * through `holdings`, DEED classes through `properties` (negative yield =
 * upkeep drains cash). Rent-yielding deeds accumulate rentCollected. No-op
 * when the asset layer is null. Returns the month's totals (rent in /
 * upkeep out, upkeep stored positive) for the v5 cash-flow record — the
 * cash math is exactly the pre-v5 behavior.
 */
export function collectAssetIncome(s: GameState): { rent: number; upkeep: number } {
  const totals = { rent: 0, upkeep: 0 };
  if (!s.assets) return totals;
  for (const id of activeAssetIds(s)) {
    const def = assetDef(id);
    if (def.kind === 'FRACTIONAL') {
      const h = s.holdings[id];
      if (!h) continue;
      const inc = assetIncomeFor(s, id, h.units);
      if (inc !== 0) s.cash = roundCash(s.cash + inc);
      if (inc > 0) totals.rent = roundCash(totals.rent + inc);
      else totals.upkeep = roundCash(totals.upkeep - inc);
    } else {
      const pos = s.properties[id];
      if (!pos) continue;
      const inc = assetIncomeFor(s, id, pos.units);
      if (inc !== 0) {
        s.cash = roundCash(s.cash + inc);
        if (inc > 0) pos.rentCollected = roundCash(pos.rentCollected + inc);
      }
      if (inc > 0) totals.rent = roundCash(totals.rent + inc);
      else totals.upkeep = roundCash(totals.upkeep - inc);
    }
  }
  return totals;
}

/** units × price × (yieldNetM + Σ yieldMods), rounded to cents. */
function assetIncomeFor(s: GameState, id: string, units: number): number {
  const def = assetDef(id);
  const market = s.assets!.markets[id];
  let y = def.yieldNetM;
  for (const m of market.mods) {
    y += m.yieldDelta ?? 0;
  }
  return roundCash(units * assetPrice(s, id) * y);
}

/**
 * v6 Yuva relief — min(home value × RELIEF_RATE_M, worth × RELIEF_WORTH_CAP),
 * rounded to cents. Zero on every legacy/no-home path (null layer, renting,
 * or the designated home no longer owned — sold or escrowed units left
 * `properties`, so read-time ownership lapses and re-buys resume it).
 * Exported so CashflowCard's estimate reuses the exact engine formula.
 */
export function homeReliefFor(s: GameState, worth: number): number {
  if (!s.home || s.home.role !== 'home' || !s.home.assetId) return 0;
  const pos = s.properties[s.home.assetId];
  if (!pos || pos.units <= 0) return 0;
  return roundCash(
    Math.min(
      assetPrice(s, s.home.assetId) * balance.HOME.RELIEF_RATE_M,
      worth * balance.HOME.RELIEF_WORTH_CAP,
    )
  );
}

/**
 * v6 escrow preview — the proceeds a LIST of `units` would lock right now:
 * price × (1 − fee), NO quick-sale discount (the reward for patience).
 * Shared by the LIST_ASSET handler and the UI preview so they can't drift.
 */
export function escrowProceedsFor(s: GameState, assetId: string, units: number): number {
  return roundCash(units * assetPrice(s, assetId) * (1 - assetFeeFor(s, assetId)));
}

/**
 * v7 salary due this month — the employed salary, 0 on every inert/unemployed
 * path (null layer, job lost). Shared by the phase-4a-pre credit and
 * CashflowCard's estimate so the two can't drift (homeReliefFor pattern).
 */
export function salaryFor(s: GameState): number {
  return s.income?.employed ? s.income.salaryM : 0;
}

/**
 * Phase 4c (v6) — collect matured escrow sales, in listing (array) order.
 * Zero draws; the empty ledger on pre-v6 replays makes this a no-op.
 * Proceeds are principal, not income: they never enter the v5 cash-flow
 * record.
 */
export function collectDueSales(s: GameState): void {
  const due = s.pendingSales.filter((ps) => ps.dueTick <= s.tick);
  if (due.length === 0) return;
  for (const ps of due) {
    s.cash = roundCash(s.cash + ps.proceeds);
    logAssetEntry(s, 'asset_escrow_collected', ps.assetId, ps.units, ps.proceeds);
  }
  s.pendingSales = s.pendingSales.filter((ps) => ps.dueTick > s.tick);
}

/**
 * Forced liquidation ladder to cover a cash deficit (living costs, event
 * costs, estate tax). Deterministic order, whole units for deeds:
 *
 *   1. fractional assets (gold) — pro-rata, closest to cash
 *   2. countries — pro-rata (the v2 behavior, unchanged)
 *   3. deeds: car → farm → house — whole units at the quick-sale discount
 *      plus the distress penalty ("the home sells last"); overage is
 *      conscious, every forced sale is logged for the history screen
 *
 * If nothing covers the deficit, cash stays negative. Steps 1 and 3 are empty
 * on legacy v2 runs — the ladder collapses to the exact v2 code path.
 *
 * v6: any L1/L3 (asset) sale enqueues the 'forced_sale' ACK notice, ≤1 per
 * tick, so FAST_FORWARD stops and the player sees the fire sale happen. L2/
 * country sales NEVER enqueue it — legacy v2 runs liquidate countries
 * silently today and must keep doing so (golden parity).
 */
export function liquidateToRaise(s: GameState, deficit: number): void {
  let remaining = deficit;
  let assetSales = 0;

  // L1 — fractional assets (gold), pro-rata
  if (s.assets && remaining > 0) {
    let liquidationValue = 0;
    for (const id of activeAssetIds(s)) {
      const h = s.holdings[id];
      if (h && assetDef(id).kind === 'FRACTIONAL') {
        liquidationValue += h.units * assetPrice(s, id) * (1 - assetFeeFor(s, id));
      }
    }
    if (liquidationValue > 0) {
      const fraction = Math.min(1, remaining / liquidationValue);
      let raised = 0;
      let soldAny = false;
      let soldUnits = 0;
      let soldId: string | undefined;
      for (const id of activeAssetIds(s)) {
        const h = s.holdings[id];
        if (!h || h.units <= 0 || assetDef(id).kind !== 'FRACTIONAL') continue;
        const unitsToSell = h.units * fraction;
        raised += unitsToSell * assetPrice(s, id) * (1 - assetFeeFor(s, id));
        h.units = round4(h.units - unitsToSell);
        if (h.units <= 0.0001) delete s.holdings[id];
        soldAny = true;
        soldUnits += unitsToSell;
        soldId = id;
      }
      if (soldAny && raised > 0) {
        s.cash = roundCash(s.cash + raised);
        remaining -= raised;
        assetSales += 1;
        logAssetEntry(s, 'asset_forced_sale', soldId, round4(soldUnits), roundCash(raised));
      }
    }
  }

  // L2 — countries, pro-rata (v2 behavior)
  if (remaining > 0) {
    let liquidationValue = 0;
    for (const id of COUNTRY_IDS) {
      const h = s.holdings[id];
      if (h) liquidationValue += h.units * s.countries[id].index * (1 - feeRateFor(s, id));
    }
    if (liquidationValue > 0) {
      const fraction = Math.min(1, remaining / liquidationValue);
      let raised = 0;
      for (const id of COUNTRY_IDS) {
        const h = s.holdings[id];
        if (!h || h.units <= 0) continue;
        const cs = s.countries[id];
        const unitsToSell = h.units * fraction;
        raised += unitsToSell * cs.index * (1 - feeRateFor(s, id));
        h.units = round4(h.units - unitsToSell);
        if (h.units <= 0.0001) delete s.holdings[id];
      }
      if (raised > 0) s.cash = roundCash(s.cash + raised);
      remaining -= raised;
    }
  }

  // L3 — deeds: car → farm → house, whole units, fire-sale price
  if (s.assets && remaining > 0) {
    for (const id of DEED_LIQUIDATION_ORDER) {
      if (remaining <= 0.005) break;
      const pos = s.properties[id];
      if (!pos || pos.units <= 0) continue;
      const netPerUnit = assetPrice(s, id) * (1 - assetFeeFor(s, id)) * (1 - effectiveQuickDiscount(s, id) - balance.ASSETS.DISTRESS_PENALTY);
      if (netPerUnit <= 0) continue;
      const unitsToSell = Math.min(pos.units, Math.ceil(remaining / netPerUnit));
      const proceeds = roundCash(unitsToSell * netPerUnit);
      pos.units -= unitsToSell;
      if (pos.units <= 0) delete s.properties[id];
      s.cash = roundCash(s.cash + proceeds);
      remaining -= proceeds;
      assetSales += 1;
      logAssetEntry(s, 'asset_forced_sale', id, unitsToSell, proceeds);
    }
  }

  // v6 — the fire-sale notice (ACK). Gated on asset sales only, deduped per
  // tick; every ladder call site (phase 4d, event costs, estate tax) gets it.
  if (assetSales > 0 && !s.pendingEvents.some((e) => e.eventId === 'forced_sale')) {
    enqueueLifeEvent(s, 'forced_sale', false);
  }
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
