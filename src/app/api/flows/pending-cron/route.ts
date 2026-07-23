import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { resumePendingWorkflowExecution } from '@/lib/flows/workflow-engine'
import type { WorkflowTriggerContext } from '@/lib/flows/workflow-engine'

/**
 * Drain due `flow_pending_executions` rows — the workflow-mode mirror
 * of `/api/automations/cron`. Separate URL from that route (and from
 * `/api/flows/cron`, which sweeps abandoned CONVERSATIONAL runs) so
 * one failing doesn't block the others.
 *
 * Auth: re-uses `AUTOMATION_CRON_SECRET`, same as `/api/flows/cron`,
 * so operators only provision one secret across all three cron routes.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows — same pattern as
 * `/api/automations/cron`.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const { data: due, error } = await admin
    .from('flow_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!due || due.length === 0) return NextResponse.json({ processed: 0 })

  let processed = 0
  for (const row of due) {
    const { data: claim } = await admin
      .from('flow_pending_executions')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    await resumePendingWorkflowExecution({
      id: row.id as string,
      flow_id: row.flow_id as string,
      flow_run_id: row.flow_run_id as string,
      resume_node_key: row.resume_node_key as string,
      context: (row.context as WorkflowTriggerContext | null) ?? {},
    })
    processed++
  }

  return NextResponse.json({ processed })
}
