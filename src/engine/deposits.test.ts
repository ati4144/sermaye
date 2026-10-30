import { describe, expect, it } from 'vitest';
import { applyAction, replay } from './actions';
import { healDeposits, migrateState } from './create';
import { performInheritance } from './life';
import { accruedDepositInterest, balance, depositPayoutFor, depositRateFor, netWorth, round4, salaryFor } from './index';
import { makeGame, runMonths } from './test-utils';
import type { DepositState, GameState } from './types';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** Hand-strip the deposit layer and re-age the envelope — a real v8 save. */
function v8Game(seed: number): GameState {
  const s = makeGame(seed);
  delete (s as Partial<GameState>).deposits;
  s.schemaVersion = 8;
  return s;
}

describe('deposits layer: schema & migration', () => {
  it('new games carry an empty ledger as the LAST state key', () => {
    const s = makeGame(12345);
    expect(s.deposits).toEqual([]);
    const keys = Object.keys(s);
    expect(keys[keys.length - 1]).toBe('deposits');
  });

  it('migrate v8 → v9 stamps an inert deposits: [], key landing last', () => {
    const v8 = v8Game(12345);
    const m = migrateState(v8);
    expect(m.schemaVersion).toBe(9);
    expect(JSON.stringify(m)).toBe(JSON.stringify({ ...v8, schemaVersion: 9, deposits: [] }));
  });

  it('the layer never self-activates on a legacy run', () => {
    const { final } = runMonths(v8Game(12345), 24);
    expect(final.deposits).toEqual([]);
  });

  it('replay is bit-for-bit across a mid-run OPEN_DEPOSIT', () => {
    const initial = makeGame(7);
    let s = initial;
    const actions: Parameters<typeof replay>[1] = [];
    const open = { type: 'OPEN_DEPOSIT', amount: 5_000, termMonths: 3 } as const;
    s = applyAction(s, open);
    actions.push(open);
    const r = runMonths(s, 6);
    actions.push(...r.actions);
    const replayed = replay(initial, actions);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(r.final));
  });
});

describe('deposits layer: rate locking', () => {
  it('locks annualCpiRate + term spread at open (us catalog)', () => {
    const s = makeGame(12345); // us: catalog .025
    expect(depositRateFor(s, 12)).toBe(0.06);
    expect(depositRateFor(s, 6)).toBe(0.05);
    expect(depositRateFor(s, 3)).toBe(0.04);
  });

  it('tr prices near the 40% catalog rate — the nominal lure, real ~spread', () => {
    const s = makeGame(12345);
    s.residency = { countryId: 'tr', cpi: 100, sinceTick: 0 };
    expect(depositRateFor(s, 12)).toBeCloseTo(0.435, 6);
    expect(depositRateFor(s, 3)).toBeCloseTo(0.415, 6);
  });

  it('a scenario-arc open prices at the override (1973 stagflation us)', () => {
    const s = makeGame(12345);
    s.residency = { countryId: 'us', cpi: 100, sinceTick: 0 };
    // beatCursor 0 < beats.length → the .065 arc override, NOT the catalog
    s.world = { ...s.world!, scenarioId: 'stagflation_1973', beatCursor: 0 };
    expect(depositRateFor(s, 12)).toBeCloseTo(0.1, 6);
  });

  it('residency null → the bare spread (the inert default of every inflation seam)', () => {
    const s = makeGame(12345);
    s.residency = null;
    expect(depositRateFor(s, 12)).toBe(0.035);
    expect(depositRateFor(s, 6)).toBe(0.025);
  });

  it('the regime tilt rides the catalog path', () => {
    const s = makeGame(12345); // us .025, crisis tilt ×1.25
    s.world = { ...s.world!, regime: 'crisis' };
    expect(depositRateFor(s, 12)).toBe(round4(0.025 * 1.25 + 0.035)); // the seam rounds once, so do we
  });

  it('the OPEN handler locks the rate into state — later CPI drift never reprices it', () => {
    let s = makeGame(12345); // us
    s = applyAction(s, { type: 'OPEN_DEPOSIT', amount: 10_000, termMonths: 12 });
    expect(s.deposits[0].annualRate).toBe(0.06);
    const r = runMonths(s, 24);
    const opened = r.states.find((st) => st.deposits.length > 0)?.deposits[0];
    expect(opened?.annualRate).toBe(0.06);
  });
});

describe('deposits layer: derived interest', () => {
  const d: DepositState = { uid: '0:0', principal: 12_000, annualRate: 0.12, openedTick: 0, termMonths: 12 };

  it('accrues monthly, capping at the term (120/mo on this contract)', () => {
    expect(accruedDepositInterest(d, 0)).toBe(0);
    expect(accruedDepositInterest(d, 1)).toBe(120);
    expect(accruedDepositInterest(d, 6)).toBe(720);
    expect(accruedDepositInterest(d, 12)).toBe(1_440);
    expect(accruedDepositInterest(d, 99)).toBe(1_440); // capped — no ghost interest
  });

  it('a pre-open tick accrues nothing (elapsed clamps at 0)', () => {
    expect(accruedDepositInterest(d, -1)).toBe(0);
  });

  it('depositPayoutFor === principal + accrued at dueTick (the twin formulas agree)', () => {
    expect(depositPayoutFor(d)).toBe(13_440);
    expect(depositPayoutFor(d)).toBe(d.principal + accruedDepositInterest(d, 12));
  });
});

