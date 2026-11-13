import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { setFormatLang } from '@/lib/text/format';
import { de } from './de';
import { en } from './en';

export const LANGUAGES = { en: 'English', de: 'Deutsch' } as const;
export type Lang = keyof typeof LANGUAGES;

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}

// Detection order: explicit choice (localStorage) → browser language → <html lang>. "de-AT" etc. map to "de".
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, de: { translation: de } },
    supportedLngs: Object.keys(LANGUAGES),
    nonExplicitSupportedLngs: true,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: 'darkroom.lang',
      caches: ['localStorage'],
    },
  });

// Registered before the components subscribe, so numbers are formatted in the new language when they re-render
const syncHtmlLang = (lng: string) => {
  document.documentElement.lang = lng;
  setFormatLang(lng);
};
syncHtmlLang(i18n.resolvedLanguage ?? 'en');
i18n.on('languageChanged', syncHtmlLang);

export default i18n;
