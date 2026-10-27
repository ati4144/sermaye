import { applyAction } from './actions';
import { createNewGame } from './create';
import type { EngineAction, GameState } from './types';

export function makeGame(seed = 12345, name = 'Test'): GameState {
  return createNewGame({ seed, name });
}

/**
 * Drive the game like a player would: resolve/ack every pending event
 * (choices take option `optionPick`), then advance one month. Returns the
 * states after each step for assertions, plus the final state.
 */
export function runMonths(
  initial: GameState,
  months: number,
  optionPick: (eventId: string) => number = () => 0,
): { states: GameState[]; actions: EngineAction[]; final: GameState } {
  let s = initial;
  const states: GameState[] = [s];
  const actions: EngineAction[] = [];

  for (let m = 0; m < months; m++) {
    // drain the queue first (a game-over mid-drain freezes the queue — stop)
    let guard = 0;
    while (s.pendingEvents.length > 0 && guard < 20 && (s.status === 'PLAYING' || s.status === 'DECEASED')) {
      guard++;
      const head = s.pendingEvents[0];
      const action: EngineAction = head.hasChoice
        ? { type: 'RESOLVE_EVENT', uid: head.uid, optionIndex: optionPick(head.eventId) }
        : { type: 'ACK_EVENT', uid: head.uid };
      s = applyAction(s, action);
      actions.push(action);
      if (s.status === 'GAME_OVER_BANKRUPT' || s.status === 'GAME_OVER_EXTINCT') break;
    }
    if (s.status !== 'PLAYING') break;

    s = applyAction(s, { type: 'NEXT_MONTH' });
    actions.push({ type: 'NEXT_MONTH' });
    states.push(s);
  }

  return { states, actions, final: s };
}

/** FNV-1a 32-bit hash of a string — golden test fingerprints. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
