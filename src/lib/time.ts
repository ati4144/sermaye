import type { TFunction } from 'i18next';
import { gameYearMonth } from '@/engine';
import type { GameState } from '@/engine';

/**
 * The in-game calendar as the player reads it — v7. The math lives in the
 * engine (gameYearMonth over the scenario anchor); this layer only picks the
 * localized month name and glues the template. Dashboard shows the full name
 * ("Ekim 2026"), history rows the abbreviation ("Eki 2026").
 */

function monthLabel(t: TFunction, month: number, abbrev: boolean): string {
  const arr = t(abbrev ? 'ui.time.monthAbbrevs' : 'ui.time.monthNames', {
    returnObjects: true,
  }) as unknown as string[];
  return arr[month - 1] ?? String(month);
}

/** "Ekim 2026" — the dashboard clock (the run's current month). */
export function formatGameDate(s: GameState, t: TFunction): string {
  const { year, month } = gameYearMonth(s);
  return t('ui.dashboard.date', { month: monthLabel(t, month, false), year });
}

/** "Eki 2026" — history rows, at any entry's tick. */
export function formatGameDateShort(s: GameState, tick: number, t: TFunction): string {
  const { year, month } = gameYearMonth(s, tick);
  return t('ui.history.monthAbbrev', { abbr: monthLabel(t, month, true), year });
}
