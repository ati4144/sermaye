import { describe, expect, it } from 'vitest';
import { healHome, migrateState } from './create';
import { applyAction } from './actions';
import { tick } from './sim';
import { enqueueLifeEvent } from './events/apply';
import { performInheritance } from './life';
import { balance } from './balance';
import { assetPrice, escrowProceedsFor, homeReliefFor, liquidateToRaise, netWorth, roundCash } from './market';
import { makeGame, runMonths } from './test-utils';
import type { GameState, PendingSale } from './types';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** A fresh game with neutral fate and deep pockets — deed tests need headroom. */
function richGame(seed: number, cash = 1_000_000): GameState {
  const s = makeGame(seed);
  s.fate = null; // neutral fee/livingCost mods — exact catalog constants
  s.cash = cash;
  return s;
}

describe('Yuva layer: schema & migration', () => {
  it('new games start as renters at schema v8 with an empty escrow ledger', () => {
    const s = makeGame(1);
    expect(s.schemaVersion).toBe(8);
    expect(s.home).toEqual({ role: 'rental', assetId: null, sinceTick: 0 });
    expect(s.pendingSales).toEqual([]);
  });

  it('migrateState stamps v5 saves inert: home null, pendingSales [], income and residency null, nothing else touched', () => {
    const s = makeGame(2);
    const v5 = clone(s);
    delete (v5 as Partial<GameState>).home;
    delete (v5 as Partial<GameState>).pendingSales;
    delete (v5 as Partial<GameState>).income;
    delete (v5 as Partial<GameState>).residency;
    (v5 as { schemaVersion: number }).schemaVersion = 5;
    const m = migrateState(v5);
    expect(m.schemaVersion).toBe(8);
    expect(m.home).toBeNull();
    expect(m.pendingSales).toEqual([]);
    expect(m.income).toBeNull();
    expect(m.residency).toBeNull(); // v7→v8 step: cpi 1 until INIT_RESIDENCY
    const v5Plus = { ...clone(v5), schemaVersion: 8, pendingSales: [], home: null, income: null, residency: null }; // key order = migrateState's
    expect(JSON.stringify(m)).toBe(JSON.stringify(v5Plus));
  });

  it('a fresh renter run is bit-identical to the v5-inert path (no wedding in 120 months)', () => {
    // seed 12345 stays single for 120 months (empirically pinned by the v6
    // renter golden), so the active-but-renting home layer changes NOTHING:
    // relief 0, no marriedTick, no eve_cikma. Strip the two v6 keys and the
    // version → the states must be bit-for-bit equal.
    const a = runMonths(makeGame(12345), 120).final;
    const twin = makeGame(12345);
    twin.home = null;
    const b = runMonths(twin, 120).final;
    const { home: _h, pendingSales: _ps, schemaVersion: _v, ...aCore } = a;
    const { home: _h2, pendingSales: _ps2, schemaVersion: _v2, ...bCore } = b;
    (bCore as { schemaVersion?: number }).schemaVersion = 5;
    (aCore as { schemaVersion?: number }).schemaVersion = 5;
    expect(JSON.stringify(aCore)).toBe(JSON.stringify(bCore));
  });
});

describe('Yuva layer: zero-draw contracts', () => {
  it('LIST_ASSET, CANCEL_LISTING and SET_ROLE never touch the rng stream', () => {
    let s = richGame(3);
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'house', amount: 200_000 }); // 1 unit
    const rngBefore = JSON.stringify(s.rng);
    s = applyAction(s, { type: 'SET_ROLE', role: 'home', assetId: 'house' });
    expect(JSON.stringify(s.rng)).toBe(rngBefore);
    s = applyAction(s, { type: 'LIST_ASSET', assetId: 'house', units: 1 });
    expect(JSON.stringify(s.rng)).toBe(rngBefore);
    s = applyAction(s, { type: 'CANCEL_LISTING', uid: s.pendingSales[0].uid });
    expect(JSON.stringify(s.rng)).toBe(rngBefore);
    s = applyAction(s, { type: 'SET_ROLE', role: 'rental' });
    expect(JSON.stringify(s.rng)).toBe(rngBefore);
  });
});

