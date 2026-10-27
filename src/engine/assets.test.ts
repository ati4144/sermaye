import { describe, expect, it } from 'vitest';
import { createNewGame, healAssets } from './create';
import { applyAction, replay } from './actions';
import { eventDef } from './events/catalog';
import { applyEffects, fireMarketEvent } from './events/apply';
import { ASSET_IDS, assetDef, DEED_LIQUIDATION_ORDER } from './data/assets';
import { COUNTRY_IDS } from './data/countries';
import { assetPrice, liquidateToRaise, netWorth, roundCash } from './market';
import { makeGame, runMonths } from './test-utils';
import type { GameState } from './types';

/** Strip a fresh v3 game down to the legacy v2 economy (assets inert). */
function legacyGame(seed: number): GameState {
  const s = makeGame(seed);
  s.assets = null;
  s.properties = {};
  return s;
}

describe('asset layer activation', () => {
  it('INIT_ASSETS activates all markets at 100 with ZERO draws', () => {
    let s = legacyGame(42);
    const rngBefore = JSON.stringify(s.rng);
    s = applyAction(s, { type: 'INIT_ASSETS' });
    expect(s.assets).not.toBeNull();
    expect(s.assets!.activeIds).toEqual(ASSET_IDS);
    for (const id of ASSET_IDS) {
      expect(s.assets!.markets[id].index).toBe(100);
      expect(s.assets!.markets[id].indexHistory).toEqual([100]);
      expect(s.assets!.markets[id].mods).toEqual([]);
    }
    // the activation itself consumes no randomness — the stream is untouched
    expect(JSON.stringify(s.rng)).toBe(rngBefore);
    // double activation is refused
    expect(() => applyAction(s, { type: 'INIT_ASSETS' })).toThrow('ASSETS_ACTIVE');
    // logged for replay
    expect(s.actionLog[s.actionLog.length - 1].action).toEqual({ type: 'INIT_ASSETS' });
  });

  it('asset actions refuse on legacy runs (ASSETS_INACTIVE)', () => {
    const s = legacyGame(7);
    expect(() => applyAction(s, { type: 'BUY_ASSET', assetId: 'gold', amount: 1000 })).toThrow('ASSETS_INACTIVE');
    expect(() => applyAction(s, { type: 'SELL_ASSET', assetId: 'farm', units: 1 })).toThrow('ASSETS_INACTIVE');
  });

  it('unknown asset ids throw', () => {
    const s = makeGame(8);
    expect(() => applyAction(s, { type: 'BUY_ASSET', assetId: 'diamond', amount: 1000 })).toThrow('Unknown asset');
  });

  it('asset ids never collide with country ids (separate namespaces)', () => {
    expect(ASSET_IDS.filter((id) => COUNTRY_IDS.includes(id))).toEqual([]);
  });
});

