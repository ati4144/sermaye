import { describe, expect, it } from 'vitest';
import { applyAction, replay } from './actions';
import { createNewGame, healWorld, migrateState, SCHEMA_VERSION } from './create';
import { tick } from './sim';
import { createWorld, eventProb, REGIMES, REGIME_IDS } from './world';
import { WORLD_PACK, scenarioDef } from './worldpack';
import { countryDef } from './data/countries';
import { marketEvents } from './events/catalog';
import { nextFloat } from './rng';
import { makeGame, runMonths } from './test-utils';
import type { GameState } from './types';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

describe('world layer: schema & creation', () => {
  it('new games start with the world active at schema v8', () => {
    const s = makeGame(1);
    expect(SCHEMA_VERSION).toBe(8);
    expect(s.schemaVersion).toBe(8);
    expect(s.world).not.toBeNull();
    expect(s.world!.regime).toBe('growth');
    expect(s.world!.scenarioId).toBeNull();
    expect(s.world!.history).toEqual([{ id: 'growth', sinceTick: 0 }]);
  });

  it('migrateState stamps v3 saves inert: world, expenses, home, income and residency null, nothing else touched', () => {
    const s = makeGame(2);
    const v3 = clone(s);
    delete (v3 as Partial<typeof v3>).world;
    delete (v3 as Partial<typeof v3>).expenses;
    delete (v3 as Partial<typeof v3>).home;
    delete (v3 as Partial<typeof v3>).pendingSales;
    delete (v3 as Partial<typeof v3>).income;
    delete (v3 as Partial<typeof v3>).residency;
    (v3 as { schemaVersion: number }).schemaVersion = 3;
    const m = migrateState(v3);
    expect(m.schemaVersion).toBe(8);
    expect(m.world).toBeNull();
    expect(m.expenses).toBeNull(); // v4→v5 step: the flat formula keeps running
    expect(m.home).toBeNull(); // v5→v6 step: relief 0, no eve_cikma
    expect(m.pendingSales).toEqual([]);
    expect(m.income).toBeNull(); // v6→v7 step: no salary until INIT_INCOME
    expect(m.residency).toBeNull(); // v7→v8 step: cpi 1 until INIT_RESIDENCY
    expect(m.assets).toEqual(s.assets);
    expect(m.cash).toBe(s.cash);
  });

  it('createWorld merges the scenario agenda over the pack defaults', () => {
    const w = createWorld('stagflation_1973', 0);
    expect(w.regime).toBe('stagnation');
    expect(w.scenarioId).toBe('stagflation_1973');
    expect(w.agenda.inflation).toBe(1.0); // scenario override
    expect(w.agenda.ai_tech).toBe(WORLD_PACK.agenda.topics.ai_tech.weight); // pack default survives
  });

  it('createWorld throws on unknown scenarios', () => {
    expect(() => createWorld('made_up_1999', 0)).toThrow(/Unknown scenario/);
  });

  it('the pack ships all three documented scenarios with ordered beats', () => {
    for (const id of ['stagflation_1973', 'gfc_2008', 'japan_1990']) {
      const def = scenarioDef(id);
      expect(def.beats.length).toBeGreaterThan(1);
      for (let i = 1; i < def.beats.length; i++) {
        expect(def.beats[i].atTick).toBeGreaterThanOrEqual(def.beats[i - 1].atTick);
      }
    }
  });
});

describe('world layer: draw budget & parity', () => {
  it('a world-active tick consumes EXACTLY one extra float (drawn up front)', () => {
    const pre = makeGame(42);
    pre.world = null;
    const inert = clone(pre);
    const active = clone(pre);
    active.world = createWorld(null, 0);

    tick(inert);
    tick(active);

    // pre-consume one float from the same stream, then an inert tick: if the
    // world layer draws exactly one float at phase 0.9 and nothing else
    // changes its draw pattern, the streams end identical.
    const shadow = clone(pre);
    nextFloat(shadow.rng);
    tick(shadow);

    expect(shadow.rng).toEqual(active.rng);
  });

  // (world-null bit-parity itself is pinned by the '991e4659' v3 golden in
  // engine.test.ts, which hashes a 120-month world-null run's full state —
  // rng included — against a constant. A same-vs-same comparison here would
  // be tautological: determinism trivially guarantees it.)

  it('same seed → identical world evolution over 120 months', () => {
    const { final: a } = runMonths(makeGame(31337), 120);
    const { final: b } = runMonths(makeGame(31337), 120);
    expect(a.world).toEqual(b.world);
  });
});