describe('SET_ROLE: the Yuva switch', () => {
  it('moves into an owned house, logs home_set, and back out to renting', () => {
    let s = richGame(4);
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'house', amount: 200_000 }); // 1 unit
    s = applyAction(s, { type: 'SET_ROLE', role: 'home', assetId: 'house' });
    expect(s.home).toEqual({ role: 'home', assetId: 'house', sinceTick: 0 });
    expect(s.eventLog.some((e) => e.eventId === 'home_set')).toBe(true);
    s = applyAction(s, { type: 'SET_ROLE', role: 'rental' });
    expect(s.home).toEqual({ role: 'rental', assetId: null, sinceTick: 0 });
    expect(s.eventLog.filter((e) => e.eventId === 'home_set').length).toBe(2);
  });

  it("activates a null home layer on legacy runs via SET_ROLE 'rental'", () => {
    const legacy = makeGame(5);
    legacy.home = null;
    const s = applyAction(legacy, { type: 'SET_ROLE', role: 'rental' });
    expect(s.home).toEqual({ role: 'rental', assetId: null, sinceTick: 0 });
  });

  it('guards: non-REAL_ESTATE deeds (car/farm/land), fractional ids, unowned homes', () => {
    let s = richGame(6);
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'car', amount: 100_000 }); // car is DEED but VEHICLE
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 60_000 }); // farm is DEED but LAND
    expect(() => applyAction(s, { type: 'SET_ROLE', role: 'home', assetId: 'car' })).toThrow('INVALID_HOME_ASSET');
    expect(() => applyAction(s, { type: 'SET_ROLE', role: 'home', assetId: 'farm' })).toThrow('INVALID_HOME_ASSET');
    expect(() => applyAction(s, { type: 'SET_ROLE', role: 'home', assetId: 'gold' })).toThrow('INVALID_HOME_ASSET');
    expect(() => applyAction(s, { type: 'SET_ROLE', role: 'home', assetId: 'house' })).toThrow('NO_HOLDING'); // REAL_ESTATE but unowned
    expect(() => applyAction(s, { type: 'SET_ROLE', role: 'mansion' as never })).toThrow();
  });
});

describe('homeReliefFor: the exact relief formula', () => {
  it('is zero on every no-home path', () => {
    const s = richGame(7);
    expect(homeReliefFor(s, 500_000)).toBe(0); // renting
    s.home = null;
    expect(homeReliefFor(s, 500_000)).toBe(0); // legacy layer
    s.home = { role: 'home', assetId: 'house', sinceTick: 0 };
    expect(homeReliefFor(s, 500_000)).toBe(0); // designated home not owned
  });

  it('is min(homeValue × rate, worth × cap), exact to the cent', () => {
    let s = richGame(8);
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'house', amount: 200_000 }); // 1 unit @ 120 000
    s = applyAction(s, { type: 'SET_ROLE', role: 'home', assetId: 'house' });
    const price = assetPrice(s, 'house');
    // wealth-cap side binds for a modest worth
    expect(homeReliefFor(s, 100_000)).toBe(roundCash(Math.min(price * 0.0022, 100_000 * 0.003)));
    // home-value side binds once worth is large enough
    expect(homeReliefFor(s, 100_000_000)).toBe(roundCash(price * 0.0022));
    expect(balance.HOME.RELIEF_RATE_M).toBe(0.0022);
    expect(balance.HOME.RELIEF_WORTH_CAP).toBe(0.003);
  });

  it('reduces the living cost BEFORE the fate multiplier and lands in the flow row', () => {
    // one rich run with a cursed livingCost ×1.5: the flow row must reconcile
    // as items + levy − 1.5 × relief = rent − upkeep − net (i.e. the relief is
    // subtracted from the clamped cost first, then multiplied — "lanet ev
    // alarak atlanamaz" runs the other way: the curse cannot dodge the home).
    let s = richGame(9);
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'house', amount: 200_000 });
    s = applyAction(s, { type: 'SET_ROLE', role: 'home', assetId: 'house' });
    s.fate = clone(makeGame(9).fate!); // a real fate object...
    s.fate.mods.livingCost = 1.5; // ...with only the curse swapped in
    s.income = null; // the pure relief formula — salary nets elsewhere
    const run = runMonths(s, 6);
    const rows = run.final.expenses!.flow.filter((f) => (f as { relief?: number }).relief !== undefined);
    expect(rows.length).toBeGreaterThan(0);
    for (const f of rows) {
      const relief = (f as { relief: number }).relief;
      expect(f.items + f.wealthLevy - 1.5 * relief).toBeCloseTo(f.rent - f.upkeep - f.net, 1);
    }
  });

  it('keeps renter months byte-identical: no relief key in the flow row', () => {
    const run = runMonths(richGame(10), 6);
    for (const f of run.final.expenses!.flow) {
      expect('relief' in f).toBe(false);
    }
  });
});

