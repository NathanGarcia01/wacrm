// ============================================================
// Plan → feature limits. Single source of truth for what each plan
// unlocks, consulted by both client-side gates (hide/disable UI,
// show "Upgrade necessário") and server-side enforcement (reject the
// request even if the client was bypassed).
//
// Numbers here mirror the pricing copy in
// src/app/(marketing)/_components/pricing-grid.tsx and
// supabase's `plans` table `code` column — if either changes, update
// both together or the marketing page and the actual gate drift.
// ============================================================

export type PlanCode = "starter" | "pro" | "business";

export interface PlanFeatures {
  maxChannels: number;
  /** `Infinity` for unlimited — always compare with `count < maxBroadcastsPerMonth`,
   *  never render Infinity directly without a "ilimitado" branch. */
  maxBroadcastsPerMonth: number;
  hasAI: boolean;
  hasDailyReport: boolean;
  hasWebhookOut: boolean;
  hasAPI: boolean;
}

const PLAN_FEATURES: Record<PlanCode, PlanFeatures> = {
  starter: {
    maxChannels: 1,
    maxBroadcastsPerMonth: 500,
    hasAI: false,
    hasDailyReport: false,
    hasWebhookOut: false,
    hasAPI: false,
  },
  pro: {
    maxChannels: 3,
    maxBroadcastsPerMonth: Infinity,
    hasAI: false,
    hasDailyReport: false,
    hasWebhookOut: false,
    hasAPI: false,
  },
  business: {
    maxChannels: Infinity,
    maxBroadcastsPerMonth: Infinity,
    hasAI: true,
    hasDailyReport: true,
    hasWebhookOut: true,
    hasAPI: true,
  },
};

function isPlanCode(value: unknown): value is PlanCode {
  return value === "starter" || value === "pro" || value === "business";
}

/**
 * Resolves a plan identifier (the `plans.code` column — "starter" |
 * "pro" | "business") to its feature limits. Unknown/missing plan
 * (null, a fork's custom plan code, a row that predates this table)
 * falls back to Starter — the most restrictive tier — rather than
 * silently granting unlimited access when the plan can't be
 * determined.
 *
 * Does NOT special-case `accounts.is_internal` or trial status —
 * callers that need the "internal accounts bypass billing" rule
 * (see CLAUDE.md) or "what plan does a trialing account see" decide
 * that before calling this, e.g. `getPlanFeatures(isInternal ?
 * "business" : account.planCode)`. Keeping that branching at the
 * call site means this function stays a pure plan → limits lookup,
 * testable without needing to fake an account/subscription shape.
 */
export function getPlanFeatures(planCode: string | null | undefined): PlanFeatures {
  return PLAN_FEATURES[isPlanCode(planCode) ? planCode : "starter"];
}
