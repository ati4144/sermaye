import { describe, expect, it } from 'vitest';
import { applyAction, replay } from './actions';
import { balance } from './balance';
import { createNewGame, healIncome, migrateState } from './create';
import { performInheritance } from './life';
import { salaryFor } from './market';
import { CURRENT_ERA_ANCHOR, gameYearMonth } from './worldpack';
import { makeGame, runMonths } from './test-utils';
import type { EngineAction, GameState } from './types';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** hand-strip a fresh game to the v6 shape (no income or residency field ever existed) */
function v6Game(seed: number): GameState {
  const v6 = clone(makeGame(seed)) as GameState;
  delete (v6 as Partial<GameState>).income;
  delete (v6 as Partial<GameState>).residency;
  delete (v6 as Partial<GameState>).deposits;
  v6.schemaVersion = 6;
  return v6;
}

describe('income layer: schema & migration', () => {
  it('migrateState stamps v6 saves inert: income and residency null, replay bit-for-bit, never self-activates', () => {
    const v6 = v6Game(9);
    const m = migrateState(v6);
    expect(m.schemaVersion).toBe(9);
    expect(m.income).toBeNull();
    expect(m.residency).toBeNull(); // v7→v8 step: cpi 1 until INIT_RESIDENCY
    expect(m.deposits).toEqual([]); // v8→v9 step: empty ledger until OPEN_DEPOSIT
    const v6Plus = { ...clone(v6), schemaVersion: 9, income: null, residency: null, deposits: [] }; // key order = migrateState's
    expect(JSON.stringify(m)).toBe(JSON.stringify(v6Plus));

    const { final, actions } = runMonths(v6, 24);
    expect(JSON.stringify(replay(v6, actions))).toBe(JSON.stringify(final));
    expect(final.income).toBeNull(); // the layer never self-activates
  });

  it('new games start employed at the opening-question salary (default 1,500)', () => {
    const s = makeGame(1);
    expect(s.income).toEqual({ salaryM: balance.INCOME.SALARY_DEFAULT, employed: true, lastReviewTick: 0 });
    expect(salaryFor(s)).toBe(balance.INCOME.SALARY_DEFAULT);
  });

  it('createNewGame takes the salary option, invalid values fall back to the default', () => {
    const good = createNewGame({ seed: 3, name: 'T', salaryM: 2_500.555 });
    expect(good.income!.salaryM).toBe(2_500.55); // roundCash: 2500.555×100 = 250055.49… → down
    for (const bad of [0, -5, NaN, Infinity, 1_000_000]) {
      const s = createNewGame({ seed: 3, name: 'T', salaryM: bad });
      expect(s.income!.salaryM).toBe(balance.INCOME.SALARY_DEFAULT);
    }
  });

  it('INIT_INCOME activates the layer (with or without an amount) and logs the event', () => {
    const v6 = v6Game(11);
    const s = applyAction(v6, { type: 'INIT_INCOME' });
    expect(s.income).toEqual({ salaryM: balance.INCOME.SALARY_DEFAULT, employed: true, lastReviewTick: 0 });
    const withAmt = applyAction(v6Game(12), { type: 'INIT_INCOME', salaryM: 3_200 });
    expect(withAmt.income!.salaryM).toBe(3_200);
    const entry = s.eventLog[s.eventLog.length - 1];
    expect(entry.eventId).toBe('income_init');
    expect(entry.uid).toBe(`${s.tick}:income_init`);
    expect(entry.assetAmount).toBe(balance.INCOME.SALARY_DEFAULT);
    expect(() => applyAction(s, { type: 'INIT_INCOME' })).toThrow('INCOME_ACTIVE');
  });
});

describe('income layer: zero-draw contract', () => {
  it('INIT_INCOME and SET_SALARY leave the rng stream untouched', () => {
    let legacy = v6Game(7);
    const legacyBefore = JSON.stringify(legacy.rng);
    legacy = applyAction(legacy, { type: 'INIT_INCOME', salaryM: 2_000 });
    expect(JSON.stringify(legacy.rng)).toBe(legacyBefore);

    let s = makeGame(7);
    const before = JSON.stringify(s.rng);
    s = applyAction(s, { type: 'SET_SALARY', salaryM: 2_100 });
    expect(JSON.stringify(s.rng)).toBe(before);
  });

  it('the employment transitions add no draws: same tick, active vs null layer, rng identical', () => {
    const active = makeGame(51);
    active.player.health = 30; // below JOB_LOSS_HEALTH
    const inert = clone(active);
    inert.income = null;
    const a = applyAction(active, { type: 'NEXT_MONTH' });
    const b = applyAction(inert, { type: 'NEXT_MONTH' });
    expect(JSON.stringify(a.rng)).toBe(JSON.stringify(b.rng));
  });
});

