import { getTranslations } from "next-intl/server";

const SUPPORT_EMAIL = "suporte@funilly.tech";

/**
 * Landing spot for middleware's is_active redirect (see
 * src/middleware.ts) — kept outside `(dashboard)` on purpose, same
 * reason as /billing/plans, so it's reachable independent of the
 * dashboard shell's own gating. <AccessGate> renders the same message
 * inline for the client-side case; this page exists for the
 * server-redirect case (middleware never renders JSX, only redirects
 * to a URL).
 */
export default async function AccountDisabledPage() {
  const t = await getTranslations("billing.accountDisabled");

  return (
    <div className="flex h-screen items-center justify-center bg-background px-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="mt-2 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t("contact")}
        </a>
      </div>
    </div>
  );
}
