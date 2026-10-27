import type { CountryDef } from '../types';

/**
 * The investable world. Higher risk grade (C) = higher drift & volatility and
 * higher fees. Flavor text lives in locale files under countries.<id>.*.
 */
export const COUNTRIES: CountryDef[] = [
  { id: 'us', grade: 'A', baseDrift: 0.07, baseVol: 0.15 },
  { id: 'de', grade: 'A', baseDrift: 0.06, baseVol: 0.14 },
  { id: 'jp', grade: 'A', baseDrift: 0.05, baseVol: 0.16 },
  { id: 'uk', grade: 'B', baseDrift: 0.06, baseVol: 0.18 },
  { id: 'cn', grade: 'B', baseDrift: 0.09, baseVol: 0.22 },
  { id: 'in', grade: 'B', baseDrift: 0.1, baseVol: 0.24 },
  { id: 'ae', grade: 'B', baseDrift: 0.08, baseVol: 0.26 },
  { id: 'tr', grade: 'C', baseDrift: 0.11, baseVol: 0.3 },
  { id: 'br', grade: 'C', baseDrift: 0.09, baseVol: 0.28 },
  { id: 'ng', grade: 'C', baseDrift: 0.12, baseVol: 0.34 },
];

export const COUNTRY_IDS: string[] = COUNTRIES.map((c) => c.id);

const byId = new Map(COUNTRIES.map((c) => [c.id, c]));

export function countryDef(id: string): CountryDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown country: ${id}`);
  return def;
}
