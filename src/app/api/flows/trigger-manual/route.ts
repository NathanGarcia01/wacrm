import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { startManualRun } from '@/lib/flows/engine'

/**
 * POST /api/flows/trigger-manual
 *
 * Body: { flow_id, conversation_id, contact_id }
 *
 * Manually starts a flow run from the conversation sidebar — session
 * auth (not the cron secret) since it's an agent-initiated action.
 * Ownership of the flow is checked via the caller's RLS-scoped
 * client; the actual run creation happens in startManualRun, which
 * uses the same admin path as the webhook-driven runner.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as
    | { flow_id?: string; conversation_id?: string; contact_id?: string }
    | null
  const flowId = body?.flow_id
  const conversationId = body?.conversation_id
  const contactId = body?.contact_id
  if (!flowId || !conversationId || !contactId) {
    return NextResponse.json(
      { error: 'flow_id, conversation_id and contact_id are required' },
      { status: 400 },
    )
  }

  // Ownership/tenancy — RLS scopes this SELECT to flows the caller's
  // account can see, so a 404 here means "not found or not yours".
  const { data: flow } = await supabase
    .from('flows')
    .select('id, status')
    .eq('id', flowId)
    .maybeSingle()
  if (!flow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (flow.status !== 'active') {
    return NextResponse.json({ error: 'flow_not_active' }, { status: 422 })
  }

  const result = await startManualRun(flowId, contactId, conversationId)
  if (!result.ok) {
    const status = result.error === 'contact_has_active_run' ? 409 : 500
    return NextResponse.json({ error: result.error }, { status })
  }
  return NextResponse.json({ success: true, run_id: result.run_id })
}
