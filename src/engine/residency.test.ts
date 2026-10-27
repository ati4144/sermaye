import { describe, expect, it } from 'vitest';
import { applyAction, replay } from './actions';
import { balance } from './balance';
import { createNewGame, createResidency, healResidency, migrateState } from './create';
import { performInheritance } from './life';
import { assetDriftVol, netWorth, roundCash } from './market';
import {
  annualCpiRate,
  basketMult,
  basketMultFor,
  COUNTRY_BASKET,
  cpiMult,
  evolveResidency,
  HOME_INFLATION,
  inflationM,
  livingClampFor,
  REGIME_TILT,
} from './residency';
import { tick } from './sim';
import { makeGame, runMonths } from './test-utils';
import { COUNTRY_IDS } from './data/countries';
import { ASSET_IDS } from './data/assets';
import { WORLD_PACK } from './worldpack';
import type { EngineAction, GameState } from './types';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** hand-strip a fresh game to the v7 shape (no residency field ever existed) */
function v7Game(seed: number): GameState {
  const v7 = clone(makeGame(seed)) as GameState;
  delete (v7 as Partial<GameState>).residency;
  v7.schemaVersion = 7;
  return v7;
}

/** a fate-neutral fresh game and its residency-null twin — pure-formula runs */
function twin(seed: number, countryId = 'us'): { inert: GameState; active: GameState } {
  const s = makeGame(seed);
  s.fate = null; // neutral living-cost/fee mods — exact catalog constants
  const inert = clone(s);
  inert.residency = null;
  s.residency = { countryId, cpi: 100, sinceTick: 0 };
  return { inert, active: s };
}

describe('residency layer: schema & creation', () => {
  it('new games carry the layer ACTIVE from creation, keyed LAST at schema 8', () => {
    const s = makeGame(1);
    expect(s.schemaVersion).toBe(8);
    expect(s.residency).toEqual({ countryId: 'us', cpi: 100, sinceTick: 0 });
    const keys = Object.keys(s);
    expect(keys[keys.length - 2]).toBe('income'); // FNV key order: income then residency
    expect(keys[keys.length - 1]).toBe('residency');
  });

  it('createNewGame takes the homeCountryId option', () => {
    const tr = createNewGame({ seed: 3, name: 'T', homeCountryId: 'tr' });
    expect(tr.residency).toEqual({ countryId: 'tr', cpi: 100, sinceTick: 0 });
    const jp = createNewGame({ seed: 3, name: 'T', homeCountryId: 'jp' });
    expect(jp.residency!.countryId).toBe('jp');
  });

  it('invalid homeCountryId values fall back to us', () => {
    for (const bad of ['xx', '', null, undefined]) {
      expect(createResidency(bad as string | null | undefined)).toEqual({ countryId: 'us', cpi: 100, sinceTick: 0 });
    }
  });

  it('migrateState stamps v7 saves inert: residency null, replay bit-for-bit, never self-activates', () => {
    const v7 = v7Game(9);
    const m = migrateState(v7);
    expect(m.schemaVersion).toBe(8);
    expect(m.residency).toBeNull(); // cpi 1 — every inert path is bit-identical pre-v8
    const v7Plus = { ...clone(v7), schemaVersion: 8, residency: null }; // key order = migrateState's
    expect(JSON.stringify(m)).toBe(JSON.stringify(v7Plus));

    const { final, actions } = runMonths(v7, 24);
    expect(JSON.stringify(replay(v7, actions))).toBe(JSON.stringify(final));
    expect(final.residency).toBeNull(); // the layer never self-activates
  });

  it('HOME_INFLATION covers exactly the catalog countries', () => {
    expect(Object.keys(HOME_INFLATION).sort()).toEqual([...COUNTRY_IDS].sort());
  });

  it('REGIME_TILT covers all four regimes with positive multipliers', () => {
    for (const id of ['growth', 'boom', 'crisis', 'stagnation'] as const) {
      expect(REGIME_TILT[id]).toBeGreaterThan(0);
    }
    expect(REGIME_TILT.growth).toBe(1); // identity regime — the default arc
  });
});

