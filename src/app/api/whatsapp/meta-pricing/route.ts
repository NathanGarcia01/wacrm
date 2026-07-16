import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPricingModel } from '@/lib/whatsapp/meta-api'
import { resolveDefaultChannel } from '@/lib/whatsapp/channels'

/**
 * Account's Meta per-message rates (meta_pricing) used to compute
 * broadcast ROI. GET also probes the number's billing model
 * (pricing_model) as a courtesy — see getPricingModel's doc comment
 * for why that's informational only and not the rates themselves.
 */
export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

  // meta_pricing supports one row per (account, country) — this app
  // targets the Brazilian market (see CLAUDE.md), so the settings UI
  // and ROI math both only ever read/write the BR row.
  const { data: pricing } = await supabase
    .from('meta_pricing')
    .select('*')
    .eq('account_id', accountId)
    .eq('country_code', 'BR')
    .maybeSingle()

  let pricingModel: string | null = null
  const config = await resolveDefaultChannel(supabase, accountId)
  if (config) {
    try {
      const info = await getPricingModel({
        phoneNumberId: config.phoneNumberId,
        accessToken: config.accessToken,
      })
      pricingModel = info.pricing_model
    } catch {
      // Best-effort — an unconfigured/invalid token just means we
      // can't show the billing-model hint, not a request failure.
    }
  }

  return NextResponse.json({ pricing: pricing ?? null, pricingModel })
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json(
      { error: 'Your profile is not linked to an account.' },
      { status: 403 },
    )
  }
  if (profile?.account_role !== 'owner' && profile?.account_role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const marketingCost = Number(body?.marketing_cost)
  const utilityCost = Number(body?.utility_cost)
  const authenticationCost = Number(body?.authentication_cost)
  const countryCode = typeof body?.country_code === 'string' ? body.country_code : 'BR'

  if (
    !Number.isFinite(marketingCost) ||
    !Number.isFinite(utilityCost) ||
    !Number.isFinite(authenticationCost) ||
    marketingCost < 0 ||
    utilityCost < 0 ||
    authenticationCost < 0
  ) {
    return NextResponse.json({ error: 'Invalid rates.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('meta_pricing')
    .upsert(
      {
        account_id: accountId,
        country_code: countryCode,
        marketing_cost: marketingCost,
        utility_cost: utilityCost,
        authentication_cost: authenticationCost,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,country_code' },
    )
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ pricing: data })
}
