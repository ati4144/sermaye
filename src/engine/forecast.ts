/**
 * Analyst forecast cones (v4) — p10/p50/p90 projections per market.
 *
 * A Monte-Carlo over the SAME evolution formula the tick uses (drift + vol × z,
 * same clamps), holding the CURRENT regime and active modifiers constant: the
 * "analyst view" is deliberately fallible — regimes flip, events fire, and the
 * cone will miss. It is a pure READ:
 *
 *   - randomness comes from a scratch rng seeded by hash(seed, tick, marketId),
 *     never from s.rng — the live stream is untouched, calls are free of side
 *     effects, and identical states always produce identical cones;
 *   - only cross-engine-safe math (+ - * /, floor/min/max, imul for the seed
 *     hash, Irving–Hall normals) — runs identically on Hermes/JSC/V8.
 */
import { balance } from './balance';
import { COUNTRY_IDS } from './data/countries';
import { assetDef } from './data/assets';
import { createRng, normal12 } from './rng';
import type { RngState } from './rng';
import { clamp, countryDriftVol, assetDriftVol } from './market';
import type { GameState } from './types';

export interface ForecastCone {
  /** pessimistic index level (10th percentile) */
  p10: number;
  /** median index level (50th percentile) */
  p50: number;
  /** optimistic index level (90th percentile) */
  p90: number;
}

/** Monte-Carlo paths per cone — enough for stable percentiles, cheap on-device. */
const PATHS = 64;
export const FORECAST_MAX_MONTHS = 12;

/** FNV-1a-style string hash with imul mixing — deterministic, engine-safe. */
function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Scratch seed: (game seed, tick, marketId) → one 32-bit stream id. */
function coneSeed(s: GameState, marketId: string): number {
  let h = (s.seed ^ Math.imul(s.tick, 0x9e3779b1)) >>> 0;
  h = (Math.imul(h, 0x85ebca6b) ^ hashString(marketId)) >>> 0;
  return (Math.imul(h, 0xc2b2ae35) ^ (h >>> 13)) >>> 0;
}

/**
 * Forecast cone for any market id — a country id or an asset id. The horizon
 * is months (clamped to FORECAST_MAX_MONTHS). Returns index levels: country
 * index or asset index (unit price = startPrice × index/100, as elsewhere).
 * World-null runs project with identity multipliers — still a useful cone.
 */
export function forecastCone(s: GameState, marketId: string, months: number): ForecastCone {
  const m = Math.max(1, Math.min(FORECAST_MAX_MONTHS, Math.floor(months)));
  const rng: RngState = createRng(coneSeed(s, marketId));

  // Effective per-month drift/vol — the SAME helpers the tick uses, so the
  // cone can never drift from the engine formula (asset markets skip
  // globalMods inside assetDriftVol, matching evolveAssetMarkets).
  if (COUNTRY_IDS.indexOf(marketId) >= 0) {
    const cs = s.countries[marketId];
    const { driftM, volM } = countryDriftVol(s, marketId);
    return projectCone(rng, cs.index, driftM, volM, m);
  }

  assetDef(marketId); // throws UNKNOWN_ASSET on ids that are neither country nor asset
  if (!s.assets || !s.assets.markets[marketId]) throw new Error('ASSET_INACTIVE');
  const am = s.assets.markets[marketId];
  const { driftM, volM } = assetDriftVol(s, marketId);
  return projectCone(rng, am.index, driftM, volM, m);
}

/** Run PATHS × months forward from `index` and pick the percentiles. */
function projectCone(rng: RngState, index: number, driftM: number, volM: number, months: number): ForecastCone {
  const finals: number[] = [];
  const vol = Math.max(0, volM);
  for (let p = 0; p < PATHS; p++) {
    let idx = index;
    for (let i = 0; i < months; i++) {
      const z = normal12(rng);
      const r = clamp(driftM + vol * z, -balance.MARKET.MAX_RETURN, balance.MARKET.MAX_RETURN);
      idx = Math.max(balance.MARKET.MIN_INDEX, idx * (1 + r));
    }
    finals.push(idx);
  }
  finals.sort((a, b) => a - b);
  return {
    p10: finals[pick(0.1)],
    p50: finals[pick(0.5)],
    p90: finals[pick(0.9)],
  };

  function pick(q: number): number {
    return Math.min(finals.length - 1, Math.max(0, Math.floor(q * (finals.length - 1))));
  }
}

/** Convenience for UI chips: signed median 12-month percentage move. */
export function forecastMedianMove(s: GameState, marketId: string, months: number): number {
  const cone = forecastCone(s, marketId, months);
  return (cone.p50 / currentLevel(s, marketId) - 1) * 100;
}

function currentLevel(s: GameState, marketId: string): number {
  if (COUNTRY_IDS.indexOf(marketId) >= 0) return s.countries[marketId].index;
  if (!s.assets || !s.assets.markets[marketId]) throw new Error('ASSET_INACTIVE');
  return s.assets.markets[marketId].index;
}