describe('residency layer: CPI math', () => {
  it('catalog rate: us × growth = .025/yr, monthly = /12', () => {
    const s = makeGame(2); // world active, growth, no scenario
    expect(annualCpiRate(s)).toBe(0.025);
    expect(inflationM(s)).toBe(0.025 / 12);
  });

  it('regime tilt multiplies CATALOG rates only; world-null runs tilt-free', () => {
    const s = makeGame(3);
    s.world!.regime = 'boom';
    expect(annualCpiRate(s)).toBeCloseTo(0.025 * 1.2, 15);
    s.world!.regime = 'crisis';
    expect(annualCpiRate(s)).toBeCloseTo(0.025 * 1.25, 15);
    const noWorld = makeGame(4);
    noWorld.world = null;
    expect(annualCpiRate(noWorld)).toBe(0.025); // tilt 1 without a world
  });

  it('residency null → rate 0 everywhere (the inert contract)', () => {
    const s = makeGame(5);
    s.residency = null;
    expect(annualCpiRate(s)).toBe(0);
    expect(inflationM(s)).toBe(0);
    expect(cpiMult(s)).toBe(1);
    const before = clone(s);
    evolveResidency(s);
    expect(s).toEqual(before); // no-op, no draws, no mutation
  });

  it('scenario overrides apply while the arc is live, WITHOUT regime tilt', () => {
    const s = makeGame(6);
    s.world!.scenarioId = 'stagflation_1973';
    s.world!.beatCursor = 0; // arc window open
    expect(annualCpiRate(s)).toBeCloseTo(0.065, 15); // authored era data beats the tilt
    s.world!.regime = 'boom';
    expect(annualCpiRate(s)).toBeCloseTo(0.065, 15); // still no tilt on overrides
  });

  it('the arc window closes: post-beat the catalog rate returns (Volcker, post-lost-decade)', () => {
    const s = makeGame(7);
    s.world!.scenarioId = 'stagflation_1973';
    const def = WORLD_PACK.scenarios.find((d) => d.id === 'stagflation_1973')!;
    s.world!.beatCursor = def.beats.length; // window closed — same gate world.ts uses
    expect(annualCpiRate(s)).toBeCloseTo(0.025, 15); // us catalog × growth tilt 1
  });

  it('an unknown country in the table falls to 0 (defensive — heal retires those)', () => {
    const s = makeGame(8);
    s.world = null;
    (s.residency as unknown as { countryId: string }).countryId = 'xx';
    expect(annualCpiRate(s)).toBe(0);
  });

  it('evolveResidency compounds with round4 and skips the inert path', () => {
    const s = makeGame(9);
    s.world = null; // pure catalog rate, no tilt
    s.residency = { countryId: 'tr', cpi: 100, sinceTick: 0 };
    evolveResidency(s);
    expect(s.residency!.cpi).toBe(103.3333); // round4(100 × (1 + .4/12))
    evolveResidency(s);
    expect(s.residency!.cpi).toBe(106.7777); // round4 compounds on the rounded value
    expect(cpiMult(s)).toBeCloseTo(1.067777, 6);
  });
});