describe('LIST_ASSET: the patient sale', () => {
  it('locks proceeds at price × (1 − fee), NO quick-sale discount, due in 6 months', () => {
    let s = richGame(11);
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'house', amount: 200_000 }); // 1 unit
    const worthBefore = netWorth(s);
    s = applyAction(s, { type: 'LIST_ASSET', assetId: 'house', units: 1 });
    expect(s.properties.house).toBeUndefined(); // units left the position book
    expect(s.pendingSales.length).toBe(1);
    const ps = s.pendingSales[0];
    expect(ps.assetId).toBe('house');
    expect(ps.units).toBe(1);
    expect(ps.dueTick).toBe(s.tick + balance.ASSETS.ESCROW_MONTHS);
    expect(balance.ASSETS.ESCROW_MONTHS).toBe(6);
    const price = assetPrice(s, 'house');
    expect(ps.proceeds).toBe(roundCash(price * (1 - 0.02))); // fee only — quickDiscount 0.08 NOT applied
    expect(ps.proceeds).toBeCloseTo(price * 0.98, 2);
    // netWorth swaps units for the locked receivable minus the fee — nothing else moves
    expect(netWorth(s)).toBeCloseTo(worthBefore - price * 0.02, 1);
    const listed = s.eventLog.find((e) => e.eventId === 'asset_listed')!;
    expect(listed.assetId).toBe('house');
    expect(listed.assetUnits).toBe(1);
    expect(listed.assetAmount).toBe(ps.proceeds);
  });

  it('guards: fractional assets, missing holdings, bad unit counts, legacy runs', () => {
    let s = richGame(12);
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 60_000 }); // 2 dönüm
    expect(() => applyAction(s, { type: 'LIST_ASSET', assetId: 'gold', units: 1 })).toThrow('NOT_DEED');
    expect(() => applyAction(s, { type: 'LIST_ASSET', assetId: 'car', units: 1 })).toThrow('NO_HOLDING');
    expect(() => applyAction(s, { type: 'LIST_ASSET', assetId: 'farm', units: 0 })).toThrow('INVALID_UNITS');
    expect(() => applyAction(s, { type: 'LIST_ASSET', assetId: 'farm', units: 1.5 })).toThrow('INVALID_UNITS');
    expect(() => applyAction(s, { type: 'LIST_ASSET', assetId: 'farm', units: 3 })).toThrow('INVALID_UNITS');
    const legacy = richGame(13);
    legacy.assets = null;
    legacy.properties = {};
    expect(() => applyAction(legacy, { type: 'LIST_ASSET', assetId: 'farm', units: 1 })).toThrow('ASSETS_INACTIVE');
  });

  it('locked proceeds are immune to later price moves and liqDelta mods', () => {
    let s = richGame(14);
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 60_000 }); // 2 dönüm
    s = applyAction(s, { type: 'LIST_ASSET', assetId: 'farm', units: 2 });
    const locked = s.pendingSales[0].proceeds;
    // a crisis freeze deepens the quick-sale discount — escrow must not care
    s.assets!.markets.farm.mods.push({ id: 'test:0', driftDelta: 0, volDelta: 0, liqDelta: 0.4, remaining: 24 });
    s.assets!.markets.farm.index *= 0.5; // price collapse
    expect(s.pendingSales[0].proceeds).toBe(locked);
    const run = runMonths(s, 7); // dueTick 6 passes
    expect(run.final.pendingSales).toEqual([]);
    const collected = run.final.eventLog.filter((e) => e.eventId === 'asset_escrow_collected');
    expect(collected.length).toBe(1);
    expect(collected[0].assetAmount).toBe(locked); // the LOCKED amount, not the collapsed value
  });

  it('pending units earn no rent', () => {
    let s = richGame(15);
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 60_000 }); // 2 dönüm, yields 0.0035/mo
    s = applyAction(s, { type: 'LIST_ASSET', assetId: 'farm', units: 2 });
    expect(s.properties.farm).toBeUndefined();
    const run = runMonths(s, 3);
    // no farm position existed → no farm income line ever, nothing to collect
    expect(run.final.eventLog.some((e) => e.eventId === 'asset_escrow_collected')).toBe(false); // due at tick 6
    expect(run.final.pendingSales[0].rentCollected).toBe(0);
  });

  it('collects at exactly dueTick in FIFO listing order and keeps netWorth flat across the swap', () => {
    let s = richGame(16);
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 60_000 }); // 2 dönüm
    s = applyAction(s, { type: 'LIST_ASSET', assetId: 'farm', units: 1 }); // due tick 6
    s = applyAction(s, { type: 'NEXT_MONTH' }); // tick 1
    s = applyAction(s, { type: 'LIST_ASSET', assetId: 'farm', units: 1 }); // due tick 7
    const first = s.pendingSales[0].proceeds;
    const second = s.pendingSales[1].proceeds;
    const run = runMonths(s, 7); // to tick 8
    const collected = run.final.eventLog.filter((e) => e.eventId === 'asset_escrow_collected');
    expect(collected.map((e) => e.tick)).toEqual([6, 7]);
    expect(collected[0].assetAmount).toBe(first);
    expect(collected[1].assetAmount).toBe(second);
    expect(run.final.pendingSales).toEqual([]);
  });

  it('a matured sale credits cash BEFORE the deficit check — no fire sale one month early', () => {
    // escrow run: everything listed, cash starved — the tick-6 payout must
    // arrive before phase 4d ever looks at the deficit. income nulled in both
    // twins: a salary would mask the starvation this test manufactures.
    let a = richGame(17);
    a = applyAction(a, { type: 'BUY_ASSET', assetId: 'farm', amount: 60_000 });
    a = applyAction(a, { type: 'LIST_ASSET', assetId: 'farm', units: 2 });
    a.cash = 100; // starve AFTER locking
    a.income = null;
    const runA = runMonths(a, 8);
    expect(runA.final.eventLog.some((e) => e.eventId === 'asset_escrow_collected')).toBe(true);
    expect(runA.final.eventLog.some((e) => e.eventId === 'forced_sale')).toBe(false);
    expect(runA.final.cash).toBeGreaterThan(0);
    // twin: same purchase, quick-sold nothing, starved — the ladder fires
    let b = richGame(17);
    b = applyAction(b, { type: 'BUY_ASSET', assetId: 'farm', amount: 60_000 });
    b.cash = 100;
    b.income = null;
    const runB = runMonths(b, 8);
    expect(runB.final.eventLog.some((e) => e.eventId === 'asset_forced_sale')).toBe(true);
  });

  it('CANCEL_LISTING restores the position exactly (and merges over a re-buy)', () => {
    let s = richGame(18);
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 60_000 }); // 2 dönüm
    const before = clone(s.properties);
    s = applyAction(s, { type: 'LIST_ASSET', assetId: 'farm', units: 2 });
    s = applyAction(s, { type: 'CANCEL_LISTING', uid: s.pendingSales[0].uid });
    expect(s.pendingSales).toEqual([]);
    expect(s.properties).toEqual(before); // byte-identical restore
    expect(s.eventLog.some((e) => e.eventId === 'asset_listing_cancelled')).toBe(true);

    // merge path: list 1 of the 2 (position keeps 1), re-buy 1 at a moved
    // price, cancel → 3 units with the snapshot merged in weighted
    s = applyAction(s, { type: 'LIST_ASSET', assetId: 'farm', units: 1 });
    s.assets!.markets.farm.index = 140; // price moved
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 40_000 }); // 1 more dönüm @ 35 000
    s = applyAction(s, { type: 'CANCEL_LISTING', uid: s.pendingSales[0].uid });
    const pos = s.properties.farm!;
    expect(pos.units).toBe(3); // 1 kept + 1 re-bought + 1 restored
    const pNew = assetPrice(s, 'farm');
    const pOld = pNew * (100 / 140);
    expect(pos.avgCost).toBeCloseTo((2 * pOld + pNew) / 3, 3); // two at the old price, one at the new
    expect(() => applyAction(s, { type: 'CANCEL_LISTING', uid: 'nope' })).toThrow('LISTING_NOT_FOUND');
  });

  it('the liquidation ladder never touches escrow (a contract, not a buffer)', () => {
    const s = richGame(19);
    s.pendingSales.push({
      uid: 'test:0',
      assetId: 'farm',
      units: 1,
      proceeds: 25_000,
      dueTick: 100,
      avgCost: 25_000,
      firstBuyTick: 0,
      rentCollected: 0,
    });
    s.cash = -5_000; // deficit with nothing else owned
    liquidateToRaise(s, 5_000);
    expect(s.pendingSales.length).toBe(1); // untouched
    expect(s.cash).toBe(-5_000); // nothing raised — cash stays negative
    expect(s.pendingEvents.some((e) => e.eventId === 'forced_sale')).toBe(false); // no asset sales → no notice
  });

  it('escrow survives inheritance — the heir collects', () => {
    let s = richGame(20);
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 60_000 });
    s = applyAction(s, { type: 'LIST_ASSET', assetId: 'farm', units: 2 });
    s.player.children = [{ id: 'c1', birthTick: -240, alive: true }];
    const locked = s.pendingSales[0].proceeds;
    performInheritance(s); // estate tax fires, ladder runs — escrow is not collateral
    expect(s.pendingSales.length).toBe(1);
    expect(s.player.generation).toBe(2);
    const run = runMonths(s, 7);
    expect(run.final.eventLog.some((e) => e.eventId === 'asset_escrow_collected')).toBe(true);
    expect(run.final.pendingSales).toEqual([]);
    void locked;
  });

  it('FAST_FORWARD months still mature escrow (collection is a phase, not an action)', () => {
    let s = richGame(21);
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 60_000 });
    s = applyAction(s, { type: 'LIST_ASSET', assetId: 'farm', units: 2 });
    let guard = 0;
    while (s.pendingSales.length > 0 && guard < 20 && s.status === 'PLAYING') {
      guard++;
      s = applyAction(s, { type: 'FAST_FORWARD', months: 12 });
      while (s.pendingEvents.length > 0 && s.status === 'PLAYING') {
        const head = s.pendingEvents[0];
        s = applyAction(
          s,
          head.hasChoice
            ? { type: 'RESOLVE_EVENT', uid: head.uid, optionIndex: 0 }
            : { type: 'ACK_EVENT', uid: head.uid },
        );
      }
    }
    expect(s.pendingSales).toEqual([]);
    expect(s.eventLog.some((e) => e.eventId === 'asset_escrow_collected')).toBe(true);
  });
});

