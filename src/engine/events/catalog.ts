import type { EventDef } from '../types';
import { FATE_EVENT_DEFS } from '../fate/defs';

/**
 * Event catalog. MARKET events are triggered by the phase-2 loop (draw-then-
 * decide, fixed catalog order). LIFE events are enqueued directly by life.ts;
 * FATE events by fate/tick.ts. Their definitions exist so ACK/RESOLVE
 * handling and the i18n layer can look them up by id.
 *
 * All copy lives in locale files (events.<id>.title/.text/.options.<n>) — the
 * engine deals in ids and numbers only.
 */
export const EVENT_CATALOG: EventDef[] = [
  // ---------- country events: crises ----------
  {
    id: 'crisis_c',
    scope: 'COUNTRY',
    appliesTo: 'C',
    p: 0.012,
    cooldown: 24,
    effects: [{ target: 'SELF', indexShock: 0.78, driftDelta: -0.008, volDelta: 0.01, duration: 8 }],
  },
  {
    id: 'crisis_b',
    scope: 'COUNTRY',
    appliesTo: 'B',
    p: 0.006,
    cooldown: 30,
    effects: [{ target: 'SELF', indexShock: 0.85, driftDelta: -0.005, volDelta: 0.006, duration: 5 }],
  },
  {
    id: 'currency_collapse',
    scope: 'COUNTRY',
    appliesTo: 'C',
    p: 0.005,
    cooldown: 48,
    effects: [{ target: 'SELF', indexShock: 0.7, driftDelta: -0.01, volDelta: 0.012, duration: 10 }],
  },
  {
    id: 'political_unrest',
    scope: 'COUNTRY',
    appliesTo: 'C',
    p: 0.008,
    cooldown: 36,
    effects: [{ target: 'SELF', indexShock: 0.88, driftDelta: -0.004, volDelta: 0.008, duration: 6 }],
  },

  // ---------- country events: booms ----------
  {
    id: 'boom_a',
    scope: 'COUNTRY',
    appliesTo: 'A',
    p: 0.01,
    cooldown: 36,
    effects: [{ target: 'SELF', indexShock: 1.12, driftDelta: 0.006, duration: 6 }],
  },
  {
    id: 'boom_b',
    scope: 'COUNTRY',
    appliesTo: 'B',
    p: 0.008,
    cooldown: 36,
    effects: [{ target: 'SELF', indexShock: 1.15, driftDelta: 0.007, duration: 6 }],
  },
  {
    id: 'discovery_boom',
    scope: 'COUNTRY',
    appliesTo: 'C',
    p: 0.006,
    cooldown: 48,
    effects: [{ target: 'SELF', indexShock: 1.22, driftDelta: 0.009, duration: 8 }],
  },
  {
    id: 'tech_boom_us',
    scope: 'COUNTRY',
    appliesTo: 'us',
    p: 0.005,
    cooldown: 60,
    effects: [{ target: 'SELF', indexShock: 1.18, driftDelta: 0.008, duration: 8 }],
  },

  // ---------- country events: choices ----------
  {
    id: 'election_year',
    scope: 'COUNTRY',
    p: 0.004,
    cooldown: 48,
    // fires for any country
    effects: [{ target: 'SELF', indexShock: 0.95, volDelta: 0.006, duration: 4 }],
    options: [
      { effects: [{ target: 'SELF', indexShock: 0.95, volDelta: 0.006, duration: 4 }] }, // let it play out
      { effects: [], cashCost: 2_000 }, // pay advisors: dodge volatility, no shock
    ],
  },
  {
    id: 'bailout_offer',
    scope: 'COUNTRY',
    appliesTo: 'C',
    p: 0.004,
    cooldown: 48,
    effects: [{ target: 'SELF', indexShock: 0.82, driftDelta: -0.006, duration: 6 }],
    options: [
      { effects: [{ target: 'SELF', indexShock: 0.82, driftDelta: -0.006, duration: 6 }] }, // accept the crash
      { effects: [{ target: 'SELF', indexShock: 0.93 }], costPctNetWorth: 0.02 }, // buy political cover
    ],
  },

  // ---------- global events ----------
  {
    id: 'global_recession',
    scope: 'GLOBAL',
    p: 0.005,
    cooldown: 60,
    // gold rows are data lines, not code: explicit asset targets resolve on
    // asset markets and are skipped on legacy runs (assets: null)
    effects: [
      { target: 'GLOBAL', indexShock: 0.9, driftDelta: -0.005, volDelta: 0.005, duration: 9 },
      { target: 'gold', indexShock: 1.04, driftDelta: 0.003, duration: 9 },
    ],
  },
  {
    id: 'oil_shock',
    scope: 'GLOBAL',
    p: 0.006,
    cooldown: 60,
    effects: [
      { target: 'GLOBAL', indexShock: 0.93, driftDelta: -0.004, volDelta: 0.006, duration: 10 },
      { target: 'farm', driftDelta: 0.002, duration: 6 },
    ],
  },
  {
    id: 'rate_hike_cycle',
    scope: 'GLOBAL',
    p: 0.007,
    cooldown: 48,
    effects: [
      { target: 'GLOBAL', driftDelta: -0.004, volDelta: 0.004, duration: 8 },
      { target: 'gold', indexShock: 0.97 },
    ],
  },
  {
    id: 'global_boom',
    scope: 'GLOBAL',
    p: 0.006,
    cooldown: 48,
    effects: [{ target: 'GLOBAL', indexShock: 1.08, driftDelta: 0.005, duration: 6 }],
  },
  {
    id: 'pandemic',
    scope: 'GLOBAL',
    p: 0.002,
    cooldown: 96,
    minTick: 36,
    effects: [{ target: 'GLOBAL', indexShock: 0.88, driftDelta: -0.006, duration: 8 }],
    options: [
      { effects: [{ target: 'GLOBAL', indexShock: 0.88, driftDelta: -0.006, duration: 8 }] }, // ride it out
      { effects: [{ target: 'GLOBAL', indexShock: 0.95 }], costPctNetWorth: 0.03 }, // hedge early
    ],
  },

  // ---------- asset events (phase 2b — only when the asset layer is active) ----------
  {
    id: 'kuraklik',
    scope: 'ASSET',
    appliesTo: 'farm',
    p: 0.006,
    cooldown: 24,
    effects: [{ target: 'SELF', indexShock: 0.92, yieldDelta: -0.0035, duration: 3 }],
  },
  {
    id: 'konut_baloni',
    scope: 'ASSET',
    appliesTo: 'house',
    p: 0.004,
    cooldown: 60,
    effects: [{ target: 'SELF', indexShock: 1.15, driftDelta: 0.008, duration: 6 }],
  },
  {
    id: 'konut_cokusu',
    scope: 'ASSET',
    appliesTo: 'house',
    p: 0.01,
    cooldown: 60,
    condition: (s) => !!s.assets && s.assets.markets.house.index > 150,
    effects: [{ target: 'SELF', indexShock: 0.78, liqDelta: 0.03, duration: 3 }],
  },
  {
    id: 'mezat_yukselisi',
    scope: 'ASSET',
    appliesTo: 'car',
    p: 0.004,
    cooldown: 48,
    effects: [{ target: 'SELF', indexShock: 1.15 }],
  },

  // ---------- life events (enqueued by life.ts, never by the market loop) ----------
  {
    id: 'illness_mild',
    scope: 'GLOBAL',
    trigger: 'LIFE',
    p: 1,
    cooldown: 0,
    effects: [],
    options: [
      { effects: [], costPctNetWorth: 0.01 }, // see a doctor
      { effects: [], healthDelta: -8 }, // tough it out
    ],
  },
  {
    id: 'illness_moderate',
    scope: 'GLOBAL',
    trigger: 'LIFE',
    p: 1,
    cooldown: 0,
    effects: [],
    options: [
      { effects: [], costPctNetWorth: 0.04, healthDelta: -2 }, // best treatment
      { effects: [], costPctNetWorth: 0.01, healthDelta: -15 }, // cheap treatment
      { effects: [], healthDelta: -25 }, // refuse treatment
    ],
  },
  {
    id: 'illness_severe',
    scope: 'GLOBAL',
    trigger: 'LIFE',
    p: 1,
    cooldown: 0,
    effects: [],
    options: [
      { effects: [], costPctNetWorth: 0.12, healthDelta: -10 }, // fight hard
      { effects: [], costPctNetWorth: 0.04, healthDelta: -30 }, // limited options
      { effects: [], healthDelta: -45 }, // no treatment
    ],
  },
  {
    id: 'marriage',
    scope: 'GLOBAL',
    trigger: 'LIFE',
    p: 1,
    cooldown: 0,
    effects: [],
    options: [
      { effects: [], setMarried: true }, // say yes
      { effects: [] }, // stay single
    ],
  },
  {
    id: 'child_born',
    scope: 'GLOBAL',
    trigger: 'LIFE',
    p: 1,
    cooldown: 0,
    effects: [],
  },
  {
    id: 'spouse_death',
    scope: 'GLOBAL',
    trigger: 'LIFE',
    p: 1,
    cooldown: 0,
    effects: [],
  },
  {
    id: 'child_death',
    scope: 'GLOBAL',
    trigger: 'LIFE',
    p: 1,
    cooldown: 0,
    effects: [{ target: 'SELF', indexShock: 1 }], // placeholder; emotional only
  },
  {
    id: 'death',
    scope: 'GLOBAL',
    trigger: 'LIFE',
    p: 1,
    cooldown: 0,
    effects: [],
  },
  {
    // v6 — ACK notice enqueued by liquidateToRaise when the fire-sale ladder
    // touched assets (L1/L3). Never enters the market draw loop.
    id: 'forced_sale',
    scope: 'GLOBAL',
    trigger: 'LIFE',
    p: 1,
    cooldown: 0,
    effects: [],
  },
  {
    // v6 — the 6th month after a wedding (life.ts, home-gated). Opt0 moves the
    // couple out; the family sends the wedding gold (beşibirlik) along.
    id: 'eve_cikma',
    scope: 'GLOBAL',
    trigger: 'LIFE',
    p: 1,
    cooldown: 0,
    effects: [],
    options: [
      { effects: [], grantAsset: { assetId: 'gold', units: 5 } }, // taşın, altını al
      { effects: [] }, // biraz daha aile ile kal
    ],
  },
  {
    // v7 — ACK notice enqueued by sim.ts phase 3.5 when chronic health collapse
    // (below JOB_LOSS_HEALTH) costs the player their job. Never enters the
    // market draw loop; the salary resumes via job_return or inheritance.
    id: 'job_loss',
    scope: 'GLOBAL',
    trigger: 'LIFE',
    p: 1,
    cooldown: 0,
    effects: [],
  },
  {
    // v7 — ACK notice enqueued when recovery (JOB_RETURN_HEALTH) brings the job
    // back. The hysteresis band between the two thresholds never flaps.
    id: 'job_return',
    scope: 'GLOBAL',
    trigger: 'LIFE',
    p: 1,
    cooldown: 0,
    effects: [],
  },

  // ---------- fate events (enqueued by fate/tick.ts, never by the market loop) ----------
  ...FATE_EVENT_DEFS,
];

const byId = new Map(EVENT_CATALOG.map((e) => [e.id, e]));

export function eventDef(id: string): EventDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown event: ${id}`);
  return def;
}

/** MARKET-scope events in fixed catalog order (deterministic draw order). */
export function marketEvents(): EventDef[] {
  return EVENT_CATALOG.filter((e) => (e.trigger ?? 'MARKET') === 'MARKET');
}
