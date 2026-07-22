import { NextResponse } from 'next/server'
import { getAuthedAccount } from '@/lib/integrations/require-account'
import {
  WEBHOOK_OUT_EVENTS,
  assertPublicWebhookUrl,
  getWebhookOutIntegration,
  isWebhookOutEvent,
  saveWebhookOutIntegration,
} from '@/lib/integrations/webhook-out'

/**
 * GET /api/integrations/webhook-out
 *
 * Current outbound-webhook config for the settings panel.
 */
export async function GET() {
  const account = await getAuthedAccount()
  if (!account) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const integration = await getWebhookOutIntegration(account.accountId)
  return NextResponse.json({
    url: integration?.config.url ?? '',
    events: integration?.config.events ?? [],
    is_active: integration?.is_active ?? false,
  })
}

/**
 * POST /api/integrations/webhook-out
 *
 * Body: `{ url, events, is_active }`. Admin-only. Validates the URL is
 * http(s) and doesn't resolve to a private/internal address before
 * saving (see assertPublicWebhookUrl) — the URL is later POSTed to from
 * the server on every subscribed event, so an unvalidated one is an
 * SSRF vector.
 */
export async function POST(request: Request) {
  const account = await getAuthedAccount()
  if (!account) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!account.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const { url, events, is_active } = body as {
    url?: string
    events?: unknown[]
    is_active?: boolean
  }

  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }
  const cleanEvents = Array.isArray(events) ? events.filter(isWebhookOutEvent) : []
  if (cleanEvents.length === 0) {
    return NextResponse.json(
      { error: 'Selecione ao menos um evento para repassar.' },
      { status: 400 },
    )
  }

  try {
    await assertPublicWebhookUrl(url)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'URL inválida'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    await saveWebhookOutIntegration(
      account.accountId,
      { url, events: cleanEvents },
      is_active !== false,
    )
    return NextResponse.json({ success: true, events: WEBHOOK_OUT_EVENTS })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[webhook-out] save failed:', message)
    return NextResponse.json({ error: 'Falha ao salvar o webhook.' }, { status: 500 })
  }
}
