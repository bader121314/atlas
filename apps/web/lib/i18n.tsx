'use client';

import { createContext, useCallback, useContext } from 'react';
import type { ReactNode } from 'react';
import { LOCALE_COOKIE } from './locale';
import type { Locale } from './locale';
import { ar } from './locales/ar';

export type { Locale } from './locale';

/**
 * Interface language (ADR-063). English text is the key: components call
 * t('English text'), and the Arabic dictionary supplies the translation,
 * falling back to English for anything not yet translated. Values such as
 * {count} are filled in after translation.
 */
const LocaleContext = createContext<Locale>('en');

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export type Vars = Record<string, string | number>;

export function translate(locale: Locale, text: string, vars?: Vars): string {
  const template = locale === 'ar' ? (ar[text] ?? text) : text;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * For code outside components: the page's language, from <html lang>,
 * which the root layout sets from the cookie.
 */
export function tr(text: string, vars?: Vars): string {
  const locale: Locale =
    typeof document !== 'undefined' && document.documentElement.lang === 'ar'
      ? 'ar'
      : 'en';
  return translate(locale, text, vars);
}

export function useT(): (text: string, vars?: Vars) => string {
  const locale = useLocale();
  return useCallback(
    (text: string, vars?: Vars) => translate(locale, text, vars),
    [locale],
  );
}

/** Remembers the choice for a year and reloads in the new language. */
export function chooseLocale(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}

/** A link-styled button offering the other language, labelled in it. */
export function LanguageSwitch() {
  const locale = useLocale();
  return locale === 'ar' ? (
    <button
      className="language-switch"
      type="button"
      lang="en"
      onClick={() => chooseLocale('en')}
    >
      English
    </button>
  ) : (
    <button
      className="language-switch"
      type="button"
      lang="ar"
      dir="rtl"
      onClick={() => chooseLocale('ar')}
    >
      العربية
    </button>
  );
}
