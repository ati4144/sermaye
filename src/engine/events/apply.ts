import type { ActiveModifier, AssetMarketState, CountryState, EventDef, EventEffect, GameState, PendingEvent } from '../types';
import { netWorth, roundCash } from '../market';

/** Deterministic unique ids — never Math.random or counters that could fork. */
export function eventUid(tick: number, eventId: string, countryId?: string): string {
  return `${tick}:${eventId}:${countryId ?? 'g'}`;
}

export function modId(eventId: string, tick: number): string {
  return `${eventId}:${tick}`;
}

/**
 * Apply an event's effects. 'SELF' maps to the triggering market (country or
 * asset). Timed effects become ActiveModifiers on the target market (or every
 * country for GLOBAL); shocks apply instantly. Asset targets resolve after
 * countries — inert (skipped) when the asset layer is null, so legacy runs
 * never see them.
 */
export function applyEffects(
  s: GameState,
  effects: EventEffect[],
  selfCountryId: string | undefined,
  eventId: string,
): void {
  for (const fx of effects) {
    if (fx.target === 'GLOBAL' || (!selfCountryId && fx.target === 'SELF')) {
      applyToAll(s, fx, eventId, s.tick);
    } else {
      const id = fx.target === 'SELF' ? selfCountryId! : fx.target;
      const market: CountryState | AssetMarketState | undefined = s.countries[id] ?? s.assets?.markets[id];
      if (!market) continue;
      applyToMarket(market, fx, eventId, s.tick);
    }
  }
}

function applyToMarket(cs: CountryState | AssetMarketState, fx: EventEffect, eventId: string, tick: number): void {
  if (fx.indexShock !== undefined) {
    cs.index = Math.max(1, cs.index * fx.indexShock);
  }
  const duration = fx.duration ?? 0;
  if (
    duration > 0 &&
    (fx.driftDelta !== undefined || fx.volDelta !== undefined || fx.yieldDelta !== undefined || fx.liqDelta !== undefined)
  ) {
    cs.mods.push({
      id: modId(eventId, tick),
      driftDelta: fx.driftDelta ?? 0,
      volDelta: fx.volDelta ?? 0,
      yieldDelta: fx.yieldDelta,
      liqDelta: fx.liqDelta,
      remaining: duration,
    });
  }
}

function applyToAll(s: GameState, fx: EventEffect, eventId: string, tick: number): void {
  for (const id of Object.keys(s.countries)) {
    applyToMarket(s.countries[id], fx, eventId, tick);
  }
}

/**
 * Register a fired market event: cooldown stamp, immediate effects (when it
 * has no player choices), pending queue entry and (for non-choice events) a
 * log entry whose netWorth is filled in after phase-5 valuation.
 * For ASSET-scope defs `countryId` carries the assetId (pending-event i18n
 * interpolation reuses the field); the cooldown stamps the asset market.
 */
export function fireMarketEvent(s: GameState, def: EventDef, countryId: string | undefined): void {
  const uid = eventUid(s.tick, def.id, countryId);
  if (def.scope === 'ASSET') {
    if (countryId && s.assets) {
      s.assets.markets[countryId].lastEventTick[def.id] = s.tick;
    }
  } else if (countryId) {
    s.countries[countryId].lastEventTick[def.id] = s.tick;
  } else {
    for (const id of Object.keys(s.countries)) {
      s.countries[id].lastEventTick[def.id] = s.tick;
    }
  }

  const hasChoice = def.options !== undefined && def.options.length > 0;
  if (!hasChoice) {
    applyEffects(s, def.effects, countryId, def.id);
  }

  s.pendingEvents.push({ uid, eventId: def.id, tick: s.tick, countryId, hasChoice });

  if (!hasChoice) {
    s.eventLog.push({
      tick: s.tick,
      uid,
      eventId: def.id,
      countryId,
      netWorth: 0, // filled by sim.ts after phase-5 valuation
      generation: s.player.generation,
    });
  }
}

/** Used by life.ts for LIFE events (illness, marriage, death, ...). */
export function enqueueLifeEvent(s: GameState, eventId: string, hasChoice: boolean): PendingEvent {
  const uid = eventUid(s.tick, eventId);
  const pending: PendingEvent = { uid, eventId, tick: s.tick, hasChoice };
  s.pendingEvents.push(pending);
  return pending;
}

/**
 * v7 — queue a non-choice LIFE notice AND its history entry in one go (the
 * plain enqueue is transient: nothing ever logs it). Mirrors fireMarketEvent's
 * non-choice branch: netWorth 0 here, filled by sim.ts after phase-5
 * valuation. Zero draws. The later ACK only clears the queue — the entry is
 * already in the log, never duplicated.
 */
export function enqueueLifeNotice(s: GameState, eventId: string): PendingEvent {
  const pending = enqueueLifeEvent(s, eventId, false);
  s.eventLog.push({
    tick: s.tick,
    uid: pending.uid,
    eventId,
    netWorth: 0, // filled by sim.ts after phase-5 valuation
    generation: s.player.generation,
  });
  return pending;
}

/**
 * Log an asset-layer entry (buy / sell / forced sale / activation). These are
 * history annotations, not events — nothing resolves them. netWorth is filled
 * eagerly (the tick backfill only touches entries still at 0).
 */
export function logAssetEntry(
  s: GameState,
  eventId: string,
  assetId: string | undefined,
  units: number | undefined,
  amount: number | undefined,
): void {
  s.eventLog.push({
    tick: s.tick,
    uid: `${s.tick}:${eventId}:${assetId ?? 'g'}:${s.eventLog.length}`,
    eventId,
    assetId,
    assetUnits: units,
    assetAmount: amount,
    netWorth: roundCash(netWorth(s)),
    generation: s.player.generation,
  });
}

/**
 * Used by fate/tick.ts for FATE beats and destiny reveals. `tag` is the beat
 * index ('r' for the reveal) — beats fire at most once, so uids stay unique.
 * Non-choice beats get a LogEntry (netWorth backfilled by phase 5) so history
 * and the ☾ sigil work.
 */
export function enqueueFateEvent(s: GameState, eventId: string, hasChoice: boolean, tag: string): PendingEvent {
  const uid = `${s.tick}:${eventId}:f${tag}`;
  const pending: PendingEvent = { uid, eventId, tick: s.tick, hasChoice };
  s.pendingEvents.push(pending);
  if (!hasChoice) {
    s.eventLog.push({
      tick: s.tick,
      uid,
      eventId,
      netWorth: 0, // filled by sim.ts after phase-5 valuation
      generation: s.player.generation,
    });
  }
  return pending;
}

/** Decrement modifier timers and drop expired ones. Called after each tick. */
export function tickModifiers(mods: ActiveModifier[]): ActiveModifier[] {
  const next: ActiveModifier[] = [];
  for (const m of mods) {
    m.remaining -= 1;
    if (m.remaining > 0) next.push(m);
  }
  return next;
}
