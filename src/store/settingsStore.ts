import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CurrencyId } from '@/lib/currency';

export type Language = 'tr' | 'en';

interface SettingsState {
  language: Language;
  /** display currency — engine money stays USD; conversion is UI-only */
  currency: CurrencyId;
  /** typewriter speed, characters per second; 0 = instant */
  textSpeedCps: number;
  hapticsEnabled: boolean;
  setLanguage: (lang: Language) => void;
  setCurrency: (currency: CurrencyId) => void;
  setTextSpeedCps: (cps: number) => void;
  setHapticsEnabled: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: 'tr',
      currency: 'usd',
      textSpeedCps: 40,
      hapticsEnabled: true,
      setLanguage: (language) => set({ language }),
      setCurrency: (currency) => set({ currency }),
      setTextSpeedCps: (textSpeedCps) => set({ textSpeedCps }),
      setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),
    }),
    {
      name: 'sermaye-settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
