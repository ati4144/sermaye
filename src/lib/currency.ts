/**
 * Display-currency catalog — a UI concern, never an engine one. The engine
 * stays USD-denominated (goldens, balance constants, log amounts); every
 * conversion happens at the formatMoney/input seam in money.ts.
 *
 * Rates are a FIXED approximate snapshot (RATE_SNAPSHOT), bundled so the app
 * needs no network and replays stay deterministic. The settings screen labels
 * them as approximate — this is a flavor conversion, not a market feed.
 */
export type CurrencyId = 'usd' | 'eur' | 'gbp' | 'jpy' | 'chf' | 'cny' | 'try' | 'inr' | 'aed' | 'brl' | 'ngn';

export interface CurrencyDef {
  id: CurrencyId;
  /** ISO 4217 code handed to Intl.NumberFormat */
  code: string;
  /** chip label in the settings picker */
  label: string;
  /** display units per 1 engine USD (approximate snapshot) */
  perUsd: number;
  /** conventional fraction digits — caps whatever the caller asks for */
  decimals: 0 | 2;
}

export const RATE_SNAPSHOT = '2026-10';

export const CURRENCIES: readonly CurrencyDef[] = [
  { id: 'usd', code: 'USD', label: '$ USD', perUsd: 1, decimals: 2 },
  { id: 'try', code: 'TRY', label: '₺ TL', perUsd: 36, decimals: 2 },
  { id: 'eur', code: 'EUR', label: '€ EUR', perUsd: 0.86, decimals: 2 },
  { id: 'gbp', code: 'GBP', label: '£ GBP', perUsd: 0.78, decimals: 2 },
  { id: 'jpy', code: 'JPY', label: '¥ JPY', perUsd: 150, decimals: 0 },
  { id: 'chf', code: 'CHF', label: 'CHF', perUsd: 0.88, decimals: 2 },
  { id: 'cny', code: 'CNY', label: 'CN¥ CNY', perUsd: 7.1, decimals: 2 },
  // v8 home countries — appended AFTER the original seven so the existing
  // order pins stay put (currency.test asserts the sequence)
  { id: 'inr', code: 'INR', label: '₹ INR', perUsd: 83, decimals: 2 },
  { id: 'aed', code: 'AED', label: 'AED', perUsd: 3.67, decimals: 2 },
  { id: 'brl', code: 'BRL', label: 'R$ BRL', perUsd: 5.4, decimals: 2 },
  { id: 'ngn', code: 'NGN', label: '₦ NGN', perUsd: 1550, decimals: 2 },
];

/**
 * v8 home country → default display currency. The country pick on the new
 * game flow calls setCurrency(COUNTRY_CURRENCY[id]) as a CONVENIENCE default;
 * the settings picker stays the override (chf lives there, not here — it is
 * not a home country). Display-side only — the engine never reads this.
 */
export const COUNTRY_CURRENCY: Record<string, CurrencyId> = {
  us: 'usd',
  de: 'eur',
  jp: 'jpy',
  uk: 'gbp',
  cn: 'cny',
  in: 'inr',
  ae: 'aed',
  tr: 'try',
  br: 'brl',
  ng: 'ngn',
};

const BY_ID: Record<CurrencyId, CurrencyDef> = Object.fromEntries(
  CURRENCIES.map((c) => [c.id, c]),
) as Record<CurrencyId, CurrencyDef>;

export function currencyDef(id: CurrencyId): CurrencyDef {
  const def = BY_ID[id];
  if (!def) throw new Error(`UNKNOWN_CURRENCY:${String(id)}`);
  return def;
}

/** engine USD → display units */
export function toDisplay(usd: number, id: CurrencyId): number {
  return usd * currencyDef(id).perUsd;
}

/** typed display units → engine USD (input seam) */
export function toUsd(display: number, id: CurrencyId): number {
  return display / currencyDef(id).perUsd;
}
