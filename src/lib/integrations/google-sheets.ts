import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { google, sheets_v4 } from 'googleapis'
import { encrypt, decrypt } from './encryption'
import { refreshGoogleAccessToken, type GoogleTokens } from './google-oauth'

let _adminClient: SupabaseClient | null = null
export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

// Column order fixed by the product spec. Column A (deal id) is the
// hidden lookup key every read/write locates a row by — never rendered
// as meaningful data, hidden via updateDimensionProperties in ensureTab.
const DEAL_COLUMNS = [
  'ID',
  'Título',
  'Contato',
  'Telefone',
  'Email',
  'Valor Total',
  'Comissão Total',
  'Responsável',
  'Tags',
  'Data Criação',
  'Última atualização',
  'Dias na etapa',
  'Motivo da perda',
  'Produtos',
]
const LAST_COLUMN_LETTER = 'N'
export const ALL_DEALS_TAB = 'Todos os Deals'
export const WON_TAB = 'Ganhos'
export const LOST_TAB = 'Perdidos'

export interface IntegrationRow {
  id: string
  account_id: string
  type: string
  config: { spreadsheet_id?: string }
  credentials: { blob?: string }
  is_active: boolean
}

export async function getIntegration(accountId: string): Promise<IntegrationRow | null> {
  const { data } = await supabaseAdmin()
    .from('integrations')
    .select('*')
    .eq('account_id', accountId)
    .eq('type', 'google_sheets')
    .maybeSingle()
  return (data as IntegrationRow) ?? null
}

function packCredentials(tokens: GoogleTokens): { blob: string } {
  return { blob: encrypt(JSON.stringify(tokens)) }
}

function unpackCredentials(credentials: { blob?: string }): GoogleTokens {
  if (!credentials?.blob) throw new Error('google_sheets integration has no stored credentials')
  return JSON.parse(decrypt(credentials.blob))
}

export async function saveTokens(
  accountId: string,
  tokens: GoogleTokens,
  config?: Record<string, unknown>,
): Promise<void> {
  const existing = await getIntegration(accountId)
  const row = {
    account_id: accountId,
    type: 'google_sheets',
    credentials: packCredentials(tokens),
    is_active: true,
    updated_at: new Date().toISOString(),
    ...(config ? { config: { ...(existing?.config ?? {}), ...config } } : {}),
  }
  if (existing) {
    await supabaseAdmin().from('integrations').update(row).eq('id', existing.id)
  } else {
    await supabaseAdmin()
      .from('integrations')
      .insert({ ...row, config: config ?? {} })
  }
}

export async function disconnectGoogleSheets(accountId: string): Promise<void> {
  await supabaseAdmin()
    .from('integrations')
    .delete()
    .eq('account_id', accountId)
    .eq('type', 'google_sheets')
}

export async function saveSpreadsheetConfig(accountId: string, spreadsheetId: string): Promise<void> {
  const integration = await getIntegration(accountId)
  if (!integration) throw new Error('google_sheets_not_connected')
  await supabaseAdmin()
    .from('integrations')
    .update({
      config: { ...integration.config, spreadsheet_id: spreadsheetId },
      updated_at: new Date().toISOString(),
    })
    .eq('id', integration.id)
}

// Google access tokens live ~1h; refresh a bit early to absorb clock
// skew and the latency of the call that's about to use the token.
const EXPIRY_SKEW_MS = 60_000

export async function getValidAccessToken(accountId: string): Promise<string> {
  const integration = await getIntegration(accountId)
  if (!integration || !integration.is_active) {
    throw new Error('google_sheets_not_connected')
  }
  const tokens = unpackCredentials(integration.credentials)
  if (tokens.expiry_date - Date.now() > EXPIRY_SKEW_MS) {
    return tokens.access_token
  }
  const refreshed = await refreshGoogleAccessToken(tokens.refresh_token)
  const newTokens: GoogleTokens = {
    access_token: refreshed.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: refreshed.expiry_date,
  }
  await supabaseAdmin()
    .from('integrations')
    .update({ credentials: packCredentials(newTokens), updated_at: new Date().toISOString() })
    .eq('id', integration.id)
  return newTokens.access_token
}