describe('world layer: regimes & agenda', () => {
  it('every regime has multipliers and a well-formed transition table', () => {
    for (const id of ['growth', 'boom', 'crisis', 'stagnation'] as const) {
      const r = REGIMES[id];
      expect(r.driftMult).toBeGreaterThan(0);
      expect(r.volMult).toBeGreaterThan(0);
      expect(r.eventProbMult).toBeGreaterThan(0);
      const sum = Object.values(r.transitions).reduce((x, y) => x + y, 0);
      expect(sum).toBeLessThanOrEqual(1);
    }
    // growth is the identity regime
    expect(REGIMES.growth.driftMult).toBe(1);
    expect(REGIMES.growth.volMult).toBe(1);
    expect(REGIMES.growth.eventProbMult).toBe(1);
  });

  it('eventProb is identity with world null, tilted otherwise, clamped at 0.95', () => {
    const s = makeGame(5);
    s.world = null;
    expect(eventProb(s, 0.1, 'oil_shock')).toBe(0.1);

    s.world = createWorld('stagflation_1973', 0); // inflation + geopolitics hot
    const tilted = eventProb(s, 0.1, 'oil_shock');
    expect(tilted).toBeGreaterThan(0.1);
    expect(eventProb(s, 0.9, 'oil_shock')).toBeLessThanOrEqual(0.95);
  });

  it('regime history is capped at 24 entries (production evolveWorld, p=1 pinned)', () => {
    const saved = REGIME_IDS.map((id) => [id, clone(REGIMES[id].transitions)] as const);
    // p=1 cycle growth→boom→crisis→stagnation→growth: every tick transitions,
    // forcing 40 production transitions through evolveWorld's own cap code
    REGIMES.growth.transitions = { boom: 1 };
    REGIMES.boom.transitions = { crisis: 1 };
    REGIMES.crisis.transitions = { stagnation: 1 };
    REGIMES.stagnation.transitions = { growth: 1 };
    try {
      const s = makeGame(6);
      s.world = createWorld(null, 0);
      for (let i = 0; i < 40; i++) tick(s);
      expect(s.world!.history.length).toBe(24); // 1 initial + 40 pushes, capped
      expect(s.world!.regime).toBe('growth'); // 40 % 4 transitions → back to growth
      expect(s.eventLog.filter((e) => e.eventId === 'regime_change')).toHaveLength(40);
    } finally {
      for (const [id, table] of saved) REGIMES[id].transitions = table;
    }
  });
});

describe('world layer: organic regime evolution', () => {
  it('seed 31337 follows the growth→boom→growth→boom→growth arc (table-pinned)', () => {
    // table re-pinned for v6: the villa market joining phase 1b (+12
    // draws/month) shifts the shared stream, so the organic arc moved.
    // residency stripped pre-run for v8: the layer draws nothing, but its
    // indexed living costs can end this renter's run inside 120 months,
    // truncating the arc the table pins
    const s = makeGame(31337);
    s.residency = null;
    const { final } = runMonths(s, 120);
    expect(final.world!.history.map((h) => h.id)).toEqual(['growth', 'boom', 'growth', 'boom', 'growth']);
    const changes = final.eventLog.filter((e) => e.eventId === 'regime_change');
    expect(changes.map((c) => c.regimeId)).toEqual(['boom', 'growth', 'boom', 'growth']);
  });

  it('boom is entered AND exited organically (seed 2718)', () => {
    // seed re-picked for v6 (villa stream shift); 777's old arc moved on
    const { final } = runMonths(makeGame(2718), 120);
    const ids = final.world!.history.map((h) => h.id);
    const boomIdx = ids.indexOf('boom');
    expect(boomIdx).toBeGreaterThanOrEqual(0);
    expect(ids.slice(boomIdx + 1).length).toBeGreaterThan(0); // the run left boom
    expect(final.world!.history.length).toBeGreaterThanOrEqual(4);
  });

  it('regime multipliers reach the tick formula: crisis return = 1.8·growth − 1.3·drift', () => {
    // same seed → identical z draws (both worlds active → same regime float);
    // with no events fired in month one the relation is pure formula:
    // r_crisis = 0.5·d + 1.8·v·z and r_growth = d + v·z ⇒ r_c = 1.8·r_g − 1.3·d
    // (seed 5 is probe-picked: month one fires no events under either regime
    // AND no country return hits the ±0.35 clamp — the researched agenda
    // tilts probabilities, so most seeds break the pure-formula precondition;
    // re-picked for v6's villa stream shift)
    const growth = makeGame(5);
    const crisis = makeGame(5);
    crisis.world!.regime = 'crisis';
    tick(growth);
    tick(crisis);
    expect(growth.eventLog.length + crisis.eventLog.length).toBe(0); // pure-formula precondition
    for (const id of Object.keys(growth.countries)) {
      const rg = growth.countries[id].index / 100 - 1;
      const rc = crisis.countries[id].index / 100 - 1;
      const d = countryDef(id).baseDrift / 12;
      expect(rc).toBeCloseTo(1.8 * rg - 1.3 * d, 3);
    }
  });

  it('crisis tilts event probabilities up: more market events than growth over 240 months', () => {
    const saved = REGIME_IDS.map((id) => [id, clone(REGIMES[id].transitions)] as const);
    for (const id of REGIME_IDS) REGIMES[id].transitions = {}; // regimes frozen — pure prob comparison
    try {
      const marketIds = new Set(marketEvents().map((d) => d.id));
      const count = (s: GameState) => s.eventLog.filter((e) => marketIds.has(e.eventId)).length;
      const growth = makeGame(2718);
      const crisis = makeGame(2718);
      crisis.world!.regime = 'crisis';
      for (let i = 0; i < 240; i++) {
        tick(growth);
        tick(crisis);
      }
      expect(count(crisis)).toBeGreaterThan(count(growth)); // eventProbMult 1.35 vs 1.0
    } finally {
      for (const [id, table] of saved) REGIMES[id].transitions = table;
    }
  });
});

