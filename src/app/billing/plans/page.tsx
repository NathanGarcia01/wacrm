import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { PricingCheckoutGrid, type PlanRow } from "./_components/pricing-checkout-grid";

/**
 * Pricing page with real Stripe Checkout — where the trial banner /
 * expired-trial gate send people to "assinar agora", and where a
 * signed-in account picks/changes plans. Logged-out visitors still see
 * the plans but get routed to /signup instead of Checkout (see
 * PricingCheckoutGrid) — subscribing without an account isn't
 * supported.
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

      <PricingCheckoutGrid plans={plans} />

      <Link
        href="/dashboard"
        className="mx-auto text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {t("backToDashboard")}
      </Link>
    </div>
  );
}