export async function getSheetsClient(accountId: string): Promise<sheets_v4.Sheets> {
  const accessToken = await getValidAccessToken(accountId)
  const auth = new google.auth.OAuth2()
  auth.setCredentials({ access_token: accessToken })
  return google.sheets({ version: 'v4', auth })
}

export function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim()
  const urlMatch = trimmed.match(/\/d\/([a-zA-Z0-9-_]+)/)
  if (urlMatch) return urlMatch[1]
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed
  return null
}

export async function createSpreadsheet(accountId: string, title: string): Promise<string> {
  const sheets = await getSheetsClient(accountId)
  const res = await sheets.spreadsheets.create({
    requestBody: { properties: { title } },
  })
  const spreadsheetId = res.data.spreadsheetId
  if (!spreadsheetId) throw new Error('Google did not return a spreadsheetId')
  return spreadsheetId
}

async function getSheetTabMap(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<Map<string, number>> {
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  })
  const map = new Map<string, number>()
  for (const s of res.data.sheets ?? []) {
    if (s.properties?.title && s.properties.sheetId != null) {
      map.set(s.properties.title, s.properties.sheetId)
    }
  }
  return map
}

/** Creates the tab (with header row + hidden id column) if missing. */
async function ensureTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  tabMap: Map<string, number>,
): Promise<number> {
  const existing = tabMap.get(tabName)
  if (existing != null) return existing

  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  })
  const sheetId = res.data.replies?.[0]?.addSheet?.properties?.sheetId
  if (sheetId == null) throw new Error(`Failed to create tab "${tabName}"`)
  tabMap.set(tabName, sheetId)

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
            properties: { hiddenByUser: true },
            fields: 'hiddenByUser',
          },
        },
      ],
    },
  })

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!A1:${LAST_COLUMN_LETTER}1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [DEAL_COLUMNS] },
  })

  return sheetId
}