describe('asset trading', () => {
  it('gold buys/sells fractionally with the kuyumcu fee', () => {
    let s = makeGame(3);
    s.fate = null; // neutral fee mod
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'gold', amount: 1000 });

    const fee = 0.0075;
    const price = assetPrice(s, 'gold'); // 100 — no tick has passed
    const h = s.holdings['gold']!;
    expect(h.units).toBeCloseTo((1000 * (1 - fee)) / price, 3);
    expect(h.avgCost).toBeCloseTo(price, 3);
    expect(s.cash).toBeCloseTo(100_000 - 1000, 1);

    s = applyAction(s, { type: 'SELL_ASSET', assetId: 'gold', units: h.units });
    expect(s.holdings['gold']).toBeUndefined();
    expect(s.cash).toBeCloseTo(100_000 - 1000 + 1000 * (1 - fee) * (1 - fee), 1);
    const sold = s.eventLog.find((e) => e.eventId === 'asset_sold')!;
    expect(sold.assetId).toBe('gold');
    expect(sold.assetAmount).toBeCloseTo(1000 * (1 - fee) * (1 - fee), 1);
  });

  it('deed buys floor whole units, charge only the real cost, guard TOO_SMALL', () => {
    let s = makeGame(11);
    s.fate = null;
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 60_000 }); // upper limit → 2 dönüm

    const pos = s.properties['farm']!;
    expect(pos.units).toBe(2);
    expect(pos.avgCost).toBe(25_000);
    expect(pos.firstBuyTick).toBe(0);
    expect(pos.rentCollected).toBe(0);
    const cost = roundCash((2 * 25_000) / (1 - 0.015));
    expect(s.cash).toBeCloseTo(100_000 - cost, 1); // the difference stays in the wallet

    // amount too small for a whole unit → no state change
    expect(() => applyAction(s, { type: 'BUY_ASSET', assetId: 'house', amount: 10_000 })).toThrow('TOO_SMALL');
    expect(s.properties['house']).toBeUndefined();
    // real cost beyond cash → refused
    expect(() => applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 1_000_000 })).toThrow('INSUFFICIENT_CASH');
    expect(s.cash).toBeCloseTo(100_000 - cost, 1);
    expect(s.properties['farm'].units).toBe(2);
  });

  it('deed sells validate whole units and apply the quick-sale discount', () => {
    let s = makeGame(21);
    s.fate = null;
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'car', amount: 45_000 });

    expect(() => applyAction(s, { type: 'SELL_ASSET', assetId: 'car', units: 1.5 })).toThrow('INVALID_UNITS');
    expect(() => applyAction(s, { type: 'SELL_ASSET', assetId: 'car', units: 2 })).toThrow('INVALID_UNITS');
    expect(() => applyAction(s, { type: 'SELL_ASSET', assetId: 'house', units: 1 })).toThrow('NO_HOLDING');

    const price = assetPrice(s, 'car'); // 40_000
    const cashBefore = s.cash;
    s = applyAction(s, { type: 'SELL_ASSET', assetId: 'car', units: 1 });
    expect(s.properties['car']).toBeUndefined();
    const proceeds = price * (1 - 0.05) * (1 - 0.1); // fee 5%, quick discount 10%
    expect(s.cash).toBeCloseTo(cashBefore + proceeds, 0);
  });

  it('crisis liqDelta widens the quick-sale discount (konut donar)', () => {
    let s = makeGame(23);
    s.fate = null;
    s.cash = 1_000_000; // test scaffolding: the daire costs ~122k, beyond the 100k start
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'house', amount: 130_000 });
    // simulate a freeze: konut_cokusu pushes liqDelta +0.03
    s.assets!.markets.house.mods.push({
      id: 'konut_cokusu:0',
      driftDelta: 0,
      volDelta: 0,
      liqDelta: 0.03,
      remaining: 3,
    });
    const price = assetPrice(s, 'house');
    const cashBefore = s.cash;
    s = applyAction(s, { type: 'SELL_ASSET', assetId: 'house', units: 1 });
    expect(s.cash).toBeCloseTo(cashBefore + price * (1 - 0.02) * (1 - 0.08 - 0.03), 0);
  });

  it('net worth counts gold and deeds', () => {
    let s = makeGame(31);
    s.fate = null;
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'gold', amount: 5000 });
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 30_000 });
    const expected =
      s.cash +
      s.holdings['gold']!.units * assetPrice(s, 'gold') +
      s.properties['farm']!.units * assetPrice(s, 'farm');
    expect(netWorth(s)).toBeCloseTo(expected, 1);
  });
});

describe('asset income (phase 4a)', () => {
  it('rent flows in before living costs; upkeep drains; kuraklık pauses the harvest', () => {
    let s = makeGame(5);
    s.fate = null;
    s.cash = 1_000_000; // scaffolding: daire + araç together exceed the 100k start
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'house', amount: 130_000 });
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'car', amount: 45_000 });
    expect(s.properties['house']!.rentCollected).toBe(0);

    s = applyAction(s, { type: 'NEXT_MONTH' });
    // one month of net rent on a ~120k daire at 0.20%/mo ≈ 240
    const rc = s.properties['house']!.rentCollected;
    expect(rc).toBeGreaterThan(100);
    expect(rc).toBeLessThan(400);
    // cars keep upkeep (negative yield) — rentCollected stays untouched
    expect(s.eventLog.filter((e) => e.eventId === 'asset_bought').length).toBe(2);

    // drought: harvest yield goes to exactly zero for its duration
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 30_000 });
    const def = eventDef('kuraklik');
    fireMarketEvent(s, def, 'farm'); // direct fire (non-choice): shock + yieldDelta mod
    expect(s.assets!.markets.farm.mods[0].yieldDelta).toBe(-0.0035);
    expect(s.assets!.markets.farm.lastEventTick['kuraklik']).toBe(s.tick);
    const head = s.pendingEvents[0];
    s = applyAction(s, { type: 'ACK_EVENT', uid: head.uid });
    s = applyAction(s, { type: 'NEXT_MONTH' });
    expect(s.properties['farm']!.rentCollected).toBe(0); // 0.0035 − 0.0035 = 0
  });
});