describe('forced-sale notice', () => {
  it('fires once per tick for asset (L1/L3) sales', () => {
    const s = richGame(22);
    s.holdings.gold = { units: 10, avgCost: 100 }; // L1 fodder
    liquidateToRaise(s, 500);
    const notices = s.pendingEvents.filter((e) => e.eventId === 'forced_sale');
    expect(notices.length).toBe(1);
    expect(notices[0].hasChoice).toBe(false); // ACK notice
    // dedup: a second ladder call in the same tick does not double-queue
    liquidateToRaise(s, 10);
    expect(s.pendingEvents.filter((e) => e.eventId === 'forced_sale').length).toBe(1);
  });

  it('never fires for country (L2) sales — legacy v2 runs stay silent', () => {
    const s = richGame(23);
    s.assets = null; // the pure v2 economy
    s.properties = {};
    s.holdings.us = { units: 100, avgCost: 100 };
    liquidateToRaise(s, 5_000);
    expect(s.pendingEvents.some((e) => e.eventId === 'forced_sale')).toBe(false);
    expect(s.cash).toBeGreaterThan(0); // the countries did sell
  });

  it('ACK clears the notice and play continues', () => {
    let s = richGame(24);
    s.holdings.gold = { units: 10, avgCost: 100 };
    liquidateToRaise(s, 500);
    const uid = s.pendingEvents.find((e) => e.eventId === 'forced_sale')!.uid;
    s = applyAction(s, { type: 'ACK_EVENT', uid });
    expect(s.pendingEvents.some((e) => e.eventId === 'forced_sale')).toBe(false);
  });
});

