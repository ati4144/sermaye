import { describe, expect, it } from 'vitest';
import { applyAction, replay } from './actions';
import { balance } from './balance';
import { healExpenses, migrateState } from './create';
import { makeGame, runMonths } from './test-utils';
import type { CashflowMonth, EngineAction, GameState, LifestyleTier } from './types';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** hand-strip a fresh game to the v4 shape (no expenses/home/residency fields ever existed) */
function v4Game(seed: number): GameState {
  const v4 = clone(makeGame(seed)) as GameState;
  delete (v4 as Partial<GameState>).expenses;
  delete (v4 as Partial<GameState>).home;
  delete (v4 as Partial<GameState>).pendingSales;
  delete (v4 as Partial<GameState>).income;
  delete (v4 as Partial<GameState>).residency;
  delete (v4 as Partial<GameState>).deposits;
  v4.schemaVersion = 4;
  return v4;
}

describe('expense layer: schema & migration', () => {
  it('migrateState stamps v4 saves inert: expenses, home, income and residency null, replay bit-for-bit', () => {
    const v4 = v4Game(9);
    const m = migrateState(v4);
    expect(m.schemaVersion).toBe(9);
    expect(m.expenses).toBeNull();
    expect(m.home).toBeNull();
    expect(m.income).toBeNull();
    expect(m.residency).toBeNull(); // v7→v8 step: cpi 1 until INIT_RESIDENCY
    expect(m.deposits).toEqual([]); // v8→v9 step: empty ledger until OPEN_DEPOSIT
    const v4Plus = { ...clone(v4), schemaVersion: 9, expenses: null, pendingSales: [], home: null, income: null, residency: null, deposits: [] }; // key order = migrateState's
    expect(JSON.stringify(m)).toBe(JSON.stringify(v4Plus));

    const { final, actions } = runMonths(v4, 24);
    expect(JSON.stringify(replay(v4, actions))).toBe(JSON.stringify(final));
    expect(final.expenses).toBeNull(); // the layer never self-activates
    expect(final.home).toBeNull(); // the Yuva layer never self-activates either
    expect(final.income).toBeNull(); // the income layer never self-activates either
    expect(final.residency).toBeNull(); // the residency layer never self-activates either
  });

  it('new games start with the expense layer active at the standard tier', () => {
    const s = makeGame(1);
    expect(s.expenses).not.toBeNull();
    expect(s.expenses!.lifestyle).toBe('standard');
    expect(s.expenses!.items.every((it) => it.kind === 'PRESET')).toBe(true);
    const sum = s.expenses!.items.reduce((a, it) => a + it.amount, 0);
    expect(sum).toBe(balance.LIVING.BASE); // parity by construction
    expect(s.expenses!.flow).toEqual([]);
  });

  it('INIT_EXPENSES activates the layer at standard and logs the event', () => {
    const v4 = v4Game(11);
    const s = applyAction(v4, { type: 'INIT_EXPENSES' });
    expect(s.expenses!.lifestyle).toBe('standard');
    expect(s.expenses!.items.reduce((a, it) => a + it.amount, 0)).toBe(balance.LIVING.BASE);
    const entry = s.eventLog[s.eventLog.length - 1];
    expect(entry.eventId).toBe('expenses_init');
    expect(entry.uid).toBe(`${s.tick}:expenses_init`);
    expect(() => applyAction(s, { type: 'INIT_EXPENSES' })).toThrow('EXPENSES_ACTIVE');
  });
});

describe('expense layer: cash parity', () => {
  it('standard tier is cash-identical to the flat formula (bit-for-bit, 120 months)', () => {
    // same seed, same fate (so the same livingCost multiplier): the itemized
    // run must match the flat run in EVERY field except `expenses` itself —
    // Σ standard items === LIVING.BASE makes the phase-4b expression equal.
    const base = makeGame(12345);
    const flat = clone(base);
    flat.expenses = null;
    const a = runMonths(flat, 120).final;
    const b = runMonths(clone(base), 120).final;
    expect(a.cash).toBe(b.cash);
    expect(a.netWorthHistory).toEqual(b.netWorthHistory);
    const { expenses: _a, ...aCore } = a;
    const { expenses: _b, ...bCore } = b;
    expect(JSON.stringify(aCore)).toBe(JSON.stringify(bCore));
    expect(b.expenses!.flow.length).toBeGreaterThan(0); // the only addition
  });
});