describe('income layer: salary credit & flow record', () => {
  it('credits the salary before the living cost — a cashless month stays off the ladder', () => {
    const active = makeGame(21);
    active.cash = 0;
    const inert = clone(active);
    inert.income = null;

    const a = applyAction(active, { type: 'NEXT_MONTH' });
    expect(a.cash).toBeGreaterThan(0); // 1,500 in − ~300 living: no deficit
    expect(a.eventLog.some((e) => e.eventId === 'asset_forced_sale')).toBe(false);

    const b = applyAction(inert, { type: 'NEXT_MONTH' });
    expect(b.cash).toBeLessThan(0); // the same month without the salary goes under
  });

  it('flow rows carry the conditional salary key and the net includes it', () => {
    const s = applyAction(makeGame(22), { type: 'NEXT_MONTH' });
    const f = s.expenses!.flow[s.expenses!.flow.length - 1];
    expect(f.salary).toBe(balance.INCOME.SALARY_DEFAULT);
    const living = f.items + f.wealthLevy;
    expect(f.net).toBeCloseTo(f.salary! + f.rent - f.upkeep - living, 1);
    // pre-v7 rows keep the byte-identical shape: no salary key at 0
    const b = applyAction(v6Game(22), { type: 'NEXT_MONTH' });
    expect('salary' in b.expenses!.flow[b.expenses!.flow.length - 1]).toBe(false);
  });

  it('active vs inert over 120 months: identical worlds, strictly richer with the salary', () => {
    const base = makeGame(12345);
    const inert = clone(base);
    inert.income = null;
    const a = runMonths(clone(base), 120).final;
    const b = runMonths(inert, 120).final;
    // no salary-side draw exists: the streams stay identical
    expect(JSON.stringify(a.rng)).toBe(JSON.stringify(b.rng));
    expect(a.countries).toEqual(b.countries);
    expect(a.holdings).toEqual(b.holdings);
    expect(a.properties).toEqual(b.properties);
    expect(a.cash).toBeGreaterThan(b.cash);
  });

  it('one-tick cash delta = salary − its levy share (salary lands before worthBefore)', () => {
    const base = makeGame(12345);
    const inert = clone(base);
    inert.income = null;
    const a = applyAction(clone(base), { type: 'NEXT_MONTH' });
    const b = applyAction(inert, { type: 'NEXT_MONTH' });
    const fateMult = a.fate?.mods.livingCost ?? 1;
    // the levy consciously sees this month's salary: Δ = salary × (1 − NETWORTH_RATE × fateMult)
    expect(a.cash - b.cash).toBeCloseTo(
      balance.INCOME.SALARY_DEFAULT * (1 - balance.LIVING.NETWORTH_RATE * fateMult),
      1,
    );
  });
});

describe('income layer: SET_SALARY', () => {
  it('updates the salary, stamps the review cursor and logs the event', () => {
    let s = runMonths(makeGame(31), 5).final;
    s = applyAction(s, { type: 'SET_SALARY', salaryM: 2_750.444 });
    expect(s.income!.salaryM).toBe(2_750.44);
    expect(s.income!.lastReviewTick).toBe(s.tick); // the yearly clock restarts here
    const entry = s.eventLog[s.eventLog.length - 1];
    expect(entry.eventId).toBe('salary_set');
    expect(entry.assetAmount).toBe(2_750.44);
  });

  it('guards: inactive layer, non-positive and non-finite amounts; over-cap clamps', () => {
    const v6 = v6Game(5);
    expect(() => applyAction(v6, { type: 'SET_SALARY', salaryM: 100 })).toThrow('INCOME_INACTIVE');

    const s = makeGame(5);
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(() => applyAction(s, { type: 'SET_SALARY', salaryM: bad })).toThrow('INVALID_SALARY');
    }
    const capped = applyAction(s, { type: 'SET_SALARY', salaryM: 5_000_000 });
    expect(capped.income!.salaryM).toBe(balance.INCOME.SALARY_MAX); // clamp, expense-amount precedent
  });
});

