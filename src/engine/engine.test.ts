import { describe, expect, it } from 'vitest';
import { createRng, nextFloat, normal12, nextU32 } from './rng';
import { applyAction, replay } from './actions';
import { createNewGame } from './create';
import { ageYears, netWorth } from './index';
import { fnv1a, makeGame, runMonths } from './test-utils';
import type { GameState } from './types';

// v6 full-state goldens (see the Yuva-economy golden tests below). Pinned by
// running each fixture once and reading the hash — then they are fences.
const V6_GOLDEN = '1da84d4f'; // '11921228' villa from creation → 'adf87bdb' v7 income:null key → 'e22685cd' v8: version 8 + residency:null key (shape-only) → v9: version 9 + deposits:[] key (shape-only)
const V6_GOLDEN_FLOW = 'd252d31a'; // 'a8dae17f' villa → '2a6f1018' v7 income:null key → 'cd6e3fe4' v8: version 8 + residency:null key (shape-only) → v9: version 9 + deposits:[] key (shape-only)
// v7 full-state golden — the income layer ACTIVE from creation (default
// salary, renter path). Pinned by probe, same as every golden above.
const V7_GOLDEN = '2e81a393'; // 'e7705c77' → '15e97c19' v8: version 8 + residency:null key (shape-only) → v9: version 9 + deposits:[] key (shape-only)
// v8 full-state goldens — the residency layer ACTIVE from creation. Pinned
// by probe, same as every golden above.
const V8_GOLDEN = 'f8deb445'; // default country us, cpi 129.0107 after 120 months → '45bafa91' v9: version 9 + deposits:[] key (shape-only; the cash path is identical)
const V8_GOLDEN_TR = 'fc78708d'; // tr, v8.1 PPP: was 2ab8644 — the 0.4× basket moved the living/levy/threshold path → 'a96a0027' v9: version 9 + deposits:[] key (shape-only)
// v9 full-state golden — the deposit layer in action (two staggered terms).
const V9_GOLDEN = '12305545'; // OPEN 50k/12mo (rate .06) at t0 + 20k/6mo (rate .05) at t1 → both mature by t13; cash path identical to the inert twin plus the two payouts

describe('rng', () => {
  it('produces identical sequences for identical seeds', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 1000; i++) {
      expect(nextU32(a)).toBe(nextU32(b));
    }
  });

  it('nextFloat stays in [0, 1) and varies', () => {
    const r = createRng(7);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 10_000; i++) {
      const x = nextFloat(r);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
    expect(max - min).toBeGreaterThan(0.9);
  });

  it('normal12 is bounded and roughly centered', () => {
    const r = createRng(99);
    let sum = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const z = normal12(r);
      expect(Math.abs(z)).toBeLessThanOrEqual(6);
      sum += z;
    }
    const mean = sum / n;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    // variance ≈ 1
    const r2 = createRng(99);
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const z = normal12(r2);
      ss += z * z;
    }
    expect(ss / n).toBeGreaterThan(0.8);
    expect(ss / n).toBeLessThan(1.2);
  });
});