describe('expense layer: zero-draw contract', () => {
  it('all five expense actions leave the rng stream untouched', () => {
    // INIT path needs an inert layer
    let legacy = v4Game(7);
    const legacyBefore = legacy.rng.s;
    legacy = applyAction(legacy, { type: 'INIT_EXPENSES' });
    expect(legacy.rng.s).toBe(legacyBefore);

    let s = makeGame(7);
    const draws = (st: GameState, action: EngineAction): GameState => {
      const before = st.rng.s;
      const after = applyAction(st, action);
      expect(after.rng.s).toBe(before);
      return after;
    };
    s = draws(s, { type: 'SET_LIFESTYLE', tier: 'comfort' });
    s = draws(s, { type: 'ADD_EXPENSE', label: 'Kıraathane', amount: 250 });
    const id = s.expenses!.items[s.expenses!.items.length - 1].id;
    s = draws(s, { type: 'UPDATE_EXPENSE', id, amount: 300 });
    draws(s, { type: 'REMOVE_EXPENSE', id });
  });
});

describe('expense layer: actions', () => {
  it('SET_LIFESTYLE swaps presets wholesale, keeps customs, validates the tier', () => {
    let s = makeGame(3);
    s = applyAction(s, { type: 'SET_LIFESTYLE', tier: 'luxury' });
    expect(s.expenses!.lifestyle).toBe('luxury');
    expect(s.expenses!.items.map((it) => it.key)).toEqual(['rent', 'food', 'transport', 'social', 'staff']);

    s = applyAction(s, { type: 'ADD_EXPENSE', label: 'Yat bakımı', amount: 5000 });
    const customId = s.expenses!.items[s.expenses!.items.length - 1].id; // 'e9'

    s = applyAction(s, { type: 'SET_LIFESTYLE', tier: 'frugal' });
    expect(s.expenses!.lifestyle).toBe('frugal');
    expect(s.expenses!.items.slice(0, 3).map((it) => it.key)).toEqual(['rent', 'food', 'transport']);
    expect(s.expenses!.items[3]).toMatchObject({ id: customId, kind: 'CUSTOM', label: 'Yat bakımı', amount: 5000 });
    const ids = s.expenses!.items.map((it) => it.id);
    expect(new Set(ids).size).toBe(ids.length); // ids are never reused
    expect(s.expenses!.seq).toBe(12); // 3 + 5 + 1 + 3 mints

    const bad = { type: 'SET_LIFESTYLE', tier: 'deluxe' } as unknown as EngineAction;
    expect(() => applyAction(s, bad)).toThrow('INVALID_TIER');
  });

  it('ADD/UPDATE/REMOVE validate labels, amounts and ids', () => {
    let s = makeGame(4);
    expect(() => applyAction(s, { type: 'ADD_EXPENSE', label: '   ', amount: 100 })).toThrow('INVALID_LABEL');
    expect(() => applyAction(s, { type: 'ADD_EXPENSE', label: 'x'.repeat(41), amount: 100 })).toThrow('INVALID_LABEL');
    expect(() => applyAction(s, { type: 'ADD_EXPENSE', label: 'Okul', amount: 0 })).toThrow('INVALID_AMOUNT');
    expect(() => applyAction(s, { type: 'ADD_EXPENSE', label: 'Okul', amount: -5 })).toThrow('INVALID_AMOUNT');

    s = applyAction(s, { type: 'ADD_EXPENSE', label: '  Özel okul  ', amount: 1234.567 });
    expect(s.expenses!.items[s.expenses!.items.length - 1]).toMatchObject({
      kind: 'CUSTOM',
      label: 'Özel okul', // trimmed
      amount: 1234.57, // roundCash
    });

    // PRESET items are editable too (the user-facing point of the feature)
    const preset = s.expenses!.items.find((it) => it.kind === 'PRESET')!;
    s = applyAction(s, { type: 'UPDATE_EXPENSE', id: preset.id, amount: 222.222 });
    expect(s.expenses!.items.find((it) => it.id === preset.id)!.amount).toBe(222.22);
    expect(() => applyAction(s, { type: 'UPDATE_EXPENSE', id: 'e999', amount: 5 })).toThrow('EXPENSE_NOT_FOUND');
    expect(() => applyAction(s, { type: 'UPDATE_EXPENSE', id: preset.id, amount: NaN })).toThrow('INVALID_AMOUNT');

    s = applyAction(s, { type: 'REMOVE_EXPENSE', id: preset.id });
    expect(s.expenses!.items.some((it) => it.id === preset.id)).toBe(false);
    expect(() => applyAction(s, { type: 'REMOVE_EXPENSE', id: preset.id })).toThrow('EXPENSE_NOT_FOUND');

    // amounts clamp to AMOUNT_MAX rather than reject
    s = applyAction(s, { type: 'ADD_EXPENSE', label: 'Filo', amount: 5_000_000 });
    expect(s.expenses!.items[s.expenses!.items.length - 1].amount).toBe(balance.EXPENSES.AMOUNT_MAX);
  });

  it('expense mutations require an active layer', () => {
    const v4 = v4Game(5);
    expect(() => applyAction(v4, { type: 'SET_LIFESTYLE', tier: 'luxury' })).toThrow('EXPENSES_INACTIVE');
    expect(() => applyAction(v4, { type: 'ADD_EXPENSE', label: 'X', amount: 1 })).toThrow('EXPENSES_INACTIVE');
    expect(() => applyAction(v4, { type: 'UPDATE_EXPENSE', id: 'e1', amount: 1 })).toThrow('EXPENSES_INACTIVE');
    expect(() => applyAction(v4, { type: 'REMOVE_EXPENSE', id: 'e1' })).toThrow('EXPENSES_INACTIVE');
  });

  it('caps the monthly charge at LIVING.MAX however far the items sum runs', () => {
    // the engine's phase-4b expression: clamp(itemsSum + worth·rate, itemsSum,
    // MAX) — items beyond the cap are simply not spent (pinned here so the
    // ExpensesSheet footer and CashflowCard estimate keep a hard reference).
    // income + residency nulled: this pins the pure expense formula,
    // salary-free and CPI-free (the v8 indexed cap is pinned in
    // residency.test's living-parity block).
    let s = applyAction(makeGame(101), { type: 'ADD_EXPENSE', label: 'Filo', amount: 100_000 });
    s.income = null;
    s.residency = null;
    const itemsSum = s.expenses!.items.reduce((a, it) => a + it.amount, 0);
    expect(itemsSum).toBeGreaterThan(balance.LIVING.MAX);
    const after = applyAction(s, { type: 'NEXT_MONTH' });
    const flow = after.expenses!.flow[0];
    expect(flow.items).toBe(balance.LIVING.MAX); // the cap, not the sum
    expect(flow.wealthLevy).toBe(0);
    expect(s.cash - after.cash).toBe(balance.LIVING.MAX); // the real deduction
  });
});

