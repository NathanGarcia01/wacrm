import { ptBR, enUS, es } from "date-fns/locale";
import type { Locale as DateFnsLocale } from "date-fns";

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

/** Maps our short app locale to a date-fns Locale object, for calls
 *  like `formatDistanceToNow`/`format` that take one directly (as
 *  opposed to the Intl-based `localeToIntl` calls above). */
const DATE_FNS_LOCALE: Record<Locale, DateFnsLocale> = {
  pt: ptBR,
  en: enUS,
  es: es,
};

export function localeToDateFns(locale: Locale): DateFnsLocale {
  return DATE_FNS_LOCALE[locale];
}