describe('residency layer: zero-draw & parity contracts', () => {
  it('one tick, zero draws: markets already differ, equity indexes do not', () => {
    // month one of this seed fires no events, so the streams are directly
    // comparable: the layer itself must consume nothing while its effects
    // are already visible in the asset markets (but never in countries).
    const { inert, active } = twin(31337);
    tick(inert);
    tick(active);
    expect(JSON.stringify(active.rng)).toBe(JSON.stringify(inert.rng)); // ZERO draws
    expect(active.countries).toEqual(inert.countries); // country equity indexes are CPI-free (locked scope)
    expect(JSON.stringify(active.assets)).not.toBe(JSON.stringify(inert.assets)); // asset prices ride the drift add-on
  });

  it('120 months, zero draws — with the asset-event confounder stripped', () => {
    // a full-run rng comparison needs the assets layer OFF: inflated asset
    // indexes legitimately change EVENT CONDITIONS (konut_cokusu's >150 index
    // gate), and a differently-fired event consumes different follow-up
    // draws. That divergence is the feature working, not a draw — so the
    // zero-draw fence strips the confounder and pins the stream equality.
    const { inert, active } = twin(31337);
    for (const s of [inert, active]) s.assets = null;
    const a = runMonths(active, 120).final;
    const b = runMonths(inert, 120).final;
    expect(JSON.stringify(a.rng)).toBe(JSON.stringify(b.rng)); // ZERO draws, 120 months
    expect(a.countries).toEqual(b.countries);
  });

  it('assetDriftVol: ΔdriftM === inflationM on every asset, volM untouched', () => {
    const { inert, active } = twin(42);
    for (const id of ASSET_IDS) {
      const withR = assetDriftVol(active, id);
      const withoutR = assetDriftVol(inert, id);
      expect(withR.driftM - withoutR.driftM).toBeCloseTo(inflationM(active), 12);
      expect(withR.volM).toBe(withoutR.volM);
    }
  });

  it('living parity (one tick): the basket indexes, the wealth levy does NOT', () => {
    // itemsSum 300 (standard preset = LIVING.BASE), worth 100k cash → the
    // levy term (400) dominates the floor, so this pins BOTH halves at once:
    // items gain exactly the CPI share while the levy stays bit-equal — the
    // no-double-count rule (the levy base self-indexes via asset prices).
    const { inert, active } = twin(10);
    tick(inert);
    tick(active);
    const iF = inert.expenses!.flow[0];
    const aF = active.expenses!.flow[0];
    expect(iF.items).toBe(300);
    expect(aF.items).toBe(300.62); // roundCash(300 × 1.002083)
    expect(aF.wealthLevy).toBe(iF.wealthLevy); // NOT indexed
    expect(inert.cash - active.cash).toBeCloseTo(0.62, 8); // fp dust accrues; the flow row is the exact ledger
  });

  it('an empty basket charges nothing for items — the levy scales by the country basket (v8.1)', () => {
    const { inert, active } = twin(11, 'tr'); // 40%/yr, price level 0.4× US
    for (const s of [inert, active]) s.expenses!.items = [];
    tick(inert);
    tick(active);
    expect(active.expenses!.flow[0].items).toBe(0); // 0 × any cpi × any basket
    // the wealth term is a LOCAL consumption standard: it scales by the PPP
    // basket (a tr player's luxury at the same net worth costs 0.4×)
    expect(active.expenses!.flow[0].wealthLevy).toBeCloseTo(inert.expenses!.flow[0].wealthLevy * 0.4, 8);
    // the month now legitimately differs — by exactly the PPP levy gap
    // (the ledger rows carry the exact numbers: worth includes this month's
    // salary credit, so the levy is 406 vs 162.4, a 243.6 tr saving)
    expect(inert.cash - active.cash).toBeCloseTo(
      active.expenses!.flow[0].wealthLevy - inert.expenses!.flow[0].wealthLevy,
      8,
    );
  });

  it('the MAX ceiling scales with the CPI and the country basket', () => {
    const orig = { ...balance.LIVING };
    try {
      balance.LIVING.MAX = 400; // small enough for a fresh game's levy to hit it
      const { inert, active } = twin(12, 'tr');
      tick(inert);
      tick(active);
      const iTotal = inert.expenses!.flow[0].items + inert.expenses!.flow[0].wealthLevy;
      const aTotal = active.expenses!.flow[0].items + active.expenses!.flow[0].wealthLevy;
      expect(iTotal).toBe(400); // min(400, max(300, 700)) — the cap binds
      // the cap scaled by cpi AND the 0.4× tr basket after one month
      expect(aTotal).toBeCloseTo(400 * 1.033333 * 0.4, 1);
    } finally {
      Object.assign(balance.LIVING, orig);
    }
  });

  it('the bankruptcy threshold scales with the country basket (v8.1)', () => {
    // same CPI, different price level: a ~$7.2k post-tick worth is POOR in
    // the US (10k line) but comfortable in Türkiye (10k × 0.4 = 4k line)
    const usa = makeGame(13);
    usa.fate = null;
    usa.cash = 6_000;
    usa.residency = { countryId: 'us', cpi: 100, sinceTick: 0 };
    const tur = clone(usa);
    tur.residency = { countryId: 'tr', cpi: 100, sinceTick: 0 };
    tick(usa);
    tick(tur);
    expect(usa.lowWealthStreak).toBe(1); // worth ≈ 7.2k < 10k → streak
    expect(tur.lowWealthStreak).toBe(0); // same worth ≥ 4k → safe
  });

  it('the bankruptcy threshold scales with the CPI', () => {
    // same country, different index: cpi 130 lifts the tr line to 5.2k before
    // the tick compounds it further; cpi 100's line is ~4k
    const hot = makeGame(14);
    hot.fate = null;
    hot.cash = 3_800;
    hot.residency = { countryId: 'tr', cpi: 130, sinceTick: 0 };
    const cold = clone(hot);
    cold.residency = { countryId: 'tr', cpi: 100, sinceTick: 0 };
    tick(hot);
    tick(cold);
    expect(hot.lowWealthStreak).toBe(1); // worth ≈ 5.2k under the compounded ~5.37k line → streak
    expect(cold.lowWealthStreak).toBe(0); // same worth above the ~4.13k line → safe
  });
});