describe('world layer: scenario mode', () => {
  const scenarioGame = (seed: number, scenarioId: string): GameState =>
    createNewGame({ seed, name: 'Test', scenarioId });

  it('the atTick-0 opening beat fires at creation — month one shows exactly one headline', () => {
    const s = scenarioGame(12345, 'gfc_2008');
    const opening = s.eventLog.filter((e) => e.eventId === 'world_news');
    expect(opening).toHaveLength(1);
    expect(opening[0].tick).toBe(0); // the game-start month, per the pack's contract
    expect(opening[0].newsId).toBe('gfc_2008:0');
    expect(opening[0].netWorth).toBeGreaterThan(0); // filled at creation, not left at 0
    expect(s.world!.beatCursor).toBe(1);

    const { final } = runMonths(clone(s), 1);
    const news = final.eventLog.filter((e) => e.eventId === 'world_news');
    expect(news.map((n) => [n.tick, n.newsId])).toEqual([
      [0, 'gfc_2008:0'],
      [1, 'gfc_2008:1'], // exactly one beat per month — no double-fire on month one
    ]);
  });

  it('a scenario id the pack no longer knows parks the beats — the save never locks', () => {
    const forged = scenarioGame(11, 'gfc_2008');
    forged.world!.scenarioId = 'retired_1999';
    const { final } = runMonths(forged, 8); // NEXT_MONTH must never throw here
    expect(final.world!.beatCursor).toBe(1); // opening beat only; timeline parked
    expect(final.world!.regime).toBe('crisis'); // the scenario's starting regime persists
    expect(final.eventLog.filter((e) => e.eventId === 'world_news')).toHaveLength(1);
  });

  it('GFC beats flip the regime on schedule and log headlines exactly once', () => {
    const { final } = runMonths(scenarioGame(12345, 'gfc_2008'), 16);
    const w = final.world!;
    expect(w.scenarioId).toBe('gfc_2008');
    expect(w.beatCursor).toBe(4); // all beats consumed
    // scripted arc: crisis from creation → stagnation (tick 6) → growth (tick 15)
    const regimeChanges = final.eventLog.filter((e) => e.eventId === 'regime_change');
    expect(regimeChanges.length).toBeGreaterThanOrEqual(2);
    const news = final.eventLog.filter((e) => e.eventId === 'world_news');
    expect(news.map((n) => n.newsId)).toEqual([
      'gfc_2008:0',
      'gfc_2008:1',
      'gfc_2008:2',
      'gfc_2008:3',
    ]);
    expect(final.world!.regime).toBe('growth'); // the scripted recovery
  });

  it('scenario runs replay bit-for-bit from the action log', () => {
    const initial = scenarioGame(777, 'japan_1990');
    const { final, actions } = runMonths(clone(initial), 14);
    const replayed = replay(initial, actions);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(final));
  });

  it('scenario beats beyond the timeline never fire (cursor parks at the end)', () => {
    const { final } = runMonths(scenarioGame(777, 'japan_1990'), 80);
    expect(final.world!.beatCursor).toBe(scenarioDef('japan_1990').beats.length);
    const news = final.eventLog.filter((e) => e.eventId === 'world_news');
    expect(news.length).toBe(scenarioDef('japan_1990').beats.filter((b) => b.news !== undefined).length);
  });
});

