import { NextResponse } from 'next/server'
import { getAuthedAccount } from '@/lib/integrations/require-account'
import { disconnectGoogleSheets } from '@/lib/integrations/google-sheets'

export async function POST() {
  const account = await getAuthedAccount()
  if (!account) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!account.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await disconnectGoogleSheets(account.accountId)
  return NextResponse.json({ success: true })
}
