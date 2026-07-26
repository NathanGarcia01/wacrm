"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";

export interface PlanRow {
  id: string;
  code: string;
  name: string;
  price_per_seat_cents: number;
  sort_order: number;
}

const SEAT_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1);

/**
 * Client half of /billing/plans — the seat selector, live total, and
 * the actual "Assinar agora" → POST /api/billing/checkout → redirect
 * to Stripe flow. Needs useAuth() (for the signed-in account's current
 * plan/status and whether there's a session at all), but this page
 * lives outside the `(dashboard)` route group on purpose — it must
 * stay reachable when <AccessGate> would otherwise block a
 * trial-expired account — so it never gets the AuthProvider that
 * DashboardShell normally supplies. Wrapping just this component in
 * its own instance is self-contained and doesn't touch anything else.
 */
export function PricingCheckoutGrid({ plans }: { plans: PlanRow[] }) {
  return (
    <AuthProvider>
      <PricingCheckoutGridInner plans={plans} />
    </AuthProvider>
  );
}

function PricingCheckoutGridInner({ plans }: { plans: PlanRow[] }) {
  const t = useTranslations("billing.plansPage");
  const router = useRouter();
  const { user, account, profileLoading } = useAuth();
  const [seats, setSeats] = useState(1);
  const [loadingPlanCode, setLoadingPlanCode] = useState<string | null>(null);

  const handleSubscribe = useCallback(async (planCode: string) => {
    if (!user) {
      router.push("/signup");
      return;
    }
    setLoadingPlanCode(planCode);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode, seats }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        toast.error(data.error ?? t("checkoutFailed"));
        setLoadingPlanCode(null);
        return;
      }
      // Full navigation, not router.push — Stripe Checkout is a
      // different origin.
      window.location.href = data.url;
    } catch {
      toast.error(t("checkoutFailed"));
      setLoadingPlanCode(null);
    }
  }, [user, seats, router, t]);

  // Only an actually-paid, active subscription counts as "current
  // plan" — a trialing account is on the Starter plan_id by default
  // (see migration 050's signup trigger) but hasn't chosen/paid for
  // anything yet, so highlighting Starter as "current" there would
  // overstate a decision the user never made.
  const currentPlanCode =
    !profileLoading && account?.subscriptionStatus === "active" ? account.planCode : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-center gap-3">
        <label htmlFor="seats" className="text-sm text-muted-foreground">
          {t("seatsLabel")}
        </label>
        <select
          id="seats"
          value={seats}
          onChange={(e) => setSeats(Number(e.target.value))}
          className="h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary/50"
        >
          {SEAT_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = currentPlanCode === plan.code;
          const totalCents = plan.price_per_seat_cents * seats;
          const isLoading = loadingPlanCode === plan.code;

          return (
            <div
              key={plan.id}
              className={`flex flex-col gap-3 rounded-xl border p-5 ${
                isCurrent ? "border-primary bg-primary/5" : "border-border bg-card"
              }`}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-foreground">{plan.name}</h2>
                {isCurrent && (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                    {t("currentPlanBadge")}
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-semibold text-foreground">
                  {formatCurrency(plan.price_per_seat_cents / 100, "BRL")}
                </span>
                <span className="text-xs text-muted-foreground">/ {t("perSeat")}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("totalLabel", {
                  total: formatCurrency(totalCents / 100, "BRL"),
                  seats,
                })}
              </p>

              {isCurrent ? (
                <span className="mt-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-primary/30 text-sm font-medium text-primary">
                  <Check className="h-4 w-4" />
                  {t("currentPlanBadge")}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSubscribe(plan.code)}
                  disabled={isLoading || loadingPlanCode !== null}
                  className="mt-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("subscribeButton")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
