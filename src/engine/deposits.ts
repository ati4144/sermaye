import { balance } from './balance';
import { netWorth, round4, roundCash } from './market';
import { annualCpiRate } from './residency';
import type { DepositState, GameState } from './types';

/**
 * v9 deposit rate — LOCKED at open: the country's current annual CPI path
 * (catalog / scenario-arc override / regime tilt — annualCpiRate) plus the
 * term spread. Zero draws; reads state only. A no-residency run prices at
 * the bare spread (annualCpiRate 0) — the same inert default every other
 * inflation seam uses, so pre-v8 replays keep their bits.
 */
export function depositRateFor(s: GameState, termMonths: number): number {
  return round4(annualCpiRate(s) + (balance.DEPOSITS.SPREAD_BY_TERM[termMonths] ?? 0));
}

/**
 * Simple interest accrued so far — DERIVED, never stored: principal × annual
 * rate / 12 × elapsed months, capped at the term (months after maturity
 * credit nothing extra). Shared by netWorth and the UI rows so the numbers
 * can never drift (homeReliefFor pattern).
 */
export function accruedDepositInterest(d: DepositState, tick: number): number {
  const elapsed = Math.min(Math.max(0, tick - d.openedTick), d.termMonths);
  return roundCash((d.principal * d.annualRate * elapsed) / 12);
}

/**
 * Full maturity payout: principal + term interest. Bit-identical to
 * `principal + accruedDepositInterest(d, dueTick)` — same expression, same
 * operation order (the twin is tested).
 */
export function depositPayoutFor(d: DepositState): number {
  return roundCash(d.principal + (d.principal * d.annualRate * d.termMonths) / 12);
}

/**
 * Phase 4c (v9) — collect matured deposits, in array order. Zero draws; the
 * empty ledger on pre-v9 replays makes this a no-op. The PRINCIPAL is
 * returned capital (never enters the cash-flow record, like escrow
 * proceeds); the INTEREST is genuine income and lands on the month's flow
 * row via the conditional `interest` key.
 */
export function collectDueDeposits(s: GameState): { credited: number; interest: number } {
  let credited = 0;
  let interest = 0;
  const due = s.deposits.filter((d) => d.openedTick + d.termMonths <= s.tick);
  if (due.length === 0) return { credited, interest };
  for (const d of due) {
    const termInterest = roundCash((d.principal * d.annualRate * d.termMonths) / 12);
    const payout = roundCash(d.principal + termInterest);
    s.cash = roundCash(s.cash + payout);
    credited += payout;
    interest += termInterest;
    s.eventLog.push({
      tick: s.tick,
      uid: `${s.tick}:deposit_matured:${s.eventLog.length}`,
      eventId: 'deposit_matured',
      assetAmount: payout, // generic amount slot — the credited total (v9)
      assetUnits: d.termMonths, // generic count slot — the term in months (v9)
      netWorth: roundCash(netWorth(s)),
      generation: s.player.generation,
    });
  }
  s.deposits = s.deposits.filter((d) => d.openedTick + d.termMonths > s.tick);
  return { credited, interest };
}
