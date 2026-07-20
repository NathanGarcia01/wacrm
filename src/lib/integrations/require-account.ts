import { createClient } from '@/lib/supabase/server'
import { canEditSettings, isAccountRole } from '@/lib/auth/roles'

export interface AuthedAccount {
  userId: string
  accountId: string
  /** Owner/admin — the bar for connecting/disconnecting/resyncing an integration. */
  canEdit: boolean
}

export async function getAuthedAccount(): Promise<AuthedAccount | null> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return null

  const { data } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!data?.account_id) return null

  return {
    userId: user.id,
    accountId: data.account_id as string,
    canEdit: isAccountRole(data.account_role) && canEditSettings(data.account_role),
  }
}
