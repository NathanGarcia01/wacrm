"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { trialDaysRemaining } from "@/lib/billing/trial";

const SUPPORT_EMAIL = "suporte@funilly.tech";

function FullScreenMessage({
  title,
  description,
  ctaLabel,
  ctaHref,
}: {
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <div className="flex h-screen items-center justify-center bg-background px-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
        <Link
          href={ctaHref}
          className="mt-2 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}

/**
 * Wraps the dashboard shell's children. Blocks the whole app behind a
 * full-screen message in two cases:
 *   - accounts.is_active = false — a hard admin kill-switch, blocks
 *     even internal accounts (this is an explicit "shut this account
 *     off" action, not a billing state).
 *   - trial lapsed for a non-internal account with no active/other
 *     paid-adjacent status. Only `trialing` + past `trial_end` is
 *     gated here — past_due/unpaid/canceled aren't blocked by this
 *     change (scope kept to "trial expired", not a full dunning flow).
 *
 * Renders `children` unchanged for every other case, including while
 * `account` is still loading — DashboardShellInner already gates on
 * `loading`/`user` before this ever mounts, and briefly showing the
 * app before the account fetch settles is preferable to a flash of a
 * block screen that then disappears.
 */
export function AccessGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations("billing");
  const { account } = useAuth();

  if (!account) return <>{children}</>;

  if (!account.is_active) {
    return (
      <FullScreenMessage
        title={t("accountDisabled.title")}
        description={t("accountDisabled.description")}
        ctaLabel={t("accountDisabled.contact")}
        ctaHref={`mailto:${SUPPORT_EMAIL}`}
      />
    );
  }

  if (!account.is_internal && account.subscriptionStatus === "trialing") {
    const daysLeft = trialDaysRemaining(account.trialEnd);
    if (daysLeft !== null && daysLeft <= 0) {
      return (
        <FullScreenMessage
          title={t("trialExpired.title")}
          description={t("trialExpired.description")}
          ctaLabel={t("trialExpired.cta")}
          ctaHref="/billing/plans"
        />
      );
    }
  }

  return <>{children}</>;
}