describe('eve_cikma: the sixth-month beat', () => {
  it('fires exactly six months after the wedding resolve, once per player', () => {
    const s = makeGame(25);
    s.player.married = true;
    // tick() increments BEFORE phase 3 reads the clock: stamp so the coming
    // tick lands exactly on the sixth month
    s.player.marriedTick = s.tick - 5;
    const after = clone(s);
    tick(after);
    const beat = after.pendingEvents.find((e) => e.eventId === 'eve_cikma');
    expect(beat).toBeDefined();
    expect(after.player.lifeFlags).toEqual({ eve_cikti: true });
    // not again: the flag holds even if the clock were re-armed
    const again = clone(after);
    again.pendingEvents = [];
    tick(again);
    expect(again.pendingEvents.some((e) => e.eventId === 'eve_cikma')).toBe(false);
    // and month 5 / month 7 are not the beat
    const early = clone(s);
    early.player.marriedTick = s.tick - 4;
    tick(early);
    expect(early.pendingEvents.some((e) => e.eventId === 'eve_cikma')).toBe(false);
  });

  it('never fires on legacy runs (home null keeps the v5 path)', () => {
    const s = makeGame(26);
    s.home = null;
    s.player.married = true;
    s.player.marriedTick = s.tick - 5;
    const after = clone(s);
    tick(after);
    expect(after.pendingEvents.some((e) => e.eventId === 'eve_cikma')).toBe(false);
  });

  it('resolving option 0 grants the beşibirlik (5 gold units)', () => {
    const s = richGame(27); // home layer active from creation
    const pending = enqueueLifeEvent(s, 'eve_cikma', true);
    const after = applyAction(s, { type: 'RESOLVE_EVENT', uid: pending.uid, optionIndex: 0 });
    expect(after.holdings.gold).toBeDefined();
    expect(after.holdings.gold.units).toBeCloseTo(5, 4);
    expect(after.eventLog.some((e) => e.eventId === 'asset_granted' && e.assetId === 'gold')).toBe(true);
  });
});

