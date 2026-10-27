import { balance } from '../balance';
import { clamp } from '../market';
import { nextFloat } from '../rng';
import { eventDef } from '../events/catalog';
import { enqueueFateEvent } from '../events/apply';
import type { FateMods, FateOption, FateState, GameState } from '../types';
import { beatDefByKey, fateRevealEventId } from './defs';

/**
 * Phase 2.5 — the fate timeline. Consumes ZERO draws: everything (destiny,
 * plannedTick, revealAtTick) was resolved at creation; this only walks the
 * snapshot with pure predicates (see the determinism contract in sim.ts).
 *
 * Order per tick:
 *   1. scheduled reveal (separate from the beat quota)
 *   2. beats in saved order — max FATE.MAX_PER_TICK fired per tick
 */
export function triggerFateBeats(s: GameState): void {
  const f = s.fate;
  if (!f) return;

  // 1. scheduled reveal
  if (f.revealedTick < 0 && f.revealAtTick >= 0 && s.tick >= f.revealAtTick) {
    enqueueFateEvent(s, fateRevealEventId(f.destinyId), false, 'r');
    f.revealedTick = s.tick;
  }

  // 2. beats
  let fired = 0;
  for (let i = 0; i < f.beats.length; i++) {
    const b = f.beats[i];
    if (b.status !== 'PENDING') continue;
    if (s.tick < b.plannedTick) continue;
    if (fired >= balance.FATE.MAX_PER_TICK) {
      deferBeat(b);
      continue;
    }

    // requires: a LOST dependency kills this beat; an unfired one defers it
    let lost = false;
    let waiting = false;
    for (const rk of b.requires) {
      const rb = f.beats.find((x) => x.key === rk);
      if (!rb || rb.status === 'LOST') { lost = true; break; }
      if (rb.status !== 'FIRED') { waiting = true; break; }
    }
    if (lost) { b.status = 'LOST'; continue; }
    if (waiting) { deferBeat(b); continue; }

    const bd = beatDefByKey(b.key);
    if (bd.condition && !bd.condition(s)) {
      deferBeat(b);
      continue;
    }

    // fire
    const hasChoice = (eventDef(b.eventId).options?.length ?? 0) > 0;
    enqueueFateEvent(s, b.eventId, hasChoice, String(i));
    b.status = 'FIRED';
    if (bd.counters) {
      for (const k of Object.keys(bd.counters)) {
        f.counters[k] = (f.counters[k] ?? 0) + bd.counters[k];
      }
    }
    if (f.revealedTick < 0) f.omenCount += 1;
    fired += 1;
  }
}

function deferBeat(b: { plannedTick: number; window: [number, number]; status: string }): void {
  b.plannedTick += 1;
  if (b.plannedTick > b.window[1] + balance.FATE.DEFER_GRACE) b.status = 'LOST';
}

/**
 * Apply an EventOption's fate payload (RESOLVE_EVENT seam). Pure state
 * mutation — no draws.
 */
export function applyFateOption(s: GameState, o: FateOption): void {
  const f = s.fate;
  if (!f) return;
  if (o.setFlag !== undefined) f.flags[o.setFlag] = true;
  if (o.cancelBeats) {
    for (const key of o.cancelBeats) {
      const b = f.beats.find((x) => x.key === key);
      if (b && b.status === 'PENDING') b.status = 'LOST';
    }
  }
  if (o.counters) {
    for (const k of Object.keys(o.counters)) {
      f.counters[k] = (f.counters[k] ?? 0) + o.counters[k];
    }
  }
  if (o.reveal === true) f.revealedTick = s.tick;
  if (o.modShift) {
    const [lo, hi] = balance.FATE.MOD_CLAMP;
    for (const k of Object.keys(o.modShift) as (keyof FateMods)[]) {
      f.mods[k] = clamp(f.mods[k] + (o.modShift[k] ?? 0), lo, hi);
    }
  }
}

/**
 * Inheritance transition, run as the FIRST line of performInheritance.
 * Consumes exactly one always-taken draw from the fate stream (the only
 * post-creation fate draw). Personal beats are LOST — "kader binds the
 * surname" — dynastic beats keep rolling to the heir; founder-scoped mods
 * reset to neutral (no generation-4 curse multipliers); the reveal stands
 * (the heir learns the family fate).
 */
export function fateOnInherit(f: FateState): void {
  nextFloat(f.rng); // always drawn — the stream shape never forks here
  for (const b of f.beats) {
    if (b.status === 'PENDING' && b.personal) b.status = 'LOST';
  }
  f.mods = {
    illness: 1, death: 1, marriage: 1, birth: 1, spouse: 1, child: 1,
    livingCost: 1, estateTax: 1, fee: 1,
  };
}

/**
 * Fate-modded life hazard: multiplies the comparison side only (the draw
 * slot itself is untouched), capped so a mod can never make an event certain.
 */
export function fateHazard(s: GameState, base: number, key: keyof FateMods): number {
  return Math.min(balance.FATE.MOD_PRODUCT_MAX, base * (s.fate?.mods[key] ?? 1));
}