describe('forced liquidation ladder', () => {
  it('sells gold first, then countries, then deeds car → farm → house (home last)', () => {
    let s = makeGame(13);
    s.fate = null;
    s.cash = 1_000_000; // scaffolding: the whole five-way portfolio exceeds the 100k start
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'gold', amount: 5000 });
    s = applyAction(s, { type: 'BUY', countryId: 'us', amount: 10_000 });
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'car', amount: 45_000 });
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 30_000 });
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'house', amount: 130_000 });

    s.cash = 0; // hand-bleed the wallet (test scaffolding, pre-log)
    liquidateToRaise(s, 500_000); // deficit way beyond gold+countries+car

    // L1: gold fully consumed, L2: countries fully consumed
    expect(s.holdings['gold']).toBeUndefined();
    expect(s.holdings['us']).toBeUndefined();
    // L3 order: car sold before farm before house — all three consumed by the deficit
    expect(s.properties['car']).toBeUndefined();
    expect(s.properties['farm']).toBeUndefined();
    expect(s.properties['house']).toBeUndefined();
    // every forced sale is logged, in ladder order
    const forced = s.eventLog.filter((e) => e.eventId === 'asset_forced_sale');
    expect(forced.map((e) => e.assetId)).toEqual(['gold', 'car', 'farm', 'house']);
    expect(s.cash).toBeGreaterThan(0); // overage is conscious (whole units)
  });

  it('a small deficit stops at gold and never touches deeds', () => {
    let s = makeGame(14);
    s.fate = null;
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'gold', amount: 5000 });
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 30_000 });
    s.cash = 0;
    liquidateToRaise(s, 3000); // gold covers it (≈ 4963 net)
    expect(s.holdings['gold']).not.toBeUndefined(); // partially sold pro-rata
    expect(s.properties['farm']).toBeDefined();
    expect(s.eventLog.filter((e) => e.eventId === 'asset_forced_sale').length).toBe(1);
  });
});

describe('asset events', () => {
  it('global recession carries an explicit gold row — and stays inert on legacy runs', () => {
    const active = makeGame(31);
    const def = eventDef('global_recession');
    applyEffects(active, def.effects, undefined, def.id);
    expect(active.countries.us.index).toBeCloseTo(90, 1); // countries shocked ×0.9
    expect(active.assets!.markets.gold.index).toBeCloseTo(104, 1); // gold refuge ×1.04

    const legacy = legacyGame(31);
    expect(() => applyEffects(legacy, def.effects, undefined, def.id)).not.toThrow();
    expect(legacy.countries.us.index).toBeCloseTo(90, 1);
  });

  it('konut_cokusu requires the housing index above 150', () => {
    const s = makeGame(33);
    const def = eventDef('konut_cokusu');
    expect(def.condition!(s)).toBe(false); // index 100
    s.assets!.markets.house.index = 151;
    expect(def.condition!(s)).toBe(true);
  });

  it('ASSET events stamp the asset market cooldown, not countries', () => {
    const s = makeGame(35);
    const def = eventDef('mezat_yukselisi');
    fireMarketEvent(s, def, 'car');
    expect(s.assets!.markets.car.lastEventTick['mezat_yukselisi']).toBe(s.tick);
    expect(s.countries.us.lastEventTick['mezat_yukselisi']).toBeUndefined();
    expect(s.assets!.markets.car.index).toBeCloseTo(115, 1); // ×1.15 shock
  });
});

describe('v2 → v3 migration & replay', () => {
  it('a hand-stripped v2 save migrates to an inert layer and replays bit-for-bit', () => {
    const base = makeGame(77);
    const v2 = JSON.parse(JSON.stringify(base)) as GameState;
    delete (v2 as Partial<GameState>).assets;
    delete (v2 as Partial<GameState>).properties;
    delete (v2 as Partial<GameState>).world;
    delete (v2 as Partial<GameState>).expenses;
    delete (v2 as Partial<GameState>).home;
    delete (v2 as Partial<GameState>).pendingSales;
    delete (v2 as Partial<GameState>).income;
    delete (v2 as Partial<GameState>).residency;
    v2.schemaVersion = 2;

    const { final, actions } = runMonths(v2, 24);
    const replayed = replay(v2, actions);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(final));
    expect(final.schemaVersion).toBe(8);
    expect(final.assets).toBeNull(); // never self-activates
    expect(final.properties).toEqual({});
    expect(final.world).toBeNull(); // the world layer never self-activates either
    expect(final.expenses).toBeNull(); // the expense layer never self-activates either
    expect(final.home).toBeNull(); // the Yuva layer never self-activates either
    expect(final.pendingSales).toEqual([]); // escrow stays empty without LIST_ASSET
    expect(final.income).toBeNull(); // the income layer never self-activates either
    expect(final.residency).toBeNull(); // the residency layer never self-activates either
  });

  it('INIT_ASSETS + trades replay bit-for-bit', () => {
    let s = legacyGame(99);
    s = applyAction(s, { type: 'INIT_ASSETS' });
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'gold', amount: 2000 });
    s = applyAction(s, { type: 'BUY_ASSET', assetId: 'farm', amount: 30_000 });
    s = applyAction(s, { type: 'FAST_FORWARD' });
    s = applyAction(s, { type: 'SELL_ASSET', assetId: 'farm', units: 1 });

    const actions = s.actionLog.map((e) => e.action);
    const initial = legacyGame(99);
    const replayed = replay(initial, actions);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(s));
  });

  it('new games get the catalog active from day one (draw-free)', () => {
    const s = createNewGame({ seed: 5, name: 'W' });
    expect(s.assets).not.toBeNull();
    expect(s.assets!.activeIds).toEqual(ASSET_IDS);
    expect(assetDef('gold').kind).toBe('FRACTIONAL');
    expect(assetDef('house').kind).toBe('DEED');
  });
});