describe('deposits layer: zero-draw & worth-neutrality contracts', () => {
  it('opening 50k leaves net worth UNCHANGED at the instant of the open', () => {
    const inert = makeGame(12345);
    const active = applyAction(inert, { type: 'OPEN_DEPOSIT', amount: 50_000, termMonths: 12 });
    expect(netWorth(active)).toBe(netWorth(inert)); // principal moved cash → receivable
    expect(active.cash).toBe(inert.cash - 50_000);
  });

  it('single-tick twin: identical rng streams with a deposit open', () => {
    const s = makeGame(12345);
    s.fate = null;
    const inert = clone(s);
    const active = applyAction(s, { type: 'OPEN_DEPOSIT', amount: 50_000, termMonths: 12 });
    const a = runMonths(active, 1).final;
    const b = runMonths(inert, 1).final;
    expect(JSON.stringify(a.rng)).toBe(JSON.stringify(b.rng));
  });

  it('120-month twin: the deposit layer never touches the rng stream', () => {
    const s = makeGame(12345);
    s.fate = null;
    const inert = clone(s);
    const active = applyAction(s, { type: 'OPEN_DEPOSIT', amount: 50_000, termMonths: 12 });
    const a = runMonths(active, 120).final;
    const b = runMonths(inert, 120).final;
    // worth-gated draws are shared (no condition reads cash — only the house
    // index), so even the accrued-interest worth divergence draws identically
    expect(JSON.stringify(a.rng)).toBe(JSON.stringify(b.rng));
  });

  it('netWorth counts principal + accrued while the deposit lives', () => {
    let s = makeGame(12345);
    s = applyAction(s, { type: 'OPEN_DEPOSIT', amount: 50_000, termMonths: 12 });
    const r = runMonths(s, 6);
    const withDep = r.final;
    const without = clone(withDep);
    without.deposits = [];
    const expected = withDep.deposits.reduce(
      (acc, dp) => acc + dp.principal + accruedDepositInterest(dp, withDep.tick),
      0,
    );
    expect(netWorth(withDep)).toBeCloseTo(netWorth(without) + expected, 2);
  });
});

describe('deposits layer: OPEN/BREAK guards', () => {
  it('rejects unknown terms, bad amounts, sub-minimum opens', () => {
    const s = makeGame(10);
    expect(() => applyAction(s, { type: 'OPEN_DEPOSIT', amount: 1_000, termMonths: 5 })).toThrow('INVALID_TERM');
    expect(() => applyAction(s, { type: 'OPEN_DEPOSIT', amount: 0, termMonths: 12 })).toThrow('INVALID_AMOUNT');
    expect(() => applyAction(s, { type: 'OPEN_DEPOSIT', amount: NaN, termMonths: 12 })).toThrow('INVALID_AMOUNT');
    expect(() => applyAction(s, { type: 'OPEN_DEPOSIT', amount: 100, termMonths: 12 })).toThrow('TOO_SMALL');
  });

  it('caps simultaneous deposits at MAX_OPEN', () => {
    let s = makeGame(10);
    for (let i = 0; i < balance.DEPOSITS.MAX_OPEN; i++) {
      s = applyAction(s, { type: 'OPEN_DEPOSIT', amount: balance.DEPOSITS.MIN_AMOUNT, termMonths: 3 });
    }
    expect(() => applyAction(s, { type: 'OPEN_DEPOSIT', amount: balance.DEPOSITS.MIN_AMOUNT, termMonths: 3 })).toThrow(
      'DEPOSIT_LIMIT',
    );
  });

  it('rejects overspending, unknown uids, and dead players', () => {
    const s = makeGame(10);
    expect(() => applyAction(s, { type: 'OPEN_DEPOSIT', amount: 1_000_000, termMonths: 12 })).toThrow(
      'INSUFFICIENT_CASH',
    );
    expect(() => applyAction(s, { type: 'BREAK_DEPOSIT', uid: 'nope' })).toThrow('DEPOSIT_NOT_FOUND');
    const dead = clone(s);
    dead.status = 'GAME_OVER_BANKRUPT';
    expect(() => applyAction(dead, { type: 'OPEN_DEPOSIT', amount: 1_000, termMonths: 12 })).toThrow('GAME_OVER');
  });
});

