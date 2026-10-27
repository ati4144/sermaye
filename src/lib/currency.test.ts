import { describe, expect, it } from 'vitest';
import { COUNTRY_CURRENCY, CURRENCIES, RATE_SNAPSHOT, currencyDef, toDisplay, toUsd } from './currency';
import { COUNTRY_IDS } from '../engine/data/countries';

describe('currency catalog (display layer — engine stays USD)', () => {
  it('ships the majors + TL + the v8 home currencies, unique ids, sane rates', () => {
    expect(CURRENCIES.map((c) => c.id)).toEqual([
      'usd', 'try', 'eur', 'gbp', 'jpy', 'chf', 'cny', // original seven — order pinned
      'inr', 'aed', 'brl', 'ngn', // v8 append — always after the seven
    ]);
    expect(new Set(CURRENCIES.map((c) => c.code)).size).toBe(CURRENCIES.length);
    for (const c of CURRENCIES) {
      expect(Number.isFinite(c.perUsd)).toBe(true);
      expect(c.perUsd).toBeGreaterThan(0);
    }
    expect(currencyDef('usd').perUsd).toBe(1);
    expect(RATE_SNAPSHOT).toMatch(/^\d{4}-\d{2}$/);
  });

  it('JPY carries no fraction digits; the rest cap at two', () => {
    expect(currencyDef('jpy').decimals).toBe(0);
    for (const c of CURRENCIES) {
      if (c.id !== 'jpy') expect(c.decimals).toBe(2);
    }
  });

  it('converts both ways — a typed display amount reaches the engine as USD', () => {
    expect(toDisplay(100, 'try')).toBeCloseTo(3600);
    expect(toUsd(3600, 'try')).toBeCloseTo(100);
    expect(toDisplay(1, 'usd')).toBe(1);
    // round trip through any currency returns the engine value
    for (const c of CURRENCIES) {
      expect(toUsd(toDisplay(1234.56, c.id), c.id)).toBeCloseTo(1234.56, 10);
    }
  });

  it('throws on unknown ids instead of silently formatting USD', () => {
    expect(() => currencyDef('btc' as never)).toThrow(/UNKNOWN_CURRENCY/);
  });

  it('COUNTRY_CURRENCY covers exactly the home countries and every id resolves', () => {
    expect(Object.keys(COUNTRY_CURRENCY).sort()).toEqual([...COUNTRY_IDS].sort());
    for (const cur of Object.values(COUNTRY_CURRENCY)) {
      expect(() => currencyDef(cur)).not.toThrow();
    }
  });
});
