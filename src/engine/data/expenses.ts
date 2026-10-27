import { balance } from '../balance';
import type { ExpenseItem, ExpensesState, LifestyleTier } from '../types';

/**
 * Lifestyle presets — the data side of the v5 expense layer (the assets.ts
 * pattern: amounts live in balance.ts, shape/helpers here). Each tier's item
 * keys resolve through i18n (`expenses.items.<key>`); the STANDARD set sums
 * exactly to LIVING.BASE so v5's default cash path equals the flat v4 formula.
 */
export const LIFESTYLE_TIERS: LifestyleTier[] = ['frugal', 'standard', 'comfort', 'luxury'];

export function isLifestyleTier(v: string): v is LifestyleTier {
  return (LIFESTYLE_TIERS as string[]).includes(v);
}

/** Fresh PRESET items for a tier, ids minted from the save's seq counter. */
export function presetItems(tier: LifestyleTier, startSeq: number): { items: ExpenseItem[]; seq: number } {
  const rows = balance.EXPENSES.PRESETS[tier];
  let seq = startSeq;
  const items = rows.map((row) => {
    seq += 1;
    return { id: `e${seq}`, kind: 'PRESET' as const, key: row.key, amount: row.amount };
  });
  return { items, seq };
}

/** Zero-draw initializer: standard tier presets, empty flow. */
export function createExpenses(): ExpensesState {
  const { items, seq } = presetItems('standard', 0);
  return { lifestyle: 'standard', items, seq, flow: [] };
}