describe('estate tax on illiquid estates', () => {
  // regression: liquidateToRaise only ADDS the raised cash, so the old
  // performInheritance left the forced-sale proceeds in the wallet and the
  // heir pocketed the un-paid tax on any cash-light estate
  /** Scaffold a deceased founder with one alive heir, then ACK the death event. */
  function inheritWith(scaffold: (s: GameState) => void): GameState {
    const s = makeGame(4242);
    s.fate = null; // neutral mods
    s.status = 'DECEASED';
    s.player.children = [{ id: 'c0', birthTick: 0, alive: true }];
    scaffold(s);
    s.pendingEvents = [{ uid: '0:death:g', eventId: 'death', tick: s.tick, hasChoice: false }];
    return applyAction(s, { type: 'ACK_EVENT', uid: '0:death:g' });
  }

  it('deed-heavy estate: the forced sale pays the tax, the heir keeps the rest', () => {
    const s = inheritWith((g) => {
      g.cash = 500;
      g.properties.house = { classId: 'house', units: 1, avgCost: 120_000, firstBuyTick: 0, rentCollected: 0 };
    });

    // worth 120,500 → tax 18,075; L3 fire-sells the deed for
    // 120,000×0.98×0.87 = 102,312; heir gets 500 + 102,312 − 18,075
    expect(s.cash).toBeCloseTo(84_737, 1);
    expect(s.properties.house).toBeUndefined();
    expect(s.player.generation).toBe(2);
  });

  it('gold-heavy estate: the pro-rata sale is burned by the tax, not left as cash', () => {
    const s = inheritWith((g) => {
      g.cash = 0;
      g.holdings.gold = { units: 500, avgCost: 100 };
    });

    // worth 50,000 → tax 7,500; L1 sells 7,500/(100×0.9925) = 75.567 units
    expect(s.cash).toBeCloseTo(0, 2);
    expect(s.holdings.gold.units).toBeCloseTo(424.4332, 3);
    expect(s.player.generation).toBe(2);
  });
});

describe('persisted-state healing (healAssets)', () => {
  it('healthy v3 state passes through untouched (same reference)', () => {
    const s = makeGame(11);
    expect(healAssets(s)).toBe(s);
  });

  it('legacy null-asset state passes through untouched (same reference)', () => {
    const s = legacyGame(12);
    expect(healAssets(s)).toBe(s);
  });

  it('backfills a missing market for an ACTIVE id at baseline', () => {
    const s = makeGame(16);
    delete s.assets!.markets.gold; // active but marketless — the crash hazard
    const healed = healAssets(s);
    expect(healed.assets!.markets.gold.index).toBe(100);
    expect(healed.assets!.markets.gold.indexHistory).toEqual([100]);
    expect(healed.assets!.markets.gold.mods).toEqual([]);
    expect(healed.assets!.activeIds).toEqual(ASSET_IDS); // all active here
  });

  it('prunes stale ids, keeps the frozen activeIds snapshot, backfills only active markets', () => {
    const s = makeGame(13);
    const houseMarket = s.assets!.markets.house;
    // a pre-villa v5 save shape: gold once lived under 'altin' (renamed away)
    s.assets = {
      activeIds: ['altin', 'house'],
      markets: { house: houseMarket, altin: { ...houseMarket, id: 'altin' } },
    };

    const healed = healAssets(s);
    expect(healed).not.toBe(s);
    // unknown pruned; the catalog's NEW villa is NOT injected — the snapshot
    // is frozen, the player opts in via ACTIVATE_ASSET (no silent +12 draws/mo)
    expect(healed.assets!.activeIds).toEqual(['house']);
    expect(Object.keys(healed.assets!.markets)).toEqual(['house']);
    expect(healed.assets!.markets.house).toBe(houseMarket); // untouched market keeps its history
    expect(healed.assets!.markets.altin).toBeUndefined();
    expect(healed.assets!.markets.villa).toBeUndefined();
  });

  it('a layer missing its keys entirely heals to an empty-but-valid layer without throwing', () => {
    const s = makeGame(15);
    s.assets = {} as GameState['assets'];
    const healed = healAssets(s);
    expect(healed.assets!.activeIds).toEqual([]);
    expect(healed.assets!.markets).toEqual({});
  });

  it('a healed state trades and ticks without throwing', () => {
    const s = makeGame(14);
    delete s.assets!.markets.gold;
    const healed = healAssets(s);
    const traded = applyAction(healed, { type: 'BUY_ASSET', assetId: 'gold', amount: 2000 });
    expect(traded.holdings.gold).toBeDefined();
    expect(() => applyAction(traded, { type: 'NEXT_MONTH' })).not.toThrow();
  });
});