describe('marriedTick stamping', () => {
  it('stamps on the wedding resolve when the home layer is active', () => {
    const s = richGame(28);
    const pending = enqueueLifeEvent(s, 'marriage', true);
    const after = applyAction(s, { type: 'RESOLVE_EVENT', uid: pending.uid, optionIndex: 0 });
    expect(after.player.married).toBe(true);
    expect(after.player.marriedTick).toBe(after.tick);
  });

  it('does NOT stamp on legacy runs — the v5 Player shape survives intact', () => {
    const s = richGame(29);
    s.home = null;
    const pending = enqueueLifeEvent(s, 'marriage', true);
    const after = applyAction(s, { type: 'RESOLVE_EVENT', uid: pending.uid, optionIndex: 0 });
    expect(after.player.married).toBe(true);
    expect(after.player.marriedTick).toBeUndefined();
    expect('lifeFlags' in after.player).toBe(false);
  });
});

describe('healHome: store-boundary repair', () => {
  it('returns the same reference for a healthy layer', () => {
    const s = makeGame(30);
    expect(healHome(s)).toBe(s);
  });

  it('degrades a bad home to renting and clamps a future sinceTick', () => {
    const s = makeGame(31);
    s.home = { role: 'mansion' as never, assetId: 'house', sinceTick: -1 };
    const healed = healHome(s);
    expect(healed.home).toEqual({ role: 'rental', assetId: null, sinceTick: -1 }); // sinceTick survived (valid)
    const s2 = makeGame(32);
    s2.home = { role: 'home', assetId: 'gold', sinceTick: 999 }; // fractional id + future tick
    const healed2 = healHome(s2);
    expect(healed2.home).toEqual({ role: 'rental', assetId: null, sinceTick: 0 });
  });

  it('drops malformed pending-sale rows and caps the ledger defensively', () => {
    const s = makeGame(33);
    const good: PendingSale = {
      uid: 't:0:farm:0',
      assetId: 'farm',
      units: 1,
      proceeds: 25_000,
      dueTick: 6,
      avgCost: 25_000,
      firstBuyTick: 0,
      rentCollected: 0,
    };
    s.pendingSales = [
      good,
      { uid: 't:1:gold:1', assetId: 'gold', units: 1, proceeds: 100, dueTick: 6, avgCost: 100, firstBuyTick: 0, rentCollected: 0 }, // not a DEED
      { uid: 't:2:farm:2', assetId: 'farm', units: 1.5, proceeds: 100, dueTick: 6, avgCost: 100, firstBuyTick: 0, rentCollected: 0 }, // fractional units
      { uid: 't:3:farm:3', assetId: 'farm', units: 1, proceeds: NaN, dueTick: 6, avgCost: 100, firstBuyTick: 0, rentCollected: 0 }, // NaN proceeds
    ];
    const healed = healHome(s);
    expect(healed.pendingSales).toEqual([good]);
    // the 33-row defensive cap
    const s2 = makeGame(34);
    s2.pendingSales = Array.from({ length: 33 }, (_, i) => ({ ...good, uid: `t:${i}` }));
    expect(healHome(s2).pendingSales.length).toBe(32);
  });

  it('leaves a null home layer null (pending rows still validated)', () => {
    const s = makeGame(35);
    s.home = null;
    s.pendingSales = [
      { uid: 'x', assetId: 'diamond', units: 1, proceeds: 1, dueTick: 1, avgCost: 1, firstBuyTick: 0, rentCollected: 0 },
    ];
    const healed = healHome(s);
    expect(healed.home).toBeNull();
    expect(healed.pendingSales).toEqual([]);
  });
});

describe('v6 escrow preview parity', () => {
  it('escrowProceedsFor matches what LIST_ASSET locks (the UI preview seam)', () => {
    const s = richGame(36);
    s.cash = 1_000_000;
    const preview = escrowProceedsFor(s, 'farm', 2);
    const t = applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 60_000 });
    const t2 = applyAction(t, { type: 'LIST_ASSET', assetId: 'farm', units: 2 });
    expect(t2.pendingSales[0].proceeds).toBe(preview); // same formula, same cents
  });
});
