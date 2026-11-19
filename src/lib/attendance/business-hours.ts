import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Fase 2 (Follow-up seguro) — B2. Horário comercial de VERDADE, lendo
 * `accounts.timezone` + `business_hours` + `holidays` (migration 069)
 * — deliberadamente NÃO reaproveita `isWithinBusinessHours` de
 * `src/lib/broadcast-cadence.ts`, que é hardcoded America/Sao_Paulo
 * 08–20 e não lê nenhuma das três tabelas configuráveis por conta.
 *
 * Split em uma função pura (testável sem banco, dado o fuso/weekday/
 * hora já resolvidos) + um wrapper fino que busca as linhas — mesmo
 * padrão de presence.ts/decide.ts (routing) e classify.ts (radar).
 */

export interface BusinessHoursWindow {
  /** "HH:mm:ss", como a coluna `time` do Postgres retorna. */
  start_time: string
  end_time: string
}

/**
 * `weekday` segue `Date#getDay()` (0 = domingo .. 6 = sábado) — mesma
 * convenção de `business_hours.weekday` (migration 069).
 */
export interface WeekdayTime {
  weekday: number
  /** "HH:mm:ss" ou "HH:mm" — comparação lexicográfica funciona pros
   *  dois formatos (zero-padded, mesmo comprimento de prefixo). */
  time: string
}

/**
 * Verdadeiro se `now` cai dentro de alguma janela cadastrada pra esse
 * dia da semana. Nenhuma janela cadastrada pra aquele weekday = conta
 * sem horário configurado pra esse dia = fora do horário (fail
 * closed: não dispara por padrão quando não há configuração,
 * consistente com `respect_business_hours` ser opt-in).
 */
export function isWithinBusinessHoursWindow(windows: BusinessHoursWindow[], now: WeekdayTime): boolean {
  return windows.some((w) => now.time >= w.start_time && now.time < w.end_time)
}

/**
 * Resolve o weekday + hora (HH:mm:ss) de `now` NO FUSO da conta —
 * usa Intl.DateTimeFormat com a timezone configurável, em vez do
 * truque de offset fixo que broadcast-cadence.ts usa (aquele assume
 * UTC-3 sem horário de verão; aqui o fuso vem de accounts.timezone e
 * pode ser qualquer um).
 */
function resolveWeekdayTime(now: Date, timezone: string): WeekdayTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
  const second = parts.find((p) => p.type === 'second')?.value ?? '00'

  // Intl's weekday short names → Date#getDay() index (0=domingo).
  const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

  return {
    weekday: WEEKDAY_INDEX[weekdayStr] ?? 0,
    // hour12:false pode devolver "24" à meia-noite em alguns runtimes
    // (bug conhecido do Intl) — normaliza pra "00".
    time: `${hour === '24' ? '00' : hour}:${minute}:${second}`,
  }
}

/**
 * Verdadeiro se `now` está dentro do horário comercial da conta —
 * false em feriado (holidays), em weekday sem janela cadastrada, ou
 * fora de toda janela cadastrada.
 */
export async function isWithinAccountBusinessHours(
  db: SupabaseClient,
  accountId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { data: account } = await db.from('accounts').select('timezone').eq('id', accountId).maybeSingle()
  const timezone = (account?.timezone as string | null) ?? 'America/Sao_Paulo'

  const resolved = resolveWeekdayTime(now, timezone)
  const todayDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now) // YYYY-MM-DD

  const { data: holiday } = await db
    .from('holidays')
    .select('id')
    .eq('account_id', accountId)
    .eq('date', todayDateStr)
    .maybeSingle()
  if (holiday) return false

  const { data: windows } = await db
    .from('business_hours')
    .select('start_time, end_time')
    .eq('account_id', accountId)
    .eq('weekday', resolved.weekday)

  return isWithinBusinessHoursWindow((windows ?? []) as BusinessHoursWindow[], resolved)
}