/** Strip the v6 villa off a fresh game — the exact shape a v5 save migrates to. */
function preVillaGame(seed: number): GameState {
  const s = makeGame(seed);
  s.assets!.activeIds = s.assets!.activeIds.filter((id) => id !== 'villa');
  delete s.assets!.markets.villa;
  return s;
}

describe('ACTIVATE_ASSET (v6)', () => {
  it('activates a catalog class at baseline with zero draws and logs it', () => {
    const s = preVillaGame(21);
    const rngBefore = JSON.stringify(s.rng);
    const t = applyAction(s, { type: 'ACTIVATE_ASSET', assetId: 'villa' });
    expect(t.assets!.activeIds.includes('villa')).toBe(true);
    expect(t.assets!.markets.villa.index).toBe(100);
    expect(t.assets!.markets.villa.indexHistory).toEqual([100]);
    expect(t.assets!.markets.villa.mods).toEqual([]);
    expect(JSON.stringify(t.rng)).toBe(rngBefore); // the activation itself draws nothing
    expect(t.eventLog.some((e) => e.eventId === 'asset_activated' && e.assetId === 'villa')).toBe(true);
    expect(() => applyAction(t, { type: 'ACTIVATE_ASSET', assetId: 'villa' })).toThrow('ASSET_ACTIVE');
    expect(() => applyAction(t, { type: 'ACTIVATE_ASSET', assetId: 'diamond' })).toThrow('Unknown asset');
    const legacy = legacyGame(22);
    expect(() => applyAction(legacy, { type: 'ACTIVATE_ASSET', assetId: 'villa' })).toThrow('ASSETS_INACTIVE');
  });

  it('rejects trading a known-but-inactive class cleanly', () => {
    const s = preVillaGame(23);
    expect(() => applyAction(s, { type: 'BUY_ASSET', assetId: 'villa', amount: 500_000 })).toThrow('ASSET_INACTIVE');
    expect(() => applyAction(s, { type: 'SELL_ASSET', assetId: 'villa', units: 1 })).toThrow('ASSET_INACTIVE');
    expect(() => applyAction(s, { type: 'LIST_ASSET', assetId: 'villa', units: 1 })).toThrow('ASSET_INACTIVE');
  });

  it('consciously joins the phase-1b stream (+12 draws/month) and replays', () => {
    const base = preVillaGame(24);
    const withVilla = applyAction(base, { type: 'ACTIVATE_ASSET', assetId: 'villa' });
    const a = applyAction(withVilla, { type: 'NEXT_MONTH' });
    const b = applyAction(base, { type: 'NEXT_MONTH' });
    expect(a.assets!.markets.villa.indexHistory.length).toBe(2); // the market evolved
    expect(JSON.stringify(a.rng)).not.toBe(JSON.stringify(b.rng)); // 12 more draws consumed
    // replay parity with the activation inside the log
    const replayed = replay(base, [
      { type: 'ACTIVATE_ASSET', assetId: 'villa' },
      { type: 'NEXT_MONTH' },
    ]);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(a));
  });

  it('villa liquidates after the house in the fire-sale order', () => {
    expect(DEED_LIQUIDATION_ORDER).toEqual(['car', 'farm', 'house', 'villa']);
  });
});