/** 1-based row index of the deal in this tab's column A, or null. */
async function findRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  dealId: string,
): Promise<number | null> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A2:A`,
  })
  const rows = res.data.values ?? []
  const idx = rows.findIndex((r) => r[0] === dealId)
  return idx === -1 ? null : idx + 2
}

async function deleteRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  sheetId: number,
  rowIndex1Based: number,
): Promise<void> {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex1Based - 1,
              endIndex: rowIndex1Based,
            },
          },
        },
      ],
    },
  })
}

interface DealRowData {
  id: string
  title: string
  contactName: string
  contactPhone: string
  contactEmail: string
  totalValue: number
  totalCommission: number
  assigneeName: string
  tags: string
  createdAt: string
  updatedAt: string
  daysInStage: number
  lostReason: string
  products: string
  status: string
  stageName: string
}

/** Resolves the tab a deal belongs in right now: won/lost bucket, or its current stage's name. */
export function resolveTargetTab(row: Pick<DealRowData, 'status' | 'stageName'>): string {
  if (row.status === 'won') return WON_TAB
  if (row.status === 'lost') return LOST_TAB
  return row.stageName
}

export async function fetchDealRow(dealId: string): Promise<DealRowData | null> {
  const admin = supabaseAdmin()
  const { data: deal } = await admin
    .from('deals')
    .select(
      'id, title, value, status, created_at, updated_at, stage_changed_at, lost_reason, assigned_to, contact_id, stage:pipeline_stages(name)',
    )
    .eq('id', dealId)
    .maybeSingle()
  if (!deal) return null

  const stage = Array.isArray(deal.stage) ? deal.stage[0] : deal.stage

  const [{ data: contact }, { data: products }, { data: assignee }, { data: contactTags }] =
    await Promise.all([
      deal.contact_id
        ? admin.from('contacts').select('name, phone, email').eq('id', deal.contact_id).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from('deal_products').select('name, quantity, commission_value').eq('deal_id', dealId),
      deal.assigned_to
        ? admin.from('profiles').select('full_name').eq('user_id', deal.assigned_to).maybeSingle()
        : Promise.resolve({ data: null }),
      deal.contact_id
        ? admin.from('contact_tags').select('tags(name)').eq('contact_id', deal.contact_id)
        : Promise.resolve({ data: [] as { tags: { name: string } | { name: string }[] | null }[] }),
    ])

  const daysInStage = Math.max(
    0,
    Math.floor((Date.now() - new Date(deal.stage_changed_at).getTime()) / 86_400_000),
  )

  const tagNames = (contactTags ?? [])
    .map((ct) => {
      const t = ct.tags
      const tag = Array.isArray(t) ? t[0] : t
      return tag?.name
    })
    .filter((name): name is string => Boolean(name))

  return {
    id: deal.id,
    title: deal.title ?? '',
    contactName: contact?.name ?? '',
    contactPhone: contact?.phone ?? '',
    contactEmail: contact?.email ?? '',
    totalValue: Number(deal.value ?? 0),
    totalCommission: (products ?? []).reduce((sum, p) => sum + Number(p.commission_value ?? 0), 0),
    assigneeName: assignee?.full_name ?? '',
    tags: tagNames.join(', '),
    createdAt: deal.created_at,
    updatedAt: deal.updated_at,
    daysInStage,
    lostReason: deal.lost_reason ?? '',
    products: (products ?? []).map((p) => `${p.name} (${p.quantity}x)`).join(', '),
    status: deal.status,
    stageName: stage?.name ?? '',
  }
}

function toRowValues(row: DealRowData, tabName: string): (string | number)[] {
  return [
    row.id,
    row.title,
    row.contactName,
    row.contactPhone,
    row.contactEmail,
    row.totalValue,
    row.totalCommission,
    row.assigneeName,
    row.tags,
    row.createdAt,
    row.updatedAt,
    row.daysInStage,
    tabName === LOST_TAB ? row.lostReason : '',
    row.products,
  ]
}

async function upsertRowInTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
  tabMap: Map<string, number>,
  row: DealRowData,
): Promise<void> {
  const sheetId = await ensureTab(sheets, spreadsheetId, tabName, tabMap)
  const values = toRowValues(row, tabName)
  const existingRowIndex = await findRow(sheets, spreadsheetId, tabName, row.id)

  if (existingRowIndex != null) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!A${existingRowIndex}:${LAST_COLUMN_LETTER}${existingRowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [values] },
    })
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${tabName}'!A:${LAST_COLUMN_LETTER}`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] },
    })
  }
  void sheetId
}

/**
 * Syncs a single deal after INSERT/UPDATE: removes it from every stage
 * tab other than the one it currently belongs to (in case it moved),
 * upserts it into that tab, and mirrors it into "Todos os Deals" (which
 * never moves — always reflects current state in place).
 */
export async function syncDealToSheet(accountId: string, dealId: string): Promise<void> {
  const integration = await getIntegration(accountId)
  const spreadsheetId = integration?.config?.spreadsheet_id
  if (!integration || !integration.is_active || !spreadsheetId) return

  const row = await fetchDealRow(dealId)
  if (!row) return

  const sheets = await getSheetsClient(accountId)
  const tabMap = await getSheetTabMap(sheets, spreadsheetId)
  const targetTab = resolveTargetTab(row)

  // Remove stale rows from any other stage/won/lost tab this deal used
  // to sit in. Bounded and cheap: one existing tab per pipeline stage
  // plus Ganhos/Perdidos, never more than a handful.
  for (const [tabName, sheetId] of tabMap) {
    if (tabName === targetTab || tabName === ALL_DEALS_TAB) continue
    const rowIndex = await findRow(sheets, spreadsheetId, tabName, dealId)
    if (rowIndex != null) await deleteRow(sheets, spreadsheetId, sheetId, rowIndex)
  }

  await upsertRowInTab(sheets, spreadsheetId, targetTab, tabMap, row)
  await upsertRowInTab(sheets, spreadsheetId, ALL_DEALS_TAB, tabMap, row)
}