describe('expense layer: healExpenses (store boundary)', () => {
  it('returns the same reference for a healthy layer (cheap hydration)', () => {
    const run = runMonths(makeGame(104), 5).final;
    expect(healExpenses(run)).toBe(run);
  });

  it('drops malformed items, pushes seq past the surviving ids, repairs the tier', () => {
    const run = runMonths(makeGame(103), 3).final;
    const e = run.expenses!;
    // forged dev-stage shape: healthy + broken customs, a bad tier, seq behind
    e.items = [
      ...e.items,
      { id: 'e99', kind: 'CUSTOM', label: 'Sağlıklı', amount: 50 },
      { id: 'e98', kind: 'CUSTOM', label: '', amount: 50 }, // empty label
      { id: 'e97', kind: 'CUSTOM', label: 'NaN', amount: NaN }, // NaN amount
      { id: 'zz', kind: 'CUSTOM', label: 'BadId', amount: 50 }, // id off-pattern
    ];
    e.lifestyle = 'deluxe' as LifestyleTier;
    e.seq = 1; // behind e99 — ids must never be reused

    const healed = healExpenses(run);
    expect(healed).not.toBe(run);
    expect(healed.expenses!.lifestyle).toBe('standard'); // degraded to default
    const ids = healed.expenses!.items.map((it) => it.id);
    expect(ids).toContain('e99'); // the healthy custom survives
    expect(ids).not.toContain('e98');
    expect(ids).not.toContain('e97');
    expect(ids).not.toContain('zz');
    expect(healed.expenses!.seq).toBe(99); // pushed past the highest live id
  });

  it('flow ring keeps only real rows: finite numbers and a tick this save has lived', () => {
    const run = runMonths(makeGame(106), 3).final;
    const e = run.expenses!;
    e.flow = [
      { tick: -1, rent: 0, upkeep: 0, items: 1, wealthLevy: 1, net: -2 }, // before month zero
      { tick: 99, rent: 'x', upkeep: 0, items: 1, wealthLevy: 1, net: -2 } as unknown as CashflowMonth, // future tick + string rent
      ...e.flow,
    ];
    const healed = healExpenses(run);
    expect(healed.expenses!.flow.length).toBe(3); // only the genuine months
    expect(healed.expenses!.flow.every((f) => f.tick >= 0 && f.tick <= run.tick)).toBe(true);
    expect(healed.expenses!.flow.every((f) => Number.isFinite(f.rent))).toBe(true);
  });
});