describe('residency layer: purchasing-power parity (v8.1)', () => {
  it('the basket catalog covers every country, values are (0,1], us is the 1.0 anchor', () => {
    expect(Object.keys(COUNTRY_BASKET).sort()).toEqual([...COUNTRY_IDS].sort());
    for (const id of COUNTRY_IDS) {
      const v = COUNTRY_BASKET[id];
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(COUNTRY_BASKET.us).toBe(1);
  });

  it('basketMult: null → 1, us → 1, tr → 0.4; basketMultFor tolerates junk', () => {
    const { inert, active } = twin(15, 'tr');
    expect(basketMult(inert)).toBe(1);
    expect(basketMult({ ...inert, residency: { countryId: 'us', cpi: 100, sinceTick: 0 } })).toBe(1);
    expect(basketMult(active)).toBe(0.4);
    expect(basketMultFor(null)).toBe(1);
    expect(basketMultFor(undefined)).toBe(1);
    expect(basketMultFor('narnia')).toBe(1);
    expect(basketMultFor('tr')).toBe(0.4);
  });

  it('livingClampFor: one PPP knob on the way out — the whole clamp scales', () => {
    const { inert, active } = twin(16, 'tr');
    const a = livingClampFor(active, 300, 100_000);
    const i = livingClampFor(inert, 300, 100_000);
    expect(a).toBeCloseTo(i * 0.4, 8); // floor, wealth term AND the cap together
  });

  it('the default salary buys the same life everywhere; a typed salary enters unscaled', () => {
    const tr = createNewGame({ seed: 17, name: 'T', homeCountryId: 'tr' });
    expect(tr.income!.salaryM).toBe(600); // 1500 × 0.4
    const usa = createNewGame({ seed: 17, name: 'U', homeCountryId: 'us' });
    expect(usa.income!.salaryM).toBe(1500);
    const typed = createNewGame({ seed: 17, name: 'X', salaryM: 2_000, homeCountryId: 'tr' });
    expect(typed.income!.salaryM).toBe(2_000); // the player's own number, FX-path
    const legacy = makeGame(18);
    legacy.fate = null;
    legacy.income = null;
    legacy.residency = { countryId: 'tr', cpi: 100, sinceTick: 0 };
    const reinit = applyAction(legacy, { type: 'INIT_INCOME', salaryM: undefined });
    expect(reinit.income!.salaryM).toBe(600); // INIT default follows the save's basket
  });
});

describe('residency layer: INIT_RESIDENCY', () => {
  it('activates the layer with exact shape and logs the anchor event', () => {
    const legacy = makeGame(21);
    legacy.residency = null;
    const s = applyAction(legacy, { type: 'INIT_RESIDENCY', countryId: 'tr' });
    expect(s.residency).toEqual({ countryId: 'tr', cpi: 100, sinceTick: 0 });
    const entry = s.eventLog[s.eventLog.length - 1];
    expect(entry.eventId).toBe('residency_init');
    expect(entry.uid).toBe(`${entry.tick}:residency_init`);
    expect(entry.countryId).toBe('tr'); // the interpolation slot
    expect(entry.generation).toBe(s.player.generation);
    expect(entry.netWorth).toBe(roundCash(netWorth(s)));
  });

  it('guards: double INIT throws, unknown countries throw on the BUY-path convention', () => {
    const s = makeGame(22);
    expect(() => applyAction(s, { type: 'INIT_RESIDENCY', countryId: 'tr' })).toThrow('RESIDENCY_ACTIVE');
    const legacy = makeGame(23);
    legacy.residency = null;
    expect(() => applyAction(legacy, { type: 'INIT_RESIDENCY', countryId: 'xx' })).toThrow(/Unknown country/);
  });

  it('a mid-run INIT re-bases at cpi 100 this tick and replays bit-for-bit', () => {
    const base = makeGame(77);
    base.residency = null; // a migrated pre-v8 save, played for a while first
    const pre = runMonths(base, 6);
    const initAt = pre.final.tick;
    const after = applyAction(pre.final, { type: 'INIT_RESIDENCY', countryId: 'tr' });
    expect(after.residency).toEqual({ countryId: 'tr', cpi: 100, sinceTick: initAt }); // the past is not retro-charged
    const post = runMonths(after, 6);
    const actions: EngineAction[] = [...pre.actions, { type: 'INIT_RESIDENCY', countryId: 'tr' }, ...post.actions];
    expect(JSON.stringify(replay(base, actions))).toBe(JSON.stringify(post.final));
    expect(post.final.residency!.cpi).toBeGreaterThan(100); // and it compounds from there
  });
});

describe('residency layer: healResidency (store boundary)', () => {
  it('returns the same reference for a healthy layer (cheap hydration)', () => {
    const s = makeGame(31);
    expect(healResidency(s)).toBe(s);
    const legacy = makeGame(32);
    legacy.residency = null;
    expect(healResidency(legacy)).toBe(legacy);
  });

  it('retires an unknown country to null — the banner re-asks', () => {
    const s = makeGame(33);
    s.residency!.countryId = 'xx';
    const healed = healResidency(s);
    expect(healed.residency).toBeNull();
  });

  it('resets a malformed CPI index to 100, rounding healthy ones', () => {
    for (const bad of [NaN, -5, 0, Infinity, '12' as unknown as number]) {
      const s = makeGame(34);
      s.residency!.cpi = bad;
      expect(healResidency(s).residency!.cpi).toBe(100);
    }
    const s = makeGame(35);
    s.residency!.cpi = 148.12345;
    expect(healResidency(s).residency!.cpi).toBe(148.1235); // round4
  });

  it('clamps a future sinceTick to the save tick, heals junk to the save tick', () => {
    const s = makeGame(36);
    expect(s.tick).toBe(0);
    s.residency!.sinceTick = 99;
    expect(healResidency(s).residency!.sinceTick).toBe(0);
    const junk = makeGame(37);
    junk.residency!.sinceTick = -4;
    expect(healResidency(junk).residency!.sinceTick).toBe(junk.tick);
  });
});

describe('residency layer: dynasty', () => {
  it('inheritance preserves the residency byte-for-byte — vatan is the family’s, not the player’s', () => {
    const s = makeGame(41);
    s.player.children = [{ id: 'c1', birthTick: -240, alive: true }];
    const before = JSON.stringify(s.residency);
    const cpiBefore = s.residency!.cpi;
    performInheritance(s);
    expect(JSON.stringify(s.residency)).toBe(before); // the handover never touches it
    const run = runMonths(s, 12);
    expect(run.final.residency!.cpi).toBeGreaterThan(cpiBefore); // and it keeps compounding for the heir
  });
});
