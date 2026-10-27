import { useSyncExternalStore } from 'react';
import { useGameStore } from './gameStore';
import { useSettingsStore } from './settingsStore';

function bothHydrated(): boolean {
  return useGameStore.persist.hasHydrated() && useSettingsStore.persist.hasHydrated();
}

function subscribe(onChange: () => void): () => void {
  const unsubs = [
    useGameStore.persist.onFinishHydration(onChange),
    useSettingsStore.persist.onFinishHydration(onChange),
  ];
  return () => unsubs.forEach((u) => u());
}

/**
 * Hydration gate: zustand-persist rehydrates from AsyncStorage/localStorage
 * asynchronously. Hold the splash (or render nothing) until both stores have
 * finished, so a reload never flashes the "no save" main menu.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, bothHydrated, () => false);
}
