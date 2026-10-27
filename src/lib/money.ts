import i18n from '@/i18n';
import { currencyDef, toDisplay, toUsd, type CurrencyId } from '@/lib/currency';
import { useSettingsStore } from '@/store/settingsStore';

function currentCurrency(): CurrencyId {
  // getState() so formatMoney also works outside React (logs, helpers)
  return useSettingsStore.getState().currency;
}

/**
 * The single seam for money formatting. The ENGINE currency is USD; what the
 * player sees is the selected display currency, converted with the fixed
 * snapshot rate from currency.ts. The locale follows the UI language.
 */
export function formatMoney(value: number, opts: { decimals?: number; sign?: boolean } = {}): string {
  const locale = i18n.language === 'en' ? 'en-US' : 'tr-TR';
  const cur = currencyDef(currentCurrency());
  const decimals = Math.min(opts.decimals ?? 0, cur.decimals);
  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: cur.code,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(toDisplay(value, cur.id)));
  if (value < 0) return `-${formatted}`;
  if (opts.sign && value > 0) return `+${formatted}`;
  return formatted;
}

export function formatPct(value: number, opts: { decimals?: number; sign?: boolean } = {}): string {
  const locale = i18n.language === 'en' ? 'en-US' : 'tr-TR';
  const decimals = opts.decimals ?? 1;
  const formatted = new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Math.abs(value));
  if (value < 0) return `-${formatted}`;
  if (opts.sign && value > 0) return `+${formatted}`;
  return formatted;
}

export function formatNumber(value: number, decimals = 0): string {
  const locale = i18n.language === 'en' ? 'en-US' : 'tr-TR';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Subscribe the calling component to display-currency changes. formatMoney
 * reads the store imperatively, so a component that renders money needs this
 * hook to re-render when the player switches currency (React Compiler
 * memoizes children — a store hook in the component itself is what
 * guarantees freshness). One bare call at the top of the component suffices.
 */
export function useCurrencySync(): void {
  useSettingsStore((s) => s.currency);
}

/** Typed display-currency number → engine USD (input seam: dispatch side). */
export function inputToUsd(display: number): number {
  return toUsd(display, currentCurrency());
}

/** Display-currency ISO code for input labels ('Maaş ({{unit}}/ay)'). */
export function displayCurrencyCode(): string {
  return currencyDef(currentCurrency()).code;
}

/** Engine USD → locale-neutral seed string for amount inputs (no thousand
 *  separators, dot decimal — the inputs parse with replace(',', '.')). */
export function usdToSeed(usd: number): string {
  const v = toDisplay(usd, currentCurrency());
  return String(Math.round(v * 100) / 100);
}

/** Engine USD → locale-formatted whole display-currency number (no symbol) —
 *  quick-button labels like "half the wallet". */
export function formatDisplayAmount(usd: number): string {
  return formatNumber(Math.floor(toDisplay(usd, currentCurrency())));
}