describe('income layer: employment transitions (phase 3.5)', () => {
  it('health below JOB_LOSS_HEALTH costs the job — notice queued AND logged, salary 0', () => {
    let s = makeGame(41);
    s.player.health = 30;
    s = applyAction(s, { type: 'NEXT_MONTH' });
    expect(s.income!.employed).toBe(false);
    const pend = s.pendingEvents.find((e) => e.eventId === 'job_loss');
    expect(pend).toBeDefined();
    // the history entry lands with the notice (netWorth backfilled by phase 5)
    const log = s.eventLog.filter((e) => e.eventId === 'job_loss');
    expect(log.length).toBe(1);
    expect(log[0].tick).toBe(s.tick);
    expect(log[0].netWorth).toBeGreaterThan(0);
    expect(salaryFor(s)).toBe(0);
    expect(s.income!.lastReviewTick).toBe(0); // the motor never touches the UI cursor
    // no salary key on the unemployment month's flow row
    const f = s.expenses!.flow[s.expenses!.flow.length - 1];
    expect('salary' in f).toBe(false);
    // the ACK clears the queue and never duplicates the entry
    s = applyAction(s, { type: 'ACK_EVENT', uid: pend!.uid });
    expect(s.eventLog.filter((e) => e.eventId === 'job_loss').length).toBe(1);
    expect(s.pendingEvents.some((e) => e.uid === pend!.uid)).toBe(false);
  });

  it('recovery to JOB_RETURN_HEALTH brings the job back — and the salary with it', () => {
    let s = makeGame(42);
    s.income = { salaryM: 1_800, employed: false, lastReviewTick: 3 };
    s.player.health = 55;
    s = applyAction(s, { type: 'NEXT_MONTH' });
    expect(s.income!.employed).toBe(true);
    const pend = s.pendingEvents.find((e) => e.eventId === 'job_return');
    expect(pend).toBeDefined();
    expect(s.eventLog.filter((e) => e.eventId === 'job_return').length).toBe(1);
    expect(salaryFor(s)).toBe(1_800);
    expect(s.income!.lastReviewTick).toBe(3);
    expect(s.expenses!.flow[s.expenses!.flow.length - 1].salary).toBe(1_800);
    s = applyAction(s, { type: 'ACK_EVENT', uid: pend!.uid });
    expect(s.eventLog.filter((e) => e.eventId === 'job_return').length).toBe(1); // no duplicate
  });

  it('the hysteresis band never flaps: 35–50 leaves both states alone', () => {
    // employed at 40: no loss (40 is not below 35)
    let s = makeGame(43);
    s.player.health = 40;
    s = applyAction(s, { type: 'NEXT_MONTH' });
    expect(s.income!.employed).toBe(true);
    expect(s.eventLog.some((e) => e.eventId === 'job_loss')).toBe(false);

    // unemployed at 40: no return (40 is below 50) — and no salary either
    let u = makeGame(43);
    u.income = { salaryM: 1_500, employed: false, lastReviewTick: 0 };
    u.player.health = 40;
    u = applyAction(u, { type: 'NEXT_MONTH' });
    expect(u.income!.employed).toBe(false);
    expect(u.eventLog.some((e) => e.eventId === 'job_return')).toBe(false);
    expect(salaryFor(u)).toBe(0);
  });

  it('inheritment resets employment — the heir is a new person with a new job', () => {
    const s = makeGame(44);
    s.player.children = [{ id: 'c-200', birthTick: -200, alive: true }];
    s.income = { salaryM: 2_000, employed: false, lastReviewTick: 7 };
    performInheritance(s);
    expect(s.player.generation).toBe(2);
    expect(s.income).toEqual({ salaryM: 2_000, employed: true, lastReviewTick: 7 });
  });
});

