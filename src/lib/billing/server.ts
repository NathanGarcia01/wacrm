import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlanFeatures, type PlanFeatures } from "./features";

/**
 * Server-side counterpart to the `usePlanFeatures()` client hook —
 * same "is_internal bypasses billing, unknown plan falls back to
 * Starter" rules, for API routes that must enforce a limit
 * server-side rather than just hiding a button. Never trust the
 * client's own idea of its plan for anything that mutates state.
 *
 * Accepts any Supabase client (RLS-scoped caller client or a
 * service-role admin client) — both can read `accounts`/
 * `subscriptions`/`plans` for the account in question given the
 * `is_account_member` / `plans_select (USING true)` policies from
 * migration 050.
 */
export async function getAccountPlanFeatures(
  supabase: SupabaseClient,
  accountId: string,
): Promise<PlanFeatures> {
  const [{ data: account }, { data: subscription }] = await Promise.all([
    supabase.from("accounts").select("is_internal").eq("id", accountId).maybeSingle(),
    supabase
      .from("subscriptions")
      .select("plans(code)")
      .eq("account_id", accountId)
      .maybeSingle(),
  ]);

  if (account?.is_internal) {
    return getPlanFeatures("business");
  }

  // Same object-vs-array embed ambiguity handled elsewhere in the
  // codebase (see use-auth.tsx, lib/admin/data.ts) — PostgREST's
  // typed client can surface a nested single-row embed as either.
  const plansEmbed = subscription?.plans as { code: string } | { code: string }[] | null | undefined;
  const planCode = Array.isArray(plansEmbed) ? plansEmbed[0]?.code : plansEmbed?.code;

  return getPlanFeatures(planCode ?? null);
}

/**
 * Server-side enforcement for maxChannels — called from both channel
 * creation routes (Cloud API and Evolution) right before they'd
 * otherwise create a new whatsapp_channels row. Counts every channel
 * regardless of is_active: a deactivated channel still occupies a
 * provisioned slot rather than freeing one up, so toggling one off
 * isn't a way around the limit.
 */
export async function checkChannelLimit(
  supabase: SupabaseClient,
  accountId: string,
): Promise<{ allowed: true } | { allowed: false; error: string }> {
  const features = await getAccountPlanFeatures(supabase, accountId);

  const { count, error } = await supabase
    .from("whatsapp_channels")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  if (error) {
    console.error("[checkChannelLimit] count query failed:", error);
    // Fail open on our own query error rather than blocking a
    // legitimate add over an unrelated DB hiccup — the count query is
    // read-only and narrowly scoped, so a failure here is far more
    // likely to be transient than a real limit violation.
    return { allowed: true };
  }

  if ((count ?? 0) >= features.maxChannels) {
    return {
      allowed: false,
      error:
        features.maxChannels === 1
          ? "Seu plano permite conectar apenas 1 número de WhatsApp. Faça upgrade para conectar mais números."
          : `Seu plano permite no máximo ${features.maxChannels} números de WhatsApp. Faça upgrade para conectar mais números.`,
    };
  }

  return { allowed: true };
}
