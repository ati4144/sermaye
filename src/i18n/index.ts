import i18n, { changeLanguage } from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import tr from './locales/tr';
import en from './locales/en';
import type { Language } from '@/store/settingsStore';

/**
 * Resources are bundled — no async backend, no suspense, no RN/web loading
 * quirks. The engine emits event ids; this layer owns all copy.
 */
// eslint-disable-next-line import/no-named-as-default-member
i18n.use(initReactI18next).init({
  resources: {
    tr: { translation: tr },
    en: { translation: en },
  },
  lng: Localization.getLocales()[0]?.languageCode === 'en' ? 'en' : 'tr',
  fallbackLng: 'tr',
  interpolation: { escapeValue: false }, // RN Text renders raw strings
  react: { useSuspense: false },
  returnNull: false,
});

export function setLanguage(lang: Language): void {
  void changeLanguage(lang);
}

export default i18n;
