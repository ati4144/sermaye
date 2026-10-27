import { afterEach, describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { createNewGame } from './create';
import { ageYears, balance } from './index';
import type { GameState, PendingEvent } from './types';

// snapshot/restore balance so hazard overrides never leak between tests
const original = JSON.parse(JSON.stringify(balance)) as typeof balance;

afterEach(() => {
  for (const key of Object.keys(original) as (keyof typeof balance)[]) {
    Object.assign(balance[key] as object, original[key]);
  }
});

/** Resolve/ack the queue head once. */
function drainOne(s: GameState, pick = 0): GameState {
  const head = s.pendingEvents[0];
  if (!head) return s;
  return head.hasChoice
    ? applyAction(s, { type: 'RESOLVE_EVENT', uid: head.uid, optionIndex: pick })
    : applyAction(s, { type: 'ACK_EVENT', uid: head.uid });
}

/** Drain until the head satisfies the predicate (or the queue empties). */
function drainUntil(s: GameState, pred: (e: PendingEvent) => boolean, pick = 0): GameState {
  let guard = 0;
  while (s.pendingEvents.length > 0 && !pred(s.pendingEvents[0]) && guard < 20) {
    guard++;
    s = drainOne(s, pick);
  }
  return s;
}

function isIllness(e: PendingEvent): boolean {
  return e.eventId.startsWith('illness_');
}

describe('life events', () => {
  it('guaranteed illness enqueues a choice event and treatment costs money', () => {
    balance.ILLNESS.BASE = 1;
    let s = createNewGame({ seed: 5, name: 'X' });
    s = applyAction(s, { type: 'NEXT_MONTH' });
    expect(s.pendingEvents.some(isIllness)).toBe(true);

    s = drainUntil(s, isIllness);
    const cashBefore = s.cash;
    s = applyAction(s, { type: 'RESOLVE_EVENT', uid: s.pendingEvents[0].uid, optionIndex: 0 }); // pay
    expect(s.cash).toBeLessThan(cashBefore);
    expect(s.pendingEvents.some(isIllness)).toBe(false);
  });

  it('refusing treatment damages health', () => {
    balance.ILLNESS.BASE = 1;
    let s = createNewGame({ seed: 5, name: 'X' });
    s = applyAction(s, { type: 'NEXT_MONTH' });
    s = drainUntil(s, isIllness);
    const before = s.player.health;
    s = applyAction(s, { type: 'RESOLVE_EVENT', uid: s.pendingEvents[0].uid, optionIndex: 1 });
    expect(s.player.health).toBeLessThan(before);
  });

  it('marriage → birth → death → inheritance to eldest child', () => {
    balance.FAMILY.MARRIAGE_P = 1;
    balance.FAMILY.BIRTH_P = 1;
    balance.ILLNESS.BASE = 0;
    balance.FAMILY.SPOUSE_DEATH_P = 0;
    balance.FAMILY.CHILD_DEATH_P = 0;

    let s = createNewGame({ seed: 9, name: 'Aile' });
    // month 1: marriage fires; resolve with option 0 (setMarried)
    s = applyAction(s, { type: 'NEXT_MONTH' });
    expect(s.pendingEvents.some((e) => e.eventId === 'marriage')).toBe(true);
    s = drainUntil(s, (e) => e.eventId === 'marriage');
    s = applyAction(s, { type: 'RESOLVE_EVENT', uid: s.pendingEvents[0].uid, optionIndex: 0 });
    expect(s.player.married).toBe(true);

    // month 2: child born (age 25 ≤ 45, < 4 children)
    s = applyAction(s, { type: 'NEXT_MONTH' });
    s = drainUntil(s, (e) => e.eventId === 'child_born');
    s = drainOne(s); // ack the birth notice
    expect(s.player.children.length).toBe(1);
    expect(s.pendingEvents.length).toBe(0);

    // month 3: arm guaranteed death now
    balance.DEATH.BASE = 1;
    s = applyAction(s, { type: 'NEXT_MONTH' });
    expect(s.status).toBe('DECEASED');

    const worthAtDeath = s.cash;
    s = drainUntil(s, (e) => e.eventId === 'death');
    const death = s.pendingEvents.find((e) => e.eventId === 'death')!;
    s = applyAction(s, { type: 'ACK_EVENT', uid: death.uid });

    expect(s.status).toBe('PLAYING');
    expect(s.player.generation).toBe(2);
    expect(s.player.alive).toBe(true);
    expect(ageYears(s)).toBeLessThanOrEqual(1); // the heir is a toddler
    // estate tax ≈ 15% of the estate
    const tax = (worthAtDeath - s.cash) / worthAtDeath;
    expect(tax).toBeGreaterThan(0.1);
    expect(tax).toBeLessThan(0.2);
  });

  it('death without heirs ends the dynasty', () => {
    balance.DEATH.BASE = 1;
    balance.ILLNESS.BASE = 0;
    let s = createNewGame({ seed: 9, name: 'Son' });
    s = applyAction(s, { type: 'NEXT_MONTH' });
    expect(s.status).toBe('DECEASED');
    s = drainUntil(s, (e) => e.eventId === 'death');
    const death = s.pendingEvents.find((e) => e.eventId === 'death')!;
    s = applyAction(s, { type: 'ACK_EVENT', uid: death.uid });
    expect(s.status).toBe('GAME_OVER_EXTINCT');
  });

  it('bankruptcy: three months under the threshold ends the game', () => {
    let s = createNewGame({ seed: 21, name: 'Zengin' });
    s.cash = 5_000; // below threshold, no holdings
    for (let month = 1; month <= 3; month++) {
      s = applyAction(s, { type: 'NEXT_MONTH' });
      while (s.pendingEvents.length > 0 && s.status === 'PLAYING') {
        s = drainOne(s);
      }
    }
    expect(s.status).toBe('GAME_OVER_BANKRUPT');
  });
});
