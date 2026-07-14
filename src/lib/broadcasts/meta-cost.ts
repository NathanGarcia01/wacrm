import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

interface MetaPricingRow {
  marketing_cost: number;
  utility_cost: number;
  authentication_cost: number;
}

/**
 * Per-message Meta rate for a template category, from the account's
 * configured `meta_pricing` row. Falls back to 0 (not "unknown") when
 * no row exists yet — an unconfigured account should show R$0 cost
 * rather than crash the ROI math; the UI prompts for manual entry
 * separately (see settings/whatsapp-config.tsx).
 */
function rateForCategory(pricing: MetaPricingRow | null, category: string | null): number {
  if (!pricing) return 0;
  switch (category) {
    case "Marketing":
      return pricing.marketing_cost;
    case "Utility":
      return pricing.utility_cost;
    case "Authentication":
      return pricing.authentication_cost;
    default:
      return 0;
  }
}

/**
 * Computes and persists a broadcast's real Meta cost: sent_count ×
 * the account's per-category rate. Called (a) right when a broadcast
 * finishes sending (see api/broadcasts/cron/route.ts), and (b) as a
 * lazy backfill for older broadcasts that completed before this
 * feature existed (see reports/broadcast-roi-queries.ts) — both paths
 * share this so the math can't drift between them.
 *
 * Safe to call repeatedly: recomputes from the current sent_count and
 * pricing every time, so a later pricing-table edit is reflected on
 * the next call rather than freezing the very first estimate forever.
 */
export async function computeAndSaveBroadcastCost(
  admin: DB,
  args: {
    broadcastId: string;
    accountId: string;
    templateCategory: string | null;
    sentCount: number;
  },
): Promise<number> {
  // One row per (account, country) — this app targets the Brazilian
  // market (see CLAUDE.md), so cost math only ever reads the BR row.
  const { data: pricing } = await admin
    .from("meta_pricing")
    .select("marketing_cost, utility_cost, authentication_cost")
    .eq("account_id", args.accountId)
    .eq("country_code", "BR")
    .maybeSingle();

  const rate = rateForCategory(pricing as MetaPricingRow | null, args.templateCategory);
  const totalCost = rate * args.sentCount;

  await admin
    .from("broadcasts")
    .update({
      meta_cost_marketing: pricing?.marketing_cost ?? 0,
      meta_cost_utility: pricing?.utility_cost ?? 0,
      meta_cost_authentication: pricing?.authentication_cost ?? 0,
      meta_total_cost: totalCost,
    })
    .eq("id", args.broadcastId);

  return totalCost;
}
