import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/whatsapp/encryption'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'
import type { TemplateButton, TemplateSampleValues } from '@/types'

/**
 * Sync message templates from Meta → local message_templates table.
 *
 * The local catalog stores Meta's status enum verbatim (APPROVED /
 * PENDING / REJECTED / PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION)
 * so the edit / resubmit / delete flows can distinguish recoverable
 * states (PAUSED) from terminal ones (DISABLED) and so webhook events
 * land 1:1 without a translation table.
 *
 * Locally-created templates (no Meta counterpart) are NOT deleted —
 * they remain visible so the user can notice drift and clean up.
 *
 * Syncs EVERY active Cloud API channel's WABA, not just the account's
 * default one (migration 105) — an account can have several numbers
 * on different WABAs (confirmed: one real account has 3), and only
 * the default's templates were ever pulled before, silently missing
 * the rest. Any template that was synced before but no longer appears
 * in ANY currently-connected WABA on this run gets flagged `orphaned`
 * (never deleted — old broadcasts may still reference it by name).
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaButton {
  type: string
  text: string
  url?: string
  phone_number?: string
  example?: string[] | string
}

interface MetaTemplateComponent {
  type: string
  text?: string
  format?: string
  buttons?: MetaButton[]
  example?: {
    header_text?: string[]
    header_handle?: string[]
    body_text?: string[][]
  }
}

interface MetaTemplate {
  id: string
  name: string
  language: string
  status: string
  category: string
  components?: MetaTemplateComponent[]
  quality_score?: { score?: string } | string
}

function normalizeCategory(
  meta: string,
): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = meta.toUpperCase()
  if (upper === 'UTILITY') return 'Utility'
  if (upper === 'AUTHENTICATION') return 'Authentication'
  return 'Marketing'
}

function normalizeQualityScore(
  raw: MetaTemplate['quality_score'],
): 'GREEN' | 'YELLOW' | 'RED' | null {
  const score =
    typeof raw === 'string' ? raw : raw?.score ? String(raw.score) : null
  if (!score) return null
  const upper = score.toUpperCase()
  return upper === 'GREEN' || upper === 'YELLOW' || upper === 'RED'
    ? (upper as 'GREEN' | 'YELLOW' | 'RED')
    : null
}

function parseButtons(metaButtons: MetaButton[] | undefined): TemplateButton[] {
  if (!metaButtons?.length) return []
  const out: TemplateButton[] = []
  for (const b of metaButtons) {
    switch (b.type?.toUpperCase()) {
      case 'QUICK_REPLY':
        out.push({ type: 'QUICK_REPLY', text: b.text })
        break
      case 'URL':
        out.push({
          type: 'URL',
          text: b.text,
          url: b.url ?? '',
          example: Array.isArray(b.example) ? b.example[0] : b.example,
        })
        break
      case 'PHONE_NUMBER':
        out.push({
          type: 'PHONE_NUMBER',
          text: b.text,
          phone_number: b.phone_number ?? '',
        })
        break
      case 'COPY_CODE':
        out.push({
          type: 'COPY_CODE',
          text: b.text,
          example: Array.isArray(b.example) ? b.example[0] ?? '' : b.example ?? '',
        })
        break
      // OTP, FLOW, etc — out of scope for v1; drop silently.
    }
  }
  return out
}

function extractSampleValues(
  body: MetaTemplateComponent | undefined,
  header: MetaTemplateComponent | undefined,
): TemplateSampleValues | null {
  // Meta returns body_text as a 2D array — one row per example set.
  // We take the first row (most templates have exactly one).
  const bodySample = body?.example?.body_text?.[0]
  const headerSample = header?.example?.header_text
  if (!bodySample?.length && !headerSample?.length) return null
  const sv: TemplateSampleValues = {}
  if (bodySample?.length) sv.body = bodySample
  if (headerSample?.length) sv.header = headerSample
  return sv
}

export async function POST() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Resolve the caller's account_id — both whatsapp_config and
    // the message_templates we sync into are account-scoped.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    // Every active Cloud API channel's WABA — not just the default
    // one (migration 105). Evolution channels have no Meta-hosted
    // templates, so they're excluded; dedupe by waba_id since more
    // than one connected number could in principle share a WABA
    // (keep the first channel's token found for a given WABA).
    const { data: channelRows, error: channelsErr } = await supabase
      .from('whatsapp_channels')
      .select('id, waba_id, access_token_encrypted')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .eq('channel_type', 'cloud_api')
      .not('waba_id', 'is', null)
      .order('created_at', { ascending: true })

    if (channelsErr) {
      return NextResponse.json({ error: channelsErr.message }, { status: 500 })
    }

    const wabasByToken = new Map<string, string>() // wabaId -> decrypted access token
    for (const row of channelRows ?? []) {
      const wabaId = row.waba_id as string
      if (!wabasByToken.has(wabaId)) {
        wabasByToken.set(wabaId, decrypt(row.access_token_encrypted as string))
      }
    }

    if (wabasByToken.size === 0) {
      return NextResponse.json(
        {
          error:
            'No connected WhatsApp Cloud API channel with a WABA found. Connect a number in Settings first.',
        },
        { status: 400 },
      )
    }

    const metaTemplates: (MetaTemplate & { wabaId: string })[] = []
    const wabaErrors: { wabaId: string; message: string }[] = []
    const truncatedWabaIds: string[] = []
    const PAGE_CAP = 20

    for (const [wabaId, accessToken] of wabasByToken) {
      let nextUrl:
        | string
        | null = `${META_API_BASE}/${wabaId}/message_templates?limit=100&fields=id,name,language,status,category,components,quality_score`
      let pageCount = 0

      // A stale/expired token on ONE secondary channel's WABA must not
      // block syncing the others — `break` out of this WABA's pages
      // on error and move on to the next entry in the outer loop.
      while (nextUrl && pageCount < PAGE_CAP) {
        pageCount++
        const metaRes: Response = await fetch(nextUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })

        if (!metaRes.ok) {
          let metaErr = `Meta API error: ${metaRes.status}`
          try {
            const body = await metaRes.json()
            if (body?.error?.message) metaErr = body.error.message
          } catch {
            // response wasn't JSON — keep the fallback
          }
          wabaErrors.push({ wabaId, message: metaErr })
          break
        }

        const metaBody: {
          data?: MetaTemplate[]
          paging?: { next?: string }
        } = await metaRes.json()
        if (metaBody.data) {
          metaTemplates.push(...metaBody.data.map((t) => ({ ...t, wabaId })))
        }
        nextUrl = metaBody.paging?.next ?? null
      }

      if (pageCount >= PAGE_CAP && nextUrl !== null) {
        truncatedWabaIds.push(wabaId)
      }
    }

    let inserted = 0
    let updated = 0
    const errors: { name: string; language: string; message: string }[] = []

    for (const t of metaTemplates) {
      const body = (t.components ?? []).find((c) => c.type === 'BODY')
      const header = (t.components ?? []).find((c) => c.type === 'HEADER')
      const footer = (t.components ?? []).find((c) => c.type === 'FOOTER')
      const buttons = (t.components ?? []).find((c) => c.type === 'BUTTONS')

      const parsedButtons = parseButtons(buttons?.buttons)
      const sampleValues = extractSampleValues(body, header)

      const headerFormat = header?.format?.toUpperCase()
      const headerType =
        headerFormat === 'TEXT' ||
        headerFormat === 'IMAGE' ||
        headerFormat === 'VIDEO' ||
        headerFormat === 'DOCUMENT'
          ? headerFormat.toLowerCase()
          : null

      const row = {
        // Account tenancy + user audit, same split as the submit
        // route. account_id is NOT NULL on message_templates
        // post-017, so an INSERT without it errors.
        account_id: accountId,
        user_id: user.id,
        name: t.name,
        category: normalizeCategory(t.category),
        language: t.language,
        header_type: headerType,
        header_content: header?.text ?? null,
        header_handle: header?.example?.header_handle?.[0] ?? null,
        body_text: body?.text ?? '',
        footer_text: footer?.text ?? null,
        buttons: parsedButtons.length ? parsedButtons : null,
        sample_values: sampleValues,
        status: normalizeStatus(t.status),
        meta_template_id: t.id,
        waba_id: t.wabaId,
        orphaned: false,
        quality_score: normalizeQualityScore(t.quality_score),
        updated_at: new Date().toISOString(),
      }

      const { data: existing, error: lookupErr } = await supabase
        .from('message_templates')
        .select('id')
        .eq('account_id', accountId)
        .eq('name', t.name)
        .eq('language', t.language)
        .maybeSingle()

      if (lookupErr) {
        errors.push({
          name: t.name,
          language: t.language,
          message: lookupErr.message,
        })
        continue
      }

      if (existing?.id) {
        const { error: updErr } = await supabase
          .from('message_templates')
          .update(row)
          .eq('id', existing.id)
        if (updErr) {
          errors.push({
            name: t.name,
            language: t.language,
            message: updErr.message,
          })
        } else {
          updated++
        }
      } else {
        const { error: insErr } = await supabase
          .from('message_templates')
          .insert(row)
        if (insErr) {
          errors.push({
            name: t.name,
            language: t.language,
            message: insErr.message,
          })
        } else {
          inserted++
        }
      }
    }

    // Orphan marking — any template with a Meta counterpart that did
    // NOT show up in any of this run's WABAs no longer belongs to a
    // connected channel (reconnected number, or deleted on Meta's
    // side). Never deletes — just hides from the default list/picker
    // (template-manager.tsx / template-picker.tsx both filter on this
    // going forward). Skipped entirely when a WABA errored out above:
    // a partial/failed fetch must never cause real templates from
    // that WABA to be wrongly marked orphaned.
    let orphaned = 0
    if (wabaErrors.length === 0) {
      const seenIds = metaTemplates.map((t) => t.id)
      const orphanQuery = supabase
        .from('message_templates')
        .update({ orphaned: true })
        .eq('account_id', accountId)
        .eq('orphaned', false)
        .not('meta_template_id', 'is', null)
      const { data: orphanedRows, error: orphanErr } =
        seenIds.length > 0
          ? await orphanQuery.not('meta_template_id', 'in', `(${seenIds.join(',')})`).select('id')
          : await orphanQuery.select('id')
      if (orphanErr) {
        errors.push({ name: '(orphan marking)', language: '', message: orphanErr.message })
      } else {
        orphaned = orphanedRows?.length ?? 0
      }
    }

    return NextResponse.json({
      success: errors.length === 0 && wabaErrors.length === 0,
      wabasSynced: wabasByToken.size - wabaErrors.length,
      wabasTotal: wabasByToken.size,
      total: metaTemplates.length,
      inserted,
      updated,
      orphaned,
      errors,
      wabaErrors,
      truncated: truncatedWabaIds.length > 0,
    })
  } catch (error) {
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to sync templates',
      },
      { status: 500 },
    )
  }
}
