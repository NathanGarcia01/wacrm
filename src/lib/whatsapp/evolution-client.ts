// ============================================================
// Evolution API client — the non-official WhatsApp connection path
// (self-hosted Baileys instance at EVOLUTION_API_URL, QR-code login).
//
// Unlike Meta's Cloud API, authentication here is ONE shared server
// credential (EVOLUTION_API_KEY) for every instance on the box — there
// is no per-channel access token to store or rotate, which is why
// whatsapp_channels.access_token_encrypted is a placeholder for
// channel_type='evolution' rows (see migration 052).
//
// Every function throws a plain Error with a message safe to surface
// in an API response — never includes EVOLUTION_API_KEY itself.
// ============================================================

function evolutionBaseUrl(): string {
  const url = process.env.EVOLUTION_API_URL
  if (!url) {
    throw new Error('EVOLUTION_API_URL is not configured')
  }
  return url.replace(/\/+$/, '')
}

function evolutionApiKey(): string {
  const key = process.env.EVOLUTION_API_KEY
  if (!key) {
    throw new Error('EVOLUTION_API_KEY is not configured')
  }
  return key
}

async function evolutionFetch(
  path: string,
  init: { method: 'GET' | 'POST' | 'DELETE'; body?: unknown } = { method: 'GET' },
): Promise<unknown> {
  const url = `${evolutionBaseUrl()}${path}`
  const response = await fetch(url, {
    method: init.method,
    headers: {
      'Content-Type': 'application/json',
      apikey: evolutionApiKey(),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })

  if (!response.ok) {
    let detail = ''
    try {
      const errBody = await response.json()
      detail = errBody?.message || errBody?.error || JSON.stringify(errBody)
    } catch {
      detail = await response.text().catch(() => '')
    }
    throw new Error(
      `Evolution API error (${response.status}) on ${init.method} ${path}${detail ? `: ${detail}` : ''}`,
    )
  }

  // Some Evolution endpoints (e.g. webhook/set) return 200 with an
  // empty body — guard against JSON-parsing nothing.
  const text = await response.text()
  return text ? JSON.parse(text) : {}
}

/** A fresh, still-unique instance name — Evolution requires these to
 *  be unique server-wide (not just per account), hence the account id
 *  + timestamp. */
export function generateEvolutionInstanceName(accountId: string): string {
  return `funilly_${accountId}_${Date.now()}`
}

/**
 * POST /instance/create — registers a new Baileys session. `qrcode:
 * true` makes Evolution generate a pairing QR immediately, but the
 * create response doesn't reliably carry it across every Evolution
 * version — callers should follow up with getEvolutionQrCode() rather
 * than trust a QR field on this response.
 */
export async function createEvolutionInstance(instanceName: string): Promise<void> {
  await evolutionFetch('/instance/create', {
    method: 'POST',
    body: {
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    },
  })
}

export interface EvolutionQrCode {
  /** Data-URI PNG (`data:image/png;base64,...`) ready for an <img src>. */
  base64: string | null
}

/** GET /instance/connect/{instanceName} — fetches (or re-generates,
 *  if the session isn't already connected) the pairing QR code. */
export async function getEvolutionQrCode(instanceName: string): Promise<EvolutionQrCode> {
  const data = (await evolutionFetch(`/instance/connect/${encodeURIComponent(instanceName)}`, {
    method: 'GET',
  })) as { base64?: string; qrcode?: { base64?: string } }
  return { base64: data.base64 ?? data.qrcode?.base64 ?? null }
}

export type EvolutionConnectionState = 'open' | 'connecting' | 'close'

/** GET /instance/connectionState/{instanceName}. */
export async function getEvolutionConnectionState(
  instanceName: string,
): Promise<EvolutionConnectionState> {
  const data = (await evolutionFetch(
    `/instance/connectionState/${encodeURIComponent(instanceName)}`,
    { method: 'GET' },
  )) as { instance?: { state?: string }; state?: string }
  const state = data.instance?.state ?? data.state
  return state === 'open' || state === 'connecting' ? state : 'close'
}

/** POST /webhook/set/{instanceName} — points this instance's events
 *  at our webhook. `events` intentionally narrowed to what
 *  evolution-webhook/route.ts actually handles; Evolution supports
 *  many more, but subscribing to unhandled ones is just noise. */
export async function setEvolutionWebhook(instanceName: string, webhookUrl: string): Promise<void> {
  await evolutionFetch(`/webhook/set/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: {
      url: webhookUrl,
      webhook_by_events: false,
      events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
    },
  })
}

/** POST /message/sendText/{instanceName}. `number` must be digits
 *  only with country code (e.g. "5511999999999") — same shape
 *  sanitizePhoneForMeta already produces for the Cloud API path.
 *  Returns the Baileys message id (`key.id`) so callers can store it
 *  in messages.message_id the same way sendTextMessage's Meta id is
 *  stored — falls back to a generated id if Evolution's response ever
 *  omits it, since messages.message_id has no NOT NULL/unique
 *  contract to violate but downstream code (reply lookups) assumes a
 *  non-empty string. */
export async function sendEvolutionText(
  instanceName: string,
  number: string,
  text: string,
): Promise<{ messageId: string }> {
  const data = (await evolutionFetch(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: { number, text },
  })) as { key?: { id?: string } }
  return { messageId: data.key?.id || `evo_${Date.now()}` }
}

/** DELETE /instance/delete/{instanceName} — best-effort teardown when
 *  a channel is removed from Funilly. Callers should not fail the
 *  whatsapp_channels delete over this throwing (the Evolution
 *  instance being unreachable/already gone must not block removing
 *  the channel on our side). */
export async function deleteEvolutionInstance(instanceName: string): Promise<void> {
  await evolutionFetch(`/instance/delete/${encodeURIComponent(instanceName)}`, {
    method: 'DELETE',
  })
}
