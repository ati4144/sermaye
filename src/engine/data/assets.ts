import { balance } from '../balance';
import type { AssetDef, GameState } from '../types';

/**
 * Asset class catalog — the countries.ts pattern. Catalog order IS the draw
 * order (phase 1b); ids never collide with COUNTRY_IDS (enforced by test).
 * Adding a class in a later version = one row here + i18n keys; the engine
 * surface does not change.
 */
const A = balance.ASSETS;

export const ASSETS_CATALOG: AssetDef[] = [
  {
    id: 'gold',
    kind: 'FRACTIONAL',
    category: 'METAL',
    grade: 'A',
    startPrice: A.GOLD.START_PRICE,
    baseDrift: A.GOLD.DRIFT,
    baseVol: A.GOLD.VOL,
    yieldNetM: A.GOLD.YIELD_NET_M,
    fee: A.GOLD.FEE,
    quickDiscount: A.GOLD.QUICK_DISCOUNT,
  },
  {
    id: 'house',
    kind: 'DEED',
    category: 'REAL_ESTATE',
    grade: 'B',
    startPrice: A.HOUSE.START_PRICE,
    baseDrift: A.HOUSE.DRIFT,
    baseVol: A.HOUSE.VOL,
    yieldNetM: A.HOUSE.YIELD_NET_M,
    fee: A.HOUSE.FEE,
    quickDiscount: A.HOUSE.QUICK_DISCOUNT,
  },
  {
    id: 'farm',
    kind: 'DEED',
    category: 'LAND',
    grade: 'B',
    startPrice: A.FARM.START_PRICE,
    baseDrift: A.FARM.DRIFT,
    baseVol: A.FARM.VOL,
    yieldNetM: A.FARM.YIELD_NET_M,
    fee: A.FARM.FEE,
    quickDiscount: A.FARM.QUICK_DISCOUNT,
  },
  {
    id: 'car',
    kind: 'DEED',
    category: 'VEHICLE',
    grade: 'C',
    startPrice: A.CAR.START_PRICE,
    baseDrift: A.CAR.DRIFT,
    baseVol: A.CAR.VOL,
    yieldNetM: A.CAR.YIELD_NET_M,
    fee: A.CAR.FEE,
    quickDiscount: A.CAR.QUICK_DISCOUNT,
  },
  {
    // v6 — appended LAST: catalog order is draw order, so legacy replays that
    // somehow reach this code must not see the stream fork mid-catalog. New
    // games activate it from creation; old saves via ACTIVATE_ASSET.
    id: 'villa',
    kind: 'DEED',
    category: 'REAL_ESTATE',
    grade: 'B',
    startPrice: A.VILLA.START_PRICE,
    baseDrift: A.VILLA.DRIFT,
    baseVol: A.VILLA.VOL,
    yieldNetM: A.VILLA.YIELD_NET_M,
    fee: A.VILLA.FEE,
    quickDiscount: A.VILLA.QUICK_DISCOUNT,
  },
];

/** Fixed draw/iteration order — the single source of truth for phase 1b. */
export const ASSET_IDS: string[] = ASSETS_CATALOG.map((d) => d.id);

/** Forced-liquidation order for DEED classes: cars go first, the home last. */
export const DEED_LIQUIDATION_ORDER: string[] = ['car', 'farm', 'house', 'villa'];

export function assetDef(id: string): AssetDef {
  const def = ASSETS_CATALOG.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown asset: ${id}`);
  return def;
}

/** Active asset ids in catalog order (never Object.keys insertion order). */
export function activeAssetIds(s: GameState): string[] {
  if (!s.assets) return [];
  const active = s.assets.activeIds;
  return ASSET_IDS.filter((id) => active.includes(id));
}