/** Removes a deleted deal's row from every tab it might appear in. */
export async function removeDealFromSheet(accountId: string, dealId: string): Promise<void> {
  const integration = await getIntegration(accountId)
  const spreadsheetId = integration?.config?.spreadsheet_id
  if (!integration || !integration.is_active || !spreadsheetId) return

  const sheets = await getSheetsClient(accountId)
  const tabMap = await getSheetTabMap(sheets, spreadsheetId)

  for (const [tabName, sheetId] of tabMap) {
    const rowIndex = await findRow(sheets, spreadsheetId, tabName, dealId)
    if (rowIndex != null) await deleteRow(sheets, spreadsheetId, sheetId, rowIndex)
  }
}

const RESYNC_BATCH_SIZE = 50
const RESYNC_BATCH_DELAY_MS = 1000

/**
 * Full resync ("Sincronizar agora"): wipes every data tab, recreates
 * one per current pipeline stage (+ Ganhos/Perdidos/Todos os Deals),
 * and repopulates from every deal currently in the account. Writes are
 * batched via values.batchUpdate at up to RESYNC_BATCH_SIZE tab-writes
 * per call (each entry covers one tab's full row range in one shot, so
 * in practice this is one call unless an account has an unusual number
 * of stages), with a delay between batches to stay under Sheets API
 * write quota.
 */
export async function fullResync(accountId: string): Promise<{ tabs: number; deals: number }> {
  const integration = await getIntegration(accountId)
  const spreadsheetId = integration?.config?.spreadsheet_id
  if (!integration || !integration.is_active || !spreadsheetId) {
    throw new Error('google_sheets_not_connected')
  }

  const admin = supabaseAdmin()
  const sheets = await getSheetsClient(accountId)

  const { data: stages } = await admin
    .from('pipeline_stages')
    .select('name, pipeline_id, position, pipelines!inner(account_id)')
    .eq('pipelines.account_id', accountId)
    .order('position', { ascending: true })

  const stageNames = Array.from(new Set((stages ?? []).map((s) => s.name)))
  const allTabNames = [...stageNames, WON_TAB, LOST_TAB, ALL_DEALS_TAB]

  // 1. Wipe existing data tabs (clear contents, keep the tab itself if
  // it already exists so any manual formatting survives; recreate the
  // header afterwards).
  let tabMap = await getSheetTabMap(sheets, spreadsheetId)
  for (const tabName of allTabNames) {
    if (tabMap.has(tabName)) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `'${tabName}'!A1:${LAST_COLUMN_LETTER}`,
      })
    }
  }

  // 2. Recreate tabs (and headers) for anything missing.
  for (const tabName of allTabNames) {
    await ensureTab(sheets, spreadsheetId, tabName, tabMap)
  }
  tabMap = await getSheetTabMap(sheets, spreadsheetId)

  // 3. Fetch every deal in the account and group rows by target tab.
  const { data: dealIds } = await admin.from('deals').select('id').eq('account_id', accountId)
  const rows = (
    await Promise.all((dealIds ?? []).map((d) => fetchDealRow(d.id as string)))
  ).filter((r): r is DealRowData => r != null)

  const byTab = new Map<string, DealRowData[]>()
  for (const row of rows) {
    const tab = resolveTargetTab(row)
    if (!byTab.has(tab)) byTab.set(tab, [])
    byTab.get(tab)!.push(row)
    if (!byTab.has(ALL_DEALS_TAB)) byTab.set(ALL_DEALS_TAB, [])
    byTab.get(ALL_DEALS_TAB)!.push(row)
  }

  // 4. Write each tab's full row set as one ValueRange, batched.
  const data: sheets_v4.Schema$ValueRange[] = []
  for (const [tabName, tabRows] of byTab) {
    if (tabRows.length === 0) continue
    data.push({
      range: `'${tabName}'!A2:${LAST_COLUMN_LETTER}${tabRows.length + 1}`,
      values: tabRows.map((r) => toRowValues(r, tabName)),
    })
  }

  for (let i = 0; i < data.length; i += RESYNC_BATCH_SIZE) {
    const chunk = data.slice(i, i + RESYNC_BATCH_SIZE)
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data: chunk },
    })
    if (i + RESYNC_BATCH_SIZE < data.length) {
      await new Promise((resolve) => setTimeout(resolve, RESYNC_BATCH_DELAY_MS))
    }
  }

  return { tabs: allTabNames.length, deals: rows.length }
}
