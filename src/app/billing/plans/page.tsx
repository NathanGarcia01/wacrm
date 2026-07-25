import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/currency";

const SUPPORT_EMAIL = "suporte@funilly.tech";

interface PlanRow {
  id: string;
  code: string;
  name: string;
  price_per_seat_cents: number;
  sort_order: number;
}

/**
 * Simple pricing page — where the trial banner / expired-trial gate
 * send people to "assinar agora". Deliberately no checkout flow yet:
 * there's no Stripe Checkout/webhook wiring anywhere else in the app
 * either (the admin panel only manages subscriptions that already
 * exist), so wiring a real purchase flow here would be a much bigger,
 * separate project. For now this just shows the plans and routes
 * interest to a human via email.
 *
 * Lives outside the `(dashboard)` route group on purpose — it must
 * stay reachable for an account whose trial just expired, and
 * `(dashboard)/layout.tsx` wraps everything in `<AccessGate>`, which
 * would block this very page for exactly the people who need it.
 */
export default async function BillingPlansPage() {
  const t = await getTranslations("billing.plansPage");
  const supabase = await createClient();
  const { data } = await supabase
    .from("plans")
    .select("id, code, name, price_per_seat_cents, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const plans = (data ?? []) as PlanRow[];

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
          >
            <h2 className="text-base font-semibold text-foreground">{plan.name}</h2>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-semibold text-foreground">
                {formatCurrency(plan.price_per_seat_cents / 100, "BRL")}
              </span>
              <span className="text-xs text-muted-foreground">/ {t("perSeat")}</span>
            </div>
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Quero assinar o ${plan.name}`)}`}
              className="mt-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Check className="h-4 w-4" />
              {t("contactSales")}
            </a>
          </div>
        ))}
      </div>

      <Link
        href="/dashboard"
        className="mx-auto text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t("backToDashboard")}
      </Link>
    </div>
  );
}
