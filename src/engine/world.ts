/**
 * Phase 0.9 — world regime evolution (v4 dynamic-economy layer).
 *
 * The world carries a coarse-grained economic regime (growth / boom / crisis /
 * stagnation) that modulates market drift/vol and event probabilities each
 * tick. Regime transitions draw exactly one float per tick — only when the
 * layer is active (INIT_WORLD / new games). world === null keeps the exact v3
 * draw budget and replays bit-for-bit.
 *
 * Scenario runs additionally apply scripted beats (phase 0.95, zero draws):
 * regime flips and news headlines on a fixed monthly schedule. While the arc
 * has beats left (or its id is unknown), organic transitions are suspended —
 * the regime is scripted-only until the last beat, then evolves again. The
 * atTick-0
 * opening beat fires at CREATION (create.ts) so the game-start headline sits
 * in the log from month one; atTick N ≥ 1 fires during the tick that ends at
 * s.tick === N. A scenario id the pack no longer knows (a save predating a
 * pack rename/drop) parks the remaining beats instead of throwing — saves
 * never soft-lock; healWorld retires the id at the store boundary.
 */
import { WORLD_PACK, scenarioDef } from './worldpack';
import type { ScenarioBeat, ScenarioDef } from './worldpack';
import { nextFloat } from './rng';
import type { GameState, RegimeId, WorldState } from './types';

export interface RegimeDef {
  /** Multiplicative drift modulation applied while this regime is active. */
  driftMult: number;
  /** Multiplicative volatility modulation applied while this regime is active. */
  volMult: number;
  /** Per-event draw probability multiplier while active. */
  eventProbMult: number;
  /** Monthly transition probabilities out of this regime (sum ≤ 1). */
  transitions: Partial<Record<RegimeId, number>>;
}

/** Regime parameters — engine balance, not external data (like balance.ts). */
export const REGIMES: Record<RegimeId, RegimeDef> = {
  growth: {
    driftMult: 1.0,
    volMult: 1.0,
    eventProbMult: 1.0,
    transitions: { boom: 0.012, crisis: 0.003, stagnation: 0.005 },
  },
  boom: {
    driftMult: 1.4,
    volMult: 1.25,
    eventProbMult: 0.9,
    transitions: { growth: 0.03, crisis: 0.006, stagnation: 0.004 },
  },
  crisis: {
    driftMult: 0.5,
    volMult: 1.8,
    eventProbMult: 1.35,
    transitions: { growth: 0.035, boom: 0.005, stagnation: 0.02 },
  },
  stagnation: {
    driftMult: 0.75,
    volMult: 1.1,
    eventProbMult: 1.15,
    transitions: { growth: 0.025, boom: 0.008, crisis: 0.007 },
  },
};

export const REGIME_IDS: RegimeId[] = ['boom', 'growth', 'crisis', 'stagnation'];

/** Agenda defaults from the pack (topicId -> weight). */
export function packAgenda(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [topic, def] of Object.entries(WORLD_PACK.agenda.topics)) {
    out[topic] = def.weight;
  }
  return out;
}

/** Safe regime lookup — a corrupt regime id degrades to identity, never throws. */
function regimeDef(id: RegimeId): RegimeDef {
  return REGIMES[id] ?? REGIMES.growth;
}

/** Pack lookup without the fail-fast — runtime paths must tolerate retired ids. */
function findScenario(id: string): ScenarioDef | undefined {
  return WORLD_PACK.scenarios.find((s) => s.id === id);
}

/**
 * Unique log uid for a regime change. Natural transitions carry the 'w'
 * suffix; scenario beats carry 'b<cursor>' so a scripted flip landing on the
 * same tick as a natural transition can never duplicate a uid (the history
 * screen keys rows by it).
 */
function regimeUid(tick: number, suffix: string): string {
  return `${tick}:regime_change:${suffix}`;
}

function logRegimeChange(s: GameState, suffix: string, id: RegimeId): void {
  s.eventLog.push({
    tick: s.tick,
    uid: regimeUid(s.tick, suffix),
    eventId: 'regime_change',
    regimeId: id,
    netWorth: 0, // filled by sim.ts after phase-5 valuation
    generation: s.player.generation,
  });
}

/**
 * Organic transitions are frozen while a scripted arc still has beats to
 * deliver — regime changes during an active scenario come only from beats,
 * so the authored arc plays out unspoiled. An unknown scenario id counts as
 * unresolved (parked) until healWorld retires it at the store boundary. Once
 * the final beat lands, the world evolves organically again.
 */
function scenarioLocksRegime(w: WorldState): boolean {
  if (!w.scenarioId) return false;
  const def = findScenario(w.scenarioId);
  if (!def) return true;
  return w.beatCursor < def.beats.length;
}

/**
 * Phase 0.9 — advance the world regime by one month (one float draw,
 * unconditional so the stream stays aligned regardless of the outcome —
 * including while a scenario arc freezes organic transitions). Logs a
 * regime_change entry on transition.
 */