describe('deposits layer: phase 4c maturity', () => {
  it('credits principal + interest at dueTick, drains the ledger, logs it', () => {
    let s = applyAction(makeGame(12345), { type: 'OPEN_DEPOSIT', amount: 10_000, termMonths: 3 });
    const r = runMonths(s, 3);
    // 3-month term locks the .04 rate (catalog .025 + spread .015):
    // 10_000 × .04 × 3/12 = 100 interest; payout 10_100
    expect(r.final.deposits).toEqual([]);
    const matured = r.final.eventLog.filter((e) => e.eventId === 'deposit_matured');
    expect(matured.length).toBe(1);
    expect(matured[0].assetAmount).toBe(10_100);
    expect(matured[0].assetUnits).toBe(3);
    const last = r.final.expenses!.flow[r.final.expenses!.flow.length - 1];
    expect(last.interest).toBe(100); // the conditional flow key on the maturity month
    // net = salary + interest + rent − upkeep − living; no assets → rent/upkeep 0,
    // living = items + wealthLevy up to double-rounding (precision 1)
    expect(last.net).toBeCloseTo(salaryFor(r.final) + 100 - (last.items + last.wealthLevy), 1);
  });

  it('months without a maturity carry NO interest key (byte-shape parity)', () => {
    let s = applyAction(makeGame(12345), { type: 'OPEN_DEPOSIT', amount: 10_000, termMonths: 12 });
    const r = runMonths(s, 1);
    expect(r.final.expenses!.flow[r.final.expenses!.flow.length - 1].interest).toBeUndefined();
  });

  it('a maturing deposit rescues the month before the deficit check (escrow rule)', () => {
    let s = applyAction(makeGame(12345), { type: 'OPEN_DEPOSIT', amount: 50_000, termMonths: 3 });
    const r1 = runMonths(s, 2);
    const craft = clone(r1.final);
    craft.cash = 1; // living would force a fire sale — the deposit matures first
    const r2 = runMonths(craft, 1);
    expect(r2.final.cash).toBeGreaterThan(0); // 1 + ~50.5k payout − living stays positive
    expect(r2.final.eventLog.some((e) => e.eventId === 'forced_sale')).toBe(false);
  });

  it('BREAK returns the principal, ALL accrued interest forfeits', () => {
    let s = applyAction(makeGame(12345), { type: 'OPEN_DEPOSIT', amount: 10_000, termMonths: 12 });
    const r = runMonths(s, 6);
    const uid = r.final.deposits[0].uid;
    const before = r.final.cash;
    const after = applyAction(r.final, { type: 'BREAK_DEPOSIT', uid });
    expect(after.cash).toBeCloseTo(before + 10_000, 2); // principal only — no 300
    expect(after.deposits).toEqual([]);
    expect(after.eventLog.some((e) => e.eventId === 'deposit_broken')).toBe(true);
  });
});

describe('deposits layer: healDeposits (store boundary)', () => {
  it('returns the SAME reference on a healthy layer', () => {
    const s = makeGame(33);
    expect(healDeposits(s)).toBe(s);
    const withDep = applyAction(s, { type: 'OPEN_DEPOSIT', amount: 1_000, termMonths: 6 });
    expect(healDeposits(withDep)).toBe(withDep);
  });

  it('a non-array ledger degrades to []', () => {
    const s = makeGame(33);
    (s as unknown as { deposits: unknown }).deposits = undefined;
    expect(healDeposits(s).deposits).toEqual([]);
  });

  it('drops malformed rows (NaN principal, unknown term, future openedTick)', () => {
    const s = makeGame(33);
    const good = applyAction(s, { type: 'OPEN_DEPOSIT', amount: 1_000, termMonths: 6 });
    good.deposits.push(
      { uid: 'x1', principal: NaN, annualRate: 0.05, openedTick: 0, termMonths: 6 },
      { uid: 'x2', principal: 500, annualRate: 0.05, openedTick: 0, termMonths: 7 },
      { uid: 'x3', principal: 500, annualRate: 0.05, openedTick: 99, termMonths: 6 },
    );
    const healed = healDeposits(good);
    expect(healed.deposits.length).toBe(1);
    expect(healed.deposits[0].uid).not.toMatch(/^x/);
  });

  it('caps an over-full ledger at MAX_OPEN, keeping the oldest', () => {
    const s = makeGame(33);
    for (let i = 0; i < balance.DEPOSITS.MAX_OPEN + 2; i++) {
      s.deposits.push({ uid: `${i}`, principal: 500, annualRate: 0.05, openedTick: 0, termMonths: 12 });
    }
    const healed = healDeposits(s);
    expect(healed.deposits.length).toBe(balance.DEPOSITS.MAX_OPEN);
    expect(healed.deposits[0].uid).toBe('0'); // oldest survive
  });
});

describe('deposits layer: dynasty', () => {
  it('inheritance preserves open deposits byte-for-byte — the heir collects', () => {
    let s = applyAction(makeGame(41), { type: 'OPEN_DEPOSIT', amount: 10_000, termMonths: 12 });
    s.player.children = [{ id: 'c1', birthTick: -240, alive: true }];
    const before = JSON.stringify(s.deposits);
    performInheritance(s);
    expect(JSON.stringify(s.deposits)).toBe(before); // the handover never touches it
    const r = runMonths(s, 12);
    expect(r.final.eventLog.some((e) => e.eventId === 'deposit_matured' && e.generation === 2)).toBe(true);
  });
});
