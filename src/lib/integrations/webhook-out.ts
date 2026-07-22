import { lookup as dnsLookup } from 'node:dns/promises'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { WEBHOOK_OUT_EVENTS, isWebhookOutEvent, type WebhookOutEvent } from './webhook-out-events'

/**
 * Outbound webhook — repasses eventos do CRM (mensagem recebida, deal
 * ganho, etc.) para uma URL externa que o próprio usuário configura em
 * Configurações → Integrações → Webhook de Saída (n8n, Zapier, Make...).
 * Stored as `integrations` row with type='webhook_out' — same table the
 * Google Sheets integration uses, keyed by (account_id, type).
 *
 * Server-only (uses node:dns and the service-role client) — the event
 * list + type live in ./webhook-out-events so client components can
 * import just that without pulling this module into the browser bundle.
 */

export { WEBHOOK_OUT_EVENTS, isWebhookOutEvent }
export type { WebhookOutEvent }

export interface WebhookOutConfig {
  url: string
  events: WebhookOutEvent[]
}

interface WebhookOutIntegrationRow {
  config: WebhookOutConfig
  is_active: boolean
}

export async function getWebhookOutIntegration(
  accountId: string,
): Promise<WebhookOutIntegrationRow | null> {
  const { data, error } = await supabaseAdmin()
    .from('integrations')
    .select('config, is_active')
    .eq('account_id', accountId)
    .eq('type', 'webhook_out')
    .maybeSingle()

  if (error) {
    console.error('[webhook-out] failed to load integration:', error.message)
    return null
  }
  return (data as WebhookOutIntegrationRow) ?? null
}

export async function saveWebhookOutIntegration(
  accountId: string,
  config: WebhookOutConfig,
  isActive: boolean,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('integrations')
    .upsert(
      { account_id: accountId, type: 'webhook_out', config, is_active: isActive },
      { onConflict: 'account_id,type' },
    )
  if (error) throw error
}

// ------------------------------------------------------------
// SSRF guard — the URL is attacker-reachable input (whoever has
// account-admin access chooses it), and both the "test" button and the
// real dispatch make the server issue a request to it. Block anything
// that resolves to a private/loopback/link-local address so this can't
// be used to probe the app's own internal network or cloud metadata
// endpoint (169.254.169.254).
// ------------------------------------------------------------

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let result = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    result = (result << 8) | n
  }
  return result >>> 0
}

function inCidr(intIp: number, base: string, maskBits: number): boolean {
  const baseInt = ipv4ToInt(base)
  if (baseInt === null) return false
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0
  return (intIp & mask) === (baseInt & mask)
}

// RFC 1918 + loopback + link-local (incl. the cloud metadata address) +
// CGNAT + documentation/reserved/multicast ranges.
const PRIVATE_V4_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

function isPrivateIPv4(ip: string): boolean {
  const intIp = ipv4ToInt(ip)
  if (intIp === null) return true // unparseable — fail closed
  return PRIVATE_V4_CIDRS.some(([base, bits]) => inCidr(intIp, base, bits))
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  if (normalized === '::1' || normalized === '::') return true
  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.split(':').pop()
    if (v4 && v4.includes('.')) return isPrivateIPv4(v4)
  }
  const firstHextet = parseInt(normalized.split(':')[0] || '0', 16)
  if (!Number.isNaN(firstHextet)) {
    if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true // fc00::/7 (ULA)
    if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true // fe80::/10 (link-local)
  }
  return false
}

/**
 * Validates that `rawUrl` is http(s) and doesn't resolve to a private /
 * loopback / link-local address. Throws with a user-facing message
 * otherwise. Re-resolves DNS on every call (not just at save time) so a
 * hostname that's re-pointed at an internal address after being saved
 * (DNS rebinding) gets caught at send time too.
 */
export async function assertPublicWebhookUrl(rawUrl: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('URL inválida.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('A URL deve começar com http:// ou https://.')
  }

  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('URLs locais não são permitidas.')
  }

  let addresses: { address: string; family: number }[]
  try {
    addresses = await dnsLookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error('Não foi possível resolver o host da URL.')
  }
  if (addresses.length === 0) {
    throw new Error('Não foi possível resolver o host da URL.')
  }

  for (const { address, family } of addresses) {
    const isPrivate = family === 6 ? isPrivateIPv6(address) : isPrivateIPv4(address)
    if (isPrivate) {
      throw new Error('A URL aponta para uma rede interna e não é permitida.')
    }
  }

  return url
}

export interface WebhookOutSendResult {
  ok: boolean
  status?: number
  error?: string
}

/**
 * POSTs `payload` to `url`. Validates the URL is safe first (see above),
 * then sends with a timeout and WITHOUT following redirects — a
 * redirect target is unvalidated, so blindly following one would let an
 * otherwise-public URL bounce the request to an internal address after
 * the SSRF check already passed.
 */
export async function sendWebhookOut(
  url: string,
  payload: unknown,
  timeoutMs = 8000,
): Promise<WebhookOutSendResult> {
  try {
    await assertPublicWebhookUrl(url)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'URL inválida' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'manual',
    })
    return { ok: res.ok, status: res.status }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Falha de rede desconhecida',
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fire-and-forget entry point for the real (non-test) dispatch paths.
 * Looks up the account's webhook_out integration; no-ops if it's
 * missing, inactive, or not subscribed to `event`. `buildPayload` only
 * runs (and only then does any extra lookup it needs) once a live,
 * subscribed integration is confirmed, so accounts without this
 * integration configured pay no extra cost on their hot paths.
 *
 * Never throws — callers use this fire-and-forget from request handlers
 * that must not fail (or block) on a slow/broken external endpoint.
 */
export async function dispatchWebhookOutEvent(
  accountId: string,
  event: WebhookOutEvent,
  buildPayload: (webhookUrl: string) => Promise<unknown> | unknown,
): Promise<void> {
  try {
    const integration = await getWebhookOutIntegration(accountId)
    if (!integration || !integration.is_active) return
    if (!integration.config?.url || !integration.config.events?.includes(event)) return

    const payload = await buildPayload(integration.config.url)
    const result = await sendWebhookOut(integration.config.url, payload)
    if (!result.ok) {
      console.error(
        `[webhook-out] POST failed for event ${event}:`,
        result.error ?? `HTTP ${result.status}`,
      )
    }
  } catch (err) {
    console.error('[webhook-out] dispatch failed:', err)
  }
}