describe('expense layer: flow record', () => {
  it('records one breakdown per tick, reconciling items + levy with the net', () => {
    let s0 = makeGame(21);
    // a farm deed makes the income side non-zero (2 units ≈ 175 $/mo rent).
    // income nulled: this reconciles the expense formula specifically (the
    // salary variant lives in income.test.ts).
    s0 = applyAction(s0, { type: 'BUY_ASSET', assetId: 'farm', amount: 60_000 });
    s0.income = null;
    const { final } = runMonths(s0, 6);
    const flow = final.expenses!.flow;
    expect(flow.map((f) => f.tick)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(flow.some((f) => f.rent > 0)).toBe(true);
    for (const f of flow) {
      const living = f.items + f.wealthLevy;
      expect(f.net).toBeCloseTo(f.rent - f.upkeep - living, 1); // cent rounding only
    }
  });

  it('caps the flow ring at FLOW_CAP, keeping the latest months', () => {
    const { final } = runMonths(makeGame(31), 30);
    const flow = final.expenses!.flow;
    expect(flow.length).toBe(balance.EXPENSES.FLOW_CAP);
    expect(flow[0].tick).toBe(30 - balance.EXPENSES.FLOW_CAP + 1);
    expect(flow[flow.length - 1].tick).toBe(final.tick);
  });
});

describe('expense layer: replay', () => {
  it('mixed expense actions replay bit-for-bit', () => {
    const initial = makeGame(9002);
    let s = initial;
    const actions: EngineAction[] = [];
    const step = (a: EngineAction) => {
      s = applyAction(s, a);
      actions.push(a);
    };
    const drain = () => {
      while (s.pendingEvents.length > 0 && s.status === 'PLAYING') {
        const head = s.pendingEvents[0];
        step(
          head.hasChoice
            ? { type: 'RESOLVE_EVENT', uid: head.uid, optionIndex: 0 }
            : { type: 'ACK_EVENT', uid: head.uid },
        );
      }
    };

    step({ type: 'SET_LIFESTYLE', tier: 'comfort' });
    step({ type: 'ADD_EXPENSE', label: 'Bağış', amount: 750 });
    step({ type: 'BUY_ASSET', assetId: 'farm', amount: 60_000 });
    step({ type: 'FAST_FORWARD', months: 6 });
    drain();
    const custom = s.expenses!.items.find((it) => it.kind === 'CUSTOM')!;
    step({ type: 'UPDATE_EXPENSE', id: custom.id, amount: 900 });
    const preset = s.expenses!.items.find((it) => it.kind === 'PRESET')!;
    step({ type: 'REMOVE_EXPENSE', id: preset.id });
    step({ type: 'SET_LIFESTYLE', tier: 'luxury' });
    drain();
    step({ type: 'NEXT_MONTH' });

    const replayed = replay(initial, actions);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(s));
    expect(replayed.expenses!.lifestyle).toBe('luxury');
  });
});