export function evolveWorld(s: GameState): void {
  const w = s.world!;
  const roll = nextFloat(s.rng);
  if (scenarioLocksRegime(w)) return;
  const table = regimeDef(w.regime).transitions;
  let acc = 0;
  let next: RegimeId = w.regime;
  for (const id of REGIME_IDS) {
    const p = table[id] ?? 0;
    if (p <= 0) continue;
    acc += p;
    if (roll < acc) {
      next = id;
      break;
    }
  }
  if (next !== w.regime) {
    w.regime = next;
    w.regimeSinceTick = s.tick;
    w.history.push({ id: next, sinceTick: s.tick });
    if (w.history.length > 24) w.history.shift();
    logRegimeChange(s, 'w', next);
  }
}

/** Apply one scripted beat: regime flip / headline, cursor advanced once. */
function applyBeat(s: GameState, w: WorldState, beat: ScenarioBeat): void {
  w.beatCursor += 1;
  if (beat.setRegime && beat.setRegime !== w.regime) {
    w.regime = beat.setRegime;
    w.regimeSinceTick = s.tick;
    w.history.push({ id: beat.setRegime, sinceTick: s.tick });
    if (w.history.length > 24) w.history.shift();
    logRegimeChange(s, `b${w.beatCursor}`, beat.setRegime);
  }
  if (beat.news !== undefined) {
    s.eventLog.push({
      tick: s.tick,
      uid: `${s.tick}:world_news:${w.scenarioId}:${beat.news}`,
      eventId: 'world_news',
      newsId: `${w.scenarioId}:${beat.news}`,
      netWorth: 0, // filled by sim.ts after phase-5 valuation (creation: create.ts)
      generation: s.player.generation,
    });
  }
}

/**
 * Phase 0.95 — apply scripted scenario beats whose time has come (zero
 * draws). Beats fire in timeline order; the cursor advances once per beat.
 * A scenario id the pack no longer knows parks the remaining beats and keeps
 * the current regime — never throws on the monthly hot path.
 */
export function applyScenarioBeats(s: GameState): void {
  const w = s.world!;
  if (!w.scenarioId) return;
  const def = findScenario(w.scenarioId);
  if (!def) return;
  while (w.beatCursor < def.beats.length && def.beats[w.beatCursor].atTick <= s.tick) {
    applyBeat(s, w, def.beats[w.beatCursor]);
  }
}

/**
 * Fire the atTick-0 opening beat at creation, so the game-start headline is
 * stamped tick 0 (month one) and the first month advances exactly one beat —
 * the tick-side `atTick <= s.tick` compare runs after the tick increment and
 * would otherwise swallow beats 0 and 1 together. Zero draws; no-op for
 * scenario-less worlds, consumed cursors, and unknown ids.
 */
export function applyOpeningBeats(s: GameState): void {
  const w = s.world;
  if (!w || !w.scenarioId || w.beatCursor !== 0) return;
  const def = findScenario(w.scenarioId);
  if (!def) return;
  const first = def.beats[0];
  if (first && first.atTick === 0) applyBeat(s, w, first);
}

/**
 * Effective event draw probability under the current regime and agenda.
 * Identity (world null / growth / empty agenda) returns the base untouched —
 * legacy runs keep their exact v3 thresholds.
 */
export function eventProb(s: GameState, baseP: number, eventId: string): number {
  const w = s.world;
  if (!w) return baseP;
  const p = baseP * regimeDef(w.regime).eventProbMult * agendaEventMult(s, eventId);
  return Math.min(Math.max(p, 0), 0.95);
}

/**
 * Per-event probability multiplier from the agenda (topicId-weighted product
 * of the pack's event multipliers). Used together with the regime multiplier.
 */
export function agendaEventMult(s: GameState, eventId: string): number {
  const w = s.world;
  if (!w) return 1;
  let mult = 1;
  for (const [topic, weight] of Object.entries(w.agenda)) {
    const def = WORLD_PACK.agenda.topics[topic];
    if (!def) continue;
    const em = def.eventMults[eventId];
    if (em !== undefined) mult *= 1 + (em - 1) * weight;
  }
  return mult;
}

/** Zero-draw world initializer: neutral regime, pack agenda (scenario aware). */
export function createWorld(scenarioId: string | null, tick = 0): WorldState {
  const def = scenarioId ? scenarioDef(scenarioId) : null;
  return {
    regime: def ? def.worldRegime : 'growth',
    regimeSinceTick: tick,
    history: [{ id: def ? def.worldRegime : 'growth', sinceTick: tick }],
    agenda: def ? { ...packAgenda(), ...def.agenda } : packAgenda(),
    scenarioId,
    beatCursor: 0,
  };
}

/** Months the current regime has been running (UI: "Kriz, 8. ay"). */
export function regimeMonths(s: GameState): number {
  return s.world ? s.tick - s.world.regimeSinceTick : 0;
}

/**
 * Regime multipliers for an ASSET market: the pack's per-class override
 * (gold rallies in crisis, housing crashes) REPLACES the base regime —
 * identity when the world layer is off.
 */
export function assetRegimeParams(s: GameState, assetId: string): { driftMult: number; volMult: number } | null {
  if (!s.world) return null;
  const override = WORLD_PACK.assetRegimes[assetId]?.[s.world.regime];
  if (override) return override;
  const base = regimeDef(s.world.regime);
  return { driftMult: base.driftMult, volMult: base.volMult };
}

/** Convenience for UI panels: current regime id or null when the layer is off. */
export function currentRegime(s: GameState): RegimeId | null {
  return s.world ? s.world.regime : null;
}
