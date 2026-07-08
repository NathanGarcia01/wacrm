export const LOCALES = ["pt", "en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "pt";
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

/** Maps our short app locale to a BCP-47 tag for Intl / toLocaleDateString
 *  calls — callers previously hardcoded "pt-BR". */
const INTL_LOCALE: Record<Locale, string> = {
  pt: "pt-BR",
  en: "en-US",
  es: "es-ES",
};

export function localeToIntl(locale: Locale): string {
  return INTL_LOCALE[locale];
}
