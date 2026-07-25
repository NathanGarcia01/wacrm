"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { trialDaysRemaining } from "@/lib/billing/trial";

const URGENT_THRESHOLD_DAYS = 3;

/**
 * Renders nothing for internal accounts, non-trialing subscriptions,
 * or once the trial has actually lapsed — that last case is handled
 * by <TrialExpiredGate> instead (full-page block, not a dismissible
 * banner).
 */
export function TrialBanner() {
  const t = useTranslations("billing.trialBanner");
  const { account } = useAuth();

  if (!account || account.is_internal) return null;
  if (account.subscriptionStatus !== "trialing") return null;

  const daysLeft = trialDaysRemaining(account.trialEnd);
  if (daysLeft === null || daysLeft <= 0) return null;

  const urgent = daysLeft < URGENT_THRESHOLD_DAYS;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
        urgent
          ? "border-red-500/30 bg-red-500/10 text-red-500"
          : "border-primary/20 bg-primary/5 text-foreground"
      }`}
    >
      <span className="font-medium">
        {urgent ? t("urgentExpiresIn", { days: daysLeft }) : t("expiresIn", { days: daysLeft })}
      </span>
      <Link
        href="/billing/plans"
        className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
          urgent
            ? "bg-red-500 text-white hover:bg-red-500/90"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        }`}
      >
        {t("subscribeNow")}
      </Link>
    </div>
  );
}
