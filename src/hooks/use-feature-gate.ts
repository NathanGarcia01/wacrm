"use client";

import { useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { getPlanFeatures, type PlanFeatures } from "@/lib/billing/features";

/** The boolean-flag subset of PlanFeatures — the numeric limits
 *  (maxChannels, maxBroadcastsPerMonth) need a count to compare
 *  against, so screens that gate on those read usePlanFeatures()
 *  directly instead of going through useFeatureGate. */
export type BooleanFeatureKey = {
  [K in keyof PlanFeatures]: PlanFeatures[K] extends boolean ? K : never;
}[keyof PlanFeatures];

/**
 * The account's current plan limits, with the `is_internal` billing
 * bypass already applied — internal accounts always read as
 * "business" here (see CLAUDE.md: "Conta is_internal=true bypassa
 * billing"), same rule <AccessGate> already applies for trial/active
 * gating. Trialing accounts are NOT special-cased: they get whatever
 * plan_id the signup trigger assigned (Starter — see migration 050),
 * so a trial shows Starter-tier limits unless the account is
 * upgraded or marked internal. If that's ever meant to change to "full
 * access during trial", it belongs here, not scattered across callers.
 */
export function usePlanFeatures(): PlanFeatures & { planCode: string | null } {
  const { account } = useAuth();
  const isInternal = account?.is_internal ?? false;
  const planCode = account?.planCode ?? null;

  return useMemo(
    () => ({
      ...getPlanFeatures(isInternal ? "business" : planCode),
      planCode,
    }),
    [isInternal, planCode],
  );
}

/** Convenience wrapper for the boolean gates (hasAI, hasDailyReport,
 *  hasWebhookOut, hasAPI) — `useFeatureGate("hasAI")` reads better at
 *  the call site than `usePlanFeatures().hasAI`. */
export function useFeatureGate(feature: BooleanFeatureKey): boolean {
  const features = usePlanFeatures();
  return features[feature];
}
