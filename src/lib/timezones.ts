/**
 * Timezones — picker options for Settings → Atendimento → Horário de
 * Atendimento (accounts.timezone, migration 069).
 *
 * Business hours are stored as wall-clock time ("08:00"–"18:00"), so
 * the account needs a timezone to convert that into real instants.
 * Curated list (not the full IANA database) since every account here
 * is Brazil-based today — mirrors the CURRENCIES pattern in
 * src/lib/currency.ts. Extend this list to offer more; nothing else
 * needs to change.
 */

export interface TimezoneOption {
  /** IANA zone name, stored verbatim in accounts.timezone. */
  value: string;
  /** Human label for the dropdown. */
  label: string;
}

export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export const TIMEZONES: TimezoneOption[] = [
  { value: "America/Noronha", label: "Fernando de Noronha (UTC-2)" },
  { value: "America/Sao_Paulo", label: "Brasília, São Paulo (UTC-3)" },
  { value: "America/Manaus", label: "Manaus (UTC-4)" },
  { value: "America/Rio_Branco", label: "Rio Branco, Acre (UTC-5)" },
];
