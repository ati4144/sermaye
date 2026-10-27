import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  applyAction,
  createNewGame,
  healAssets,
  healExpenses,
  healHome,
  healIncome,
  healResidency,
  healWorld,
  migrateState,
  SCHEMA_VERSION,
} from '@/engine';
import type { EngineAction, GameState } from '@/engine';

export type SlotId = 1 | 2 | 3;
export const SLOTS: SlotId[] = [1, 2, 3];

interface GameStore {
  /** persisted per-slot saves; null = empty slot */
  slots: Record<SlotId, GameState | null>;
  /** the slot the player is currently playing — persisted so a page refresh resumes the run */
  activeSlot: SlotId | null;
  /** answers: fate questionnaire picks (index per question, -1 = skipped) */
  newGame: (
    slot: SlotId,
    name: string,
    answers?: number[],
    scenarioId?: string | null,
    salaryM?: number,
    homeCountryId?: string,
  ) => GameState;
  loadSlot: (slot: SlotId) => void;
  closeGame: () => void;
  /** dispatch an engine action into the active slot's state and autosave */
  dispatch: (action: EngineAction) => GameState;
  deleteSlot: (slot: SlotId) => void;
}

/**
 * Persisted slots → sanitized slots. migrateState upgrades older schemas;
 * healAssets repairs dev-stage asset shapes (missing/renamed market ids),
 * healWorld repairs dev-stage world shapes (typo'd regimes, agenda gaps,
 * scenario ids the pack retired), healExpenses repairs dev-stage expense
 * shapes (malformed items, seq behind the live ids, over-long flow) and
 * healIncome repairs dev-stage income shapes (malformed salary, bad review
 * cursor) — all can hide inside a version-matched envelope. Newer-than-code
 * saves are dropped wholesale.
 */
function sanitizeSlots(raw: Partial<Record<SlotId, unknown>> | undefined): Record<SlotId, GameState | null> {
  const out = { 1: null, 2: null, 3: null } as Record<SlotId, GameState | null>;
  for (const id of SLOTS) {
    const st = raw?.[id] as GameState | undefined;
    if (st && typeof st === 'object' && typeof st.schemaVersion === 'number' && st.schemaVersion <= SCHEMA_VERSION) {
      out[id] = healResidency(
        healIncome(healExpenses(healWorld(healAssets(healHome(migrateState(st as GameState)))))),
      );
    }
  }
  return out;
}

function migrate(persisted: unknown, version: number): Pick<GameStore, 'slots' | 'activeSlot'> {
  const raw = ((persisted as Pick<GameStore, 'slots' | 'activeSlot'> | undefined)?.slots ?? {}) as Partial<
    Record<SlotId, unknown>
  >;
  const out = sanitizeSlots(raw);
  void version;
  // activeSlot only survives if its save did
  const persistedSlot = (persisted as Pick<GameStore, 'activeSlot'> | undefined)?.activeSlot ?? null;
  return { slots: out, activeSlot: persistedSlot && out[persistedSlot] ? persistedSlot : null };
}

export const useGameStore = create<GameStore>()(
  persist<GameStore, [], [], Pick<GameStore, 'slots' | 'activeSlot'>>(
    (set, get) => ({
      slots: { 1: null, 2: null, 3: null },
      activeSlot: null,

      newGame: (slot, name, answers, scenarioId, salaryM, homeCountryId) => {
        // a random-ish seed from the clock — UI-layer concern, never engine
        const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
        const state = createNewGame({
          seed,
          name,
          answers,
          scenarioId: scenarioId ?? null,
          salaryM,
          homeCountryId: homeCountryId ?? null,
        });
        set((s) => ({ slots: { ...s.slots, [slot]: state }, activeSlot: slot }));
        return state;
      },

      loadSlot: (slot) => {
        if (get().slots[slot]) set({ activeSlot: slot });
      },

      closeGame: () => set({ activeSlot: null }),

      dispatch: (action) => {
        const { activeSlot, slots } = get();
        if (!activeSlot) throw new Error('NO_ACTIVE_GAME');
        const current = slots[activeSlot];
        if (!current) throw new Error('NO_ACTIVE_GAME');
        const next = applyAction(current, action);
        set({ slots: { ...slots, [activeSlot]: next } });
        return next;
      },

      deleteSlot: (slot) =>
        set((s) => ({ slots: { ...s.slots, [slot]: null }, activeSlot: s.activeSlot === slot ? null : s.activeSlot })),
    }),
    {
      name: 'sermaye-saves',
      // bump with the engine schema — zustand only calls migrate() when the
      // stored envelope version differs, so without this the per-slot
      // migration/drop logic above never runs
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ slots: s.slots, activeSlot: s.activeSlot }),
      migrate,
      // zustand runs migrate() only on envelope-version bumps; merge runs on
      // EVERY rehydration — the hook that catches stale asset shapes inside a
      // version-matched save (the default shallow merge is replaced wholesale;
      // slots/activeSlot are the only persisted keys anyway)
      merge: (persisted, current) => {
        const p = persisted as Pick<GameStore, 'slots' | 'activeSlot'> | undefined;
        const slots = sanitizeSlots(p?.slots);
        return { ...current, slots, activeSlot: p?.activeSlot && slots[p.activeSlot] ? p.activeSlot : null };
      },
    },
  ),
);

/** Selector: the state of the active slot, or null outside a game. */
export function useActiveGame(): GameState | null {
  return useGameStore((s) => (s.activeSlot ? s.slots[s.activeSlot] : null));
}
