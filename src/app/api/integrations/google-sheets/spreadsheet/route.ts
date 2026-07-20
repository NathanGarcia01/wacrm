import { NextResponse } from 'next/server'
import { getAuthedAccount } from '@/lib/integrations/require-account'
import {
  getIntegration,
  extractSpreadsheetId,
  createSpreadsheet,
  saveSpreadsheetConfig,
} from '@/lib/integrations/google-sheets'

/**
 * GET /api/integrations/google-sheets/spreadsheet
 *
 * Connection + spreadsheet status for the settings panel.
 */
export async function GET() {
  const account = await getAuthedAccount()
  if (!account) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const integration = await getIntegration(account.accountId)
  if (!integration) {
    return NextResponse.json({ connected: false, spreadsheet_id: null, spreadsheet_url: null })
  }

  const spreadsheetId = (integration.config?.spreadsheet_id as string | undefined) ?? null
  return NextResponse.json({
    connected: true,
    spreadsheet_id: spreadsheetId,
    spreadsheet_url: spreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
      : null,
  })
}

/**
 * POST /api/integrations/google-sheets/spreadsheet
 *
 * Body: `{ url }` to bind an existing spreadsheet the user pasted, or
 * `{ create: true, title? }` to have the app create one via the Drive
 * scope already granted.
 */
export async function POST(request: Request) {
  const account = await getAuthedAccount()
  if (!account) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!account.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const integration = await getIntegration(account.accountId)
  if (!integration) {
    return NextResponse.json(
      { error: 'Conecte sua conta Google antes de escolher a planilha.' },
      { status: 400 },
    )
  }

  const body = await request.json().catch(() => ({}))
  const { url, create, title } = body as { url?: string; create?: boolean; title?: string }

  try {
    let spreadsheetId: string
    if (create) {
      spreadsheetId = await createSpreadsheet(account.accountId, title || 'Funilly — Pipeline')
    } else {
      if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })
      const extracted = extractSpreadsheetId(url)
      if (!extracted) {
        return NextResponse.json({ error: 'URL da planilha inválida.' }, { status: 400 })
      }
      spreadsheetId = extracted
    }

    await saveSpreadsheetConfig(account.accountId, spreadsheetId)

    return NextResponse.json({
      success: true,
      spreadsheet_id: spreadsheetId,
      spreadsheet_url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[google-sheets/spreadsheet] failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