describe('world layer: INIT_WORLD', () => {
  it('activates on a legacy run with zero draws and logs world_init', () => {
    const v3 = makeGame(7);
    v3.world = null;
    v3.home = null; // a real v3 save has no Yuva layer
    v3.schemaVersion = 3;
    const rngBefore = clone(v3.rng);

    const s = applyAction(v3, { type: 'INIT_WORLD' });
    expect(s.world).not.toBeNull();
    expect(s.world!.regime).toBe('growth');
    expect(s.world!.scenarioId).toBeNull();
    expect(s.rng).toEqual(rngBefore); // zero draws — the stream is untouched
    expect(s.eventLog.some((e) => e.eventId === 'world_init')).toBe(true);
    expect(s.actionLog[s.actionLog.length - 1].action.type).toBe('INIT_WORLD');
  });

  it('throws WORLD_ACTIVE when the layer already runs', () => {
    const s = makeGame(8);
    expect(() => applyAction(s, { type: 'INIT_WORLD' })).toThrow('WORLD_ACTIVE');
  });

  it('INIT_WORLD replay is stable (idempotent in the log, not in effect)', () => {
    const v3 = makeGame(9);
    v3.world = null;
    const activated = applyAction(v3, { type: 'INIT_WORLD' });
    // replaying the same single action over the v3 state reproduces it
    const again = replay(v3, [{ type: 'INIT_WORLD' }]);
    expect(JSON.stringify(again)).toBe(JSON.stringify(activated));
  });
});

describe('world layer: healWorld (store boundary)', () => {
  it('returns the same reference for a healthy world', () => {
    const s = runMonths(makeGame(21), 30).final; // real transitions, real history
    expect(healWorld(s)).toBe(s);
  });

  it('degrades an unknown scenario to scenario-less and clamps the cursor', () => {
    const s = makeGame(22);
    s.world!.scenarioId = 'renamed_away';
    s.world!.beatCursor = 3;
    const healed = healWorld(s);
    expect(healed.world!.scenarioId).toBeNull();
    expect(healed.world!.beatCursor).toBe(0);
    expect(healed.world!.regime).toBe('growth'); // the live regime is untouched
  });

  it('retires the arc when the cursor is garbage — consumed beats never replay', () => {
    // a float/negative cursor is a corrupt envelope; resetting it to 0 would
    // dump every backdated headline and regime flip into one tick, so a known
    // scenario with a garbage cursor parks at the end of its timeline instead
    const s = makeGame(25);
    s.world!.scenarioId = 'gfc_2008';
    s.world!.beatCursor = 2.5;
    const healed = healWorld(s);
    expect(healed.world!.scenarioId).toBe('gfc_2008'); // the scenario itself stays
    expect(healed.world!.beatCursor).toBe(scenarioDef('gfc_2008').beats.length); // retired
    expect(healed.world!.regime).toBe('growth'); // organic evolution resumes
  });

  it('rebuilds a corrupt world shape from a fresh baseline without mutating the input', () => {
    const broken = makeGame(23);
    const raw = broken.world as unknown as Record<string, unknown>;
    raw.regime = 'typo';
    raw.regimeSinceTick = 999_999;
    raw.history = 'nope';
    raw.agenda = undefined;
    raw.scenarioId = 7;
    raw.beatCursor = -2;
    const healed = healWorld(broken);
    const w = healed.world!;
    expect(w.regime).toBe('growth');
    expect(w.regimeSinceTick).toBe(broken.tick);
    expect(w.history.length).toBeGreaterThan(0);
    expect(w.agenda.inflation).toBe(WORLD_PACK.agenda.topics.inflation.weight); // pack agenda restored
    expect(w.scenarioId).toBeNull();
    expect(w.beatCursor).toBe(0);
    // the original corrupt object is never mutated
    expect((broken.world as unknown as Record<string, unknown>).regime).toBe('typo');
  });

  it('fills agenda topics a newer pack added to an older save', () => {
    const older = clone(makeGame(24));
    delete older.world!.agenda.energy;
    const healed = healWorld(older);
    expect(healed.world!.agenda.energy).toBe(WORLD_PACK.agenda.topics.energy.weight);
    expect(healed.world!.agenda.inflation).toBe(older.world!.agenda.inflation); // saved values win
  });
});