describe('v7 calendar: gameYearMonth (pure derivation, zero state writes)', () => {
  it('tick 0 IS the anchor month for every scenario', () => {
    const anchors: [string, number, number][] = [
      ['stagflation_1973', 1973, 10], // the embargo month
      ['gfc_2008', 2008, 9], // Lehman month
      ['japan_1990', 1989, 12], // the Nikkei peak — the 1990 the arc names comes later
    ];
    for (const [id, y, m] of anchors) {
      const s = makeGame(1);
      s.world = { ...(s.world!), scenarioId: id };
      expect(gameYearMonth(s, 0)).toEqual({ year: y, month: m });
    }
  });

  it('current-era runs (and world-null legacy runs) hang from Ekim 2026', () => {
    expect(CURRENT_ERA_ANCHOR).toEqual({ year: 2026, month: 10 });
    const s = makeGame(2);
    expect(gameYearMonth(s, 0)).toEqual({ year: 2026, month: 10 });
    s.world = null;
    expect(gameYearMonth(s, 0)).toEqual({ year: 2026, month: 10 });
  });

  it('Dec→Jan rolls the year; the month cycles 1..12', () => {
    const s = makeGame(3); // anchor Oct 2026
    expect(gameYearMonth(s, 2)).toEqual({ year: 2026, month: 12 });
    expect(gameYearMonth(s, 3)).toEqual({ year: 2027, month: 1 }); // the roll
    expect(gameYearMonth(s, 15)).toEqual({ year: 2028, month: 1 }); // a full year later
    // japan's anchor is December — the very next tick rolls
    const jp = makeGame(3);
    jp.world = { ...(jp.world!), scenarioId: 'japan_1990' };
    expect(gameYearMonth(jp, 0)).toEqual({ year: 1989, month: 12 });
    expect(gameYearMonth(jp, 1)).toEqual({ year: 1990, month: 1 }); // the crisis year begins
  });

  it('defaults to the run tick and never touches state', () => {
    const s = runMonths(makeGame(4), 30).final;
    const before = JSON.stringify(s);
    expect(gameYearMonth(s)).toEqual(gameYearMonth(s, s.tick)); // default = current tick
    expect(gameYearMonth(s, 0)).toEqual({ year: 2026, month: 10 }); // 30 months from Oct 2026 → Apr 2029
    expect(gameYearMonth(s)).toEqual({ year: 2029, month: 4 });
    expect(JSON.stringify(s)).toBe(before); // pure derivation
  });
});

describe('income layer: replay', () => {  it('mixed income actions replay bit-for-bit', () => {
    const initial = v6Game(9002);
    let s = initial;
    const actions: EngineAction[] = [];
    const step = (a: EngineAction) => {
      s = applyAction(s, a);
      actions.push(a);
    };
    step({ type: 'INIT_INCOME', salaryM: 2_200 });
    step({ type: 'FAST_FORWARD', months: 14 }); // crosses the yearly-review horizon
    while (s.pendingEvents.length > 0 && s.status === 'PLAYING') {
      const head = s.pendingEvents[0];
      step(
        head.hasChoice
          ? { type: 'RESOLVE_EVENT', uid: head.uid, optionIndex: 0 }
          : { type: 'ACK_EVENT', uid: head.uid },
      );
    }
    step({ type: 'SET_SALARY', salaryM: 3_000 });
    step({ type: 'NEXT_MONTH' });

    const replayed = replay(initial, actions);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(s));
    expect(replayed.income!.salaryM).toBe(3_000);
  });
});

describe('income layer: healIncome (store boundary)', () => {
  it('returns the same reference for a healthy layer (cheap hydration)', () => {
    const run = runMonths(makeGame(104), 5).final;
    expect(healIncome(run)).toBe(run);
  });

  it('degrades a malformed salary to SALARY_DEFAULT, repairs the flag, clamps the cursor', () => {
    const run = runMonths(makeGame(103), 3).final; // tick 3
    const broken = clone(run);
    broken.income = { salaryM: NaN, employed: 'yes' as unknown as boolean, lastReviewTick: 99 };
    const healed = healIncome(broken);
    expect(healed.income).toEqual({ salaryM: balance.INCOME.SALARY_DEFAULT, employed: true, lastReviewTick: 3 });

    const nulled = clone(run);
    nulled.income = null;
    expect(healIncome(nulled)).toBe(nulled); // null layer: same reference, nothing to heal
  });
});
