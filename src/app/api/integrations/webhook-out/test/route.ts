import { NextResponse } from 'next/server'
import { getAuthedAccount } from '@/lib/integrations/require-account'
import { sendWebhookOut } from '@/lib/integrations/webhook-out'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * POST /api/integrations/webhook-out/test
 *
 * Body: `{ url }` — the URL currently in the (possibly unsaved) form
 * field, so the user can try before saving. Sends one sample payload,
 * in the same Evolution-API-compatible shape the real dispatch uses,
 * and reports back whether the endpoint accepted it.
 */
export async function POST(request: Request) {
  const account = await getAuthedAccount()
  if (!account) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!account.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const limit = checkRateLimit(`webhook-out-test:${account.userId}`, RATE_LIMITS.webhookOutTest)
  if (!limit.success) return rateLimitResponse(limit)

  const body = await request.json().catch(() => ({}))
  const { url } = body as { url?: string }
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  const testPayload = {
    event: 'MESSAGES_UPSERT',
    instance: 'Funilly (teste)',
    data: {
      key: {
        remoteJid: '5511999999999@s.whatsapp.net',
        fromMe: false,
        id: 'TEST_MESSAGE_ID',
      },
      message: {
        conversation: 'Esta é uma mensagem de teste do Funilly.',
      },
      messageType: 'text',
      messageTimestamp: Date.now(),
      pushName: 'Contato de Teste',
    },
    destination: url,
    date_time: new Date().toISOString(),
    sender: '5511999999999',
    server_url: process.env.NEXT_PUBLIC_SITE_URL,
  }

  const result = await sendWebhookOut(url, testPayload)
  return NextResponse.json(result)
}
