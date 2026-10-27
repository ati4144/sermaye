import { balance } from './balance';
import { WORLD_PACK } from './worldpack';
import type { GameState, RegimeId } from './types';

/**
 * The v8 "Vatan" (residency) layer — the home-country inflation engine.
 * Deterministic to the bone: ZERO rng draws anywhere (a fixed per-country CPI
 * catalog, scenario-arc overrides, and a mild regime tilt on catalog rates
 * only), which keeps every pre-v8 path byte-identical while residency is null.
 *
 * Scope (user decision 2026-10-18): asset prices gain the monthly rate as a
 * nominal drift add-on; the living BASKET (the expense items) indexes by the
 * cumulative cpi; the bankruptcy threshold scales with it. The wealth levy
 * deliberately does NOT index — its base (net worth) already self-indexes
 * through the inflated asset prices, so a second multiplier would double-count
 * the asset side. Salary stays nominal: the v7 yearly raise review is the
 * inflation defense.
 */

/**
 * Annual home CPI, current era — the player-side catalog. countries.ts is the
 * investable-markets catalog (equity drift/vol/fees) and stays CPI-free by
 * the locked scope decision; home inflation lives here and here only.
 */
export const HOME_INFLATION: Record<string, number> = {
  us: 0.025,
  de: 0.02,
  jp: 0.005,
  uk: 0.025,
  cn: 0.02,
  in: 0.055,
  ae: 0.02,
  tr: 0.4,
  br: 0.05,
  ng: 0.18,
};

/**
 * Mild deterministic tilt on CATALOG rates by the current world regime —
 * applied to the base table only, never to scenario-arc overrides (authored
 * era data already encodes the era's regime character; a crisis tilt on
 * gfc_2008's .015 would push the wrong direction).
 */
export const REGIME_TILT: Record<RegimeId, number> = {
  growth: 1,
  boom: 1.2,
  crisis: 1.25,
  stagnation: 1.05,
};

/**
 * The effective ANNUAL home-CPI rate. Scenario overrides apply only while the
 * arc is live (beatCursor < beats.length — the same window world.ts uses for
 * regime suppression): a permanent 1973 override would compound US CPI ×25 by
 * year 50, while post-arc the catalog's ~.025 matches the post-Volcker era.
 */
export function annualCpiRate(s: GameState): number {
  const r = s.residency;
  if (!r) return 0;
  const w = s.world;
  if (w && w.scenarioId) {
    const def = WORLD_PACK.scenarios.find((d) => d.id === w.scenarioId);
    if (def && w.beatCursor < def.beats.length) {
      const override = def.inflation?.[r.countryId];
      if (override !== undefined) return override;
    }
  }
  const tilt = w ? REGIME_TILT[w.regime] : 1;
  return (HOME_INFLATION[r.countryId] ?? 0) * tilt;
}

/**
 * Monthly home-CPI rate — the SAME value phase 0.97 compounds and phase 1b's
 * asset-drift add-on reads within a tick (single-sourced on purpose).
 */
export function inflationM(s: GameState): number {
  return annualCpiRate(s) / 12;
}

/**
 * Cumulative CPI multiplier — 1 on every inert path. Shared by the engine and
 * the UI estimate surfaces (homeReliefFor pattern) so the two can't drift.
 */
export function cpiMult(s: GameState): number {
  return s.residency ? s.residency.cpi / 100 : 1;
}

const round4 = (x: number): number => Math.round(x * 10000) / 10000; // market.ts twin, kept local to avoid a market↔residency import cycle

/**
 * Phase 0.97 — compound the CPI index. Zero draws; no-op when the layer is
 * null. Runs after the world/beats so this month's regime and arc state
 * already apply, and before the markets so the phase-1b drift add-on reads
 * the same month's rate.
 */
export function evolveResidency(s: GameState): void {
  if (!s.residency) return;
  s.residency.cpi = round4(s.residency.cpi * (1 + inflationM(s)));
}

/**
 * The phase-4b living-cost clamp — shared by the engine and the UI estimate
 * surfaces so the formula can never drift (homeReliefFor pattern). v8: the
 * basket AND the bounds index by the cumulative CPI; the wealth-levy term
 * inside the raw value does not (its base — net worth — self-indexes via the
 * inflated asset prices). cpi 1 (every inert path) keeps the exact pre-v8
 * bits: x*1 === x in IEEE-754.
 */
export function livingClampFor(s: GameState, itemsSum: number, worth: number): number {
  const cpi = cpiMult(s);
  return Math.min(
    balance.LIVING.MAX * cpi,
    Math.max(itemsSum * cpi, itemsSum * cpi + worth * balance.LIVING.NETWORTH_RATE),
  );
}
