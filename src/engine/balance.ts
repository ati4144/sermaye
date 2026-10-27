/**
 * Every tunable constant of the simulation lives here — balancing never
 * touches logic. Tests may override fields and restore them afterwards.
 */
import type { LifestyleTier } from './types';

export const balance = {
  START_CASH: 100_000,
  START_AGE_MONTHS: 25 * 12,

  FEES: { A: 0.005, B: 0.01, C: 0.0175 } as Record<string, number>,

  MARKET: {
    MAX_RETURN: 0.35, // monthly return clamp
    MIN_INDEX: 1,
    HISTORY_CAP: 64, // per-country sparkline samples
    // sqrt(12) precomputed as a literal — engine avoids transcendental calls
    ANNUAL_TO_MONTHLY_VOL: 3.4641016151377544,
  },

  LIVING: {
    BASE: 300, // monthly floor — survival cost at near-zero wealth
    NETWORTH_RATE: 0.004, // lifestyle cost ≈ 0.4%/mo (≈5%/yr) of net worth
    MAX: 20_000,
  },

  HEALTH: {
    DECAY_START_AGE: 50,
    DECAY_PER_MONTH: 0.02, // multiplied by (age-50)/10
  },

  ILLNESS: {
    BASE: 0.002, // monthly base hazard
    AGE_FROM: 30,
    AGE_FACTOR: 0.0000026, // * (age-30)^2
    SEVERITY_WEIGHTS: [0.55, 0.33, 0.12], // mild / moderate / severe
  },

  DEATH: {
    BASE: 0.0002, // monthly base hazard
    AGE_FROM: 55,
    AGE_FACTOR: 0.00002, // * (age-55)^2
    LOW_HEALTH_THRESHOLD: 30,
    LOW_HEALTH_PENALTY: 0.01,
  },

  FAMILY: {
    MARRIAGE_P: 0.008,
    MARRIAGE_MIN_AGE: 24,
    MARRIAGE_MAX_AGE: 50,
    BIRTH_P: 0.01,
    BIRTH_MAX_AGE: 45,
    MAX_CHILDREN: 4,
    SPOUSE_DEATH_P: 0.0012,
    CHILD_DEATH_P: 0.0006,
  },

  INHERIT: {
    ESTATE_TAX: 0.15,
    HEIR_HEALTH: 80,
  },

  BANKRUPT: {
    THRESHOLD: 10_000,
    STREAK_MONTHS: 3,
  },

  EVENTS: {
    MAX_GLOBAL_PER_TICK: 1,
    MAX_COUNTRY_PER_TICK: 1,
  },

  /** Varlık Kataloğu v3 — see docs/yatirim-design.md §3.5/§7 */
  ASSETS: {
    MAX_ASSET_PER_TICK: 1,
    /** extra quick-sale discount when the engine force-sells (fire sale) */
    DISTRESS_PENALTY: 0.05,
    /**
     * v6 escrow — months a LIST_ASSET sale sits before the locked proceeds
     * pay out (phase 4c). The reward for patience: no quick-sale discount.
     */
    ESCROW_MONTHS: 6,
    GOLD: { START_PRICE: 100, DRIFT: 0.035, VOL: 0.15, FEE: 0.0075, YIELD_NET_M: 0, QUICK_DISCOUNT: 0 },
    HOUSE: { START_PRICE: 120_000, DRIFT: 0.035, VOL: 0.07, FEE: 0.02, YIELD_NET_M: 0.002, QUICK_DISCOUNT: 0.08 },
    FARM: { START_PRICE: 25_000, DRIFT: 0.025, VOL: 0.05, FEE: 0.015, YIELD_NET_M: 0.0035, QUICK_DISCOUNT: 0.12 },
    CAR: { START_PRICE: 40_000, DRIFT: 0.03, VOL: 0.09, FEE: 0.05, YIELD_NET_M: -0.0015, QUICK_DISCOUNT: 0.1 },
    /** v6 konut kademesi — the top of the property ladder (yatirim-design §8 Faz 2) */
    VILLA: { START_PRICE: 400_000, DRIFT: 0.035, VOL: 0.06, FEE: 0.02, YIELD_NET_M: 0.002, QUICK_DISCOUNT: 0.1 },
  },

  /** Yuva katmanı v6 — home-ownership living-cost relief; see docs/yatirim-design.md §6 */
  HOME: {
    /** monthly relief per unit of home value (design: evDeğeri × 0.0022) */
    RELIEF_RATE_M: 0.0022,
    /** relief cap: min(homeValue × rate, worth × this) — self-limits vs the 0.004 levy */
    RELIEF_WORTH_CAP: 0.003,
  },

  /**
   * Gelir katmanı v7 — the player-entered monthly salary. Unemployment is
   * health-gated with hysteresis (zero draws anywhere): chronic collapse
   * below JOB_LOSS_HEALTH costs the job, recovery to JOB_RETURN_HEALTH
   * brings it back — the band between the two never flaps.
   */
  INCOME: {
    /** opening-question default / INIT_INCOME default (USD per month) */
    SALARY_DEFAULT: 1_500,
    /** upper bound on a player-entered salary (USD per month) */
    SALARY_MAX: 100_000,
    /** employed && health < this → job_loss */
    JOB_LOSS_HEALTH: 35,
    /** !employed && health >= this → job_return */
    JOB_RETURN_HEALTH: 50,
  },

  /** Gider Kalemleri v5 — itemized living costs; see docs (plan §motor) */
  EXPENSES: {
    /** monthly cash-flow breakdowns kept in state */
    FLOW_CAP: 24,
    /** per-item monthly amount bound */
    AMOUNT_MAX: 100_000,
    /** custom label length bound (trimmed) */
    LABEL_MAX: 40,
    /**
     * Lifestyle presets. The STANDARD set sums EXACTLY to LIVING.BASE so a
     * fresh v5 game charges the same living cost as the flat v4 formula —
     * balance is preserved by construction, not by re-tuning.
     */
    PRESETS: {
      frugal: [
        { key: 'rent', amount: 100 },
        { key: 'food', amount: 70 },
        { key: 'transport', amount: 40 },
      ],
      standard: [
        { key: 'rent', amount: 140 },
        { key: 'food', amount: 100 },
        { key: 'transport', amount: 60 },
      ],
      comfort: [
        { key: 'rent', amount: 300 },
        { key: 'food', amount: 200 },
        { key: 'transport', amount: 100 },
        { key: 'social', amount: 50 },
      ],
      luxury: [
        { key: 'rent', amount: 800 },
        { key: 'food', amount: 400 },
        { key: 'transport', amount: 250 },
        { key: 'social', amount: 200 },
        { key: 'staff', amount: 150 },
      ],
    } as Record<LifestyleTier, { key: string; amount: number }[]>,
  },

  FATE: {
    /** per-field clamp for every FateMods entry */
    MOD_CLAMP: [0.5, 1.5] as [number, number],
    /** capped probability for any fate-modded life hazard (p × mod) */
    MOD_PRODUCT_MAX: 0.95,
    /** fate beats enqueued per tick (reveal is separate) */
    MAX_PER_TICK: 1,
    /** a deferred beat is LOST once plannedTick passes window[1] + this */
    DEFER_GRACE: 36,
    /** weight sway clamp as a fraction of the destiny's base weight */
    SWAY: [0.5, 2] as [number, number],
    /** total answer-level starting cash delta is clamped to ±this */
    START_CASH_CAP: 15_000,
    /** |cashDelta| on a single fate option */
    CASH_DELTA_CAP: 10_000,
    /** standard modShift magnitude for content defs */
    MOD_SHIFT: 0.1,
  },
};