describe('engine determinism', () => {
  it('same seed + same actions → bit-identical state', () => {
    const a = runMonths(makeGame(777), 120).final;
    const b = runMonths(makeGame(777), 120).final;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds diverge', () => {
    const a = runMonths(makeGame(1), 120).final;
    const b = runMonths(makeGame(2), 120).final;
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('replaying the action log over the initial state reproduces the live state', () => {
    const { final, actions } = runMonths(makeGame(31337), 60);
    const initial = makeGame(31337);
    const replayed = replay(initial, actions);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(final));
  });

  it('golden fingerprint (legacy v2 economy): engine changes must consciously update this hash', () => {
    // legacy = the v2 economy: the v3 asset layer, the v4 world layer, the
    // v5 expense layer, the v6 Yuva/escrow layer AND the v7 income layer
    // stripped from a fresh game, exactly what migrateState produces for real
    // v2 saves (assets: null is inert — no draws, no income, no asset events;
    // world: null likewise — no regime float, identity multipliers; expenses:
    // null keeps the flat living-cost formula; home: null keeps relief 0, no
    // marriedTick stamp, no eve_cikma, no escrow; income: null keeps the
    // salary credit and employment transitions off; deposits: [] accrues
    // nothing). Live play normalizes on entry, so the final state carries
    // exactly eight additions vs v2: the inert keys "assets":null,
    // "properties":{}, "world":null, "expenses":null, "home":null,
    // "pendingSales":[], "income":null, "residency":null.
    // Stripping them before hashing must reproduce the v2 state bit-for-bit.
    // This hash must NEVER move: it is the (v2 initial, actionLog)
    // bit-parity contract.
    const legacy = makeGame(12345);
    legacy.assets = null;
    legacy.properties = {};
    legacy.world = null;
    legacy.expenses = null;
    legacy.home = null;
    legacy.income = null;
    legacy.residency = null;
    const { final } = runMonths(legacy, 120);
    // normalization adds exactly ten things to a v2 run: the version bump
    // and the nine inert keys. Normalize all ten back, then hash: the
    // result must be the v2 state bit-for-bit — same draws, same markets,
    // same logs, same cash to the cent.
    const { assets: _a, properties: _p, world: _w, expenses: _e, home: _h, pendingSales: _ps, income: _i, residency: _r, deposits: _d, ...v2Core } = final;
    v2Core.schemaVersion = 2;
    const hash = fnv1a(JSON.stringify(v2Core));
    // seed 12345, 120 months, policy: resolve choices with option 0
    // (RANDOM-mode fate; '7006171c' → schema v2 fate seed draw, 'f3561505' →
    // kader-review content fixes, '1b9d3a91' stable through the v3 asset,
    // v4 world, v5 expense, v6 Yuva/escrow AND v7 income layers)
    expect(hash).toBe('1b9d3a91');
  });

  it('golden fingerprint (v3 asset economy): consciously update on asset changes', () => {
    // v3 = the asset economy WITHOUT the world/expense/Yuva/income layers:
    // all hand-stripped to null/[] before the run (exactly what a real v3
    // save migrates to). The hash must keep matching the pre-v4 engine
    // bit-for-bit.
    const v3 = makeGame(12345);
    v3.world = null;
    v3.expenses = null;
    v3.home = null;
    v3.income = null;
    v3.residency = null;
    const { final } = runMonths(v3, 120);
    const { world: _w, expenses: _e, home: _h, pendingSales: _ps, income: _i, residency: _r, deposits: _d, ...v3Core } = final;
    v3Core.schemaVersion = 3; // migration bumps to 7 — normalize back for v3 parity
    const hash = fnv1a(JSON.stringify(v3Core));
    // same seed/months/policy with the asset layer active (gold/house/farm/car
    // markets evolve from day one). Balance changes to ASSETS/* or the asset
    // event catalog move this — update it consciously, never casually.
    // ('991e4659' → '5e13babd' v6 villa: NEW GAMES activate the villa market
    // from creation → +12 draws/month in phase 1b. Real v3 saves keep their
    // frozen activeIds — healAssets no longer force-syncs, ACTIVATE_ASSET is
    // the opt-in.)
    expect(hash).toBe('5e13babd');
  });

  it('golden fingerprint (v5-core world economy): consciously update on world/expense changes', () => {
    // v5-core = everything through the expense layer, with the v6 Yuva and
    // v7 income layers hand-stripped (home/income null pre-run — exactly
    // what a real v5 save migrates to; marriedTick never stamps, eve_cikma
    // never fires, the living-cost formula keeps the exact v5 expression,
    // no salary is ever credited). Strip the post-v5 keys post-run and
    // normalize the version back — the hash must keep matching the pre-v6
    // engine bit-for-bit.
    const v5 = makeGame(12345);
    v5.home = null;
    v5.income = null;
    v5.residency = null;
    const { final } = runMonths(v5, 120);
    const { home: _h, pendingSales: _ps, income: _i, residency: _r, deposits: _d, ...v5Core } = final;
    v5Core.schemaVersion = 5;
    const hash = fnv1a(JSON.stringify(v5Core));
    // same seed/months/policy with ALL pre-v6 layers active: asset markets
    // from day one, the world regime layer (one float per tick, regime-scaled
    // drift/vol, agenda-tilted event probabilities) and the v5 expense layer
    // (standard preset sums exactly to LIVING.BASE — the cash path matches
    // the flat formula; only the itemized state + flow ring are new).
    // REGIMES/WORLD_PACK/EXPENSES balance changes move this — update it
    // consciously. ('aca0ac7' hand-authored agenda → 'dd7a454e' researched
    // 2026-10 agenda → 'e9dd173c' v5 expenses state → 'adb1362' v6 villa
    // market active from creation; the cash path itself is unchanged —
    // standard preset sums to LIVING.BASE)
    expect(hash).toBe('adb1362');
  });

  it('golden fingerprint (v5-core gfc_2008 scenario): consciously update on scenario changes', () => {
    // v5-core parity for the scripted crisis arc — home/income hand-stripped
    // pre-run, post-v5 keys stripped post-run (see the v5-core world golden).
    const gfc = createNewGame({ seed: 12345, name: 'Test', scenarioId: 'gfc_2008' });
    gfc.home = null;
    gfc.income = null;
    gfc.residency = null;
    const { final } = runMonths(gfc, 120);
    const { home: _h, pendingSales: _ps, income: _i, residency: _r, deposits: _d, ...v5Core } = final;
    v5Core.schemaVersion = 5;
    const hash = fnv1a(JSON.stringify(v5Core));
    // the scripted crisis arc pins the scenario-only market path: crisis
    // regime from creation, opening beat at tick 0, scripted flips at ticks
    // 6/15, the GFC agenda tilt, organic transitions suspended until the last
    // beat. None of this is reachable from the scenario-less fixtures above —
    // scenario/WORLD_PACK/REGIMES/EXPENSES changes move this hash; update it
    // consciously, never casually. ('f80e224a' v4 → '1a34f2d8' v5 expenses →
    // '449da977' v6 villa market active from creation)
    expect(hash).toBe('449da977');
  });

  it('golden fingerprint (v5-core japan_1990 scenario): consciously update on scenario changes', () => {
    // v5-core parity for the lost-decade arc — home/income hand-stripped
    // pre-run, post-v5 keys stripped post-run (see the v5-core world golden).
    const jp = createNewGame({ seed: 12345, name: 'Test', scenarioId: 'japan_1990' });
    jp.home = null;
    jp.income = null;
    jp.residency = null;
    const { final } = runMonths(jp, 120);
    const { home: _h, pendingSales: _ps, income: _i, residency: _r, deposits: _d, ...v5Core } = final;
    v5Core.schemaVersion = 5;
    const hash = fnv1a(JSON.stringify(v5Core));
    // the boom→crisis→stagnation lost-decade arc (flips at ticks 8/27) pins a
    // regime path no other golden visits, including the post-arc return to
    // organic evolution. ('67452f03' v4 → '7a40a255' v5 expenses → '9aefb4a'
    // v6 villa market active from creation) Update consciously.
    expect(hash).toBe('9aefb4a');
  });

  it('golden fingerprint (v6 Yuva economy, renter path): consciously update on Yuva/escrow changes', () => {
    // income hand-stripped pre-run — exactly what a REAL v6 save migrates to
    // (income: null), so this stays the v6-parity fence, not a v7 run.
    const renter = makeGame(12345);
    renter.income = null;
    renter.residency = null;
    const { final } = runMonths(renter, 120);
    const hash = fnv1a(JSON.stringify(final));
    // the FULL v6 state — everything the v5-core goldens cover PLUS the
    // active Yuva layer from day one: home {role:'rental'} (relief still 0 —
    // a renter owns nothing) and the empty escrow ledger. This seed stays
    // single for all 120 months, so the hash pins the INERT Yuva path: same
    // draws, same cash, only the new state keys ('11921228' → 'adf87bdb' at
    // v7 is the migrated income:null key entering the JSON — shape-only, the
    // cash path is identical). HOME balance changes or any migration/shape
    // change to home/pendingSales/income moves this hash — update it
    // consciously, never casually.
    expect(final.income).toBeNull();
    expect(final.residency).toBeNull();
    expect(hash).toBe(V6_GOLDEN);
  });

  it('golden fingerprint (v6 Yuva economy, wedding-gold path): consciously update on Yuva/escrow changes', () => {
    // income hand-stripped pre-run (see the renter-path golden above).
    const wed = makeGame(1);
    wed.income = null;
    wed.residency = null;
    const { final } = runMonths(wed, 120);
    const hash = fnv1a(JSON.stringify(final));
    // same fixture shape, seed 1: a wedding resolves with option 0 →
    // marriedTick stamps → six months later eve_cikma fires → option 0
    // grants the beşibirlik (5 gold units land in holdings.gold). This is
    // the long-horizon fence for the whole v6 life-path: marriedTick
    // stamping, lifeFlags, the eve_cikma catalog def and grantAsset wiring
    // all feed this hash — update it consciously, never casually.
    // ('a8dae17f' → '2a6f1018' at v7: the migrated income:null key —
    // shape-only, the cash path is identical.)
    expect(final.eventLog.some((e) => e.eventId === 'eve_cikma')).toBe(true);
    expect(final.holdings.gold?.units ?? 0).toBeGreaterThanOrEqual(5);
    expect(hash).toBe(V6_GOLDEN_FLOW);
  });

  it('golden fingerprint (v7 income economy, salaried renter): consciously update on income changes', () => {
    // residency hand-stripped pre-run — exactly what a REAL v7 save migrates
    // to (residency: null), so this stays the v7-parity fence, not a v8 run.
    const renter = makeGame(12345);
    renter.residency = null;
    const { final } = runMonths(renter, 120);
    const hash = fnv1a(JSON.stringify(final));
    // the FULL v7 state — everything the v6 renter golden covers PLUS the
    // active income layer from day one: salary 1,500/mo credited in phase
    // 4a-pre (before the levy base), employed throughout (this seed stays
    // healthy — no job_loss/job_return on this path), flow rows carrying the
    // conditional salary key. INCOME balance changes, the phase-3.5/4a-pre
    // wiring or any income shape change moves this hash — update it
    // consciously, never casually.
    expect(final.income).toEqual({ salaryM: 1500, employed: true, lastReviewTick: 0 });
    expect(final.expenses?.flow.some((f) => (f.salary ?? 0) > 0)).toBe(true);
    expect(final.residency).toBeNull();
    expect(hash).toBe(V7_GOLDEN);
  });

  it('golden fingerprint (v8 residency economy, us renter): consciously update on residency changes', () => {
    const { final } = runMonths(makeGame(12345), 120);
    const hash = fnv1a(JSON.stringify(final));
    // the FULL v8 state — everything the v7 salaried-renter golden covers
    // PLUS the active residency layer from day one: the us CPI index
    // compounding monthly in phase 0.97 (catalog ~.025/yr × regime tilts),
    // the living basket indexing by the cumulative cpi, the asset-drift
    // nominal add-on in phase 1b, and the scaled bankruptcy threshold.
    // HOME_INFLATION / REGIME_TILT / scenario inflation rows, the phase-0.97
    // wiring, the livingClampFor basket indexing or any residency shape
    // change moves this hash — update it consciously, never casually.
    expect(final.residency?.countryId).toBe('us');
    expect(final.residency!.cpi).toBeGreaterThan(100);
    expect(hash).toBe(V8_GOLDEN);
  });

  it('golden fingerprint (v8 residency economy, tr high-inflation path): consciously update on residency changes', () => {
    const { final } = runMonths(createNewGame({ seed: 12345, name: 'Test', homeCountryId: 'tr' }), 120);
    const hash = fnv1a(JSON.stringify(final));
    // the high-inflation fence: same seed as the us golden but the family
    // lives in Turkey (~40%/yr catalog rate) — asset prices ride the nominal
    // drift add-on, the living basket compounds hard, the bankruptcy
    // threshold melts upward. Pins the whole v8 inflation path end-to-end;
    // HOME_INFLATION.tr or any formula change moves this hash — update it
    // consciously, never casually.
    expect(final.residency?.countryId).toBe('tr');
    expect(final.residency!.cpi).toBeGreaterThan(140); // ×10.6 here: the early arc override (.18) hands off to the .40 catalog rate
    expect(hash).toBe(V8_GOLDEN_TR);
  });

  it('golden fingerprint (v9 deposit economy): consciously update on deposit changes', () => {
    // two deposits, staggered terms: 50k/12mo opened at t0 (us catalog rate
    // .025 + .035 spread = .06 locked), 20k/6mo at t1 (.025 + .025 = .05).
    // The 6mo matures at tick 7 (interest 20_000 × .05 × 6/12 = 500), the
    // 12mo at tick 12 (50_000 × .06 × 1 = 3_000) — the flow row's
    // conditional interest key exists on exactly those two months.
    let s = applyAction(makeGame(12345), { type: 'OPEN_DEPOSIT', amount: 50_000, termMonths: 12 });
    expect(s.deposits[0]).toEqual({ uid: '0:0', principal: 50_000, annualRate: 0.06, openedTick: 0, termMonths: 12 });
    s = applyAction(runMonths(s, 1).final, { type: 'OPEN_DEPOSIT', amount: 20_000, termMonths: 6 });
    expect(s.deposits[1]).toEqual({ uid: '1:1', principal: 20_000, annualRate: 0.05, openedTick: 1, termMonths: 6 });
    const { final } = runMonths(s, 12);
    const hash = fnv1a(JSON.stringify(final));
    // the full v9 path end-to-end: rate locking, derived accrual inside
    // netWorth (the levy base consciously grows with accrued interest),
    // phase-4c maturity credits, the flow interest key, the ledger draining
    // back to empty. DEPOSITS balance changes, the rate formula or any
    // deposit shape change moves this hash — update it consciously, never
    // casually.
    expect(final.deposits).toEqual([]);
    expect(final.eventLog.filter((e) => e.eventId === 'deposit_matured').length).toBe(2);
    const flow = final.expenses?.flow ?? [];
    const withInterest = flow.filter((f) => f.interest !== undefined);
    expect(withInterest.length).toBe(2);
    expect(withInterest.map((f) => f.interest)).toEqual([500, 3000]);
    expect(hash).toBe(V9_GOLDEN);
  });
});

describe('serialization', () => {
  it('every monthly state round-trips through JSON unchanged', () => {
    const { states } = runMonths(makeGame(555), 24);
    for (const st of states) {
      const rt: GameState = JSON.parse(JSON.stringify(st));
      expect(rt).toEqual(st);
    }
  });
});

describe('market soak', () => {
  it('1000 months: no NaN, indexes stay >= 1, cash finite', () => {
    let s = makeGame(2024);
    s = applyAction(s, { type: 'BUY', countryId: 'us', amount: 90_000 }); // be an investor
    const { states } = runMonths(s, 1000);
    const last = states[states.length - 1];
    for (const id of Object.keys(last.countries)) {
      const idx = last.countries[id].index;
      expect(Number.isFinite(idx)).toBe(true);
      expect(idx).toBeGreaterThanOrEqual(1);
      expect(last.countries[id].indexHistory.length).toBeLessThanOrEqual(65);
    }
    expect(Number.isFinite(last.cash)).toBe(true);
    expect(Number.isFinite(netWorth(last))).toBe(true);
  });

  it('founding player starts at 25 and ages with ticks', () => {
    const s = makeGame(1);
    expect(ageYears(s)).toBe(25);
    const { final } = runMonths(s, 120); // 10 years
    expect(ageYears(final)).toBe(35);
  });
});

describe('buy/sell mechanics', () => {
  it('charges grade fees and tracks avgCost', () => {
    let s = makeGame(10);
    s = applyAction(s, { type: 'BUY', countryId: 'us', amount: 10_000 }); // A: 0.5%
    expect(s.cash).toBeCloseTo(90_000, 2);
    expect(s.holdings.us.units).toBeCloseTo(10_000 * 0.995 / 100, 4);
    expect(s.holdings.us.avgCost).toBeCloseTo(100, 2);

    s = applyAction(s, { type: 'SELL', countryId: 'us', units: s.holdings.us.units });
    expect(s.cash).toBeCloseTo(90_000 + 10_000 * 0.995 * 0.995, 2);
    expect(s.holdings.us).toBeUndefined();
  });

  it('rejects overspending and unknown countries', () => {
    const s = makeGame(10);
    expect(() => applyAction(s, { type: 'BUY', countryId: 'us', amount: 1_000_000 })).toThrow('INSUFFICIENT_CASH');
    expect(() => applyAction(s, { type: 'BUY', countryId: 'xx', amount: 100 })).toThrow();
    expect(() => applyAction(s, { type: 'SELL', countryId: 'us', units: 1 })).toThrow('NO_HOLDING');
  });

  it('blocks the next month while an event is pending', async () => {
    const { EVENT_CATALOG } = await import('./events/catalog');
    const crisis = EVENT_CATALOG.find((e) => e.id === 'crisis_c')!;
    const savedP = crisis.p;
    crisis.p = 1; // guaranteed C-grade crisis this month
    try {
      const s = applyAction(makeGame(10), { type: 'NEXT_MONTH' });
      expect(s.pendingEvents.length).toBeGreaterThan(0);
      expect(() => applyAction(s, { type: 'NEXT_MONTH' })).toThrow('PENDING_EVENT');
    } finally {
      crisis.p = savedP;
    }
  });
});

describe('fast-forward', () => {
  it('stops at the next pending event and lands in the action log', async () => {
    const { EVENT_CATALOG } = await import('./events/catalog');
    const crisis = EVENT_CATALOG.find((e) => e.id === 'crisis_c')!;
    const savedP = crisis.p;
    crisis.p = 1;
    try {
      const s0 = makeGame(10);
      // month 1 fires the forced crisis → FF must stop right there
      const s1 = applyAction(s0, { type: 'FAST_FORWARD' });
      expect(s1.pendingEvents.length).toBeGreaterThan(0);
      expect(s1.tick).toBe(s0.tick + 1);
      const last = s1.actionLog[s1.actionLog.length - 1];
      expect(last.action.type).toBe('FAST_FORWARD');
      expect(() => applyAction(s1, { type: 'FAST_FORWARD' })).toThrow('PENDING_EVENT');
    } finally {
      crisis.p = savedP;
    }
  });

  it('advancing 12 months equals stepping month-by-month with the same drain policy', () => {
    const drain = (s: GameState): GameState => {
      let st = s;
      while (st.pendingEvents.length > 0) {
        const head = st.pendingEvents[0];
        st = head.hasChoice
          ? applyAction(st, { type: 'RESOLVE_EVENT', uid: head.uid, optionIndex: 0 })
          : applyAction(st, { type: 'ACK_EVENT', uid: head.uid });
      }
      return st;
    };
    // reference: one month at a time, draining the queue after each
    let ref = makeGame(4242);
    for (let i = 0; i < 12 && ref.status === 'PLAYING'; i++) {
      ref = drain(applyAction(ref, { type: 'NEXT_MONTH' }));
    }
    // fast-forward: run to each stop, drain, repeat until the same horizon
    let ff = makeGame(4242);
    while (ff.status === 'PLAYING' && ff.tick < 12) {
      ff = applyAction(ff, { type: 'FAST_FORWARD', months: 12 - ff.tick });
      ff = drain(ff);
    }
    expect(ff.tick).toBe(ref.tick);
    // identical worlds — the action log obviously differs (different actions)
    const { actionLog: _ffLog, ...ffWorld } = ff;
    const { actionLog: _refLog, ...refWorld } = ref;
    expect(ffWorld).toEqual(refWorld);
    expect(ff.rng).toEqual(ref.rng);
  });

  it('replays FAST_FORWARD actions bit-identically', () => {
    const initial = makeGame(9001);
    let s = initial;
    const actions: Parameters<typeof replay>[1] = [];
    for (let round = 0; round < 8; round++) {
      const action = { type: 'FAST_FORWARD', months: 12 } as const;
      s = applyAction(s, action);
      actions.push(action);
      while (s.pendingEvents.length > 0) {
        const head = s.pendingEvents[0];
        if (head.hasChoice) {
          const a = { type: 'RESOLVE_EVENT', uid: head.uid, optionIndex: 0 } as const;
          s = applyAction(s, a);
          actions.push(a);
        } else {
          const a = { type: 'ACK_EVENT', uid: head.uid } as const;
          s = applyAction(s, a);
          actions.push(a);
        }
      }
    }
    const replayed = replay(initial, actions);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(s));
  });
});
