import { NextResponse } from 'next/server'
import { runRoutingCycle } from '@/lib/routing/cycle'

/**
 * Fase 1 (distribuição automática de tickets) — Etapa 2: ciclo
 * automático, agendado via pg_cron a cada minuto (migration 130).
 *
 * Auth: reusa AUTOMATION_CRON_SECRET via o header `x-cron-secret`,
 * mesmo padrão de /api/automations/cron, /api/flows/cron e
 * /api/broadcasts/cron — um único segredo para todos os crons.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await runRoutingCycle()
    return NextResponse.json({ success: true, ...summary })
  } catch (err) {
    console.error('[GET /api/routing/cron] cycle failed:', err)
    return NextResponse.json({ error: 'Routing cycle failed' }, { status: 500 })
  }
}
