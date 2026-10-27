import type { FateMods, GameState } from '../types';

/**
 * Static fate content contracts. Like EventDef, these ship with the app and
 * are never serialized — GameState.fate snapshots everything the runtime
 * needs (plannedTick, status, flags, mods), while conditions and requires
 * stay code-side. The honest contract is "fate catalog frozen per
 * schemaVersion": beat keys and event ids are append-only across releases.
 */

/** A scheduled story beat of a destiny (or an armed questionnaire answer). */
export interface FateBeatDef {
  /** globally unique across all destinies and answer beats */
  key: string;
  /** EventDef id — must exist in the event catalog with trigger 'FATE' */
  eventId: string;
  /** alternate event ids; exactly one is drawn at creation */
  variants?: string[];
  /** inclusive [from, to] window in months; [n, n] = fixed month */
  window: [number, number];
  /** beat keys that must be FIRED before this one fires */
  requires?: string[];
  /** pure, draw-free state predicate; false → defer one month */
  condition?: (s: GameState) => boolean;
  /** personal beats are LOST at inheritance; default false — DYNASTIC (design §10.2: pending beats roll to the heir) */
  personal?: boolean;
  /** merged into fate.counters when the beat fires */
  counters?: Record<string, number>;
}

/** A destiny archetype. */
export interface FateDef {
  id: string;
  /** base weight in the RANDOM pick */
  weight: number;
  /** sparse weight deltas keyed by chosen answer key or answer flag */
  answerWeights?: Record<string, number>;
  /** hard gate: every flag must be present for the destiny to be eligible */
  requireAll?: string[];
  /** hard gate: destiny is ineligible if any flag is present */
  requireNone?: string[];
  /** veiled destinies show no dashboard omen line before the reveal */
  veiled?: boolean;
  /** founder-only starting condition; cash deltas are answer-level by design */
  start?: { health?: number };
  mods?: Partial<FateMods>;
  revealWindow: [number, number];
  beats: FateBeatDef[];
}

/** One questionnaire question; option i stores answer i. */
export interface FateQuestionDef {
  id: string;
  options: {
    /** answer key — referenced by destiny answerWeights */
    key: string;
    flags?: string[];
    cashDelta?: number;
    mods?: Partial<FateMods>;
    /** answer beat keys (from ANSWER_BEATS) armed by this answer */
    armBeats?: string[];
  }[];
}
